# Node, CLI, and package validation

Read the sections relevant to the task. Ordinary frontend or pure-function work does not require this entire checklist.

## File creation and replacement

- For generated batches, consider reading and rendering templates into a complete plan before checking destinations and parents and writing files. Planning must not create the destination directory. Execution must still protect against conflicts appearing after planning.
- Before adopting an existing project, validate the project directory and actual native configuration file. A directory or broken symlink at the expected configuration path is not a valid file.
- Define symlink behavior explicitly. A false result from `existsSync()` does not prove that no directory entry exists; overwrite protection must account for broken links. Executable scope checks may need `realpath()`. Preserve supported directory symlinks rather than rejecting or following every link indiscriminately.
- Use exclusive creation to protect existing files and preserve real errors such as `EACCES`, `ENOSPC`, and `EIO`. Preflight checks do not replace write-time conflict protection.
- Do not assume that system temporary directories, project directories, and metadata directories share a filesystem. Put staging files near their destinations when atomic rename is required. Cross-filesystem copying needs complete validation and a recovery path.
- Multiple renames do not automatically form a transaction. Prepare and validate new files, then back up and activate them. Define commit ordering for lockfiles and other metadata, and verify intermediate failures and failed recovery. Retain the only recoverable copy if recovery fails.
- Attempt cleanup for each temporary directory independently. Report leftovers, preserve the primary error, and distinguish completed commits from cleanup failures.
- For asynchronous resource cleanup, a rejection in `finally` must not replace an existing operation failure. Preserve the original thrown value and report the cleanup failure separately. Cover simultaneous operation/cleanup failures and the intended cleanup-only behavior in regression tests.

These requirements do not mean that every file write needs a generic transaction framework.

## CLI and child processes

Distinguish the CLI's own commands from downstream arguments. Use `node:util.parseArgs` when supported by the minimum Node version and suitable for the task. Choose a third-party CLI framework based on actual command complexity and forwarding requirements.

- Preserve argument ordering, repeated options, empty arguments, spaces, and `--`. For example, `tool test --help` may need to show the downstream test tool's help rather than the wrapper's own help.
- Retain the original argument array instead of reconstructing a shell command from parsed options. Prefer `spawn` or `execFile` with an argument array and explicit `cwd`; avoid unnecessary shells.
- Clean up listeners registered by the current invocation on startup failure and normal completion without changing the caller's existing listeners. Verify exit status and signal forwarding according to platform behavior.
- Distinguish startup failure, nonzero exit, and signal termination. Choose completion events according to whether stdio must be fully closed; do not clean up only on success.
- Bound test child processes and preserve failure output. Isolate signal tests so they cannot terminate the test runner or leave orphan processes.
- File names, archive formats, and execution methods are platform behavior. Simulated Windows file mappings do not replace installation checks on a Windows runner. Skip POSIX signal cases only under appropriate platform conditions and explain the skip.

## Test substitution boundaries

Prefer a small set of optional download, extraction, or other I/O functions supplied to a service. Production defaults must still perform real validation. These functions may remain private to the relevant module; substitution does not require new directories or an injection framework.

Use valid temporary configuration and local archives to control test data. Do not rewrite ESM source, bypass validation, or add production switches used only by tests. A few isolated CLI integration tests may replace network boundaries in child processes. Keep filesystem fault-injection patches narrowly scoped and reliably restore them.

Preserve real temporary-file tests for missing extracted files, activation failures, metadata commit failures, recovery failures, cleanup failures, and relevant platform or filesystem paths. Select cases that match the current change.

Resolve resources relative to their module rather than relying on execution from the repository root. Arrange cleanup for temporary directories, services, and listeners, and check for leftovers when possible.

## Templates and published artifacts

- Generated projects need portable dependency declarations. Absolute `file:` paths are suitable for explicit local integration, not default user output. Check package names, aliases, versions, and actual publication identity for consistency.
- Keep framework settings in templates and the CLI's name and version in package metadata. Generated README text, version output, and dependency declarations must use that source consistently.
- When template dependencies change, generate a real project, install those dependencies, and run `tsc --noEmit` with dependency declarations included. Successful compilation does not prove that TypeScript checking passed.
- For compiled npm packages, `prepack` can make `npm pack` and `npm publish` build correct artifacts. Check package-manager lifecycle behavior first and account for repeated builds caused by lifecycle scripts.
- `pack --dry-run` is only a packaging preview. Verify a real tgz built from a clean artifact state: install it outside the repository, execute the installed binary, inspect packaged resources, and validate relevant templates or features.
- Artifact tests must not rely on the source repository's `dist`, development dependency links, or global CLI fallback. Installing a local tgz does not publish it. Do not push tags or publish to a registry merely to test a package.
- Build tools may use newer Node versions, but runtime compatibility must be verified by executing compiled code on the declared minimum version. Do not run tests that clean the same build directory concurrently.

Use the [npm lifecycle documentation](https://docs.npmjs.com/cli/using-npm/scripts/) to verify behavior such as `prepack`; consult the relevant official documentation for other package managers.
