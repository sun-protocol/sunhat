import { matchesGlob, relative, sep } from 'node:path';
import type { SolidityHooks } from 'hardhat/types/hooks';
import type { FileBuildResult } from 'hardhat/types/solidity';
import type { CompilerBatch } from './types.js';

function globs(batch: CompilerBatch): string[] {
  if (batch.include?.length) {
    return batch.include;
  }
  return [
    ...(batch.dirs ?? []).flatMap((directory) => [
      `${directory}/**/*.sol`,
      ...(directory.startsWith('contracts/')
        ? [
            `${directory.replace(/^contracts\//u, 'contracts-exposed/')}/**/*.sol`,
          ]
        : []),
    ]),
    ...(batch.extraLeaves ?? []).map((name) => `**/${name}.sol`),
  ];
}
export default async (): Promise<Partial<SolidityHooks>> => ({
  async build(context, roots, options, next) {
    const compiler = context.config.tre?.compiler;
    if (compiler === undefined || compiler.target !== 'tron') {
      return next(context, roots, options);
    }
    const matches = (file: string, patterns: string[]) =>
      patterns.some((pattern) =>
        matchesGlob(
          relative(context.config.paths.root, file).split(sep).join('/'),
          pattern,
        ),
      );
    const selected = roots.filter(
      (file) =>
        (compiler.include.length === 0 || matches(file, compiler.include)) &&
        !matches(file, compiler.exclude),
    );
    if (compiler.batches.length === 0) {
      return next(context, selected, options);
    }
    const result = new Map<string, FileBuildResult>();
    const covered = new Set<string>();
    for (const batch of compiler.batches) {
      const files = selected.filter((file) => matches(file, globs(batch)));
      for (const file of files) {
        covered.add(file);
      }
      if (files.length === 0) {
        continue;
      }
      console.log(`[sunhat-tron] Building batch ${batch.name}`);
      const built = await next(context, files, {
        ...options,
        cleanupArtifacts: false,
      });
      if (!(built instanceof Map)) {
        return built;
      }
      for (const [file, entry] of built) {
        result.set(file, entry);
      }
    }
    if (selected.some((file) => !covered.has(file))) {
      throw new Error(
        'TRON compiler batches do not cover all selected source files',
      );
    }
    return result;
  },
});
