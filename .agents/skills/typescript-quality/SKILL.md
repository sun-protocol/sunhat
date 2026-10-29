---
name: typescript-quality
description: Project-local TypeScript engineering and code style rules for Sunhat. Use for TypeScript development, refactoring, quality reviews, and related CLI, template, test, or npm distribution changes in this repository.
---

# TypeScript engineering quality

This file and its references define the TypeScript development rules for Sunhat. They were copied from the global `typescript-quality` skill on 2026-10-29 and are maintained independently. In this repository, use the local version when it differs from global guidance; explicit user instructions take precedence. Update this directory directly rather than relying on global files or automatic synchronization.

Use English for all content maintained in this directory, including code, comments, documentation, rules, examples, metadata, and names. Chinese text and Chinese characters must not appear in this directory. Check changed files and names before delivery.

Deliver TypeScript changes with clear responsibilities, useful failure diagnostics, and verifiable results. Keep the current task as the scope boundary: a quality improvement does not authorize dependency upgrades, framework migrations, or a repository-wide rewrite.

## Runtime support

Sunhat supports only Node.js majors 20, 22, 24, and 26. The CLI minimum is 20.11.0. Node.js 20 remains supported and will be deprecated in a future release. Hardhat 3 requires Node.js 22.13+, 24.x, or 26.x; the Hardhat 2/TRON plugin requires 22.x, 24.x, or 26.x. Keep CLI guards, package engines, lockfile metadata, template requirements, and CI consistent. Do not admit odd majors or unlisted future even majors automatically.

## Workflow

- Distinguish analysis, implementation, and review from the request and session context. Stay read-only when asked only to analyze; otherwise follow the authorized scope and commit sequence.
- Read repository conventions, current changes, relevant code, and tests. Confirm the package manager, lockfile, TypeScript and ESLint configuration, module format, build process, and minimum runtime. For browser projects, also check browser and bundler requirements.
- Describe issues using concrete triggers, source locations, and effects. Distinguish correctness defects, compatibility problems, and maintenance improvements. Make changes according to their impact, without expanding the list just to find more work.
- Follow the user's requested batch order. Check completion and exit status before committing. A running test, truncated log, or successful commit is not evidence that validation passed.
- Independent reads may run in parallel. Sequence commands that clean or rebuild `dist` before tests that read it.

## Design and code style

- Organize modules by responsibility and reason for change. Command and UI layers handle arguments, orchestration, and presentation; keep business decisions and I/O boundaries clear. For batch writes needing previews, conflict checks, or recovery, consider separate read-only planning and execution phases.
- Keep small helpers with their sole consumer when appropriate. A few function parameters or options can provide dependency injection; do not require one file per function, a container, or a class hierarchy.
- Preserve boundaries with distinct meaning, such as syntax parsing versus business validation, or installation configuration versus runtime records. Directory depth, file count, and line count help locate problems; they are not acceptance criteria.
- Prefer platform features supported by the minimum runtime and libraries already used by the project. Use standard parsers or mature libraries for structured formats; keep application-specific field rules in the application. Verify versions, runtime requirements, and maintenance before adding dependencies.
- Keep configuration ownership clear. Framework settings and versions belong in templates or configuration data; package names and versions need a single source of truth. Follow the application's established configuration model rather than forcing a template layer onto it.
- Follow repository formatting, naming, and import conventions. Format only the authorized scope. Side-effect imports, plugin registration, and module initialization have behavioral ordering requirements; do not sort them mechanically.
- Use `import type` where appropriate. Make public boundaries and necessary `readonly` contracts explicit while allowing local type inference.
- Do not hide real problems with unsupported type assertions, non-null assertions, `any`, or broad lint exclusions. When interoperability requires an assertion, limit it to the smallest boundary supported by evidence.
- Use guard clauses and explicit failure branches. Share repeated error conversions when useful; keep one-off helpers near their consumers.

When changing TypeScript, ESLint, or formatter configuration, read [Checks and compatibility](references/typescript-checks.md) as needed. Do not copy another project's complete configuration without checking its fit.

## Data and failure boundaries

- Treat external input from files, APIs, environment variables, and third-party metadata as `unknown`. After parsing, validate every field actually read, including `null`, arrays, optional fields, and nested records, before constructing business types. `JSON.parse(...) as T` does not validate data.
- Distinguish read failures, syntax errors, and business validation failures. Include the relevant path, field, or operation. Check filesystem error codes before classification: for example, `EEXIST` from exclusive creation is a conflict, while other errors need their own diagnostics.
- Preserve causes and error codes when wrapping errors, using the target runtime's `cause` support or existing project mechanisms. Project command functions should return status or throw; the entry point controls process exit.
- For multi-stage replacement, use an existing transaction or define the commit point and recovery path. Prepare and validate new state before replacing old state. If recovery fails, retain usable backups and report their exact locations.
- Handle cleanup failures separately and continue attempting other cleanup steps. If both the operation and cleanup fail, preserve the original thrown value, including non-Error values, and report the cleanup error separately. Do not discard or replace the primary exception. After a successful commit, report leftover temporary files without misrepresenting the operation as unsuccessful.

For file replacement, CLI processes, or npm packages, also read [Node, CLI, and package validation](references/node-cli-packaging.md). Apply these requirements when relevant, not to unrelated frontend or pure-function changes.

## Validation and delivery

- Test observable behavior and important invariants: processed inputs, state before and after failure, arguments, exit codes, and real artifacts. For defect fixes, establish a case that fails before the fix and passes afterward where practical.
- For naming, moves, or formatting alone, prefer existing relevant checks and update references. Do not add tests that merely mirror the implementation, file counts, or internal names.
- Control unit-test input through explicit I/O boundaries. Use a small number of integration tests for real entry points and connections. File replacement and recovery tests still need real temporary files; do not mock the entire chain.
- Resolve test resources relative to the module or an explicit working directory, not the caller's incidental repository-root location. Clean up temporary directories and listeners, bound child-process execution, and retain useful failure output.
- Run type, lint, format, and behavioral checks appropriate to the change. Type checking does not replace runtime validation. Changes affecting minimum runtimes, platform branches, or package distribution need actual execution evidence for those boundaries.
- Once checks pass, repeat or broaden validation only for new changes, failures, or unresolved concerns. Do not hide incompatibility by skipping declaration checks, removing assertions, or disabling rules.
- Explain what changed, why, what was actually checked, and material limits. Distinguish local results from CI, real execution from simulation, and skipped cases from passed cases. Base technical documentation on current behavior and reproducible commands.
- This skill does not authorize commits, pushes, publication, changes to global tools, or contact with others. Follow the user's existing authorization for those actions.

## Evidence and history

For the origin of these rules or when revising them, read [Sunhat commits and lessons](references/sunhat-lessons.md). It records historical evidence rather than requiring other projects to adopt Sunhat's dependencies, layout, or version choices.
