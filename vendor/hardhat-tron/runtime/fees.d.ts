import type { TronWeb } from 'tronweb';
export interface TransactionUserConfig {
  feeLimit?: number;
  energyPrice?: number;
}
export interface TransactionConfig {
  readonly feeLimit: number;
  readonly energyPrice?: number;
}
export function normalizeFeePolicy(value: unknown): TransactionConfig;
export function createFeePolicy(value: unknown): {
  resolve(
    tronWeb: TronWeb,
    gasLimit?: bigint | string | number | null,
  ): Promise<number>;
  feeLimit(value?: bigint | string | number): number;
};
