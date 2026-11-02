# Reused TRON integration core

This directory adapts the MIT-licensed `@openzeppelin/hardhat-tron@0.1.0` npm source. `provenance.json` records the verified archive integrity and upstream file digests; `LICENSE` retains the upstream notice. The existing Hardhat 2 template continues to consume the upstream package.

The adaptation moves module state into factories and replaces implicit HRE lookups with an explicit connection context. It removes Hardhat 2 registration, global helper-module replacement and global Mocha timeout mutation. Native transport, ABI dispatch, deployment, receipt translation and patched-node primitives retain their upstream implementation. Configured accounts are used without automatic derived-account funding; `tre.fundSigners` explicitly enables the inherited patched-node funding behavior.

The Docker lifecycle accepts native node readiness and does not delete an unowned stopped container. Compiler errors retain their causes without importing Hardhat 2 error classes. New adapter code owns typed configuration, lifecycle leases, public hooks and validation of consumer input.

The public delivery path is `@sun-protocol/sunhat/hardhat3-tron`, or `sunhat/hardhat3-tron` through the generated dependency alias. Compiled entry and types live under `dist/plugins/tron/`; this CommonJS directory is packaged alongside them. The consumer provides exact Hardhat, ethers, TRON runtime, TronWeb and compiler wrapper dependencies. Optional peers cover both existing H2 consumers and the H3 plugin; importing the CLI does not load this core.

Factory isolation does not establish full node capability parity. The requirements capability matrix remains authoritative until real ordinary/patched TRE and artifact checks are recorded.
