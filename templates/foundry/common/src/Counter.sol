// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @title Counter
/// @notice Minimal state transition used to verify a Sunhat project setup.
contract Counter {
    uint256 public number;

    event NumberChanged(uint256 indexed previousNumber, uint256 indexed newNumber);

    /// @notice Replaces the stored number.
    /// @param newNumber New value to store.
    function setNumber(uint256 newNumber) external {
        uint256 previousNumber = number;
        number = newNumber;
        emit NumberChanged(previousNumber, newNumber);
    }

    /// @notice Increments the stored number by one.
    function increment() external {
        uint256 previousNumber = number;
        uint256 newNumber = previousNumber + 1;
        number = newNumber;
        emit NumberChanged(previousNumber, newNumber);
    }
}
