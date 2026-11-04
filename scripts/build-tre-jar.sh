#!/usr/bin/env bash
#
# Builds the patched FullNode.jar from test/fixtures/tre-patch/src and stages it at
# .sunhat/tre/FullNode.jar. The consumer's container config mounts that
# file over the image's stock jar so the container starts already
# patched — no in-flight restart, no race with pre-approve.
#
# Run this once after each change to the Java patch sources, and after
# every TRE image bump. The output jar is gitignored.
#
# Strategy:
#   1. Copy the stock FullNode.jar out of the TRE image (`docker create`
#      + `docker cp`; the node never starts).
#   2. Compile the patch sources in a throwaway JDK container against
#      that jar. TRE 2.0 ships a jlink-trimmed JRE without javac, so
#      compiling inside the TRE image (what this script did for TRE 1.x,
#      which had OpenJDK 8) no longer works. The `--release` level is
#      derived from the stock jar's own class-file version (52 → 8,
#      61 → 17) so the emitted classes always load on the runtime the
#      image actually ships.
#   3. Repack: every .class produced by the compile replaces the
#      corresponding entry in the stock jar (new classes are added).
#
# Env knobs:
#   TRE_IMAGE  image to patch. Defaults to config/tron-defaults.json.
#   JDK_IMAGE  compiler image. Defaults to config/tron-defaults.json.
#   TRE_JAR    path of FullNode.jar inside TRE_IMAGE. Auto-detected.
#   SUNHAT_TRE_JAR_OUTPUT  output path; defaults to .sunhat/tre/FullNode.jar.
#
set -euo pipefail
cd "$(dirname "$0")/.."

read_default() {
  python3 - "$1" <<'PYTHON'
import json
import sys

path = 'config/tron-defaults.json'
field = sys.argv[1]
with open(path, encoding='utf-8') as source:
    defaults = json.load(source)
value = defaults.get(field) if isinstance(defaults, dict) else None
if not isinstance(value, str) or not value.strip():
    sys.exit(f'Invalid TRON default {field} in {path}: expected a non-empty string')
print(value)
PYTHON
}

TRE_IMAGE="${TRE_IMAGE:-$(read_default image)}"
JDK_IMAGE="${JDK_IMAGE:-$(read_default jdkImage)}"
OUT="${SUNHAT_TRE_JAR_OUTPUT:-.sunhat/tre/FullNode.jar}"

WORK="$(mktemp -d)"
TEMP="sunhat-tron-jar-build-$(python3 -c 'import uuid; print(uuid.uuid4())')"
CREATED=false
cleanup() {
  status=$?
  trap - EXIT
  if [ "$CREATED" = true ]; then
  removal="$(docker rm -f "$TEMP" 2>&1)" || {
    case "$removal" in
      *"No such container"*) ;;
      *) printf 'Failed to remove owned TRE build container %s: %s\n' "$TEMP" "$removal" >&2 || true
         if [ "$status" -eq 0 ]; then status=1; fi ;;
    esac
  }
  fi
  rm -rf "$WORK" || {
    printf 'Failed to clean TRE build directory %s\n' "$WORK" >&2 || true
    if [ "$status" -eq 0 ]; then status=1; fi
  }
  exit "$status"
}
trap cleanup EXIT

echo "→ Locating stock FullNode.jar in $TRE_IMAGE..."
if [ -z "${TRE_JAR:-}" ]; then
  # TRE 1.x kept the jar at /tron/FullNode/FullNode.jar; fall back to a
  # search for other layouts.
  TRE_JAR="$(docker run --rm --entrypoint sh "$TRE_IMAGE" -c \
    'if [ -f /tron/FullNode/FullNode.jar ]; then echo /tron/FullNode/FullNode.jar; else find / -name "FullNode*.jar" -not -path "/proc/*" 2>/dev/null | head -1; fi')"
fi
if [ -z "$TRE_JAR" ]; then
  echo "error: no FullNode.jar found in $TRE_IMAGE (set TRE_JAR to its path)" >&2
  exit 1
fi
echo "  $TRE_JAR"

docker create --name "$TEMP" --entrypoint sh "$TRE_IMAGE" >/dev/null
CREATED=true
docker cp "$TEMP:$TRE_JAR" "$WORK/upstream.jar"
docker rm -f "$TEMP" >/dev/null
CREATED=false

# Class-file major version of a class we overlay → javac --release level
# (major 44 + N is Java N: 52 = Java 8, 61 = Java 17).
MAJOR="$(unzip -p "$WORK/upstream.jar" org/tron/core/capsule/TransactionCapsule.class \
  | python3 -c 'import sys; b = sys.stdin.buffer.read(8); print(b[6] * 256 + b[7])')"
RELEASE=$((MAJOR - 44))
echo "→ Stock jar class-file version $MAJOR → javac --release $RELEASE"

echo "→ Compiling patch sources in $JDK_IMAGE..."
mkdir -p "$WORK/build"
cp -R test/fixtures/tre-patch/src "$WORK/src"
docker run --rm --user "$(id -u):$(id -g)" -v "$WORK:/work" -w /work "$JDK_IMAGE" sh -c "
  javac -encoding UTF-8 --release $RELEASE -classpath /work/upstream.jar -d /work/build \
    \$(find /work/src -name '*.java' | sort)
"

echo "→ Repacking jar..."
python3 - "$WORK/upstream.jar" "$WORK/patched.jar" "$WORK/build" <<'PY'
import os
import sys
import zipfile

src, dst, staging = sys.argv[1:4]

# java-tron's jar carries duplicate entries (META-INF/LICENSE twice).
# CPython 3.12+ (and the 3.8.20 / 3.9.20 / 3.11.10 backports) refuses
# to read those: "Overlapped entries ... (possible zip bomb)". The repack
# below de-dupes by filename and keeps the first copy, so disable the
# guard by clearing the offset it tests.
_orig = zipfile.ZipFile._RealGetContents


def _lenient(self):
    _orig(self)
    for info in self.filelist:
        try:
            info._end_offset = None
        except AttributeError:
            pass


zipfile.ZipFile._RealGetContents = _lenient

# Glob every .class produced by the patch compile (top-level classes
# PLUS their nested inner classes — e.g. TreJsonRpcImpl$SnapshotEntry.class).
# Anything emitted into the staging tree replaces the corresponding
# entry in the upstream jar.
patches = {}
for root, _, files in os.walk(staging):
    for f in files:
        if f.endswith(".class"):
            abs_path = os.path.join(root, f)
            patches[os.path.relpath(abs_path, staging)] = abs_path

with zipfile.ZipFile(src) as zin, zipfile.ZipFile(dst, "w", zipfile.ZIP_DEFLATED) as zout:
    upstream_names = set(zin.namelist())
    replaced = sorted(n for n in patches if n in upstream_names)
    added = sorted(n for n in patches if n not in upstream_names)
    print(f"patching {len(patches)} class file(s): {len(replaced)} replaced, {len(added)} added")
    for n in replaced:
        print(f"  replace {n}")
    for n in added:
        print(f"  add     {n}")
    seen = set()
    for item in zin.infolist():
        if item.filename in patches or item.filename in seen:
            continue
        seen.add(item.filename)
        zout.writestr(item, zin.read(item.filename))
    for name, path in patches.items():
        with open(path, "rb") as fh:
            zout.writestr(name, fh.read())
print("repack OK")
PY

mkdir -p "$(dirname "$OUT")"
mv "$WORK/patched.jar" "$OUT"
echo ""
echo "Patched jar staged at: $OUT (built from $TRE_IMAGE, $TRE_JAR)"
echo "Wire it into your hardhat config via tre.jarPath, then 'npx hardhat test'"
echo "starts a fresh container with the patch baked in."
