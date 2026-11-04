'use strict';

const {
  ParamType,
  Typed,
  assertArgument,
  getAddress,
  hexlify,
} = require('ethers');
const { toEvmAddress } = require('@openzeppelin/tron-runtime');

// ethers Result.slice() stays frozen, while ParamType.walkAsync writes into
// slices. Copy ABI containers only; leave scalar Addressable objects intact.
function mutableContainers(parameter, value) {
  if (Array.isArray(value)) {
    return Array.from(value, (entry, index) =>
      mutableContainers(
        parameter?.isArray()
          ? parameter.arrayChildren
          : parameter?.components?.[index],
        entry,
      ),
    );
  }
  if (parameter?.isTuple() && value !== null && typeof value === 'object') {
    return Object.fromEntries(
      parameter.components
        .filter((component) => component.name && component.name in value)
        .map((component) => [
          component.name,
          mutableContainers(component, value[component.name]),
        ]),
    );
  }
  return value;
}

async function normalizeArguments(
  inputs,
  values,
  convertAddress = toEvmAddress,
) {
  if (inputs.length !== values.length) {
    throw new Error(
      `Expected ${inputs.length} ABI arguments, received ${values.length}`,
    );
  }
  return Promise.all(
    inputs.map(async (input, index) => {
      const parameter = ParamType.from(input);
      const value = Typed.dereference(await values[index], parameter.baseType);
      return parameter.walkAsync(
        mutableContainers(parameter, value),
        async (type, leaf) => {
          let resolved = Typed.dereference(await leaf, type);
          if (type === 'address') {
            if (resolved && typeof resolved.getAddress === 'function') {
              resolved = await resolved.getAddress();
            } else if (resolved && typeof resolved === 'object') {
              resolved =
                resolved.tronAddress ?? resolved.target ?? resolved.address;
            }
            return getAddress(convertAddress(resolved));
          }
          if (type === 'bytes' || /^bytes[0-9]+$/.test(type)) {
            return hexlify(resolved);
          }
          return resolved;
        },
      );
    }),
  );
}

// Contract methods retain their established accepted address forms. Deployment
// parameters also accept the runtime codec's prefixed TRON hex representation.
function normalizeCallArguments(inputs, values) {
  return normalizeArguments(inputs, values, (address) => {
    assertArgument(
      typeof address === 'string' &&
        (/^0x[0-9a-fA-F]{40}$/.test(address) ||
          /^41[0-9a-fA-F]{40}$/.test(address) ||
          (address.startsWith('T') && address.length === 34)),
      'invalid address',
      'address',
      address,
    );
    return toEvmAddress(address);
  });
}

function splitOverrides(args, expectedInputCount) {
  if (args.length !== expectedInputCount + 1) {
    return { overrides: {}, args };
  }
  const overrides = Typed.dereference(args[args.length - 1], 'overrides');
  if (
    overrides === null ||
    typeof overrides !== 'object' ||
    Array.isArray(overrides)
  ) {
    throw new Error('Contract overrides must be an object');
  }
  return { overrides, args: args.slice(0, -1) };
}

module.exports = { normalizeArguments, normalizeCallArguments, splitOverrides };
