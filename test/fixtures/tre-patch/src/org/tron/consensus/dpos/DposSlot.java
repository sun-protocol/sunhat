package org.tron.consensus.dpos;

import com.google.protobuf.ByteString;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;
import org.tron.consensus.ConsensusDelegate;
import org.tron.core.config.Parameter;

@Component
public class DposSlot {
    private static final Logger logger = LoggerFactory.getLogger("consensus");
    private volatile boolean autoMine = false;
    @Autowired
    private ConsensusDelegate consensusDelegate;
    private DposService dposService;

    // OZ-on-TVM addition: when non-zero, the NEXT call to
    // `getTime()` returns this value verbatim instead of computing
    // from slot * BLOCK_PRODUCED_INTERVAL. `tre_setNextBlockTimestamp`
    // writes here; `TreJsonRpcImpl.mineInternal` clears it after a
    // successful produce. Volatile because block production runs on
    // its own thread.
    public static volatile long NEXT_BLOCK_TIMESTAMP_OVERRIDE = 0L;

    public long getAbSlot(long time) {
        return (time - this.dposService.getGenesisBlockTime()) / (long) Parameter.ChainConstant.BLOCK_PRODUCED_INTERVAL;
    }

    public long getSlot(long time) {
        // OZ-on-TVM: when the one-shot override is set, return
        // slot 1 so produceBatch picks a non-zero slot. slot=0 maps
        // to NOT_TIME_YET in DposTask; we want the produce path to
        // proceed and consume our override.
        if (NEXT_BLOCK_TIMESTAMP_OVERRIDE > 0L) {
            return 1L;
        }
        long firstSlotTime = this.getTime(0L);
        if (time < firstSlotTime) {
            // OZ-on-TVM fix: after a forward time-warp the
            // chain's LBHT can be greater than the wall-clock. The
            // stock code returned 0 here, but DposTask's
            // produceBatch then calls getTime(0) which yields LBHT
            // verbatim — giving the new block the SAME timestamp as
            // the previous one, which fails validateWitnessSchedule
            // on push. Returning 1 here advances the block by one
            // interval (1 ms in instamine mode) so each successive
            // mine ratchets time strictly forward.
            return 1L;
        }
        return (time - firstSlotTime) / (long) Parameter.ChainConstant.BLOCK_PRODUCED_INTERVAL;
    }

    public long getTime(long slot) {
        // OZ-on-TVM addition: short-circuit to the override so
        // the next mined block lands at exactly the requested timestamp.
        // Cleared after produce by the caller -- see TreJsonRpcImpl.
        long override = NEXT_BLOCK_TIMESTAMP_OVERRIDE;
        if (override > 0L) {
            return override;
        }
        long interval = Parameter.ChainConstant.BLOCK_PRODUCED_INTERVAL;
        if (this.consensusDelegate.getLatestBlockHeaderNumber() == 0L) {
            return this.dposService.getGenesisBlockTime() + slot * interval;
        }
        if (this.consensusDelegate.lastHeadBlockIsMaintenance()) {
            slot += this.consensusDelegate.getMaintenanceSkipSlots();
        }
        long time = this.consensusDelegate.getLatestBlockHeaderTimestamp();
        time -= (time - this.dposService.getGenesisBlockTime()) % interval;
        return time + interval * slot;
    }

    public ByteString getScheduledWitness(long slot) {
        long currentSlot = this.getAbSlot(this.consensusDelegate.getLatestBlockHeaderTimestamp()) + slot;
        if (currentSlot < 0L) {
            throw new RuntimeException("current slot should be positive.");
        }
        int size = this.consensusDelegate.getActiveWitnesses().size();
        if (size <= 0) {
            throw new RuntimeException("active witnesses is null.");
        }
        int witnessIndex = (int) currentSlot % (size * 1);
        return (ByteString) this.consensusDelegate.getActiveWitnesses().get(witnessIndex /= 1);
    }

    public boolean isAutoMine() {
        return this.autoMine;
    }

    public void setAutoMine(boolean autoMine) {
        this.autoMine = autoMine;
    }

    public void setDposService(DposService dposService) {
        this.dposService = dposService;
    }
}
