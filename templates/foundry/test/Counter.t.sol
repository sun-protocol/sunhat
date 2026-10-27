// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Counter} from "../src/Counter.sol";

/// @title CounterTest
/// @notice Self-contained Foundry tests with no external Solidity library dependency.
contract CounterTest {
    Counter internal counter;

    function setUp() public {
        counter = new Counter();
    }

    function testIncrement() public {
        counter.increment();
        assert(counter.number() == 1);
    }

    function testFuzzSetNumber(uint256 value) public {
        counter.setNumber(value);
        assert(counter.number() == value);
    }
}
