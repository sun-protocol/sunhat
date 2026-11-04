package org.tron.core.services.jsonrpc.tre;

import java.nio.ByteBuffer;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;

// OZ-on-TVM addition.
//
// Process-global whitelist consulted by the patched
// org.tron.core.capsule.TransactionCapsule.validateSignature: when a
// transaction's `owner_address` is in this set, signature verification
// is skipped and the tx is accepted regardless of which key signed it.
//
// Motivated by Hardhat's `impersonateAccount` cheat which the OZ test
// suite leans on for contract-as-caller flows (AccessManager,
// AccessManaged, Bridge*, RelayedCall, ERC20Crosschain,
// TransparentUpgradeableProxy proxy-admin tests, ~600 cases total). On
// real TVM there is no analogue: every tx must carry a signature that
// ECRecovers to its owner_address. This registry is the explicit
// opt-in that lets a developer's regtest accept "I broadcast as 0xCAFE
// even though I don't have its key" provided 0xCAFE has been added
// here.
//
// Mutated via the `tre_impersonateAccount` / `tre_stopImpersonatingAccount`
// JSON-RPC methods (see TreJsonRpc / TreJsonRpcImpl). Storage is a
// ConcurrentHashMap-backed Set so the read path on the validation
// thread doesn't contend with RPC-thread writes.
//
// Snapshot semantics: this registry is INTENTIONALLY NOT covered by
// `tre_snapshot` / `tre_revert`. Impersonation grants are a node
// setting, not part of chain state — a loadFixture-based test that
// calls `impersonate(addr)` once at top-of-file should not lose its
// grant when the fixture restores. Tests that want to drop a grant
// must call `stopImpersonatingAccount` explicitly.
//
// Security: this is a regtest-only feature. The patched jar carrying
// this class must never be deployed against a real network — any
// inbound tx whose owner is on the whitelist would be accepted without
// signature verification.
public final class TreImpersonationRegistry {

    private static final Set<ByteBuffer> WHITELIST = ConcurrentHashMap.newKeySet();

    private TreImpersonationRegistry() {
    }

    // Add an address to the whitelist. The address byte[] is cloned
    // so callers can reuse the buffer; we never hold a reference to
    // caller-owned arrays since ByteBuffer.wrap doesn't copy.
    public static void add(byte[] address) {
        if (address == null || address.length == 0) {
            return;
        }
        WHITELIST.add(ByteBuffer.wrap(address.clone()));
    }

    public static void remove(byte[] address) {
        if (address == null || address.length == 0) {
            return;
        }
        WHITELIST.remove(ByteBuffer.wrap(address));
    }

    public static boolean isImpersonated(byte[] address) {
        if (address == null || address.length == 0) {
            return false;
        }
        return WHITELIST.contains(ByteBuffer.wrap(address));
    }

    public static int size() {
        return WHITELIST.size();
    }

    public static void clear() {
        WHITELIST.clear();
    }
}
