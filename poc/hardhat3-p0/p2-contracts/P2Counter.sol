// SPDX-License-Identifier: MIT
pragma solidity 0.8.25;

/// @title P2 compiler task integration fixture
contract P2Counter {
    uint256 public immutable initialValue;

    /// @param value Value embedded into the deployment bytecode.
    constructor(uint256 value) {
        initialValue = value;
    }
}
