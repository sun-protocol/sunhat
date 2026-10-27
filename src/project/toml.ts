import { parse } from 'smol-toml';

export function parseToml(text: string): unknown {
  return parse(text, {
    integersAsBigInt: true,
    // Node 20.11 does not provide Temporal.
    useLegacyDate: true,
  });
}
