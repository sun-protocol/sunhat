import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import createConfigHooks, {
  resolveSunhatConfigurationVariables,
  validateSunhatUserConfig,
} from '../src/v2/plugin/config-hook.js';
import type { HardhatUserConfigLike } from '../src/v2/plugin/contracts.js';

describe('Sunhat Hardhat 3 config hook', () => {
  it('returns a Hardhat-compatible path for config validation errors', () => {
    const errors = validateSunhatUserConfig({
      sunhat: {
        compilation: {
          targets: {
            evm: {
              chain: 'evm',
              sources: ['contracts'],
              compilers: [
                {
                  id: 'solidity',
                  kind: 'solc',
                  version: '^0.8.25',
                },
              ],
            },
          },
        },
      },
    });

    assert.deepEqual(errors[0].path, [
      'sunhat',
      'compilation',
      'targets',
      'evm',
      'compilers',
      0,
      'version',
    ]);
    assert.match(errors[0].message, /exact compiler version/);
  });

  it('accepts paired Hardhat configuration variables before resolution', () => {
    const config = vyperVariableConfig();
    assert.deepEqual(validateSunhatUserConfig(config), []);
  });

  it('does not mutate prototypes while cloning untrusted config keys', () => {
    const sunhat = JSON.parse(`{
      "__proto__": { "polluted": true },
      "compilation": { "targets": {} }
    }`);
    const errors = validateSunhatUserConfig({ sunhat });

    assert.equal(({} as { polluted?: boolean }).polluted, undefined);
    assert.deepEqual(errors[0].path, ['sunhat', '__proto__']);
    assert.match(errors[0].message, /unknown configuration field/);
  });

  it('resolves compiler secrets before enforcing path and digest invariants', async () => {
    const raw = vyperVariableConfig().sunhat;
    const resolved = await resolveSunhatConfigurationVariables(raw, (value) => ({
      async get() {
        assert.equal(typeof value, 'object');
        const name = (value as { name: string }).name;
        return name === 'VYPER_PATH' ? '/opt/vyper/bin/vyper-json' : 'a'.repeat(64);
      },
    }));

    const hooks = await createConfigHooks();
    const finalConfig = await hooks.resolveUserConfig!(
      { ...vyperVariableConfig(), sunhat: resolved as never },
      () => ({ get: async () => '' }),
      async () => ({ paths: { root: '/project' } })
    );
    assert.equal(
      finalConfig.sunhat?.compilation.targets.evm.compilers[0].path,
      '/opt/vyper/bin/vyper-json'
    );
    assert.equal(
      finalConfig.sunhat?.compilation.targets.evm.compilers[0].sha256,
      'a'.repeat(64)
    );
    assert.equal(Object.isFrozen(finalConfig.sunhat), true);
  });

  it('calls the next resolver and publishes normalized network bindings', async () => {
    const hooks = await createConfigHooks();
    let called = false;
    const userConfig: HardhatUserConfigLike = {
      networks: {
        hardhatMainnet: {
          type: 'edr-simulated',
          chainType: 'l1',
          sunhat: { target: 'evm' },
        },
      },
      sunhat: solidityConfig(),
    };
    const finalConfig = await hooks.resolveUserConfig!(
      userConfig,
      () => ({ get: async () => '' }),
      async () => {
        called = true;
        return { paths: { root: '/project' } };
      }
    );

    assert.equal(called, true);
    assert.equal(finalConfig.sunhat?.networks.hardhatMainnet.target, 'evm');
    assert.deepEqual(await hooks.validateResolvedConfig!(finalConfig), []);
  });
});

function solidityConfig() {
  return {
    compilation: {
      targets: {
        evm: {
          chain: 'evm' as const,
          sources: ['contracts'],
          compilers: [
            {
              id: 'solidity',
              kind: 'solc' as const,
              version: '0.8.25',
            },
          ],
        },
      },
    },
  };
}

function vyperVariableConfig(): HardhatUserConfigLike {
  return {
    sunhat: {
      compilation: {
        targets: {
          evm: {
            chain: 'evm',
            sources: ['contracts'],
            compilers: [
              {
                id: 'vyper',
                kind: 'vyper',
                version: '0.4.3',
                path: { _type: 'ConfigurationVariable', name: 'VYPER_PATH' },
                sha256: { _type: 'ConfigurationVariable', name: 'VYPER_SHA256' },
              },
            ],
          },
        },
      },
    },
  };
}
