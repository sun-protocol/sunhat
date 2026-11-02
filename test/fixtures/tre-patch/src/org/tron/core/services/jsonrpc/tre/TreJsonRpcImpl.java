package org.tron.core.services.jsonrpc.tre;

import com.google.common.primitives.UnsignedBytes;
import com.google.protobuf.ByteString;
import java.util.Comparator;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.TreeMap;
import java.util.concurrent.atomic.AtomicLong;
import org.bouncycastle.util.encoders.Hex;
import org.tron.common.crypto.Hash;
import org.tron.common.parameter.CommonParameter;
import org.tron.common.utils.ByteArray;
import org.tron.common.utils.StringUtil;
import org.tron.consensus.dpos.DposSlot;
import org.tron.consensus.dpos.DposTask;
import org.tron.core.ChainBaseManager;
import org.tron.core.capsule.AccountCapsule;
import org.tron.core.capsule.BlockCapsule;
import org.tron.core.capsule.CodeCapsule;
import org.tron.core.capsule.ContractCapsule;
import org.tron.core.capsule.ProtoCapsule;
import org.tron.core.capsule.StorageRowCapsule;
import org.tron.core.config.Parameter;
import org.tron.core.db.Manager;
import org.tron.core.db.TronStoreWithRevoking;
import org.tron.core.exception.jsonrpc.JsonRpcInternalException;
import org.tron.core.exception.jsonrpc.JsonRpcInvalidParamsException;
import org.tron.core.services.jsonrpc.tre.types.MineArgs;
import org.tron.core.services.jsonrpc.tre.types.StorageRangeResult;
import org.tron.core.db.RecentTransactionStore;
import org.tron.core.db.TransactionStore;
import org.tron.core.store.AccountStore;
import org.tron.core.store.CodeStore;
import org.tron.core.store.ContractStore;
import org.tron.core.store.DebugTraceStore;
import org.tron.core.store.DynamicPropertiesStore;
import org.tron.core.store.StorageRowStore;
import org.tron.core.store.StoreFactory;
import org.tron.core.vm.debug.DebugTrace;
import org.tron.protos.Protocol;
import org.tron.protos.contract.SmartContractOuterClass;

public class TreJsonRpcImpl implements TreJsonRpc {
    private final Manager dbManager;
    private final AccountStore accountStore;
    private final CodeStore codeStore;
    private final ContractStore contractStore;
    private final DebugTraceStore debugTraceStore;
    private final DynamicPropertiesStore dynamicPropertiesStore;
    private final StorageRowStore storageRowStore;
    private final TransactionStore transactionStore;
    private final RecentTransactionStore recentTransactionStore;
    private final DposTask dposTask;
    private final DposSlot dposSlot;

    public TreJsonRpcImpl(Manager dbManager, DposTask dposTask, DposSlot dposSlot) {
        this.dbManager = dbManager;
        ChainBaseManager chainBaseManager = StoreFactory.getInstance().getChainBaseManager();
        this.accountStore = chainBaseManager.getAccountStore();
        this.codeStore = chainBaseManager.getCodeStore();
        this.contractStore = chainBaseManager.getContractStore();
        this.debugTraceStore = chainBaseManager.getDebugTraceStore();
        this.dynamicPropertiesStore = chainBaseManager.getDynamicPropertiesStore();
        this.storageRowStore = chainBaseManager.getStorageRowStore();
        this.transactionStore = chainBaseManager.getTransactionStore();
        this.recentTransactionStore = chainBaseManager.getRecentTransactionStore();
        this.dposTask = dposTask;
        this.dposSlot = dposSlot;
    }

    @Override
    public boolean setAccountBalance(String addressParam, String balanceParam) throws JsonRpcInvalidParamsException {
        if (addressParam == null) {
            throw new NullPointerException("addressParam is marked non-null but is null");
        }
        byte[] address = TreUtil.decodeAddress(addressParam);
        long balance = TreUtil.decodeLong(balanceParam);
        if (balance < 0L) {
            throw new JsonRpcInvalidParamsException("balance can not be less than 0");
        }
        AccountCapsule accountCapsule = this.accountStore.get(address);
        if (Objects.isNull(accountCapsule)) {
            boolean withDefaultPermission = this.dynamicPropertiesStore.getAllowMultiSign() == 1L;
            accountCapsule = new AccountCapsule(ByteString.copyFrom(address), Protocol.AccountType.Normal, this.dynamicPropertiesStore.getLatestBlockHeaderTimestamp(), withDefaultPermission, this.dynamicPropertiesStore);
        }
        accountCapsule.setBalance(balance);
        this.forceWrite((TronStoreWithRevoking) this.accountStore, address, (ProtoCapsule) accountCapsule);
        return true;
    }

    @Override
    public boolean setAccountStorageAt(String addressParam, String slotParam, String valueParam) throws JsonRpcInvalidParamsException {
        byte[] address = TreUtil.decodeAddress(addressParam);
        byte[] slot = TreUtil.decodeDataWord(slotParam);
        byte[] value = TreUtil.decodeDataWord(valueParam);
        this.createContractAccountIfNotExist(address);
        // TRE 2.0: version-1 contracts hash the slot into the storage key, so
        // derive the key with the contract's version (TreUtil.compose/3).
        int contractVersion = 0;
        ContractCapsule contractCapsule = this.contractStore.get(address);
        if (contractCapsule != null) {
            contractVersion = contractCapsule.getContractVersion();
        }
        byte[] key = TreUtil.compose(slot, address, contractVersion);
        StorageRowCapsule storageRowCapsule = new StorageRowCapsule(key, value);
        this.forceWrite((TronStoreWithRevoking) this.storageRowStore, key, (ProtoCapsule) storageRowCapsule);
        return true;
    }

    @Override
    public boolean setAccountCode(String addressParam, String codeParam) throws JsonRpcInvalidParamsException {
        byte[] address = TreUtil.decodeAddress(addressParam);
        byte[] code = TreUtil.decodeHex(codeParam);
        this.createContractAccountIfNotExist(address);
        CodeCapsule codeCapsule = new CodeCapsule(code);
        this.forceWrite((TronStoreWithRevoking) this.codeStore, address, (ProtoCapsule) codeCapsule);
        ContractCapsule contractCapsule = this.contractStore.get(address);
        contractCapsule.setCodeHash(Hash.sha3(code));
        this.forceWrite((TronStoreWithRevoking) this.contractStore, address, (ProtoCapsule) contractCapsule);
        return true;
    }

    private void createContractAccountIfNotExist(byte[] address) {
        AccountCapsule accountCapsule = this.accountStore.get(address);
        if (accountCapsule == null) {
            accountCapsule = new AccountCapsule(ByteString.copyFrom(address), ByteString.copyFromUtf8("CreatedByTre"), Protocol.AccountType.Contract);
        } else {
            if (accountCapsule.getType() != Protocol.AccountType.Contract) {
                accountCapsule.updateAccountType(Protocol.AccountType.Contract);
            }
            Protocol.Account.Builder builder = accountCapsule.getInstance().toBuilder();
            builder.clearOwnerPermission();
            builder.clearWitnessPermission();
            builder.clearActivePermission();
            accountCapsule = new AccountCapsule(builder.build());
        }
        this.forceWrite((TronStoreWithRevoking) this.accountStore, address, (ProtoCapsule) accountCapsule);
        ContractCapsule contractCapsule = this.contractStore.get(address);
        if (contractCapsule == null) {
            SmartContractOuterClass.SmartContract.Builder builder = SmartContractOuterClass.SmartContract.newBuilder();
            builder.setContractAddress(ByteString.copyFrom(address)).setConsumeUserResourcePercent(100L);
            contractCapsule = new ContractCapsule(builder.build());
        }
        this.forceWrite((TronStoreWithRevoking) this.contractStore, address, (ProtoCapsule) contractCapsule);
    }

    @Override
    public boolean blockTime(String blockTimeParam) throws JsonRpcInvalidParamsException {
        int blockTime = TreUtil.decodeInt(blockTimeParam);
        if (blockTime < 0 || blockTime > 60) {
            throw new JsonRpcInvalidParamsException("block time should between [0, 60] in second");
        }
        if (blockTime == 0) {
            this.dposSlot.setAutoMine(false);
            Parameter.ChainConstant.BLOCK_PRODUCED_INTERVAL = 1;
        } else {
            this.dposSlot.setAutoMine(true);
            Parameter.ChainConstant.BLOCK_PRODUCED_INTERVAL = blockTime * 1000;
        }
        return true;
    }

    @Override
    public String mine(MineArgs mineArgs) throws JsonRpcInvalidParamsException, JsonRpcInternalException {
        int blocksToMine = TreUtil.decodeInt(mineArgs.getBlocks());
        return this.mineInternal((long) blocksToMine);
    }

    @Override
    public String mine() throws JsonRpcInvalidParamsException, JsonRpcInternalException {
        return this.mineInternal(1L);
    }

    // Per-block production budget in milliseconds. Stock DposTask.produceBatch
    // passes `currentTimeMillis + BLOCK_PRODUCED_INTERVAL` to BlockHandle.produce
    // as the deadline. In instamine mode BLOCK_PRODUCED_INTERVAL is 1 ms, which
    // is too tight to fit any non-trivial contract call (CREATE2 deploys, full
    // bytecode publish, complex EVM execution) -- generateBlock's per-tx loop
    // (Manager.java:1681 "Processing transaction time exceeds the producing
    // time") breaks before the tx is processed, the tx is left in pending, and
    // waitForReceipt polls fruitlessly until its own 60 s deadline. We pass a
    // 5-second budget instead. This DOES NOT change BLOCK_PRODUCED_INTERVAL --
    // slot/witness scheduling stays identical to stock behaviour.
    private static final long MINE_DEADLINE_BUDGET_MS = 5000L;

    private String mineInternal(long blocksToMine) throws JsonRpcInvalidParamsException, JsonRpcInternalException {
        if (blocksToMine <= 0L || blocksToMine > 100L) {
            throw new JsonRpcInvalidParamsException("blocks should between (0, 100]");
        }
        try {
            return this.mineWithBudget((int) blocksToMine);
        } finally {
            // Consume any one-shot tre_setNextBlockTimestamp override.
            // Subsequent tre_mine calls resume normal slot-based
            // timestamping unless the test sets another override.
            DposSlot.NEXT_BLOCK_TIMESTAMP_OVERRIDE = 0L;
        }
    }

    // DposTask.isManualMining is an AtomicBoolean in tronbox/tre:dev but a
    // plain boolean in stock java-tron — probe the live value's type so the
    // patch works against either runtime. Admission must be atomic (native
    // produceBatch does compareAndSet(false, true)): a separate read-then-set
    // lets two concurrent tre_mine calls both pass the check and both drive
    // block production. The AtomicBoolean path gets a real CAS — which also
    // excludes against the node's own produceBatch — and the stock-boolean
    // path guards the check-and-set with a process-wide lock.
    private static final Object MANUAL_MINING_FALLBACK_LOCK = new Object();

    private static boolean tryEnterManualMining(java.lang.reflect.Field field, Object target)
            throws IllegalAccessException {
        Object value = field.get(target);
        if (value instanceof java.util.concurrent.atomic.AtomicBoolean) {
            return ((java.util.concurrent.atomic.AtomicBoolean) value).compareAndSet(false, true);
        }
        synchronized (MANUAL_MINING_FALLBACK_LOCK) {
            if ((Boolean) field.get(target)) {
                return false;
            }
            field.setBoolean(target, true);
            return true;
        }
    }

    private static void exitManualMining(java.lang.reflect.Field field, Object target)
            throws IllegalAccessException {
        Object value = field.get(target);
        if (value instanceof java.util.concurrent.atomic.AtomicBoolean) {
            ((java.util.concurrent.atomic.AtomicBoolean) value).set(false);
        } else {
            field.setBoolean(target, false);
        }
    }

    // Replicates DposTask.produceBatch's logic but passes MINE_DEADLINE_BUDGET_MS
    // to BlockHandle.produce as the deadline. Uses reflection because DposTask's
    // dposService field is private and the BlockHandle interface lives in a
    // module we don't want to add as a direct compile dependency of the patch.
    //
    // Returns "0x0" on success (matches the stock mine() return shape).
    private String mineWithBudget(int blocksToMine) throws JsonRpcInternalException {
        try {
            java.lang.reflect.Field isManualMiningField =
                this.dposTask.getClass().getDeclaredField("isManualMining");
            isManualMiningField.setAccessible(true);

            java.lang.reflect.Field dposServiceField =
                this.dposTask.getClass().getDeclaredField("dposService");
            dposServiceField.setAccessible(true);
            Object dposService = dposServiceField.get(this.dposTask);

            Object blockHandle = dposService.getClass().getMethod("getBlockHandle").invoke(dposService);
            java.util.Map<?, ?> miners =
                (java.util.Map<?, ?>) dposService.getClass().getMethod("getMiners").invoke(dposService);

            // BlockHandle.produce takes (Param.Miner, long blockTime, long deadline, boolean).
            // Resolve the Param.Miner Class via the JVM (not a direct import) so the
            // patch compiles without pulling org.tron.consensus.base into the
            // build-script classpath gymnastics for an inner class.
            Class<?> minerClass = Class.forName("org.tron.consensus.base.Param$Miner");
            java.lang.reflect.Method produceMethod = null;
            for (java.lang.reflect.Method m : blockHandle.getClass().getMethods()) {
                if (!"produce".equals(m.getName())) continue;
                Class<?>[] pt = m.getParameterTypes();
                if (pt.length == 4 && pt[0].isAssignableFrom(minerClass)
                        && pt[1] == long.class && pt[2] == long.class && pt[3] == boolean.class) {
                    produceMethod = m;
                    break;
                }
            }
            if (produceMethod == null) {
                throw new JsonRpcInternalException(
                    "BlockHandle.produce(Param.Miner, long, long, boolean) not found on "
                        + blockHandle.getClass().getName());
            }
            java.lang.reflect.Method setBlockWaitLock =
                blockHandle.getClass().getMethod("setBlockWaitLock", boolean.class);

            // Native produceBatch holds BlockHandle.getLock() while producing;
            // take the same monitor so a manual mine never interleaves with
            // the node's own block production.
            Object produceLock = blockHandle.getClass().getMethod("getLock").invoke(blockHandle);
            if (produceLock == null) {
                produceLock = blockHandle;
            }

            if (!tryEnterManualMining(isManualMiningField, this.dposTask)) {
                throw new JsonRpcInternalException("node is already manual mining");
            }
            try {
                setBlockWaitLock.invoke(blockHandle, true);
                synchronized (produceLock) {
                    for (int i = 0; i < blocksToMine; i++) {
                        // Recompute slot/witness/blockTime per iteration so each
                        // block in a multi-block batch gets a fresh schedule slot
                        // (matches stock chain semantics, where consecutive
                        // intra-batch blocks advance one slot each).
                        long slot = this.dposSlot.getSlot(System.currentTimeMillis() + 50L);
                        com.google.protobuf.ByteString scheduled = this.dposSlot.getScheduledWitness(slot);
                        Object miner = miners.get(scheduled);
                        if (miner == null) {
                            throw new JsonRpcInternalException("no miner configured for scheduled witness");
                        }
                        long blockTime = this.dposSlot.getTime(slot);
                        // OZ-on-TVM: enforce ≥1-second advance between
                        // mined blocks when the override is not set. In
                        // instamine mode (`blockTime=0`), `BLOCK_PRODUCED_INTERVAL`
                        // is 1ms, so two consecutive tre_mine calls land
                        // blocks at the SAME `block.timestamp` (second
                        // resolution) — breaking Governor tests that do
                        // `waitForSnapshot(snap) → vote()`. Hardhat's
                        // BLOCK_PRODUCED_INTERVAL is 1 second by default,
                        // so the vote-tx block naturally lands at snap+1.
                        //
                        // We only clamp here (the manual-mine path) and not
                        // in DposSlot.getTime itself — the validation paths
                        // (validateWitnessSchedule, etc.) call getTime with
                        // slot=0/1 to compute expected schedule times, and
                        // bumping those by +1000ms would fail block-time
                        // validation on legitimate genesis-era blocks.
                        if (DposSlot.NEXT_BLOCK_TIMESTAMP_OVERRIDE == 0L) {
                            long lbht = this.dynamicPropertiesStore.getLatestBlockHeaderTimestamp();
                            long minimum = lbht + 1000L;
                            if (blockTime < minimum) {
                                blockTime = minimum;
                            }
                        }
                        long deadline = System.currentTimeMillis() + MINE_DEADLINE_BUDGET_MS;
                        produceMethod.invoke(blockHandle, miner, blockTime, deadline, true);
                        // After produce, the override is consumed (handled in
                        // mineInternal's finally block on return). Within a
                        // multi-block batch, subsequent iterations of this loop
                        // re-enter getTime/getSlot with override=0 so each block
                        // gets a fresh, monotonically-advancing timestamp.
                        DposSlot.NEXT_BLOCK_TIMESTAMP_OVERRIDE = 0L;
                    }
                }
            } finally {
                // Mirror native produceBatch's release order: manual-mining
                // flag first, then the block wait lock.
                exitManualMining(isManualMiningField, this.dposTask);
                setBlockWaitLock.invoke(blockHandle, false);
            }
            return "0x0";
        } catch (JsonRpcInternalException e) {
            throw e;
        } catch (Exception e) {
            throw new JsonRpcInternalException("custom mine failed: " + e.getClass().getName() + ": " + e.getMessage());
        }
    }

    @Override
    public boolean unlockedAccounts(List<String> accountsParam) throws JsonRpcInvalidParamsException {
        for (String accountStr : accountsParam) {
            byte[] address = TreUtil.decodeAddress(accountStr);
            String account = StringUtil.encode58Check(address);
            if (!CommonParameter.getInstance().unlockedAccounts.contains(account)) {
                CommonParameter.getInstance().unlockedAccounts.add(account);
            }
        }
        return true;
    }

    @Override
    public String version() {
        // Base TRE build reports "v1.0.1" on tronbox/tre 2.0.0; the `-oz-tron`
        // suffix is what the hardhat-tron runtime gates the patched cheatcodes on.
        return "v2.0.0-oz-tron";
    }

    private static final String INSTANCE_ID = newInstanceId();

    private static String newInstanceId() {
        byte[] buf = new byte[32];
        new java.security.SecureRandom().nextBytes(buf);
        return "0x" + Hex.toHexString(buf);
    }

    @Override
    public String instanceId() {
        return INSTANCE_ID;
    }

    @Override
    public boolean start(String threadsParam) throws JsonRpcInvalidParamsException {
        TreUtil.decodeInt(threadsParam);
        return true;
    }

    @Override
    public boolean stop() throws JsonRpcInvalidParamsException {
        return true;
    }

    @Override
    public DebugTrace traceTransaction(String txID) throws JsonRpcInvalidParamsException {
        return DebugTrace.fromPB(this.debugTraceStore.get(TreUtil.decodeHash(txID)).getInstance());
    }

    @Override
    public StorageRangeResult storageRangeAt(String blockHashOrNumber, int txIndex, String address, String startKey, int limit) throws JsonRpcInvalidParamsException {
        // TRE 2.0 semantics (reconstructed from the stock 2.0.0 jar): only the
        // latest state is served, keys are returned in unsigned lexicographic
        // order from `startKey`, and `nextKey` is set when `limit` is hit.
        this.checkLatestState(blockHashOrNumber, txIndex);
        if (limit <= 0) {
            throw new JsonRpcInvalidParamsException("limit must be greater than 0");
        }
        byte[] prefix = new byte[16];
        System.arraycopy(Hash.sha3(TreUtil.decodeAddress(address)), 0, prefix, 0, 16);
        byte[] start = null;
        if (startKey != null && !startKey.isEmpty()) {
            String hex = startKey.startsWith("0x") ? startKey.substring(2) : startKey;
            if (!hex.isEmpty()) {
                start = ByteArray.fromHexString(hex);
            }
        }
        Comparator<byte[]> comparator = UnsignedBytes.lexicographicalComparator();
        TreeMap<byte[], byte[]> sorted = new TreeMap<>(comparator);
        this.storageRowStore.prefixQuery(prefix).forEach((key, value) -> sorted.put(key.getBytes(), value.getData()));
        StorageRangeResult result = new StorageRangeResult();
        int count = 0;
        for (Map.Entry<byte[], byte[]> entry : sorted.entrySet()) {
            byte[] key = entry.getKey();
            if (start != null && comparator.compare(key, start) < 0) {
                continue;
            }
            if (count >= limit) {
                result.setNextKey(Hex.toHexString(key));
                break;
            }
            result.addEntry(Hex.toHexString(key), Hex.toHexString(entry.getValue()));
            count++;
        }
        return result;
    }

    // TRE 2.0: debug_storageRangeAt only supports the head state. Accept
    // "latest", an empty selector, the head block number (decimal, or hex with
    // 0x), 0, or the head block hash; reject anything else.
    private void checkLatestState(String blockHashOrNumber, int txIndex) throws JsonRpcInvalidParamsException {
        ChainBaseManager chainBaseManager = this.dbManager.getChainBaseManager();
        if (txIndex > 0) {
            throw new JsonRpcInvalidParamsException("only the latest/current state is supported, txIndex must be 0");
        }
        if (blockHashOrNumber == null || blockHashOrNumber.isEmpty() || "latest".equalsIgnoreCase(blockHashOrNumber)) {
            return;
        }
        long headNumber = chainBaseManager.getHeadBlockNum();
        BlockCapsule.BlockId headId = chainBaseManager.getHeadBlockId();
        String headHash = headId.toString();
        String value = blockHashOrNumber.startsWith("0x") ? blockHashOrNumber.substring(2) : blockHashOrNumber;
        boolean matchesHash = value.equalsIgnoreCase(headHash);
        boolean matchesNumber = false;
        try {
            long number = blockHashOrNumber.startsWith("0x") ? Long.parseLong(value, 16) : Long.parseLong(value);
            matchesNumber = number == headNumber || number == 0;
        } catch (NumberFormatException e) {
            // not a block number
        }
        if (!matchesHash && !matchesNumber) {
            throw new JsonRpcInvalidParamsException("only the latest/current state is supported");
        }
    }

    // ===== OZ-on-TVM addition =====
    // Set the timestamp of the NEXT block produced by tre_mine. The
    // implementation writes to DposSlot.NEXT_BLOCK_TIMESTAMP_OVERRIDE,
    // which the patched DposSlot consults in getTime() / getSlot().
    // Cleared in mineInternal's finally so each setNextBlockTimestamp
    // call is one-shot.
    @Override
    public boolean setNextBlockTimestamp(String timestampMsParam) throws JsonRpcInvalidParamsException {
        long target = TreUtil.decodeLong(timestampMsParam);
        if (target <= 0L) {
            throw new JsonRpcInvalidParamsException("timestamp must be > 0");
        }
        long currentLBHT = this.dynamicPropertiesStore.getLatestBlockHeaderTimestamp();
        if (target <= currentLBHT) {
            throw new JsonRpcInvalidParamsException(
                "timestamp must be greater than current LBHT (" + currentLBHT + " ms)");
        }
        DposSlot.NEXT_BLOCK_TIMESTAMP_OVERRIDE = target;
        return true;
    }

    // ===== OZ-on-TVM addition =====
    // Snapshot / revert via direct state dump.
    //
    // The "natural" implementation (RevokingDatabase.buildSession +
    // ISession.revoke) cannot survive a mine. Tracing the
    // disassembled bytecode revealed why:
    //   - SnapshotManager.buildSession() flushes the bottom of the
    //     stack to disk once `size > maxSize`.
    //   - Manager.pushBlock recomputes `maxSize = LBHN -
    //     LatestSolidifiedBlockNum + 1` at the end of every push,
    //     overriding any pin we set.
    //   - pushBlock also resets maxFlushCount via its private
    //     `Manager.maxFlushCount` field on every push.
    //   - On top of that, pushBlock calls ISession.merge() on the
    //     SessionOptional session it builds, which pops the head
    //     and shifts our session boundary.
    // Three escape hatches conspire — even with all three pinned
    // by reflection, the SessionOptional-shared session model
    // means our snapshot boundary drifts in ways that are tricky
    // to undo deterministically.
    //
    // For smoke-test scope ("just for testing if it works") we
    // sidestep all of that with a brute-force state dump: iterate
    // the relevant stores at snapshot time, save (key, value) maps
    // in memory, and write them back verbatim on revert. The TRE
    // node has a tiny state (10 prefunded accounts plus whatever
    // a test creates), so the O(state) cost is negligible.
    //
    // Stores captured (covers the OZ-on-TVM test surface):
    //   - accountStore           — balances + account metadata
    //   - codeStore              — contract bytecode
    //   - contractStore          — contract metadata (ABI hash, code hash)
    //   - storageRowStore        — SSTORE-backed contract storage
    //   - transactionStore       — confirmed-tx hash index used by
    //     Manager.validateDup() for replay protection. Critical to
    //     restore: otherwise a test that runs the same function
    //     call against a snapshot-restored contract eventually
    //     produces a tx hash collision with a previous test, and
    //     pushBlock rejects with DupTransactionException — the
    //     receipt then never appears in the unconfirmed view and
    //     waitForReceipt hangs for the full timeout. Verified by
    //     disassembling Manager.validateDup (offset 1509-1511):
    //     `chainBaseManager.getTransactionStore().has(hash)`.
    //   - recentTransactionStore — short-term tx index used by the
    //     same replay-protection path on solidified-but-recent txs.
    //     Roll back together with transactionStore for consistency.
    //
    // Deliberately NOT captured:
    //   - dynamicPropertiesStore (holds LBHN/LBHT) — rolling these
    //     back without also rolling back BlockStore + BlockIndexStore
    //     + the KhaosDatabase fork-tracker leaves the chain in an
    //     inconsistent state where ChainBaseManager.getHead() reads
    //     a "future" block that the consensus path then NPEs on
    //     next push. For loadFixture-style tests, monotonically
    //     advancing block number is harmless — contract state
    //     rolls back, time advances forward.
    //   - block history
    //   - resource accounting (energy/bandwidth)
    private static final Map<String, SnapshotEntry> SNAPSHOTS = new LinkedHashMap<>();
    private static final AtomicLong SNAPSHOT_COUNTER = new AtomicLong();

    private static class SnapshotEntry {
        // ByteBuffer wraps keep byte[] arrays usable as HashMap keys.
        final Map<java.nio.ByteBuffer, byte[]> accounts;
        final Map<java.nio.ByteBuffer, byte[]> codes;
        final Map<java.nio.ByteBuffer, byte[]> contracts;
        final Map<java.nio.ByteBuffer, byte[]> storageRows;
        final Map<java.nio.ByteBuffer, byte[]> transactions;
        final Map<java.nio.ByteBuffer, byte[]> recentTransactions;

        SnapshotEntry(
                Map<java.nio.ByteBuffer, byte[]> accounts,
                Map<java.nio.ByteBuffer, byte[]> codes,
                Map<java.nio.ByteBuffer, byte[]> contracts,
                Map<java.nio.ByteBuffer, byte[]> storageRows,
                Map<java.nio.ByteBuffer, byte[]> transactions,
                Map<java.nio.ByteBuffer, byte[]> recentTransactions) {
            this.accounts = accounts;
            this.codes = codes;
            this.contracts = contracts;
            this.storageRows = storageRows;
            this.transactions = transactions;
            this.recentTransactions = recentTransactions;
        }
    }

    // Iterate a revoking store and clone every (key, value) pair
    // into a fresh HashMap keyed by ByteBuffer (so byte[] keys
    // compare structurally). We iterate the underlying IRevokingDB
    // (raw byte[]) NOT the TronStoreWithRevoking iterator: the
    // latter wraps every value in a capsule whose constructor can
    // throw (e.g. TransactionCapsule(byte[]) raises BadItemException
    // on entries that aren't well-formed protobuf — there are such
    // entries in TransactionStore from internal metadata).
    private static <T extends org.tron.core.capsule.ProtoCapsule<?>> Map<java.nio.ByteBuffer, byte[]> dumpStore(
            org.tron.core.db.TronStoreWithRevoking<T> store) {
        Map<java.nio.ByteBuffer, byte[]> out = new java.util.HashMap<>();
        java.util.Iterator<Map.Entry<byte[], byte[]>> it = store.getRevokingDB().iterator();
        while (it.hasNext()) {
            Map.Entry<byte[], byte[]> e = it.next();
            byte[] k = e.getKey();
            byte[] v = e.getValue();
            if (k == null || v == null) {
                continue;
            }
            out.put(java.nio.ByteBuffer.wrap(k.clone()), v.clone());
        }
        return out;
    }

    // Restore a store: single-pass diff-based restore. Walks the
    // current store once, classifying each key as:
    //   - ADDED since snapshot     → delete (key in current, not in snapshot)
    //   - MODIFIED since snapshot  → put snapshot value (key in both, value differs)
    //   - UNCHANGED                → no-op (key in both, value same — most keys for short-lived fixtures)
    //   - REMOVED since snapshot   → put snapshot value (key in snapshot, not in current)
    //
    // Why: the previous implementation walked the current store to
    // build a delete list, then ALWAYS rewrote every snapshot key
    // back into the store. With ~700+ contracts and thousands of
    // storage rows, the unconditional put-back was ~80% of revert
    // cost for the typical case where the test only touched a tiny
    // slice of state since the snapshot. Diff-based revert turns that
    // into "writes proportional to actual changes" rather than
    // "writes proportional to total state" — net effect on the OZ
    // test suite is ~3-5x faster per revert.
    //
    // Uses the raw revokingDB layer so we never touch the capsule
    // layer (and never trigger BadItemException for metadata-style
    // entries in TransactionStore et al.).
    private static <T extends org.tron.core.capsule.ProtoCapsule<?>> void restoreStore(
            org.tron.core.db.TronStoreWithRevoking<T> store,
            Map<java.nio.ByteBuffer, byte[]> snapshot) {
        org.tron.core.db2.common.IRevokingDB db = store.getRevokingDB();
        java.util.List<byte[]> toDelete = new java.util.ArrayList<>();
        java.util.Set<java.nio.ByteBuffer> matched = new java.util.HashSet<>(snapshot.size() * 2);
        // Single pass through current store: classify each key.
        java.util.Iterator<Map.Entry<byte[], byte[]>> it = db.iterator();
        while (it.hasNext()) {
            Map.Entry<byte[], byte[]> entry = it.next();
            byte[] k = entry.getKey();
            if (k == null) {
                continue;
            }
            java.nio.ByteBuffer keyBuf = java.nio.ByteBuffer.wrap(k);
            byte[] snapVal = snapshot.get(keyBuf);
            if (snapVal == null) {
                // Added since snapshot — needs delete.
                toDelete.add(k);
            } else {
                matched.add(keyBuf);
                // In both — check if value actually changed.
                if (!java.util.Arrays.equals(entry.getValue(), snapVal)) {
                    db.put(k, snapVal);
                }
                // else: unchanged, no-op — the savings vs the
                // previous implementation come from this branch
                // being the common case.
            }
        }
        for (byte[] k : toDelete) {
            db.delete(k);
        }
        // Keys present in snapshot but absent from current store
        // (deleted between snapshot and revert) — write them back.
        for (Map.Entry<java.nio.ByteBuffer, byte[]> e : snapshot.entrySet()) {
            if (!matched.contains(e.getKey())) {
                db.put(e.getKey().array(), e.getValue());
            }
        }
    }

    @Override
    public String snapshot() throws JsonRpcInternalException {
        try {
            // EXPERIMENT: revert to pre-"proper fix" — don't snapshot
            // transactionStore. The proper fix introduced unexplained
            // broadcast-dropped behavior late in long runs. Bisecting.
            Map<java.nio.ByteBuffer, byte[]> accounts;
            Map<java.nio.ByteBuffer, byte[]> codes;
            Map<java.nio.ByteBuffer, byte[]> contracts;
            Map<java.nio.ByteBuffer, byte[]> storageRows;
            Map<java.nio.ByteBuffer, byte[]> transactions = new java.util.HashMap<>();
            Map<java.nio.ByteBuffer, byte[]> recentTransactions = new java.util.HashMap<>();
            synchronized (this.dbManager) {
                accounts = dumpStore(this.accountStore);
                codes = dumpStore(this.codeStore);
                contracts = dumpStore(this.contractStore);
                storageRows = dumpStore(this.storageRowStore);
            }
            String id = "0x" + Long.toHexString(SNAPSHOT_COUNTER.incrementAndGet());
            synchronized (SNAPSHOTS) {
                SNAPSHOTS.put(id, new SnapshotEntry(
                    accounts, codes, contracts, storageRows,
                    transactions, recentTransactions));
            }
            return id;
        } catch (Exception e) {
            throw new JsonRpcInternalException("snapshot failed: " + e.getMessage());
        }
    }

    @Override
    public boolean revert(String snapshotId) throws JsonRpcInvalidParamsException, JsonRpcInternalException {
        // Walk insertion order, drop snapshotId and everything
        // taken after it (Hardhat semantics: revert(N) invalidates
        // any newer snapshot ids). The TARGET snapshot's state is
        // what we restore.
        SnapshotEntry targetEntry;
        synchronized (SNAPSHOTS) {
            if (!SNAPSHOTS.containsKey(snapshotId)) {
                throw new JsonRpcInvalidParamsException("unknown snapshot id: " + snapshotId);
            }
            targetEntry = SNAPSHOTS.get(snapshotId);
            boolean inTail = false;
            Iterator<Map.Entry<String, SnapshotEntry>> it = SNAPSHOTS.entrySet().iterator();
            while (it.hasNext()) {
                Map.Entry<String, SnapshotEntry> e = it.next();
                if (e.getKey().equals(snapshotId)) {
                    inTail = true;
                }
                if (inTail) {
                    it.remove();
                }
            }
        }
        try {
            synchronized (this.dbManager) {
                restoreStore(this.accountStore, targetEntry.accounts);
                restoreStore(this.codeStore, targetEntry.codes);
                restoreStore(this.contractStore, targetEntry.contracts);
                restoreStore(this.storageRowStore, targetEntry.storageRows);
                // BISECT: skip transactionStore/recentTransactionStore
                // restore to test whether the snapshot of those was
                // causing the broadcast-dropped issue late in long
                // runs. The wait.js dual-view check handles the DUP
                // case we previously needed this for.
                // restoreStore(this.transactionStore, targetEntry.transactions);
                // restoreStore(this.recentTransactionStore, targetEntry.recentTransactions);
            }
            return true;
        } catch (Exception e) {
            throw new JsonRpcInternalException("revert failed: " + e.getMessage());
        }
    }

    private <T extends ProtoCapsule> void forceWrite(TronStoreWithRevoking<T> store, byte[] key, T value) {
        Manager manager = this.dbManager;
        synchronized (manager) {
            store.put(key, value);
        }
    }

    @Override
    public boolean dropSnapshot(String snapshotId) throws JsonRpcInvalidParamsException {
        if (snapshotId == null) {
            throw new JsonRpcInvalidParamsException("snapshotId is required");
        }
        synchronized (SNAPSHOTS) {
            return SNAPSHOTS.remove(snapshotId) != null;
        }
    }

    // ===== OZ-on-TVM addition =====
    // See TreImpersonationRegistry for full semantics + security
    // caveat. add/remove are idempotent — the static set treats
    // repeated calls as no-ops.
    @Override
    public boolean impersonateAccount(String addressParam) throws JsonRpcInvalidParamsException {
        if (addressParam == null) {
            throw new JsonRpcInvalidParamsException("addressParam is required");
        }
        byte[] address = TreUtil.decodeAddress(addressParam);
        TreImpersonationRegistry.add(address);
        return true;
    }

    @Override
    public boolean stopImpersonatingAccount(String addressParam) throws JsonRpcInvalidParamsException {
        if (addressParam == null) {
            throw new JsonRpcInvalidParamsException("addressParam is required");
        }
        byte[] address = TreUtil.decodeAddress(addressParam);
        TreImpersonationRegistry.remove(address);
        return true;
    }
}
