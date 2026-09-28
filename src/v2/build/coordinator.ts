import path from 'node:path';
import { mkdir, realpath, rm, writeFile } from 'node:fs/promises';
import { discoverBuildSources } from './discovery.js';
import { SunhatBuildError } from './errors.js';
import { canonicalJson } from './hash.js';
import { verifyCompilerIntegrity } from './integrity.js';
import {
  buildIdForIdentity,
  commitBuildSnapshot,
  restoreSnapshotIfValid,
  snapshotDirectory,
} from './snapshot.js';
import { selectVyperCompilerGroups, VyperCompiler } from './vyper.js';
import type {
  BackendBuildResult,
  BuildIdentity,
  SolidityBuildBackend,
  SolidityBuildFingerprint,
  TargetBuildRequest,
  TargetBuildResult,
} from './types.js';

export interface BuildCoordinatorOptions {
  readonly solidity: SolidityBuildBackend;
  readonly vyper?: VyperCompiler;
}

export class BuildCoordinator {
  readonly #solidity: SolidityBuildBackend;
  readonly #vyper: VyperCompiler;

  public constructor(options: BuildCoordinatorOptions) {
    this.#solidity = options.solidity;
    this.#vyper = options.vyper ?? new VyperCompiler();
  }

  public async build(request: TargetBuildRequest): Promise<TargetBuildResult> {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(request.targetName)) {
      throw new SunhatBuildError(
        'UNSUPPORTED_SOURCE_LAYOUT',
        `invalid build target name: ${request.targetName}`
      );
    }
    const projectRoot = await realpath(path.resolve(request.projectRoot));
    const sources = await discoverBuildSources(projectRoot, request.target.sources);
    const soliditySources = sources.filter(({ language }) => language === 'solidity');
    const vyperSources = sources.filter(({ language }) => language === 'vyper');
    if (soliditySources.length === 0 && vyperSources.length === 0) {
      throw new SunhatBuildError(
        'EMPTY_BUILD_TARGET',
        `target "${request.targetName}" contains no .sol or .vy source files`
      );
    }

    const artifactDirectory = path.join(
      projectRoot,
      'artifacts',
      'sunhat',
      request.targetName
    );
    const cacheDirectory = path.join(
      projectRoot,
      'cache',
      'sunhat',
      request.targetName
    );
    const compilerKind = request.target.chain === 'tron' ? 'tron-solc' : 'solc';
    const solidityCompilers = request.target.compilers.filter(
      (compiler) => compiler.kind === compilerKind
    );
    let solidityRequest: Parameters<SolidityBuildBackend['build']>[0] | undefined;
    if (soliditySources.length > 0) {
      if (solidityCompilers.length === 0) {
        throw new SunhatBuildError(
          'MISSING_COMPILER_EXECUTABLE',
          `target "${request.targetName}" has Solidity sources but no ${compilerKind} compiler`
        );
      }
      solidityRequest = {
        artifactDirectory: path.join(artifactDirectory, 'solidity'),
        cacheDirectory: path.join(cacheDirectory, 'solidity'),
        compilerKind,
        compilers: solidityCompilers,
        force: request.force === true,
        overrides: request.target.overrides,
        projectRoot,
        sourceDirectories: request.target.sources.map((sourceDirectory) =>
          path.resolve(projectRoot, sourceDirectory)
        ),
        sources: soliditySources,
        targetName: request.targetName,
      };
    }

    let solidityFingerprint: SolidityBuildFingerprint | undefined;
    try {
      const usedCompilers = solidityRequest === undefined
        ? []
        : [...solidityCompilers];
      if (vyperSources.length > 0) {
        const vyperCompilers = request.target.compilers.filter(
          (compiler) => compiler.kind === 'vyper'
        );
        if (vyperCompilers.length === 0) {
          throw new SunhatBuildError(
            'MISSING_COMPILER_EXECUTABLE',
            `target "${request.targetName}" contains Vyper sources but no Vyper compiler`
          );
        }
        usedCompilers.push(
          ...selectVyperCompilerGroups(
            vyperSources,
            vyperCompilers,
            request.target.overrides
          ).keys()
        );
      }
      await Promise.all(usedCompilers.map(verifyCompilerIntegrity));
      if (solidityRequest !== undefined) {
        solidityFingerprint = await this.#solidity.fingerprint?.(
          solidityRequest
        );
      }
    } catch (error) {
      await rm(artifactDirectory, { force: true, recursive: true });
      await writeDiagnostics(artifactDirectory, error);
      throw error;
    }
    const snapshotSources = mergeSnapshotSources(
      sources,
      solidityFingerprint?.sources
    );
    const buildIdentity = createBuildIdentity(
      request.targetName,
      request.target,
      snapshotSources,
      solidityFingerprint?.metadata
    );
    const buildId = buildIdForIdentity(buildIdentity);
    const finalSnapshotDirectory = snapshotDirectory(
      projectRoot,
      request.targetName,
      buildId
    );

    let restored = false;
    try {
      restored =
        request.force !== true &&
        (await restoreSnapshotIfValid(
          projectRoot,
          request.targetName,
          buildId,
          artifactDirectory
        ));
    } catch (error) {
      await rm(artifactDirectory, { force: true, recursive: true });
      await writeDiagnostics(artifactDirectory, error);
      throw error;
    }
    if (restored) {
      return Object.freeze({
        artifactDirectory,
        buildId,
        cacheHit: true,
        snapshotDirectory: finalSnapshotDirectory,
        sources: snapshotSources,
        targetName: request.targetName,
      });
    }

    await rm(artifactDirectory, { force: true, recursive: true });
    await mkdir(artifactDirectory, { recursive: true });

    const backendResults: BackendBuildResult[] = [];
    try {
      if (solidityRequest !== undefined) {
        backendResults.push(
          await this.#solidity.build(solidityRequest)
        );
      }
      if (vyperSources.length > 0) {
        backendResults.push(
          await this.#vyper.build({
            artifactDirectory: path.join(artifactDirectory, 'vyper'),
            projectRoot,
            sources,
            target: request.target,
            targetName: request.targetName,
          })
        );
      }
      const errors = backendResults.flatMap(({ diagnostics }) =>
        diagnostics.filter(({ severity }) => severity === 'error')
      );
      if (errors.length > 0) {
        throw new SunhatBuildError(
          'BUILD_FAILED',
          `target "${request.targetName}" failed to compile`,
          errors
        );
      }
    } catch (error) {
      await rm(artifactDirectory, { force: true, recursive: true });
      await writeDiagnostics(artifactDirectory, error);
      throw error;
    }

    const metadata = Object.freeze({
      backends: backendResults.map(({ metadata }) => metadata),
      target: request.targetName,
    });
    const committedSnapshot = await commitBuildSnapshot({
      artifactDirectory,
      buildId,
      buildIdentity,
      metadata,
      projectRoot,
      sources: snapshotSources,
      targetName: request.targetName,
    });
    return Object.freeze({
      artifactDirectory,
      buildId,
      cacheHit: false,
      snapshotDirectory: committedSnapshot,
      sources: snapshotSources,
      targetName: request.targetName,
    });
  }
}

function mergeSnapshotSources(
  discoveredSources: readonly Awaited<ReturnType<typeof discoverBuildSources>>[number][],
  soliditySources: readonly Awaited<ReturnType<typeof discoverBuildSources>>[number][] | undefined
) {
  if (soliditySources === undefined) {
    return discoveredSources;
  }
  return Object.freeze(
    [
      ...discoveredSources.filter(({ language }) => language !== 'solidity'),
      ...soliditySources,
    ].sort((left, right) => left.sourceName.localeCompare(right.sourceName))
  );
}

function createBuildIdentity(
  targetName: string,
  target: TargetBuildRequest['target'],
  sources: Awaited<ReturnType<typeof discoverBuildSources>>,
  solidityFingerprint: Readonly<Record<string, unknown>> | undefined
): BuildIdentity {
  return Object.freeze({
    schema: 'sunhat-build-identity-2',
    chain: target.chain,
    compilers: target.compilers.map(
      ({ id, kind, settings, sha256, version }) => ({
        id,
        kind,
        settings,
        sha256,
        version,
      })
    ),
    overrides: target.overrides,
    ...(solidityFingerprint === undefined ? {} : { solidityFingerprint }),
    sources: sources.map(({ sourceName, sha256: sourceSha256 }) => ({
      sha256: sourceSha256,
      sourceName,
    })),
    target: targetName,
  });
}

async function writeDiagnostics(
  artifactDirectory: string,
  error: unknown
): Promise<void> {
  await mkdir(artifactDirectory, { recursive: true });
  const diagnostics =
    error instanceof SunhatBuildError && error.diagnostics.length > 0
      ? error.diagnostics
      : [
          {
            message: error instanceof Error ? error.message : String(error),
            severity: 'error' as const,
          },
        ];
  await writeFile(
    path.join(artifactDirectory, 'compilation-errors.json'),
    `${canonicalJson({ diagnostics })}\n`,
    { encoding: 'utf8', flag: 'wx' }
  );
}
