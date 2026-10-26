# Sunhat

Sunhat is a TypeScript npm CLI that binds a project to Hardhat 2 or Foundry and to an EVM or TRON target through `sunhat.toml`. It handles project initialization, binding, command routing, and child-process management without replacing the framework's compiler, test runner, or argument parser.

```bash
npm install
npm run build
npm test
```

## Initialize or adopt a project

New projects use Foundry by default. Pass `--framework hardhat` explicitly when creating a Hardhat project:

```bash
sunhat init --target tron contracts
sunhat init --framework hardhat --target evm app
```

Adopting an existing project does not modify its native configuration. Specify the target when Sunhat cannot determine it unambiguously:

```bash
sunhat init --framework hardhat --adopt --target tron .
sunhat init --adopt .
```

The binding file is the sole source of truth for command routing:

```toml
[project]
framework = "hardhat"
target = "evm"
```

Initialization uses exclusive file creation. It fails if a destination file already exists and never overwrites unknown content. Dependency installation remains under the project's control.

## Commands

Hardhat projects use native Hardhat tasks:

```bash
sunhat compile --force
sunhat test --grep Counter
sunhat node
sunhat custom-plugin-task --flag value
```

Foundry projects use native Foundry commands:

```bash
sunhat build --sizes
sunhat test --match-contract CounterTest
sunhat cast block-number
sunhat anvil
sunhat toolchain check
```

Sunhat does not rewrite core commands across frameworks. Compile Hardhat projects with `sunhat compile` and Foundry projects with `sunhat build`. Based on the `sunhat.toml` binding, Sunhat forwards each command and its arguments directly to the selected framework. The former `sunhat hardhat ...` and `sunhat foundry ...` three-part command forms are no longer supported. Anvil and Chisel are unavailable for TRON Foundry projects.

The target project must install Hardhat major version 2. The current template pins `hardhat@2.29.1`, which supports Node.js 24. Sunhat resolves the absolute Hardhat entry point from the project's dependencies and does not invoke `npx`.

Hardhat TRON projects require a running Docker daemon. Their generated configuration selects the `tre` network, compiles with `tron-solc`, and starts `tronbox/tre:dev` automatically for `sunhat test`. Set `TRE_URL` and `TRE_PRIVATE_KEY` to use an existing TRE instance instead of the generated local defaults.

Hardhat dependencies use exact versions published on the npm registry. Projects generated from a local Sunhat build use a `file:` dependency on the package that ran initialization instead of requesting the unpublished `sunhat@2.0.0`. Foundry does not depend on a placeholder npm package. After initialization and `npm install`, run:

```bash
sunhat toolchain install
sunhat toolchain check
```

EVM projects download `foundry-rs/foundry@v1.8.6`. TRON projects download the public release for `elsvv/foundry-tron@9ea07db4b342fd606f6f7c3f99be1757e90d5e90`. Sunhat verifies the archive against a pinned SHA-256 digest before extracting it to `.sunhat/toolchains/`, then verifies the selected binary's digest on every invocation.

Child processes receive a structured argv array and run with `shell: false`. They inherit stdout and stderr, and Sunhat forwards SIGINT, SIGTERM, and the native exit status.
