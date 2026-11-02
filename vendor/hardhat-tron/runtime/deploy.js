'use strict';

// Adapted from @openzeppelin/hardhat-tron 0.1.0; see ../provenance.json and LICENSE.
module.exports = function createModule(deps) {
  // Deploy a compiled artifact via TronWeb and wait for the full-node's
  // unconfirmed view to surface `contract_address`. Combines the
  // receipt-poll discipline from wait.js with TronWeb's smart-contract
  // creation path.

  const { mine } = deps.cheatcodes;

  // Recursively expand tuple types in an ABI input descriptor. TronWeb's
  // bundled ethers v6 AbiCoder rejects the literal `"tuple"` /
  // `"tuple[]"` type strings (it only handles full canonical forms like
  // `"(address,uint256)"` / `"(address,uint256)[]"`). The artifact's
  // stored ABI uses the literal form (matching solc's JSON output) plus
  // a `components` array describing the tuple's fields — we collapse
  // the two into one canonical string here.
  //
  // Symptom without this: `tronWeb.transactionBuilder.createSmartContract`
  // throws `TypeError: invalid param type (argument="obj",
  // value="tuple[]", code=INVALID_ARGUMENT)` for any contract whose
  // constructor takes a `tuple[]`.
  function expandTupleTypes(input) {
    if (!input) {
      return input;
    }
    if (input.type === 'tuple' && Array.isArray(input.components)) {
      return {
        ...input,
        type: `(${input.components.map((c) => expandTupleTypes(c).type).join(',')})`,
      };
    }
    const m = input.type && input.type.match(/^tuple(\[[^\]]*\])$/);
    if (m && Array.isArray(input.components)) {
      return {
        ...input,
        type: `(${input.components.map((c) => expandTupleTypes(c).type).join(',')})${m[1]}`,
      };
    }
    return input;
  }

  function expandAbiForTronWeb(abi) {
    return abi.map((item) => {
      if (!Array.isArray(item.inputs)) {
        return item;
      }
      return { ...item, inputs: item.inputs.map(expandTupleTypes) };
    });
  }

  // Build + sign a CreateSmartContract tx WITHOUT broadcasting. Returns
  // the signed tx plus the contract address TronWeb computed locally
  // (`0x41 + keccak256(txID || ownerAddress)[12:]`, identical to the
  // formula java-tron's WalletUtil.generateContractAddress uses on the
  // node side). The returned `signedTx` can be broadcast later via
  // `submitPrebuilt` and will deploy to exactly `predictedAddressTron`.
  //
  // Caveats:
  //   - TronWeb defaults `expiration` to `timestamp + 60s`. Broadcasts
  //     after that window fail with "Transaction expired".
  //   - `ref_block_*` is sampled at prebuild time. java-tron rejects
  //     broadcasts whose ref_block is more than 65535 blocks old;
  //     under TRE instamine (1 block/broadcast) that's well over a
  //     thousand intervening txs of headroom.
  async function prebuildDeploy(tronWeb, deployerAddress, artifact, opts = {}) {
    const params = {
      abi: expandAbiForTronWeb(artifact.abi),
      bytecode: artifact.bytecode,
      feeLimit: opts.feeLimit ?? 1_000_000_000,
      callValue: opts.callValue ?? 0,
      userFeePercentage: opts.userFeePercentage ?? 100,
      // `originEnergyLimit` caps energy a single tx can consume on this
      // contract regardless of caller's `feeLimit`. TVM's hard ceiling
      // is 10^7 — anything higher fails TronWeb's param validator.
      originEnergyLimit: opts.originEnergyLimit ?? 10_000_000,
      // TVM rejects CreateSmartContract with `contractName.length > 32`
      // ("Contract validate error : contractName's length cannot be
      // greater than 32"). The name field is for display only and has
      // no effect on bytecode/behavior, so truncating is safe.
      name: (opts.name ?? artifact.contractName ?? 'Contract').slice(0, 32),
      parameters: opts.parameters,
    };
    const unsigned = await tronWeb.transactionBuilder.createSmartContract(
      params,
      deployerAddress,
    );
    const signed = await tronWeb.trx.sign(unsigned);
    // `contract_address` is populated by TronWeb's helper.genContractAddress
    // BEFORE sign/broadcast (formula `41 + keccak256(txID||owner)[12:]`).
    // Signing does not change raw_data, so signed.txID === unsigned.txID
    // and the predicted address remains correct.
    return { signedTx: signed, predictedAddressTron: signed.contract_address };
  }

  // Broadcast a pre-signed CreateSmartContract tx and poll for its
  // receipt. Returns `{ address, txId, info }`, the same shape as
  // `deployContract`, so any consumer that holds a `prebuildDeploy`
  // result can hand it off to the rest of the deploy pipeline without
  // branching.
  async function submitPrebuilt(tronWeb, signed, opts = {}) {
    const sent = await tronWeb.trx.sendRawTransaction(signed);
    if (!sent.result) {
      throw new Error(`deploy failed: ${JSON.stringify(sent)}`);
    }
    const txId =
      sent.txid || (sent.transaction && sent.transaction.txID) || signed.txID;
    return pollDeployReceipt(tronWeb, txId, opts);
  }

  async function deployContract(tronWeb, deployerAddress, artifact, opts = {}) {
    const { signedTx } = await prebuildDeploy(
      tronWeb,
      deployerAddress,
      artifact,
      opts,
    );
    const sent = await tronWeb.trx.sendRawTransaction(signedTx);
    if (!sent.result) {
      throw new Error(`deploy failed: ${JSON.stringify(sent)}`);
    }
    const txId =
      sent.txid || (sent.transaction && sent.transaction.txID) || signedTx.txID;
    return pollDeployReceipt(tronWeb, txId, opts);
  }

  // Poll the unconfirmed view until the receipt surfaces (or its
  // `contract_address` does, for a constructor-reverted deploy). Shared
  // by `deployContract` (build+sign+broadcast pipeline) and
  // `submitPrebuilt` (broadcast pre-signed pipeline). Returns the same
  // `{ address, txId, info }` shape regardless of caller.
  //
  // NOTE: do NOT call `tre_mine` here on broadcast. Measured behavior
  // on tronbox/tre:dev with the patched FullNode shows
  // `broadcasttransaction` already produces a block containing the tx
  // when `blockTime=0` (instamine). An extra `tre_mine` after broadcast
  // just produces an EMPTY block on top — ~13 ms server-side cost per
  // deploy that recovers no correctness. Benchmark: 59 ms/deploy with
  // the extra mine vs 47 ms without, across 20 samples. At ~30k
  // deploys per full suite that's ~6 minutes of pure waste. The poll
  // below catches up to the auto-mined block within 1 iteration in
  // practice. (Polling will still mine as a recovery hatch if the tx
  // hasn't surfaced — see the `iter % 5` block below.)
  async function pollDeployReceipt(tronWeb, txId, opts = {}) {
    // Wall-clock budget for deploy. Default 180 s — late in a long
    // test run, TRE's per-block work grows with chain state and deploys
    // can take longer than 30 s. The wider margin avoids hiding real
    // hangs.
    const deadline = Date.now() + (opts.deployTimeout ?? 180_000);
    let iter = 0;
    // Receipt-result check: TVM sets `contract_address` on the info
    // shape even when the constructor REVERTS — the address is
    // computed deterministically and recorded regardless of execution
    // outcome. Without this gate, deployContract returns a facade for
    // a contract that doesn't actually exist on-chain, and tests like
    // `expect(deployContract(...)).to.be.revertedWithCustomError(...)`
    // see "didn't revert" instead of the constructor's revert data.
    while (Date.now() < deadline) {
      const info = await tronWeb.trx.getUnconfirmedTransactionInfo(txId);
      if (info && info.contract_address) {
        const result = info.receipt && info.receipt.result;
        // SUCCESS or undefined-receipt (early surfacing) → happy path.
        // Anything else → constructor revert; surface txId + info shape
        // so the caller can inspect.
        if (result === 'SUCCESS' || !result) {
          return { address: info.contract_address, txId, info };
        }
        // Lazy-require the bridge to avoid the bridge ↔ deploy.js
        // module-load cycle; the bridge's `buildRevertError` wraps the
        // raw `info` in an ethers-shaped Error with `.data` so chai
        // matchers' `revertedWithCustomError` can decode it.
        const { buildRevertError } = deps.bridge;
        throw buildRevertError(txId, info);
      }
      if (iter && iter % 5 === 0) {
        await mine(tronWeb).catch(() => {});
      }
      iter++;
      await new Promise((r) => setImmediate(r));
    }
    // Public-network hedge: try the solidified view once before timing
    // out.
    const info = await tronWeb.trx.getTransactionInfo(txId);
    if (info && info.contract_address) {
      const result = info.receipt && info.receipt.result;
      if (result === 'SUCCESS' || !result) {
        return { address: info.contract_address, txId, info };
      }
      throw new Error(
        `deploy reverted (${result}) tx ${txId}: ${JSON.stringify(info)}`,
      );
    }
    throw new Error(`deploy timeout — no contract_address for tx ${txId}`);
  }

  return { deployContract, prebuildDeploy, submitPrebuilt };
};
