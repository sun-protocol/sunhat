import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import {
  mkdir,
  mkdtemp,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { SunhatBuildError } from './errors.js';
import type { BuildDiagnostic } from './errors.js';
import { canonicalJson, sha256 } from './hash.js';
import type {
  BackendBuildResult,
  BuildSource,
} from './types.js';
import type {
  NormalizedCompilationTarget,
  NormalizedCompilerConfig,
} from '../config/index.js';

const MAX_COMPILER_OUTPUT_BYTES = 64 * 1024 * 1024;
const COMPILER_TIMEOUT_MS = 120_000;

export interface VyperBuildRequest {
  readonly artifactDirectory: string;
  readonly projectRoot: string;
  readonly sources: readonly BuildSource[];
  readonly target: NormalizedCompilationTarget;
  readonly targetName: string;
}

interface VyperCompilation {
  readonly buildInfoId: string;
  readonly compiler: Readonly<Record<string, unknown>>;
  readonly diagnostics: readonly BuildDiagnostic[];
  readonly input: unknown;
  readonly output: Record<string, any>;
  readonly roots: readonly BuildSource[];
}

export class VyperCompiler {
  public async build(request: VyperBuildRequest): Promise<BackendBuildResult> {
    const roots = request.sources.filter(({ language }) => language === 'vyper');
    const compilers = request.target.compilers.filter(
      (compiler) => compiler.kind === 'vyper'
    );
    if (compilers.length === 0) {
      throw new SunhatBuildError(
        'MISSING_COMPILER_EXECUTABLE',
        `target "${request.targetName}" contains Vyper sources but no Vyper compiler`
      );
    }
    const groups = selectVyperCompilerGroups(
      roots,
      compilers,
      request.target.overrides
    );
    const compilations: VyperCompilation[] = [];
    for (const [compiler, compilerRoots] of groups) {
      compilations.push(
        await compileVyperGroup(request, compiler, compilerRoots)
      );
    }
    await emitVyperArtifacts(request.artifactDirectory, compilations);
    const diagnostics = Object.freeze(
      compilations.flatMap((compilation) => compilation.diagnostics)
    );
    return Object.freeze({
      diagnostics,
      metadata: Object.freeze({
        buildInfoIds: Object.freeze(
          compilations.map(({ buildInfoId }) => buildInfoId)
        ),
        compilers: Object.freeze(
          compilations.map(({ compiler }) => compiler)
        ),
        language: 'vyper',
      }),
    });
  }
}

async function compileVyperGroup(
  request: VyperBuildRequest,
  compiler: NormalizedCompilerConfig,
  roots: readonly BuildSource[]
): Promise<VyperCompilation> {
    if (compiler.path === undefined || compiler.sha256 === undefined) {
      throw new SunhatBuildError(
        'MISSING_COMPILER_EXECUTABLE',
        `${compiler.id} requires an absolute vyper-json path and SHA-256`
      );
    }

    const versionResult = await runProcess(compiler.path, ['--version']);
    if (versionResult.code !== 0) {
      throw processError(compiler, versionResult.stderr);
    }
    const actualVersion = versionResult.stdout.trim();
    if (
      actualVersion !== compiler.version &&
      !actualVersion.startsWith(`${compiler.version}+`)
    ) {
      throw new SunhatBuildError(
        'COMPILER_INTEGRITY_MISMATCH',
        `${compiler.id} reports version ${actualVersion}, expected ${compiler.version}`
      );
    }
    const environmentLock = await readPythonEnvironmentLock(compiler.path);
    const input = createVyperInput(request.sources, roots, compiler);
    const isolatedWorkingDirectory = await mkdtemp(
      path.join(os.tmpdir(), 'sunhat-vyper-build-')
    );
    let compileResult: Awaited<ReturnType<typeof runProcess>>;
    try {
      compileResult = await runProcess(
        compiler.path,
        [],
        canonicalJson(input),
        isolatedWorkingDirectory
      );
    } finally {
      await rm(isolatedWorkingDirectory, { force: true, recursive: true });
    }
    if (compileResult.code !== 0 && compileResult.stdout.trim() === '') {
      throw processError(compiler, compileResult.stderr);
    }

    let output: Record<string, any>;
    try {
      output = JSON.parse(compileResult.stdout);
    } catch {
      throw new SunhatBuildError(
        'INVALID_BUILD_OUTPUT',
        `${compiler.id} returned invalid JSON: ${compileResult.stderr.trim()}`
      );
    }
    const diagnostics = normalizeVyperDiagnostics(output.errors);
    if (
      compileResult.code !== 0 ||
      diagnostics.some(({ severity }) => severity === 'error')
    ) {
      throw new SunhatBuildError(
        'BUILD_FAILED',
        `${compiler.id} rejected the Vyper sources`,
        diagnostics
      );
    }

    const compilerEvidence = Object.freeze({
      environmentLock,
      executableSha256: compiler.sha256,
      id: compiler.id,
      kind: compiler.kind,
      version: actualVersion,
    });
    const buildInfoId = `vyper-${compiler.version}-${sha256(
      canonicalJson({ compiler: compilerEvidence, input })
    )}`;
    return Object.freeze({
      buildInfoId,
      compiler: compilerEvidence,
      diagnostics,
      input,
      output,
      roots,
    });
}

function createVyperInput(
  sources: readonly BuildSource[],
  roots: readonly BuildSource[],
  compiler: NormalizedCompilerConfig
) {
  const selectedRoots = new Set(roots.map(({ sourceName }) => sourceName));
  const inputSources: Record<string, { content: string }> = Object.create(null);
  for (const source of sources) {
    if (
      (source.language === 'vyper' && selectedRoots.has(source.sourceName)) ||
      source.language === 'vyper-interface' ||
      source.language === 'json'
    ) {
      inputSources[source.sourceName] = { content: source.content };
    }
  }
  return {
    language: 'Vyper',
    sources: inputSources,
    settings: {
      ...compiler.settings,
      outputSelection: {
        '*': ['abi', 'evm.bytecode.object', 'evm.deployedBytecode.object'],
      },
    },
  };
}

async function emitVyperArtifacts(
  artifactDirectory: string,
  compilations: readonly VyperCompilation[]
): Promise<void> {
  const temporaryDirectory =
    `${artifactDirectory}.tmp-${process.pid}-` +
    randomBytes(6).toString('hex');
  await rm(temporaryDirectory, { force: true, recursive: true });
  await mkdir(path.join(temporaryDirectory, 'build-info'), { recursive: true });
  try {
    for (const compilation of compilations) {
      for (const root of compilation.roots) {
        const contracts = compilation.output.contracts?.[root.sourceName];
        if (contracts === undefined || typeof contracts !== 'object') {
          throw new SunhatBuildError(
            'INVALID_BUILD_OUTPUT',
            `vyper-json returned no contracts for ${root.sourceName}`
          );
        }
        for (const [contractName, contractOutput] of Object.entries<any>(contracts)) {
          if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(contractName)) {
            throw new SunhatBuildError(
              'INVALID_BUILD_OUTPUT',
              `vyper-json returned an unsafe contract name: ${contractName}`
            );
          }
          const bytecode = contractOutput.evm?.bytecode?.object;
          const deployedBytecode = contractOutput.evm?.deployedBytecode?.object;
          if (
            !Array.isArray(contractOutput.abi) ||
            typeof bytecode !== 'string' ||
            typeof deployedBytecode !== 'string'
          ) {
            throw new SunhatBuildError(
              'INVALID_BUILD_OUTPUT',
              `vyper-json returned an incomplete artifact for ${root.sourceName}:${contractName}`
            );
          }
          const artifact = {
            _format: 'sunhat-vyper-artifact-1',
            abi: contractOutput.abi,
            buildInfoId: compilation.buildInfoId,
            bytecode: normalizeBytecode(bytecode),
            contractName,
            deployedBytecode: normalizeBytecode(deployedBytecode),
            sourceName: root.sourceName,
          };
          const outputPath = path.join(
            temporaryDirectory,
            root.sourceName,
            `${contractName}.json`
          );
          await mkdir(path.dirname(outputPath), { recursive: true });
          await writeJson(outputPath, artifact);
        }
      }
      await Promise.all([
        writeJson(
          path.join(
            temporaryDirectory,
            'build-info',
            `${compilation.buildInfoId}.json`
          ),
          {
            _format: 'sunhat-vyper-build-info-1',
            compiler: compilation.compiler,
            id: compilation.buildInfoId,
            input: compilation.input,
          }
        ),
        writeJson(
          path.join(
            temporaryDirectory,
            'build-info',
            `${compilation.buildInfoId}.output.json`
          ),
          {
            _format: 'sunhat-vyper-build-info-output-1',
            id: compilation.buildInfoId,
            output: compilation.output,
          }
        ),
      ]);
    }
    await rm(artifactDirectory, { force: true, recursive: true });
    await mkdir(path.dirname(artifactDirectory), { recursive: true });
    await rename(temporaryDirectory, artifactDirectory);
  } finally {
    await rm(temporaryDirectory, { force: true, recursive: true });
  }
}

export function selectVyperCompilerGroups(
  roots: readonly BuildSource[],
  compilers: readonly NormalizedCompilerConfig[],
  overrides: Readonly<Record<string, string>>
): ReadonlyMap<NormalizedCompilerConfig, readonly BuildSource[]> {
  const compilerById = new Map(
    compilers.map((compiler) => [compiler.id, compiler] as const)
  );
  const mutableGroups = new Map<NormalizedCompilerConfig, BuildSource[]>();
  for (const root of roots) {
    const constraint = readVyperVersionConstraint(root);
    const overrideId = overrides[root.sourceName];
    let compiler: NormalizedCompilerConfig | undefined;
    if (overrideId !== undefined) {
      compiler = compilerById.get(overrideId);
      if (compiler === undefined) {
        throw new SunhatBuildError(
          'UNSUPPORTED_SOURCE_LAYOUT',
          `Vyper source ${root.sourceName} is overridden with non-Vyper compiler ${overrideId}`
        );
      }
      if (constraint !== undefined && !satisfiesVersion(compiler.version, constraint)) {
        throw new SunhatBuildError(
          'BUILD_FAILED',
          `${root.sourceName} requires Vyper ${constraint}, ` +
            `but override ${overrideId} is ${compiler.version}`
        );
      }
    } else {
      compiler = [...compilers]
        .filter(
          (candidate) =>
            constraint === undefined ||
            satisfiesVersion(candidate.version, constraint)
        )
        .sort((left, right) => compareVersions(right.version, left.version))[0];
      if (compiler === undefined) {
        throw new SunhatBuildError(
          'BUILD_FAILED',
          `${root.sourceName} has no configured Vyper compiler compatible with ` +
            (constraint ?? 'its source')
        );
      }
    }
    const group = mutableGroups.get(compiler) ?? [];
    group.push(root);
    mutableGroups.set(compiler, group);
  }
  return new Map(
    [...mutableGroups.entries()]
      .sort(([left], [right]) => compareVersions(right.version, left.version))
      .map(([compiler, selectedRoots]) => [
        compiler,
        Object.freeze(
          [...selectedRoots].sort((left, right) =>
            left.sourceName.localeCompare(right.sourceName)
          )
        ),
      ])
  );
}

function readVyperVersionConstraint(source: BuildSource): string | undefined {
  const matches = [
    ...source.content.matchAll(/^\s*#\s*pragma\s+version\s+([^#\r\n]+?)\s*$/gim),
  ];
  if (matches.length > 1) {
    throw new SunhatBuildError(
      'UNSUPPORTED_SOURCE_LAYOUT',
      `${source.sourceName} declares multiple Vyper version pragmas`
    );
  }
  return matches[0]?.[1].trim();
}

function satisfiesVersion(version: string, constraint: string): boolean {
  const actual = parseVersion(version);
  const trimmed = constraint.trim();
  if (trimmed.includes('||')) {
    throw new SunhatBuildError(
      'UNSUPPORTED_SOURCE_LAYOUT',
      `unsupported Vyper version constraint: ${constraint}`
    );
  }
  if (trimmed.startsWith('^')) {
    const lower = parseVersion(trimmed.slice(1));
    const upper =
      lower[0] > 0
        ? ([lower[0] + 1, 0, 0] as const)
        : lower[1] > 0
          ? ([0, lower[1] + 1, 0] as const)
          : ([0, 0, lower[2] + 1] as const);
    return compareTuples(actual, lower) >= 0 && compareTuples(actual, upper) < 0;
  }
  if (trimmed.startsWith('~')) {
    const lower = parseVersion(trimmed.slice(1));
    const upper = [lower[0], lower[1] + 1, 0] as const;
    return compareTuples(actual, lower) >= 0 && compareTuples(actual, upper) < 0;
  }
  if (/^\d+\.\d+\.(?:x|\*)$/i.test(trimmed)) {
    const [major, minor] = trimmed.split('.').map(Number);
    return actual[0] === major && actual[1] === minor;
  }

  const parts = trimmed.split(/[\s,]+/).filter(Boolean);
  if (parts.length === 0) {
    throw new SunhatBuildError(
      'UNSUPPORTED_SOURCE_LAYOUT',
      'empty Vyper version constraint'
    );
  }
  return parts.every((part) => {
    const match = /^(===|==|!=|>=|<=|>|<)?(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)$/.exec(
      part
    );
    if (match === null) {
      throw new SunhatBuildError(
        'UNSUPPORTED_SOURCE_LAYOUT',
        `unsupported Vyper version constraint: ${constraint}`
      );
    }
    const comparison = compareTuples(actual, parseVersion(match[2]));
    switch (match[1] ?? '==') {
      case '==':
      case '===':
        return comparison === 0;
      case '!=':
        return comparison !== 0;
      case '>=':
        return comparison >= 0;
      case '<=':
        return comparison <= 0;
      case '>':
        return comparison > 0;
      case '<':
        return comparison < 0;
    }
  });
}

function compareVersions(left: string, right: string): number {
  return compareTuples(parseVersion(left), parseVersion(right));
}

function parseVersion(version: string): readonly [number, number, number] {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:[-+][0-9A-Za-z.-]+)?$/.exec(version);
  if (match === null) {
    throw new SunhatBuildError(
      'UNSUPPORTED_SOURCE_LAYOUT',
      `invalid exact Vyper version: ${version}`
    );
  }
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function compareTuples(
  left: readonly [number, number, number],
  right: readonly [number, number, number]
): number {
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) {
      return left[index] - right[index];
    }
  }
  return 0;
}

function normalizeVyperDiagnostics(value: unknown): readonly BuildDiagnostic[] {
  if (!Array.isArray(value)) {
    return Object.freeze([]);
  }
  return Object.freeze(
    value.map((entry: any) => {
      const location = entry.sourceLocation ?? entry.source_location;
      const formattedMessage = String(
        entry.formattedMessage ?? entry.message ?? entry
      );
      // Vyper 0.4.3 emits the file structurally but keeps line/column only in
      // formattedMessage. This fallback parses the JSON field, never stderr.
      const textualLocation = /,\s*line\s+(\d+):(\d+)\b/.exec(
        formattedMessage
      );
      return Object.freeze({
        code: stringOrUndefined(entry.errorCode ?? entry.error_code),
        column:
          numberOrUndefined(location?.column ?? location?.col_offset) ??
          numberOrUndefined(
            textualLocation === null ? undefined : Number(textualLocation[2])
          ),
        file: stringOrUndefined(location?.file),
        line:
          numberOrUndefined(location?.line ?? location?.lineno) ??
          numberOrUndefined(
            textualLocation === null ? undefined : Number(textualLocation[1])
          ),
        message: formattedMessage,
        severity: entry.severity === 'warning' ? 'warning' : 'error',
        type: stringOrUndefined(entry.type),
      });
    })
  );
}

async function readPythonEnvironmentLock(executable: string) {
  const binDirectory = path.dirname(executable);
  const [pythonVersion, dependencies] = await Promise.all([
    runProcess(path.join(binDirectory, 'python'), ['--version']),
    runProcess(path.join(binDirectory, 'pip'), [
      'freeze',
      '--disable-pip-version-check',
    ]),
  ]);
  if (pythonVersion.code !== 0 || dependencies.code !== 0) {
    throw new SunhatBuildError(
      'COMPILER_PROCESS_FAILED',
      'failed to lock the Vyper Python environment'
    );
  }
  return Object.freeze({
    dependencies: Object.freeze(
      dependencies.stdout
        .split('\n')
        .map((entry) => entry.trim())
        .filter(Boolean)
        .sort()
    ),
    python: `${pythonVersion.stdout}${pythonVersion.stderr}`.trim(),
  });
}

async function runProcess(
  executable: string,
  args: readonly string[],
  stdin?: string,
  cwd?: string
): Promise<{ code: number; stderr: string; stdout: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd,
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let outputBytes = 0;
    const timeout = setTimeout(() => child.kill('SIGKILL'), COMPILER_TIMEOUT_MS);
    const append = (current: string, chunk: Buffer) => {
      outputBytes += chunk.byteLength;
      if (outputBytes > MAX_COMPILER_OUTPUT_BYTES) {
        child.kill('SIGKILL');
        return current;
      }
      return current + chunk.toString('utf8');
    };
    child.stdout.on('data', (chunk: Buffer) => {
      stdout = append(stdout, chunk);
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr = append(stderr, chunk);
    });
    child.once('error', (error) => {
      clearTimeout(timeout);
      reject(
        new SunhatBuildError(
          'COMPILER_PROCESS_FAILED',
          `failed to start compiler process ${executable}: ${error.message}`
        )
      );
    });
    child.once('close', (code, signal) => {
      clearTimeout(timeout);
      if (outputBytes > MAX_COMPILER_OUTPUT_BYTES) {
        reject(
          new SunhatBuildError(
            'INVALID_BUILD_OUTPUT',
            `compiler output exceeded ${MAX_COMPILER_OUTPUT_BYTES} bytes`
          )
        );
        return;
      }
      if (signal === 'SIGKILL' && code === null) {
        reject(
          new SunhatBuildError(
            'COMPILER_PROCESS_FAILED',
            `compiler timed out after ${COMPILER_TIMEOUT_MS}ms`
          )
        );
        return;
      }
      resolve({ code: code ?? 1, stderr, stdout });
    });
    child.stdin.end(stdin);
  });
}

function processError(
  compiler: NormalizedCompilerConfig,
  stderr: string
): SunhatBuildError {
  return new SunhatBuildError(
    'COMPILER_PROCESS_FAILED',
    `${compiler.id} failed: ${stderr.trim()}`
  );
}

function normalizeBytecode(value: string): string {
  return value.startsWith('0x') ? value : `0x${value}`;
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await writeFile(filePath, `${canonicalJson(value)}\n`, {
    encoding: 'utf8',
    flag: 'wx',
  });
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}
