# Sunhat 2

Sunhat 2 is a project CLI for Hardhat 2 and Foundry on EVM and TRON. It selects the framework and target from `sunhat.toml`, then runs the project's native tools. The npm package is `@sun-protocol/sunhat`; the executable is `sunhat`.

## Version policy

**Sunhat 1.x is maintenance-only.** It receives bug fixes and security updates, with no new features. New development targets Sunhat 2. Existing projects can keep their pinned 1.x dependency while planning migration; the [v1 documentation snapshot](https://github.com/sun-protocol/sunhat/blob/f583526/README.md) remains available.

## What changed from v1

| Area           | Sunhat 1.x                                                | Sunhat 2                                                                                          |
| -------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Architecture   | Hardhat plugin with a CLI proxy                           | Project CLI with separate Hardhat and Foundry adapters                                            |
| Configuration  | Sunhat's Hardhat plugin API                               | `sunhat.toml` binds the framework and target; native framework configuration stays in the project |
| Initialization | Hardhat-oriented scaffold with automatic npm installation | Four framework/target templates, explicit npm installation, and `--adopt` for existing projects   |
| Foundry        | Used alongside the Hardhat workflow                       | Project-local EVM or TRON toolchain installed and verified during `init`                          |

Commands use the selected framework's syntax: `sunhat compile` for Hardhat, `sunhat build` for Foundry, and `sunhat test` for either. V1 plugin APIs such as deployment tracking and named accounts are not provided by the v2 CLI; migration requires reviewing the project's plugins and scripts.

## Start a project

Use Node.js 20.11 or newer. The default project is Foundry + TRON:

```bash
npm install --global @sun-protocol/sunhat@2.0.0
sunhat init counter
cd counter
sunhat build
sunhat test
```

See [QuickStart](docs/QuickStart.md) for all four project types, local installation, compiler setup, adoption, and command examples.

## Development

Use Node.js 24 for repository development:

```bash
npm ci
npm run lint
npm run format:check
npm test
```

`npm run test:templates` installs fresh Hardhat EVM/TRON projects and runs `tsc --noEmit`. `npm run pack:check` checks package contents. Runtime tests use framework and download fixtures.

Initialization files and Foundry release data live under `templates/<framework>/common/` and `templates/<framework>/<target>/`. Target files override matching common files. The [TOML compatibility note](docs/toml-binding.md) documents the binding syntax baseline and parser limits.
