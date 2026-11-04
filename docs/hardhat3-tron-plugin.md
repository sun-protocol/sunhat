# Hardhat 3 TRON plugin

The Sunhat artifact exposes `@sun-protocol/sunhat/hardhat3-tron`. Projects using the generated `sunhat` npm alias import `sunhat/hardhat3-tron`. This entry adapts the licensed Hardhat 2 TRON runtime to public Hardhat 3 configuration, connection, Solidity and task hooks. It does not load the Hardhat 2 plugin.

Use Node.js 22.13+, 24.x or 26.x. The verified consumer dependencies are Hardhat 3.21.1, hardhat-ethers 4.2.1, hardhat-mocha 4.0.1, hardhat-utils 5.1.1, ethers 6.17.0, tron-runtime 0.1.0, TronWeb 6.5.1 and solc 0.8.26. Import checks reject incompatible dependency versions before loading framework hooks. Consumer projects own these dependencies; installing the CLI alone installs none of them.

```typescript
import { defineConfig } from 'hardhat/config';
import sunhatTron from 'sunhat/hardhat3-tron';

export default defineConfig({
  plugins: [sunhatTron],
  solidity: '0.8.26',
  networks: {
    default: {
      type: 'http',
      tron: true,
      url: 'http://127.0.0.1:9090/jsonrpc',
      accounts: 'remote',
    },
  },
  tre: { autoStart: false },
});
```

`accounts: 'remote'` creates a read-only connection with no signers. Configure local keys or an HD account definition for native writes. The ethers facade interprets value and balance integers as sun: one boundary unit is one sun, not one ether. Native resource fields remain available on `receipt.nativeReceipt` and `receipt.nativeTransactionInfo`; `nativeTransactionId` retains the original TRON ID. Broadcasts wait for actual inclusion, including plain TRX transfers.

Configure authentication through the Hardhat network's `httpHeaders`. Native requests and SDK signers retain the configured URL's path prefix and query parameters; diagnostic messages show only the origin. Network `timeout: 0` disables the default client timeout, while readiness and receipt polling retain their own deadlines. State reads reject transport and invalid-response errors instead of returning zero. Mutating TRE requests and broadcasts do not automatically retry or follow redirects after an uncertain outcome.

## Compiler and connections

The package's default TRE image and compiler mirror are maintained in `config/tron-defaults.json`. A project's `tre.image` and `tre.compiler.mirror` settings override these defaults; `tre.compiler.path` selects a local compiler instead.

`tre.compiler.target` is `auto`, `tron` or `evm`. Auto uses the configured `networks.default.tron` flag when resolving configuration; a command-line network flag does not change the compiler target. Keep separate configurations or explicitly select the target when compiling for both VMs. TRON artifacts use `<artifacts>-tron`; EVM connections read the original artifact root. Build both targets before a test that deploys on both.

Contract lookup uses Hardhat's public artifact manager for each target, including custom source directories and dependencies. Ambiguous bare names require a fully qualified `source/path.sol:ContractName`. Builds invalidate the connection's artifact indexes even on failure. An existing factory retains the artifact it was created with; request a new factory after rebuilding to use updated ABI or bytecode.

The downloader verifies the upstream compiler manifest and checksum before atomic cache replacement. Manifest files, compiler binaries and concurrent downloads are isolated by the normalized mirror URL. The default cache uses Hardhat's public platform cache directory under `compilers-v3/wasm/tron-solc`; `hardhat clean --global` clears it. An explicit `tre.compiler.cacheDir` is resolved from the project root and is managed separately. Existing unscoped caches are not reused because their source cannot be verified. `tre.compiler.path` accepts only the pinned 0.8.26 TVM compiler with SHA-256 `31fe546b9e6ad74e816d6406dcdb59f3af180f9c1145fd994bd5205d9c8465c1`. `include`, `exclude`, `batches` and `batchesPath` adapt source selection through the public build hook. `hardhat tron:compile-batches` builds the configured batches without deleting earlier batch artifacts.

Obtain ethers and optional native helpers from `await network.create(name)`. A TRON connection exposes `connection.tre`; an EVM connection does not. Close each connection after use and preserve the original operation error if closing also fails. Providers, keys, receipts, fixture caches and capability probes belong to that connection. Local metadata identifies the actual node instance rather than the connection object.

For named contracts, `ethers.getContractFactory(name, signer)` and `ethers.getContractFactory(name, { signer })` bind deployment and factory attachment to the selected native signer. `ethers.getContractAt(name, address, signer)` uses that signer for subsequent calls. Omitting the optional signer keeps the connection's default account; unsupported explicit signers are rejected rather than replaced with that default. Use `factory.connect(signer)` or `contract.connect(signer)` to change an existing binding to another native signer or a native contract's `runner`. These `connect` methods require a native signer or runner: `null`, `undefined` and EVM-only runners are rejected. Detached runners are not supported; use an `accounts: 'remote'` connection for read-only access.

Address conversion preserves the supplied account or contract identity. A simulated address return is never paired with a later internal CREATE receipt, and ordinary parameters, transaction destinations, provider reads and matchers do not resolve implicit address aliases. Code that relied on automatic redirection from a simulated address must use the actual child address from the successful deployment's event or `receipt.nativeTransactionInfo.internal_transactions` instead. For explicit native deployment prediction, `signer.predictAddress(name, args)` prebuilds the transaction consumed by the matching `ethers.deployContract(name, args, signer)` call; broadcast it before its native expiration. The connection's `ethers.getCreate2Address` retains TVM's `0x41` prefix for deterministic CREATE2 calculations.

Prediction cache entries match the deployment account, artifact source/name, ABI, bytecode, ABI-encoded constructor arguments and effective native value/fee limit. Prediction and deployment share the same argument and override preparation, and TronWeb receives those exact constructor bytes. Equivalent numeric, address, tuple and `Typed.overrides` representations can reuse the prediction; different constructor values or effective overrides cannot. Each matching deployment consumes its cached signed transaction once. Bare and fully qualified names for the same artifact share this identity.

## Docker and assertions

Automatic Docker startup is disabled by default. With `tre.autoStart: true`, the default policies start TRE for `test`, `test mocha` and `node`; `autoStartOnCompile` remains false. Automatic startup binds IPv4 loopback; already running IPv6 and other endpoints can be reused. Configure `image`, `port`, `startupEnv`, `jarPath`, `containerName`, `readinessTimeoutMs`, `autoStartOnTest`, `autoStartOnCompile`, `autoStartOnNode` and `keepRunning` explicitly where needed. Relative jar paths resolve from the project root. Only containers started by this invocation are removed; pre-existing services are reused. The TRON node task remains alive until a termination signal and retains the service.

Connections to an owned container share a lease by immutable container ID, including verified localhost aliases. Each connection validates its own endpoint and credentials. Closing one connection cannot remove a container still used by another; cleanup targets the recorded ID so a replacement with the same name is preserved. Identity lookups retain their resolver, isolate authenticated endpoints, and invalidate owned aliases on teardown. Temporary identity or capability failures remain retryable on the same connection. `tre.helpers.time.increase()` returns the new timestamp as a number, including for a zero increment.

Ordinary TRE supports native compilation, deployment, calls, events, balances and receipts. Snapshot/revert, fixture snapshots, time control, account balance/code/storage mutation and impersonation require a patched node. Unsupported capabilities fail explicitly. Build the pinned test patch with `npm run tre:build-jar`; its sources, licenses and provenance live under `test/fixtures/tre-patch/` and are excluded from the npm package.

Contract calls use ethers argument-aware overload resolution: ambiguous bare names fail before RPC, and `Typed` values or full signatures disambiguate them. Empty and typed overrides are separate from ABI inputs; payable simulations forward their exact native value. Nested tuple arrays and fixed dimensions use standard ABI traversal, and decoded return values retain ethers `Result` shape and named fields. Results can be passed back into calls and constructors. `waitForDeployment()` resolves to the same contract facade. Failed decoding or transport is reported without retrying through a different decoder.

The inherited patched snapshot restores account, code, contract and storage state. It retains block height, timestamps and transaction history. A successful receipt remains a historical receipt after restoring state; snapshot restoration does not mean that the transaction was never included. Snapshots affect every connection to the same node, so serialize snapshot-based tests on that node. Separate nodes have independent state and capabilities.

Set `tre.matchers: true` and register `@nomicfoundation/hardhat-ethers-chai-matchers@3.0.11` with `chai@5.3.3` for assertions. Native balance matchers follow the Hardhat 3 signature, for example `expect(tx).to.changeEtherBalance(connection.ethers, account, delta)`. Events and revert assertions retain the official matcher interface. EVM balance assertions keep their original implementation. No global HRE or module-export patch selects the native connection.

All four native balance matchers resolve account `getAddress()` methods, including signers and contracts with Addressable targets, before calculating changes. EVM hex, TRON base58 and TRON hex strings remain supported. Address resolution errors reject the assertion; unresolved objects cannot count as zero changes. Diagnostics reuse the resolved address without calling `getAddress()` again.

The facade covers the inherited TRON testing surface, not every ethers Provider method. Native `waitForTransaction` supports inclusion confirmation counts zero and one; larger counts fail explicitly. Coverage, Solidity tests, forks and proxy upgrade plugins require separate compatibility work.

Native execution failures remain failures even when an argument resembles an unsupported precompile address. Empty revert data stays `0x`; output types and selectors found in runtime bytecode do not establish an error cause. View calls and all `staticCall` simulations decode actual revert bytes through the contract's ethers Interface, including custom errors, `Error(string)` and Panic. If a failed transaction has no revert bytes, the existing diagnostic constant call may provide them; the native failed receipt remains attached. Before a transaction hash is available, a diagnostic error with actual bytes retains the original send exception as `cause`. An empty, successful or unavailable diagnostic call leaves the original send exception intact.

## Validation

Run these repository checks from a source checkout:

```bash
npm run build
npm run test:tron-plugin
npm run tre:build-jar
npm run test:hardhat3:tron-plugin
```

The artifact suite installs a real tgz outside the repository and exercises ordinary and patched Docker TRE. It checks declaration-inclusive TypeScript, compiler identity and batch selection, native transactions/events/assertions, EVM coexistence, read-only connections, different nodes/accounts, helper isolation, owned/reused containers, failing test cleanup and persistent node shutdown. Docker and compiler failures fail the suite. `SUNHAT_PATCHED_TRE_JAR` and `SUNHAT_TRON_SOLC` can select existing local verification artifacts; compiler integrity remains enforced.

Native contract calls, raw signer calls and impersonated calls share receipt conversion and a bounded receipt cache. Their receipts retain event logs for event and token balance assertions. All four native balance matchers accept synchronous predicates; single-account predicates receive a bigint and multiple-account predicates receive a bigint array.

Native `estimateGas` returns the node's simulated energy usage as a bigint (or
an RPC hex quantity). Contract methods, provider estimates and `eth_estimateGas`
share this behavior. Failed simulations and transport errors propagate;
missing energy usage is an invalid response. Deployment estimation without a
recipient is unsupported. These estimates describe energy, not TRX fees or
bandwidth costs.
