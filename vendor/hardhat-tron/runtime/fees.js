'use strict';

const { requestJson } = require('./transport');
const defaults = require('../../../config/tron-defaults.json');

function positiveNumber(value, field) {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${field} must be a positive safe integer`);
  }
  return value;
}

function normalizeFeePolicy(value) {
  if (
    value !== undefined &&
    (value === null || typeof value !== 'object' || Array.isArray(value))
  ) {
    throw new Error('tre.transaction must be an object');
  }
  const input = value ?? {};
  return Object.freeze({
    feeLimit: positiveNumber(
      input.feeLimit === undefined
        ? defaults.transaction.feeLimit
        : input.feeLimit,
      'tre.transaction.feeLimit',
    ),
    ...(input.energyPrice === undefined
      ? {}
      : {
          energyPrice: positiveNumber(
            input.energyPrice,
            'tre.transaction.energyPrice',
          ),
        }),
  });
}

function createFeePolicy(value) {
  const { getBigInt } = require('ethers');
  const policy = normalizeFeePolicy(value);
  function feeLimit(value = policy.feeLimit) {
    const amount = getBigInt(value, 'feeLimit');
    if (amount <= 0n || amount > BigInt(policy.feeLimit)) {
      throw new Error(
        'TRON feeLimit must be positive and within tre.transaction.feeLimit',
      );
    }
    return Number(amount);
  }
  async function resolve(tronWeb, gasLimit) {
    if (gasLimit === undefined || gasLimit === null) {
      return policy.feeLimit;
    }
    const energy = getBigInt(gasLimit, 'gasLimit');
    if (energy <= 0n) {
      throw new Error('TRON gasLimit must be a positive integer');
    }
    let price = policy.energyPrice;
    if (price === undefined) {
      const response = await requestJson(
        tronWeb,
        '/wallet/getchainparameters',
        { body: '{}' },
      );
      const entries = response?.chainParameter;
      const matches = Array.isArray(entries)
        ? entries.filter((entry) => entry?.key === 'getEnergyFee')
        : [];
      const raw = matches.length === 1 ? matches[0].value : undefined;
      if (
        !(
          (typeof raw === 'number' && Number.isSafeInteger(raw)) ||
          (typeof raw === 'string' && /^[0-9]+$/.test(raw)) ||
          typeof raw === 'bigint'
        ) ||
        BigInt(raw) <= 0n
      ) {
        throw new Error(
          'TRON getchainparameters must return one positive getEnergyFee',
          { cause: response },
        );
      }
      price = BigInt(raw);
    }
    return feeLimit(energy * BigInt(price));
  }
  return { resolve, feeLimit };
}

module.exports = { normalizeFeePolicy, createFeePolicy };
