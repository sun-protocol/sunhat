import { sha256 } from '../build/index.js';
import { SunhatDeploymentError } from './errors.js';
import type { NetworkIdentity } from './types.js';

export function validateNetworkIdentity(identity: NetworkIdentity): void {
  if (!['evm', 'tron'].includes(identity.chain)) {
    invalid('unsupported chain');
  }
  if (!/^[0-9]+$/.test(identity.chainId)) {
    invalid('chainId must be an unsigned decimal string');
  }
  if (!identity.name.trim()) {
    invalid('network name is required');
  }
  if (!identity.genesisHash && !identity.instanceId) {
    invalid('genesisHash or instanceId is required');
  }
  for (const value of [identity.genesisHash, identity.instanceId]) {
    if (value !== undefined && !/^[A-Za-z0-9:_-]{1,256}$/.test(value)) {
      invalid('network discriminator contains unsafe characters');
    }
  }
}

export function networkKey(identity: NetworkIdentity): string {
  validateNetworkIdentity(identity);
  const name = identity.name
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'network';
  const discriminator = identity.genesisHash ?? identity.instanceId!;
  return `${identity.chain}-${identity.chainId}-${name}-${sha256(discriminator).slice(0, 12)}`;
}

function invalid(message: string): never {
  throw new SunhatDeploymentError(
    'NETWORK_IDENTITY_MISMATCH',
    `invalid network identity: ${message}`
  );
}
