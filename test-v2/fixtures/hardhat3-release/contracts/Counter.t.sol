// SPDX-License-Identifier: MIT
pragma solidity 0.8.25;

import {Counter} from './Counter.sol';

/// @title Native Hardhat 3 release package test
contract CounterTest {
    error UnexpectedValue(uint256 actual, uint256 expected);

    function testIncrement() external {
        Counter counter = new Counter(41);
        counter.increment();
        uint256 actual = counter.value();
        if (actual != 42) revert UnexpectedValue(actual, 42);
    }
}
