import { HDNodeWallet, SigningKey } from 'ethers';
import type { HttpNetworkConfig } from 'hardhat/types/config';

export async function resolveSigningAccounts(
  config: HttpNetworkConfig['accounts'],
): Promise<string[]> {
  const accounts: string[] = [];
  if (config === 'remote') {
    // Native writes require local keys; remote accounts remain read-only.
  } else if (Array.isArray(config)) {
    for (const account of config) {
      accounts.push(await account.getHexString());
    }
  } else {
    const mnemonic = await config.mnemonic.get();
    const passphrase = await config.passphrase.get();
    for (let index = 0; index < config.count; index += 1) {
      accounts.push(
        HDNodeWallet.fromPhrase(
          mnemonic,
          passphrase,
          `${config.path}/${config.initialIndex + index}`,
        ).privateKey,
      );
    }
  }
  for (const key of accounts) {
    if (!/^0x[a-fA-F0-9]{64}$/u.test(key)) {
      throw new Error('Invalid TRON signing account format');
    }
    try {
      void new SigningKey(key).publicKey;
    } catch {
      throw new Error('Invalid TRON signing account');
    }
  }
  return accounts;
}
