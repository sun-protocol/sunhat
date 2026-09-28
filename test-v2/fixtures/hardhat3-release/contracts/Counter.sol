// SPDX-License-Identifier: MIT
pragma solidity 0.8.25;

/// @title Release package integration counter
contract Counter {
    uint256 public value;

    event ValueIncremented(uint256 indexed previousValue, uint256 indexed newValue);

    /// @notice Sets the initial counter value.
    constructor(uint256 initialValue) {
        value = initialValue;
    }

    /// @notice Increments the stored value by one.
    function increment() external {
        uint256 previousValue = value;
        uint256 newValue = previousValue + 1;
        value = newValue;
        emit ValueIncremented(previousValue, newValue);
    }
}
