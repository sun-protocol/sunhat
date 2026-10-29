# Hardhat 3 compatibility status

The working tree supports Hardhat 3/EVM initialization, adoption and native command execution. The actual npm tarball has passed dependency installation, TypeScript checking, compilation, deployment and state/event tests on a local EVM. Hardhat 3/TRON remains incomplete and is explicitly rejected before project files are written or a native framework is launched.

This report records development after commit `70bb493`. It does not change the capabilities of the already published Sunhat 2.0.0 package or mark the combined EVM/TRON requirement complete.

## Frozen EVM validation dependencies

The EVM dependency matrix was frozen on 2026-10-28. TRON plugin discovery and Docker TRE checks were extended on 2026-10-29.

| Package                           | Version   |
| --------------------------------- | --------- |
| `hardhat`                         | `3.21.1`  |
| `@nomicfoundation/hardhat-ethers` | `4.2.1`   |
| `@nomicfoundation/hardhat-mocha`  | `4.0.1`   |
| `ethers`                          | `6.17.0`  |
| `mocha`                           | `12.0.3`  |
| `typescript`                      | `5.8.3`   |
| `@types/node`                     | `22.10.2` |
| `@types/mocha`                    | `10.0.10` |

The selected Hardhat package exports `hardhat/package.json` and declares `dist/src/cli.js` as its executable. Sunhat resolves that project-local entry and checks that the project's exact declaration matches the installed version. There is no global fallback or implicit framework installation.

The selected Hardhat version's native check requires an even Node major at or above 22.13.0. Sunhat narrows this to Node 22.13+, 24.x, or 26.x and requires `type: module` in the consumer package. The CLI supports only Node 20.11+, 22.x, 24.x, and 26.x; Node 20 remains supported and will be deprecated in a future release. Odd majors and unlisted future even majors are rejected by the CLI entry point as well as package engine metadata.

The artifact integration passed locally on macOS arm64 with Node 22.13.0, 24.22.1, and 26.0.0, including package engine consistency and cleanup-error regression cases. Node 22.13.0 and 26.0.0 were downloaded from official Node.js distributions and checked against their published SHA-256 checksums. The Node 26.0.0 darwin-arm64 archive digest was `dcee8564c1a9342f9594dd5e52d533894dfef6b85aa771bbbb870baa3c403235`. Linux CI covers Node 22.13.0 and 26.0.0 in a matrix, Node 24.22.1 in the main job, and the Node 20.11.0 compatibility baseline separately; remote results are not claimed by this local report.

The complete runtime suite passed locally on Node 20.11.0, 22.13.0, 24.22.1, and 26.0.0: 325 passed and two Linux-specific filesystem cases were skipped on macOS in each run. On Node 20 the Hardhat 3 launch tests verify rejection; they do not claim that Hardhat 3 itself runs on that version. Boundary tests also verify rejection of odd majors and unlisted future even majors.

## Verified EVM behavior

```bash
sunhat init --framework hardhat --hardhat-version 3 --target evm example
cd example
npm install
npm run build
npm test
```

These commands require a Sunhat build containing the new integration. The integration suite substitutes its locally packed CLI for the published registry CLI while leaving framework dependencies at their generated exact versions.

The template uses explicit plugin registration and `network.create()` for ethers connections. Tests deploy the example contract, check its initial value, submit a mutation, verify the successful receipt and emitted event, and check the new value. Tests and scripts share a connection helper that preserves the original thrown value if cleanup also fails, while reporting the secondary error. A cleanup-only failure is propagated.

Run the complete artifact integration check with:

```bash
npm run test:hardhat3
```

This check packs the built package, installs it outside the repository, generates an EVM project using the installed CLI, installs exact framework dependencies, runs `tsc --noEmit`, invokes the generated build/test npm scripts, and executes the deployment script. It also checks package and template engine ranges against the installed runtime guards and injects a failing public Hardhat close hook to verify original exception identity, including `undefined`, `null`, and `false`, even when diagnostic reporting fails. Finally, it removes the temporary project's artifacts and checks that the generated deployment script and Mocha test both retain their missing-artifact errors when cleanup also fails. It uses an in-process EVM and broadcasts no transactions to public networks.

Existing `sunhat init` defaults remain Foundry/TRON. Hardhat initialization without a major version still selects Hardhat 2. `--hardhat-version` is an initialization/adoption option, not an additional routing field or runtime override. Adoption validates explicit version conflicts and Hardhat 3's ESM requirement before writing, without rewriting the consumer's configuration or dependency declaration.

## TRON plugin selection

No installable Hardhat 3/TRON plugin was identified in the npm searches for `hardhat3 tron`, `hardhat tron`, and `openzeppelin tron`, or in the inspected OpenZeppelin main revision. This is the result of that search, not a claim about every private or unpublished implementation.

| Candidate                             | Inspected version | Hardhat requirement                      | Decision                                                                                                        |
| ------------------------------------- | ----------------- | ---------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `@openzeppelin/hardhat-tron`          | `0.1.0`           | `^2.22.0`                                | Reference implementation for TVM compilation and native transaction behavior; cannot load directly in Hardhat 3 |
| `@openzeppelin/hardhat-tron-upgrades` | `0.1.1`           | `^2.22.0`, plus `hardhat-tron ^0.1.0`    | Does not resolve the base plugin conflict; proxy upgrades remain outside the initial integration                |
| `@layerzerolabs/hardhat-tron`         | `3.0.168`         | `^2.19.0`, plus `hardhat-deploy ^0.12.4` | Its package major is not the supported Hardhat major                                                            |
| `@openzeppelin/tron-runtime`          | `0.1.0`           | None; peers with `tronweb ^6.4.0`        | Reusable address, native transaction and receipt primitives; not a Hardhat plugin                               |
| `@openzeppelin/tron-contracts`        | `5.6.0`           | None                                     | Solidity library; does not provide compiler or network integration                                              |

OpenZeppelin's plugin declares `ethers: ^6.13.0` and `node: >=22`. Its main revision `d3aa82e3914087778b0cdc21d6faa05be87cecd9` still declares Hardhat 2. Combining the published plugin with Hardhat `3.21.1` in an isolated package produces `ERESOLVE`. No force install, peer override or modification of node_modules was used.

Reproduce the package checks with:

```bash
npm view @openzeppelin/hardhat-tron@0.1.0 version peerDependencies engines --json
npm view @openzeppelin/hardhat-tron-upgrades@0.1.1 version peerDependencies --json
npm view @layerzerolabs/hardhat-tron@3.0.168 version peerDependencies --json
npm view @openzeppelin/tron-runtime@0.1.0 version peerDependencies engines --json
```

The reference plugin's entry point and compiler use `extendConfig`, `extendEnvironment`, `subtask`, and Hardhat 2 internal imports. Its ethers bridge assumes a shared HRE, and its test/node lifecycle wrappers use the old task override model. Changing its peer range cannot adapt those APIs.

The implementation direction is an independent Hardhat 3 plugin using public configuration and network extension points, with `@openzeppelin/tron-runtime` reused through its root exports. Hardhat 3.21.1's public compiler `path` setting already accepts the verified TRON compiler, so the initial integration does not require a Hardhat core fork or the deprecated `getCompiler` hook. A downloader/configuration layer and the ethers network bridge still need to be delivered as an installable plugin. This working tree does not invent a registry package name or version for that missing release.

## Local Docker TRE probe

The test environment is local Docker TRE, matching the reference plugin's container model. Run:

```bash
npm run test:hardhat3:tron
```

This is a native Hardhat compatibility probe, not a generated Sunhat TRON project or the final package acceptance suite. It installs a separate fixture containing Hardhat `3.21.1`, `hardhat-mocha 4.0.1`, `mocha 12.0.3`, `ethers 6.17.0`, `tron-runtime 0.1.0`, and `tronweb 6.5.1`. It invokes native `hardhat build` and `hardhat test mocha`; transport and signing use TronWeb and the shared runtime, not `connection.ethers`.

The probe uses:

- TRE image `tronbox/tre@sha256:f4332e11df12a9f360639a4546fd046593909630fda48af00b30410c144342f0`, reporting java-tron `4.8.2`. The registry index contains Linux amd64 and arm64 manifests.
- The reference plugin's public development mnemonic, account derivation path, starting balance and JVM flags. A plain manual TRE start generates different accounts; its keys must not be assumed to match these fixtures or the existing Hardhat 2 template's default key.
- `tron-solc 0.8.26+commit.733b4d28` from `tronprotocol/solc-bin` revision `32695fe4b8d85704da9ec4cedce107a905e412ac`; SHA-256 `31fe546b9e6ad74e816d6406dcdb59f3af180f9c1145fd994bd5205d9c8465c1`. The compiler is copied to an isolated `.cjs` file and selected through Hardhat's public `solidity.path` setting. The digest identifies the TVM compiler independently of its Solidity version string.
- A unique container name and a random host port bound only to `127.0.0.1`. Readiness requires native node information and a block after genesis. Cleanup removes only the container and directory created by that invocation, including after failure. An unavailable Docker daemon fails the check rather than skipping it.

The compiler is downloaded automatically. Set `SUNHAT_TRON_SOLC=/absolute/path/to/soljson.js` to reuse a local copy; the same fixed checksum is always enforced. The probe does not write to global compiler caches.

The native probe passed locally on macOS arm64 with Node 22.13.0, 24.22.1, and 26.0.0. The Node 22.13.0 run downloaded and verified the compiler through the probe's default path. It compiled the example, broadcast real `CreateSmartContract` and `TriggerSmartContract` transactions, verified successful native receipts and transaction IDs, read state before and after the mutation, decoded `NumberChanged`, and checked Base58/TRON hex/EVM address round trips and native contract address derivation. No EDR network connection is created in this test.

One successful run reported these original receipt fields:

| Operation      | `energy_usage_total` (Energy) | `net_usage` (Bandwidth) | `energy_fee` (sun) |
| -------------- | ----------------------------: | ----------------------: | -----------------: |
| Deploy Counter |                        68,548 |                     829 |          6,854,800 |
| Increment      |                        21,797 |                     279 |          2,179,700 |

These are observed local-node results, not fixed cost guarantees. Assertions require positive native energy and bandwidth usage or its sun fee; they do not relabel either resource as EVM gas. TRE omits empty event `data` in protobuf JSON when all arguments are indexed; the fixture normalizes that omission to `0x` before ABI decoding.

A separate Linux CI job runs this probe. Its remote execution result has not been observed locally.

## Remaining acceptance

The Docker environment and native compiler/transaction path are now verified. The independent plugin, typed ethers connection integration and generated TRON template remain incomplete. Initialization, adoption and runtime dispatch therefore continue to reject Hardhat 3/TRON before writing files or launching a framework.

- Deliver the Hardhat 3 plugin's compiler setup and native ethers network connection, with an installable, pinned artifact and documented public extension points.
- Run the generated TRON project's TypeScript, build, test and deployment lifecycle through the packed Sunhat CLI on Docker TRE. Preserve compiler identity, original resource fields and native receipt/event semantics.
- Add the production TRON template and artifact acceptance coverage; remove the temporary rejection only after that path passes. The native probe above cannot replace those checks.
- Freeze the final release version and update the user-facing support matrix and migration documentation for EVM and TRON together.

References: [Hardhat 3 migration](https://hardhat.org/docs/migrate-from-hardhat2), [Node.js support](https://hardhat.org/docs/reference/nodejs-support), [ethers plugin](https://hardhat.org/docs/plugins/hardhat-ethers), [OpenZeppelin plugin at the inspected revision](https://github.com/OpenZeppelin/hardhat-tron/blob/d3aa82e3914087778b0cdc21d6faa05be87cecd9/package.json), [published TRON plugin metadata](https://registry.npmjs.org/@openzeppelin%2fhardhat-tron/0.1.0), [TRON upgrades plugin metadata](https://registry.npmjs.org/@openzeppelin%2fhardhat-tron-upgrades/0.1.1), [LayerZero plugin metadata](https://registry.npmjs.org/@layerzerolabs%2fhardhat-tron/3.0.168), [shared TRON runtime](https://github.com/OpenZeppelin/tron-runtime), and [reference Docker lifecycle](https://github.com/OpenZeppelin/hardhat-tron/blob/d3aa82e3914087778b0cdc21d6faa05be87cecd9/src/tre/lifecycle.js).
