// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @dev Minimal balance/event fixture for matcher compatibility tests.
contract TokenFixture {
    error InsufficientBalance();

    mapping(address account => uint256 balance) public balanceOf;

    event Transfer(address indexed from, address indexed to, uint256 amount);

    constructor() {
        balanceOf[msg.sender] = 100;
        emit Transfer(address(0), msg.sender, 100);
    }

    function transfer(address recipient, uint256 amount) external returns (bool) {
        uint256 balance = balanceOf[msg.sender];
        if (balance < amount) revert InsufficientBalance();
        balanceOf[msg.sender] = balance - amount;
        balanceOf[recipient] += amount;
        emit Transfer(msg.sender, recipient, amount);
        return true;
    }
}
