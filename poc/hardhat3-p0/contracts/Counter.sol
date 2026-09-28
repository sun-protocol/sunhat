// SPDX-License-Identifier: MIT
pragma solidity 0.8.25;

/// @title Minimal Hardhat 3 build and test probe
/// @notice Keeps the P0 fixture independent from Sunhat 1.x runtime code.
contract Counter {
    uint256 public value;

    event ValueIncremented(uint256 indexed previousValue, uint256 indexed newValue);

    /// @notice Increments the stored value by one.
    function increment() external {
        uint256 previousValue = value;
        uint256 newValue;
        unchecked {
            newValue = previousValue + 1;
        }
        value = newValue;
        emit ValueIncremented(previousValue, newValue);
    }
}
