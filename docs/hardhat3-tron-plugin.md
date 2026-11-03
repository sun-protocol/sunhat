# Hardhat 3 TRON plugin

The Sunhat artifact exposes `@sun-protocol/sunhat/hardhat3-tron`. Projects using the generated `sunhat` npm alias import `sunhat/hardhat3-tron`. This entry adapts the licensed Hardhat 2 TRON runtime to public Hardhat 3 configuration, connection, Solidity and task hooks. It does not load the Hardhat 2 plugin.

Use Node.js 22.13+, 24.x or 26.x. The verified consumer dependencies are Hardhat 3.21.1, hardhat-ethers 4.2.1, hardhat-mocha 4.0.1, ethers 6.17.0, tron-runtime 0.1.0, TronWeb 6.5.1 and solc 0.8.26. Import checks reject incompatible dependency versions before loading framework hooks. Consumer projects own these dependencies; installing the CLI alone installs none of them.

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

## Compiler and connections

The package's default TRE image and compiler mirror are maintained in `config/tron-defaults.json`. A project's `tre.image` and `tre.compiler.mirror` settings override these defaults; `tre.compiler.path` selects a local compiler instead.

`tre.compiler.target` is `auto`, `tron` or `evm`. Auto uses the configured `networks.default.tron` flag when resolving configuration; a command-line network flag does not change the compiler target. Keep separate configurations or explicitly select the target when compiling for both VMs. TRON artifacts use `<artifacts>-tron`; EVM connections read the original artifact root. Build both targets before a test that deploys on both.

The downloader verifies the upstream compiler manifest and checksum before atomic cache replacement. `tre.compiler.path` accepts only the pinned 0.8.26 TVM compiler with SHA-256 `31fe546b9e6ad74e816d6406dcdb59f3af180f9c1145fd994bd5205d9c8465c1`. `include`, `exclude`, `batches` and `batchesPath` adapt source selection through the public build hook. `hardhat tron:compile-batches` builds the configured batches without deleting earlier batch artifacts.

Obtain ethers and optional native helpers from `await network.create(name)`. A TRON connection exposes `connection.tre`; an EVM connection does not. Close each connection after use and preserve the original operation error if closing also fails. Providers, keys, receipts, fixture caches and capability probes belong to that connection. Local metadata identifies the actual node instance rather than the connection object.

## Docker and assertions

Automatic Docker startup is disabled by default. With `tre.autoStart: true`, the default policies start TRE for `test`, `test mocha` and `node`; `autoStartOnCompile` remains false. Startup requires a loopback URL. Configure `image`, `port`, `startupEnv`, `jarPath`, `containerName`, `readinessTimeoutMs`, `autoStartOnTest`, `autoStartOnCompile`, `autoStartOnNode` and `keepRunning` explicitly where needed. Relative jar paths resolve from the project root. Only containers started by this invocation are removed; pre-existing services are reused. The TRON node task remains alive until a termination signal and retains the service.

Ordinary TRE supports native compilation, deployment, calls, events, balances and receipts. Snapshot/revert, fixture snapshots, time control, account balance/code/storage mutation and impersonation require a patched node. Unsupported capabilities fail explicitly. Build the pinned test patch with `npm run tre:build-jar`; its sources, licenses and provenance live under `test/fixtures/tre-patch/` and are excluded from the npm package.

The inherited patched snapshot restores account, code, contract and storage state. It retains block height, timestamps and transaction history. A successful receipt remains a historical receipt after restoring state; snapshot restoration does not mean that the transaction was never included. Snapshots affect every connection to the same node, so serialize snapshot-based tests on that node. Separate nodes have independent state and capabilities.

Set `tre.matchers: true` and register `@nomicfoundation/hardhat-ethers-chai-matchers@3.0.11` with `chai@5.3.3` for assertions. Native balance matchers follow the Hardhat 3 signature, for example `expect(tx).to.changeEtherBalance(connection.ethers, account, delta)`. Events and revert assertions retain the official matcher interface. EVM balance assertions keep their original implementation. No global HRE or module-export patch selects the native connection.

The facade covers the inherited TRON testing surface, not every ethers Provider method. Native `waitForTransaction` supports inclusion confirmation counts zero and one; larger counts fail explicitly. Coverage, Solidity tests, forks and proxy upgrade plugins require separate compatibility work.

## Validation

Run these repository checks from a source checkout:

```bash
npm run build
npm run test:tron-plugin
npm run tre:build-jar
npm run test:hardhat3:tron-plugin
```

The artifact suite installs a real tgz outside the repository and exercises ordinary and patched Docker TRE. It checks declaration-inclusive TypeScript, compiler identity and batch selection, native transactions/events/assertions, EVM coexistence, read-only connections, different nodes/accounts, helper isolation, owned/reused containers, failing test cleanup and persistent node shutdown. Docker and compiler failures fail the suite. `SUNHAT_PATCHED_TRE_JAR` and `SUNHAT_TRON_SOLC` can select existing local verification artifacts; compiler integrity remains enforced.
