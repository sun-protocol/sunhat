import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

export function setArchiveDigest(configuration, archive) {
  const config = JSON.parse(readFileSync(configuration, 'utf8'));
  const platform = `${process.platform}-${process.arch === 'x64' ? 'amd64' : process.arch}`;
  config.platforms[platform].sha256 = createHash('sha256')
    .update(readFileSync(archive))
    .digest('hex');
  writeFileSync(configuration, `${JSON.stringify(config, null, 2)}\n`);
}
