// SPDX-License-Identifier: MIT
pragma solidity 0.8.25;

import {P2Counter} from "./P2Counter.sol";

/// @title Native Hardhat 3 Solidity test for the Sunhat-selected build target.
contract P2CounterTest {
    /// @notice Confirms constructor immutables survive the target build pipeline.
    function testInitialValue() external {
        P2Counter counter = new P2Counter(42);
        require(counter.initialValue() == 42, "unexpected initial value");
    }
}
