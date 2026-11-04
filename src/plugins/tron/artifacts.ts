import { createHardhatRuntimeEnvironment } from 'hardhat/hre';
import type { ArtifactManager } from 'hardhat/types/artifacts';
import type { HookContext } from 'hardhat/types/hooks';

const managers = new WeakMap<
  ArtifactManager,
  Map<string, Promise<ArtifactManager>>
>();

export async function artifactsFor(
  context: Pick<HookContext, 'config' | 'artifacts'>,
  directory: string,
): Promise<ArtifactManager> {
  if (directory === context.config.paths.artifacts) {
    return context.artifacts;
  }
  let owned = managers.get(context.artifacts);
  if (owned === undefined) {
    owned = new Map();
    managers.set(context.artifacts, owned);
  }
  let pending = owned.get(directory);
  if (pending === undefined) {
    pending = createHardhatRuntimeEnvironment(
      { paths: { artifacts: directory } },
      {},
      context.config.paths.root,
    ).then((hre) => hre.artifacts);
    owned.set(directory, pending);
  }
  try {
    return await pending;
  } catch (error) {
    if (owned.get(directory) === pending) {
      owned.delete(directory);
    }
    throw error;
  }
}

export async function clearArtifactCaches(
  context: Pick<HookContext, 'artifacts'>,
): Promise<void> {
  const results = await Promise.allSettled([
    Promise.resolve().then(() => context.artifacts.clearCache()),
    ...[...(managers.get(context.artifacts)?.values() ?? [])].map(
      async (pending) => (await pending).clearCache(),
    ),
  ]);
  const failures = results.flatMap((result) =>
    result.status === 'rejected' ? [result.reason] : [],
  );
  if (failures.length > 0) {
    throw new AggregateError(failures, 'Failed to clear TRON artifact caches');
  }
}
