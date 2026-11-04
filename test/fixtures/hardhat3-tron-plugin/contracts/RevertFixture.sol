// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @dev Distinguishes actual revert bytes from unrelated runtime selectors.
contract RevertFixture {
    error Deliberate(uint256 value);
    error FailedCall();
    error FailedDeployment();

    function check(address candidate) external pure returns (bool) {
        if (candidate != address(0)) {
            assembly ("memory-safe") {
                revert(0, 0)
            }
        }
        return false;
    }

    function pay(address) external payable returns (address) {
        assembly ("memory-safe") {
            revert(0, 0)
        }
    }

    function write() external returns (address) {
        assembly ("memory-safe") {
            revert(0, 0)
        }
    }

    function failCustom() external pure {
        revert Deliberate(42);
    }

    /// @dev Encodes the built-in error deliberately for ABI compatibility tests.
    function failReason() external pure {
        bytes memory data = abi.encodeWithSignature("Error(string)", "EXPECTED_REVERT");
        assembly ("memory-safe") {
            revert(add(data, 32), mload(data))
        }
    }

    function failPanic() external pure {
        assert(false);
    }

    /// @dev These bytes are data, not evidence that either error was raised.
    function markers() external pure returns (bytes8) {
        return hex"d6bda275b06ebf3d";
    }
}
