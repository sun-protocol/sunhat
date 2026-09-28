import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  selectVyperCompilerGroups,
  SunhatBuildError,
} from '../src/v2/build/index.js';
import type { BuildSource } from '../src/v2/build/index.js';
import { normalizeSunhatConfig } from '../src/v2/config/index.js';

describe('Sunhat P2 Vyper compiler routing', () => {
  it('selects the highest compatible compiler for each exact or ranged pragma', () => {
    const compilers = vyperCompilers();
    const groups = selectVyperCompilerGroups(
      [
        vyperSource('contracts/Legacy.vy', '# pragma version 0.2.8\n'),
        vyperSource(
          'contracts/Modern.vy',
          '# pragma version >=0.4.0,<0.5.0\n'
        ),
        vyperSource('contracts/Unpinned.vy', 'value: uint256\n'),
      ],
      compilers,
      {}
    );

    assert.deepEqual(
      [...groups.entries()].map(([compiler, roots]) => [
        compiler.id,
        roots.map(({ sourceName }) => sourceName),
      ]),
      [
        [
          'modern',
          ['contracts/Modern.vy', 'contracts/Unpinned.vy'],
        ],
        ['legacy', ['contracts/Legacy.vy']],
      ]
    );
  });

  it('honors a compatible file override', () => {
    const compilers = vyperCompilers();
    const groups = selectVyperCompilerGroups(
      [vyperSource('contracts/Explicit.vy', 'value: uint256\n')],
      compilers,
      { 'contracts/Explicit.vy': 'legacy' }
    );

    assert.equal([...groups.keys()][0].id, 'legacy');
  });

  it('fails closed when an override violates the source pragma', () => {
    assert.throws(
      () =>
        selectVyperCompilerGroups(
          [
            vyperSource(
              'contracts/Modern.vy',
              '# pragma version ^0.4.0\n'
            ),
          ],
          vyperCompilers(),
          { 'contracts/Modern.vy': 'legacy' }
        ),
      buildError('BUILD_FAILED')
    );
  });

  it('rejects unsupported or ambiguous pragma syntax', () => {
    assert.throws(
      () =>
        selectVyperCompilerGroups(
          [
            vyperSource(
              'contracts/Bad.vy',
              '# pragma version ^0.4.0 || ^0.3.0\n'
            ),
          ],
          vyperCompilers(),
          {}
        ),
      buildError('UNSUPPORTED_SOURCE_LAYOUT')
    );
  });
});

function vyperCompilers() {
  return normalizeSunhatConfig({
    compilation: {
      targets: {
        evm: {
          chain: 'evm',
          sources: ['contracts'],
          compilers: [
            {
              id: 'legacy',
              kind: 'vyper',
              path: '/opt/vyper-0.2.8/bin/vyper-json',
              sha256: '2'.repeat(64),
              version: '0.2.8',
            },
            {
              id: 'modern',
              kind: 'vyper',
              path: '/opt/vyper-0.4.3/bin/vyper-json',
              sha256: '4'.repeat(64),
              version: '0.4.3',
            },
          ],
        },
      },
    },
  }).compilation.targets.evm.compilers;
}

function vyperSource(sourceName: string, content: string): BuildSource {
  return {
    absolutePath: `/${sourceName}`,
    content,
    language: 'vyper',
    sha256: '0'.repeat(64),
    sourceName,
  };
}

function buildError(code: SunhatBuildError['code']) {
  return (error: unknown): boolean => {
    assert.ok(error instanceof SunhatBuildError);
    assert.equal(error.code, code);
    return true;
  };
}
