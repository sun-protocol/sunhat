# TOML binding compatibility

Sunhat's binding syntax baseline is **TOML 1.0.0**. The routing contract remains a `project` table containing `framework = "hardhat" | "foundry"` and `target = "evm" | "tron"`. Other parsed keys are ignored. Project discovery, the `Binding` interface, and `readBinding(path)` remain unchanged.

This is a binding compatibility baseline, not a claim of complete TOML conformance or a strict 1.0-only parser. The selected backend also accepts TOML 1.1 constructs, including multiline inline tables and newer escapes. These extensions are outside Sunhat's compatibility promise. Upgrading the dependency does not change that promise; changing the baseline requires an explicit documentation and test update.

## Parser decision

The candidates were checked on 2026-10-27 using their npm metadata and upstream documentation:

| Candidate                                                                  | Syntax and runtime                                                                   | Maintenance evidence                                    | Decision                                                        |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------- | --------------------------------------------------------------- |
| [`smol-toml@1.9.1`](https://github.com/squirrelchat/smol-toml/tree/v1.9.1) | TOML 1.1; Node >=18; native ESM and TypeScript declarations; no runtime dependencies | Published 2026-10-09; fixes invalid exponent acceptance | Selected after compatibility and grammar checks                 |
| [`toml@5.0.1`](https://github.com/BinaryMuse/toml-node)                    | TOML 1.1; Node >=20; no runtime dependencies                                         | Published 2026-10-12                                    | Maintained alternative; does not provide a 1.0-only mode either |
| [`@ltd/j-toml@1.38.0`](https://github.com/LongTengDao/j-toml)              | Supports selecting TOML 1.0 explicitly                                               | Latest npm publication 2023-01-16                       | Version selection is useful, but release maintenance is older   |
| [`@iarna/toml@2.2.5`](https://github.com/iarna/iarna-toml)                 | Established parser; no current Node 20 compatibility claim verified here             | Latest stable npm publication 2020-04-22                | Not selected given the release gap                              |

The choice favors a maintained ESM backend without adding a syntax implementation or a Temporal polyfill. The package is pinned exactly in `package.json` and the lockfile. Its `engines` field alone is not considered proof of Node 20.11 compatibility.

## Processing boundaries

`readBinding(path)` reads the file, calls `parseToml(text)`, then calls `validateBinding(document, path)` and returns a `Binding`.

- `src/project/toml.ts` is the only parser integration. It returns `unknown`, preserves integers as `bigint`, and explicitly selects legacy date handling so Node 20.11 does not need Temporal.
- `validateBinding` accepts an unknown value and checks the project table and routing enums. It imports no parser types and performs no syntax parsing.
- File and parser errors are wrapped separately by `readBinding`. All binding-load failures retain the existing exit code `4` and file path.

## Coverage and limits

The upstream [README at the selected tag](https://github.com/squirrelchat/smol-toml/blob/v1.9.1/README.md) describes its official `toml-test` coverage and exceptions. Legacy dates can normalize invalid calendar days, and JavaScript string decoding has Unicode/UTF-8 limitations. Enabling bigint avoids losing signed 64-bit integer precision. Sunhat does not advertise full general-purpose TOML conformance.

For an independent syntax acceptance check, the selected options were run against the fixed [official `toml-test v2.2.0` TOML 1.0 manifest](https://github.com/toml-lang/toml-test/blob/v2.2.0/tests/files-toml-1.0.0): 205 valid documents accepted, 453 invalid documents rejected, and 21 invalid documents accepted. The 21 comprise nine newer-syntax cases, six calendar-date cases, and six encoding cases. This check measures acceptance and rejection; it does not compare every decoded value with the suite's expected JSON.

Repository tests separately exercise TOML 1.0 binding syntax, integer preservation, date parsing, duplicate definitions, Binding validation without parsing, file errors, and command-routing exit codes. The minimum-runtime CI job builds with the development Node version, installs only production dependencies on **Node 20.11.0**, and runs the runtime tests there. Lint and build tooling use the development Node version.

Local verification on macOS arm64 used the official Node 20.11.0 binary with its archive checked against Node's published SHA-256. Both Node 20.11.0 and the development Node 24.22.1 passed 181 runtime tests; two Linux filesystem tests were skipped on macOS. A separately packed package installed with production dependencies only also passed initialization, syntax-error handling, and Binding-error handling on Node 20.11.0.
