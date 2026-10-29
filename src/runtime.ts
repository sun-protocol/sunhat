interface MinimumNodeVersion {
  readonly major: number;
  readonly minor: number;
}

export function isSupportedNode(
  version: string,
  minimum: MinimumNodeVersion = { major: 20, minor: 11 },
): boolean {
  const match = version.match(/^(\d+)\.(\d+)\.\d+$/u);
  if (!match) {
    return false;
  }
  const major = Number(match[1]);
  const minor = Number(match[2]);
  return (
    [20, 22, 24, 26].includes(major) &&
    (major > minimum.major ||
      (major === minimum.major && minor >= minimum.minor))
  );
}
