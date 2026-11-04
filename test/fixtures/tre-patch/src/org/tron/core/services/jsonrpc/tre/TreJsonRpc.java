package org.tron.core.services.jsonrpc.tre;

import com.googlecode.jsonrpc4j.JsonRpcMethod;
import java.util.List;
import org.springframework.stereotype.Component;
import org.tron.core.exception.jsonrpc.JsonRpcInternalException;
import org.tron.core.exception.jsonrpc.JsonRpcInvalidParamsException;
import org.tron.core.services.jsonrpc.tre.types.MineArgs;
import org.tron.core.services.jsonrpc.tre.types.StorageRangeResult;
import org.tron.core.vm.debug.DebugTrace;

@Component
public interface TreJsonRpc {
    public static final String TRE_Prefix = "tre_";
    public static final String MINER_Prefix = "miner_";
    public static final String DEBUG_Prefix = "debug_";

    @JsonRpcMethod(value = "tre_setAccountBalance")
    boolean setAccountBalance(String var1, String var2) throws JsonRpcInvalidParamsException, JsonRpcInternalException;

    @JsonRpcMethod(value = "tre_setAccountStorageAt")
    boolean setAccountStorageAt(String var1, String var2, String var3) throws JsonRpcInvalidParamsException, JsonRpcInternalException;

    @JsonRpcMethod(value = "tre_setAccountCode")
    boolean setAccountCode(String var1, String var2) throws JsonRpcInvalidParamsException, JsonRpcInternalException;

    @JsonRpcMethod(value = "tre_blockTime")
    boolean blockTime(String var1) throws JsonRpcInvalidParamsException;

    @JsonRpcMethod(value = "tre_mine")
    String mine(MineArgs var1) throws JsonRpcInvalidParamsException, JsonRpcInternalException;

    @JsonRpcMethod(value = "tre_mine")
    String mine() throws JsonRpcInvalidParamsException, JsonRpcInternalException;

    @JsonRpcMethod(value = "tre_unlockedAccounts")
    boolean unlockedAccounts(List<String> var1) throws JsonRpcInvalidParamsException;

    @JsonRpcMethod(value = "tre_version")
    String version();

    @JsonRpcMethod(value = "miner_start")
    boolean start(String var1) throws JsonRpcInvalidParamsException;

    @JsonRpcMethod(value = "miner_stop")
    boolean stop() throws JsonRpcInvalidParamsException;

    @JsonRpcMethod(value = "debug_traceTransaction")
    DebugTrace traceTransaction(String var1) throws JsonRpcInvalidParamsException;

    @JsonRpcMethod(value = "debug_storageRangeAt")
    StorageRangeResult storageRangeAt(String var1, int var2, String var3, String var4, int var5) throws JsonRpcInvalidParamsException;

    // ===== OZ-on-TVM addition =====
    // Set the timestamp (MS since epoch) of the NEXT block produced by
    // tre_mine. One-shot: cleared after the next successful produce.
    // Combine with tre_mine to instantly advance chain time without
    // wall-clock waits.
    @JsonRpcMethod(value = "tre_setNextBlockTimestamp")
    boolean setNextBlockTimestamp(String timestampMsParam) throws JsonRpcInvalidParamsException;

    // ===== OZ-on-TVM addition =====
    // Capture the chain's current revoking-store state and return a
    // snapshot id. The id is a hex-encoded counter (e.g. "0x3"). Pass
    // it to tre_revert to roll the chain back to this point.
    //
    // Implementation: wraps java-tron's `Manager.getRevokingStore()
    // .buildSession()`. Subsequent block productions / state writes
    // accumulate on top of the session; revoking the session undoes
    // them all in one atomic step. Snapshots taken AFTER this one
    // are also discarded on revert (matches Hardhat's evm_revert
    // semantics — every snapshot id is one-shot and invalidates
    // newer ids).
    @JsonRpcMethod(value = "tre_snapshot")
    String snapshot() throws JsonRpcInternalException;

    // ===== OZ-on-TVM addition =====
    // Roll the chain state back to the point at which `snapshotId`
    // was captured. Discards the snapshot (and any newer ones).
    // Returns true on success, throws JsonRpcInvalidParamsException
    // if the id is unknown / already consumed.
    @JsonRpcMethod(value = "tre_revert")
    boolean revert(String snapshotId) throws JsonRpcInvalidParamsException, JsonRpcInternalException;

    // ===== OZ-on-TVM addition =====
    // Release the memory held by `snapshotId` without restoring state.
    // Each snapshot pins a full copy of the four state stores in RAM;
    // a long test run accumulates O(test_file_count) of these, each
    // holding everything-ever-deployed worth of bytecode/storage. Once
    // a fixture's snapshot id is no longer reachable from the JS side
    // (loadFixture has discarded its restorer), dropping it frees the
    // memory and stops it from contributing to the lookup cost on
    // future revert calls. Idempotent: dropping an already-removed id
    // returns false but does not throw.
    @JsonRpcMethod(value = "tre_dropSnapshot")
    boolean dropSnapshot(String snapshotId) throws JsonRpcInvalidParamsException;

    // ===== OZ-on-TVM addition =====
    // Add `address` to the impersonation whitelist consulted by the
    // patched TransactionCapsule.validateSignature. Subsequent
    // transactions whose owner_address equals `address` bypass
    // ECRecover + permission/weight checks and are accepted regardless
    // of which key signed them. Used to forge `msg.sender` for OZ
    // tests where the test code wants to send as a contract address
    // (AccessManager/AccessManaged/Bridge/RelayedCall flows).
    //
    // Accepts the same address formats as tre_setAccountBalance:
    // TVM base58, 0x41-prefixed hex, or 0x-prefixed 20-byte EVM-style.
    // Idempotent.
    //
    // SECURITY: this method must never be enabled on a node serving
    // real network traffic. Anyone reaching this RPC can spoof any
    // owner_address. The patched jar lives behind regtest only.
    @JsonRpcMethod(value = "tre_impersonateAccount")
    boolean impersonateAccount(String addressParam) throws JsonRpcInvalidParamsException;

    // ===== OZ-on-TVM addition =====
    // Remove `address` from the impersonation whitelist. After this
    // call, signature verification for `address` reverts to normal
    // ECRecover semantics. Idempotent (no-op if not present).
    @JsonRpcMethod(value = "tre_stopImpersonatingAccount")
    boolean stopImpersonatingAccount(String addressParam) throws JsonRpcInvalidParamsException;

    // ===== OZ-on-TVM addition =====
    // Random id generated once per node process; lets any RPC client tell
    // two boots of an otherwise deterministic chain apart.
    @JsonRpcMethod(value = "tre_instanceId")
    String instanceId();
}
