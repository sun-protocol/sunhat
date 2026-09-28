import { createHash } from 'node:crypto';
import { createHardhatRuntimeEnvironment } from 'hardhat/hre';
import type { HardhatUserConfig } from 'hardhat/types/config';
import type {
  CompilationJobCreationError,
  CompilerOutputError,
  FileBuildResult,
} from 'hardhat/types/solidity';
import { SunhatBuildError } from '../build/errors.js';
import type { BuildDiagnostic } from '../build/errors.js';
import type {
  BackendBuildResult,
  BuildSource,
  SolidityBuildBackend,
  SolidityBuildFingerprint,
  SolidityBuildRequest,
} from '../build/types.js';
import type { NormalizedCompilerConfig } from '../config/types.js';

const BUILD_PROFILE = 'default';

/** Uses only Hardhat 3 public build and HRE APIs. */
export class Hardhat3SolidityBackend implements SolidityBuildBackend {
  public async fingerprint(
    request: SolidityBuildRequest
  ): Promise<SolidityBuildFingerprint> {
    const hre = await createTargetHre(request);
    const result = await hre.solidity.getCompilationJobs(
      request.sources.map(({ absolutePath }) => absolutePath),
      {
        buildProfile: BUILD_PROFILE,
        force: true,
        isolated: true,
        quiet: true,
        scope: 'contracts',
      }
    );
    if (!result.success) {
      throw new SunhatBuildError('BUILD_FAILED', result.formattedReason, [
        {
          code: result.reason,
          file: result.rootFilePath,
          message: result.formattedReason,
          severity: 'error',
        },
      ]);
    }

    const jobs = new Set(result.compilationJobsPerFile.values());
    const buildIds = (
      await Promise.all([...jobs].map((job) => job.getBuildId()))
    ).sort();
    const dependencies = new Map<
      string,
      { package: string; packageVersion: string; sha256: string }
    >();
    const dependencySources = new Map<string, BuildSource>();
    for (const job of jobs) {
      for (const file of job.dependencyGraph.getAllFiles()) {
        const contentSha256 = sha256(file.content.text);
        dependencies.set(file.inputSourceName, {
          package: file.package.name,
          packageVersion: file.package.version,
          sha256: contentSha256,
        });
        dependencySources.set(
          file.inputSourceName,
          Object.freeze({
            absolutePath: file.fsPath,
            content: file.content.text,
            language: 'solidity',
            sha256: contentSha256,
            sourceName: file.inputSourceName,
          })
        );
      }
    }
    return Object.freeze({
      metadata: Object.freeze({
        buildIds: Object.freeze(buildIds),
        dependencies: Object.freeze(
          Object.fromEntries(
            [...dependencies.entries()].sort(([left], [right]) =>
              left.localeCompare(right)
            )
          )
        ),
        hardhat: hre.versions.hardhat,
      }),
      sources: Object.freeze(
        [...dependencySources.values()].sort((left, right) =>
          left.sourceName.localeCompare(right.sourceName)
        )
      ),
    });
  }

  public async build(
    request: SolidityBuildRequest
  ): Promise<BackendBuildResult> {
    const hre = await createTargetHre(request);
    const result = await hre.solidity.build(
      request.sources.map(({ absolutePath }) => absolutePath),
      {
        buildProfile: BUILD_PROFILE,
        cleanupArtifacts: true,
        force: request.force,
        isolated: true,
        quiet: true,
        scope: 'contracts',
      }
    );
    const diagnostics = await normalizeBuildDiagnostics(hre, result);
    return Object.freeze({
      diagnostics,
      metadata: Object.freeze({
        adapter: 'hardhat-3',
        compilerKind: request.compilerKind,
        compilers: request.compilers.map(({ id, version }) => ({ id, version })),
        roots: request.sources.map(({ sourceName }) => sourceName),
      }),
    });
  }
}

async function createTargetHre(request: SolidityBuildRequest) {
  const compilerById = new Map(
    request.compilers.map((compiler) => [compiler.id, compiler] as const)
  );
  const overrides: Record<string, ReturnType<typeof compilerConfig>> =
    Object.create(null);
  for (const [sourceName, compilerId] of Object.entries(request.overrides)) {
    const compiler = compilerById.get(compilerId);
    if (compiler !== undefined) {
      overrides[sourceName] = compilerConfig(compiler);
    }
  }
  const userConfig: HardhatUserConfig = {
    paths: {
      artifacts: request.artifactDirectory,
      cache: request.cacheDirectory,
      sources: [...request.sourceDirectories],
    },
    solidity: {
      profiles: {
        [BUILD_PROFILE]: {
          compilers: request.compilers.map(compilerConfig),
          isolated: true,
          overrides,
          toolVersionsInBuildInfo: true,
        },
      },
    },
  };
  return createHardhatRuntimeEnvironment(userConfig, {}, request.projectRoot);
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function compilerConfig(compiler: NormalizedCompilerConfig) {
  return {
    path: compiler.path,
    settings: compiler.settings,
    type: 'solc' as const,
    version: compiler.version,
  };
}

async function normalizeBuildDiagnostics(
  hre: Awaited<ReturnType<typeof createHardhatRuntimeEnvironment>>,
  result: CompilationJobCreationError | Map<string, FileBuildResult>
): Promise<readonly BuildDiagnostic[]> {
  if (!hre.solidity.isSuccessfulBuildResult(result)) {
    return Object.freeze([
      Object.freeze({
        code: result.reason,
        file: result.rootFilePath,
        message: result.formattedReason,
        severity: 'error' as const,
      }),
    ]);
  }

  const diagnostics: BuildDiagnostic[] = [];
  for (const buildResult of result.values()) {
    if (buildResult.type === 'BUILD_FAILURE') {
      for (const error of buildResult.errors) {
        const remapped = await hre.solidity.remapCompilerError(
          buildResult.compilationJob,
          error,
          true
        );
        diagnostics.push(normalizeCompilerDiagnostic(remapped));
      }
    } else if (buildResult.type === 'BUILD_SUCCESS') {
      for (const warning of buildResult.warnings) {
        const remapped = await hre.solidity.remapCompilerError(
          buildResult.compilationJob,
          warning,
          true
        );
        diagnostics.push(normalizeCompilerDiagnostic(remapped));
      }
    }
  }
  return Object.freeze(
    diagnostics.map((diagnostic) => Object.freeze(diagnostic))
  );
}

function normalizeCompilerDiagnostic(error: CompilerOutputError): BuildDiagnostic {
  const location = readSourceLocation(error);
  return {
    code: error.errorCode,
    column: location?.column,
    file: location?.file,
    line: location?.line,
    message: error.formattedMessage ?? error.message,
    severity: error.severity === 'error' ? 'error' : 'warning',
    type: error.type,
  };
}

function readSourceLocation(
  error: CompilerOutputError
): { column?: number; file?: string; line?: number } | undefined {
  const location = (
    error as CompilerOutputError & {
      sourceLocation?: { file?: unknown };
    }
  ).sourceLocation;
  const formattedLocation = /-->\s+([^\r\n]+?):(\d+):(\d+):?(?:\r?\n|$)/.exec(
    error.formattedMessage ?? ''
  );
  if (location === undefined && formattedLocation === null) {
    return undefined;
  }
  return {
    column: formattedLocation === null ? undefined : Number(formattedLocation[3]),
    file:
      typeof location?.file === 'string'
        ? location.file
        : formattedLocation?.[1],
    line: formattedLocation === null ? undefined : Number(formattedLocation[2]),
  };
}
