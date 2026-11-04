// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Counter} from "./Counter.sol";

/// @dev Creates children after returning an unrelated account address.
contract AddressFactoryFixture {
    address public immutable owner;

    event ChildCreated(address indexed child);

    constructor(address owner_) {
        owner = owner_;
    }

    function createChild() external {
        emit ChildCreated(address(new Counter()));
    }

    function createDeterministicChild(bytes32 salt) external {
        emit ChildCreated(address(new Counter{salt: salt}()));
    }
}
