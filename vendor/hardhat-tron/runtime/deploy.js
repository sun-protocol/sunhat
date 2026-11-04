'use strict';

// Adapted from @openzeppelin/hardhat-tron 0.1.0; see ../provenance.json and LICENSE.
module.exports = function createModule(deps) {
  // Deploy a compiled artifact via TronWeb and wait for the full-node's
  // unconfirmed view to surface `contract_address`. Combines the
  // receipt-poll discipline from wait.js with TronWeb's smart-contract
  // creation path.

  const { Interface, ParamType } = require('ethers');
  const { normalizeArguments } = require('./abi');

  // The node's protobuf ABI omits tuple components. Preserve their canonical
  // types in the stored ABI while encoding arguments against the original ABI.
  function expandAbiForTronWeb(abi) {
    return abi.map((item) =>
      !Array.isArray(item.inputs)
        ? item
        : {
            ...item,
            inputs: item.inputs.map((input) => ({
              ...input,
              type: ParamType.from(input, item.type === 'event').format(
                'sighash',
              ),
            })),
          },
    );
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
    const iface = new Interface(artifact.abi);
    const rawParameter =
      opts.rawParameter ??
      iface.encodeDeploy(
        await normalizeArguments(iface.deploy.inputs, opts.parameters ?? []),
      );
    const params = {
      abi: expandAbiForTronWeb(artifact.abi),
      bytecode: artifact.bytecode,
      feeLimit: deps.fees.feeLimit(opts.feeLimit),
      callValue: opts.callValue ?? 0,
      userFeePercentage: opts.userFeePercentage ?? 100,
      // Bound the deployer's energy contribution per contract call.
      // The pinned SDK accepts at most 10^7 for this field.
      originEnergyLimit: opts.originEnergyLimit ?? 10_000_000,
      // TVM rejects CreateSmartContract with `contractName.length > 32`
      // ("Contract validate error : contractName's length cannot be
      // greater than 32"). The name field is for display only and has
      // no effect on bytecode/behavior, so truncating is safe.
      name: (opts.name ?? artifact.contractName ?? 'Contract').slice(0, 32),
      rawParameter,
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
    if (signed?.raw_data?.fee_limit === undefined) {
      throw new Error('TRON prebuilt deployment is missing raw_data.fee_limit');
    }
    deps.fees.feeLimit(signed.raw_data.fee_limit);
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
    const info = await deps.wait.waitForReceipt(tronWeb, txId, {
      timeout: opts.deployTimeout ?? 180000,
    });
    if (info.receipt?.result !== 'SUCCESS') {
      throw deps.bridge.buildRevertError(txId, info);
    }
    if (typeof info.contract_address !== 'string') {
      throw new Error(
        `Successful deployment ${txId} has no native contract address`,
      );
    }
    return { address: info.contract_address, txId, info };
  }

  return { deployContract, prebuildDeploy, submitPrebuilt };
};
