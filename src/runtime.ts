import { compatibility } from './compatibility.js';

interface MinimumNodeVersion {
  readonly major: number;
  readonly minor: number;
}

export function isSupportedNode(
  version: string,
  minimum: MinimumNodeVersion = compatibility.node.minimum.cli,
): boolean {
  const match = version.match(/^(\d+)\.(\d+)\.\d+$/u);
  if (!match) {
    return false;
  }
  const major = Number(match[1]);
  const minor = Number(match[2]);
  return (
    compatibility.node.majors.includes(major) &&
    (major > minimum.major ||
      (major === minimum.major && minor >= minimum.minor))
  );
}

export function nodeSupportDescription(
  minimum: MinimumNodeVersion = compatibility.node.minimum.cli,
): string {
  const versions = compatibility.node.majors
    .filter((major) => major >= minimum.major)
    .map((major) =>
      major === minimum.major && minimum.minor > 0
        ? `${major}.${minimum.minor}+`
        : `${major}.x`,
    );
  return versions.length > 1
    ? `${versions.slice(0, -1).join(', ')} or ${versions.at(-1)}`
    : versions.join('');
}
