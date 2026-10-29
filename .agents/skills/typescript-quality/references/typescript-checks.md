# Checks and compatibility

Read this reference when changing check configuration, resolving type issues, or verifying runtime requirements. Inspect installed tool versions and project configuration before selecting rules.

## Establish the baseline first

Check `engines`, CI runtimes, the lockfile, TypeScript version, `package.json.type`, `module`, `moduleResolution`, `target`, `lib`, and framework settings. The Node version used to build may be newer than the package's minimum runtime; report validation of these separately.

- Choose Node module settings according to the actual ESM or CJS output. Frontend bundlers may need `bundler` resolution; do not impose `NodeNext` everywhere.
- Successful target and declaration checks do not prove that the minimum runtime provides the same APIs. Execute the relevant compiled paths, using an isolated installation with only production dependencies when necessary.
- Check library runtime and browser requirements, import formats, declarations, and maintenance. Adopting a newer library must not silently raise the supported runtime or syntax baseline.
- For format parsers, specify supported versions, numeric precision, and date semantics. Not every syntax accepted by a library is automatically a product commitment. Keep business validation separate.

## TypeScript checks to consider

These are candidates, not a configuration template that must be enabled in one change. If fixing newly reported errors would exceed the task's scope, explain the tradeoff and keep the work reviewable.

| Check                                   | Purpose and boundary                                                                                        |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `strict`                                | Establish strict type checking; extend existing framework settings rather than replacing them unnecessarily |
| `noUncheckedIndexedAccess`              | Expose array, index, and dictionary reads that may return `undefined`                                       |
| `exactOptionalPropertyTypes`            | Distinguish missing fields from explicit `undefined`; verify public interface compatibility                 |
| `noImplicitReturns`                     | Detect missing return paths                                                                                 |
| `noFallthroughCasesInSwitch`            | Detect accidental fallthrough; assess intentional cases according to their actual behavior                  |
| `noUnusedLocals` / `noUnusedParameters` | Identify unused declarations; check dynamic, external, and public consumers before deletion                 |
| `verbatimModuleSyntax`                  | Make type and runtime imports explicit; first verify TypeScript version, module format, and output          |

Prefer inference for local variables. Exported functions, external input, and cross-module contracts should have sufficiently explicit types. Use type guards or an existing schema library; do not build a parsing framework for a few fields.

## ESLint and formatting

Keep existing ESLint, Biome, Prettier, or framework tooling unless the task requires changing it. A quality review does not justify replacing the entire toolchain.

For source files with correct type information, consider:

- `@typescript-eslint/consistent-type-imports`
- `@typescript-eslint/no-floating-promises`
- `@typescript-eslint/no-misused-promises`
- `@typescript-eslint/no-unsafe-type-assertion`

Confirm that installed versions support these rules and use the corresponding project parser settings, including `projectService` where supported. Apply typed rules only to files with a valid tsconfig and dependency context. Templates, configuration scripts, tests, and browser code may need different patterns and globals.

Follow project formatting conventions. Quote style, semicolons, indentation, and import ordering are not universal rules across repositories. For asynchronous APIs, make return, await, and background execution intentions explicit; `void` alone does not handle rejection.

## Validation order

Usually run the relevant build or `tsc --noEmit`, followed by lint, formatting, and behavioral checks. Independent checks may run concurrently. Tests that read build output must wait for the build to finish.

When dependency declarations conflict, inspect the actual installed versions and declaration resolution. Do not add `skipLibCheck` just to make the project appear to pass. An existing root-level setting does not require a repository-wide change during unrelated work, but a claim that a generated project passes type checking must include its real declared dependencies and their declarations.

Consult official documentation when verifying current tool behavior:

- [TypeScript compiler options](https://www.typescriptlang.org/tsconfig/)
- [typescript-eslint typed linting](https://typescript-eslint.io/getting-started/typed-linting/)
- [Node.js util documentation](https://nodejs.org/api/util.html#utilparseargsconfig)
