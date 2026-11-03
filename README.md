# Sunhat 2

Sunhat 2 is a project CLI for Hardhat 2, Hardhat 3 and Foundry on EVM and TRON. It selects the framework and target from `sunhat.toml`, then runs the project's native tools. The npm package is `@sun-protocol/sunhat`; the executable is `sunhat`. This checkout targets 2.1.0 and has not been published; the released 2.0.0 package does not contain Hardhat 3 support.

## Version policy

**Sunhat 1.x is maintenance-only.** It receives bug fixes and security updates, with no new features. New development targets Sunhat 2. Existing projects can keep their pinned 1.x dependency while planning migration; the [v1 documentation snapshot](https://github.com/sun-protocol/sunhat/blob/f583526/README.md) remains available.

## What changed from v1

| Area           | Sunhat 1.x                                                | Sunhat 2                                                                                                      |
| -------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Architecture   | Hardhat plugin with a CLI proxy                           | Project CLI with separate Hardhat and Foundry adapters                                                        |
| Configuration  | Sunhat's Hardhat plugin API                               | `sunhat.toml` binds the framework and target; native framework configuration stays in the project             |
| Initialization | Hardhat-oriented scaffold with automatic npm installation | Six framework/version/target templates, separate dependency installation, and `--adopt` for existing projects |
| Foundry        | Used alongside the Hardhat workflow                       | Project-local EVM or TRON toolchain installed with `sunhat toolchain install`                                 |

Commands use the selected framework's syntax: `sunhat compile` for Hardhat 2, `sunhat build` for Hardhat 3 or Foundry, and `sunhat test` for all three. V1 plugin APIs such as deployment tracking and named accounts are not provided by the v2 CLI; migration requires reviewing the project's plugins and scripts.

## Start a project

Use Node.js 20.11+, 22.x, 24.x, or 26.x. Other major versions are rejected. Node.js 20 remains supported and will be deprecated in a future release. Hardhat 3 requires 22.13+, 24.x, or 26.x; framework plugins may impose stricter requirements. The default project is Foundry + TRON:

```bash
npm install --global @sun-protocol/sunhat@2.0.0
sunhat init counter
cd counter
sunhat toolchain install
sunhat build
sunhat test
```

The example above uses released 2.0.0. For this checkout's Hardhat 3 features, build/install a local tgz as described in [QuickStart](docs/QuickStart.md). Initialize with `--framework hardhat --hardhat-version 3 --target tron` or `--target evm`. Hardhat initialization still defaults to version 2; Foundry/TRON remains the overall default.

| Framework | EVM                               | TRON                                                                     |
| --------- | --------------------------------- | ------------------------------------------------------------------------ |
| Foundry   | Existing project-local toolchain  | Existing project-local Foundry-TRON toolchain                            |
| Hardhat 2 | Existing ethers template          | Existing OpenZeppelin Hardhat 2 plugin                                   |
| Hardhat 3 | Explicit ethers/Mocha connections | Native TVM plugin at `sunhat/hardhat3-tron`, ordinary/patched Docker TRE |

In this 2.1.0 checkout, only the Hardhat 3/TRON template declares Sunhat as a project dependency, because it imports the native TRON plugin. Other templates do not install the CLI locally. Hardhat npm scripts invoke local Hardhat directly; Foundry npm scripts use Sunhat on `PATH` to select the project-pinned toolchain. Released 2.0.0 templates retain their original dependency policy.

The [TRON plugin guide](docs/hardhat3-tron-plugin.md) covers native sun units, compiler/artifact separation, Docker policies, assertions and patched-node limits. Adoption preserves user code and configuration; register the appropriate native plugins before adopting.

## Development

Use Node.js 24 for repository development:

```bash
npm ci
npm run lint
npm run format:check
npm test
```

`npm run test:templates` generates Hardhat 2 EVM/TRON projects, installs their exact generated framework dependencies without a Sunhat dependency, and runs declaration-inclusive `tsc --noEmit`.

`npm run pack:check` starts without build artifacts, installs the actual tarball in an isolated project, and exercises the installed CLI and all six templates. This check requires npm registry access; Foundry release downloads use local fixtures.

`prepack` builds the CLI for both `npm pack` and `npm publish`.

Run `npm run test:hardhat3` for the generated EVM artifact lifecycle and `npm run test:tron-plugin` for core/adapter regressions. With Docker running, `npm run tre:build-jar`, `npm run test:hardhat3:tron-plugin` and `npm run test:hardhat3:tron-template` verify ordinary/patched TRE and the generated TRON lifecycle. `npm run check:english` checks maintained paths/text. See the [2.1.0 development release notes](docs/release-2.1.0.md) for supported behavior and limits.

Runtime tests use temporary CLI copies and release configuration for local archives. Installer tests replace download and extraction dependencies where needed; filesystem replacement and rollback tests use real files and directories.

Source builds reject unused declarations, incomplete return paths, and switch fallthrough. ESLint uses type information for `src/` to catch unhandled promises, async callbacks in synchronous APIs, and unsafe type assertions. Template linting does not require installing each generated project's dependencies.

Initialization files and Foundry release data live under `templates/<framework>/common/` and `templates/<framework>/<target>/`; Hardhat 3 uses `templates/hardhat/3/`. Target files override matching common files. The `sunhat.toml` binding uses TOML 1.0 syntax with a `project` table containing `framework` and `target`.
