export function isCompatibleDependency(
  version: string,
  minimum: string,
): boolean {
  const actual = version
    .match(/^(\d+)\.(\d+)\.(\d+)$/u)
    ?.slice(1)
    .map(Number);
  const expected = minimum
    .match(/^(\d+)\.(\d+)\.(\d+)$/u)
    ?.slice(1)
    .map(Number);
  if (
    actual === undefined ||
    expected === undefined ||
    !actual.every(Number.isSafeInteger) ||
    !expected.every(Number.isSafeInteger)
  ) {
    return false;
  }
  const [major, minor, patch] = actual;
  const [expectedMajor, expectedMinor, expectedPatch] = expected;
  return (
    major === expectedMajor &&
    minor !== undefined &&
    expectedMinor !== undefined &&
    patch !== undefined &&
    expectedPatch !== undefined &&
    (major === 0
      ? minor === expectedMinor && patch >= expectedPatch
      : minor > expectedMinor ||
        (minor === expectedMinor && patch >= expectedPatch))
  );
}
