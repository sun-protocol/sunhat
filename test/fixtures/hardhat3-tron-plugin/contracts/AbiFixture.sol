// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @dev Exercises native ABI calls without token or authorization dependencies.
contract AbiFixture {
    struct Row {
        address owner;
        uint256 value;
    }

    struct Single {
        uint256 value;
    }

    struct Nested {
        Single child;
    }

    bytes32 public immutable initialDigest;
    uint256 public counter;

    event Changed(uint256 value);
    event ValueSeen(address indexed caller, uint256 value);
    event ChildCreated(address child);

    constructor(Row[][] memory rows) {
        initialDigest = keccak256(abi.encode(rows));
    }

    function valueSeen() external payable returns (uint256) {
        emit ValueSeen(msg.sender, msg.value);
        return msg.value;
    }

    function pick(uint256 first) external payable returns (uint256) {
        emit ValueSeen(msg.sender, msg.value);
        return first + msg.value;
    }

    function pick(uint256 first, uint256 second) external payable returns (uint256) {
        emit ValueSeen(msg.sender, msg.value);
        return first + second + msg.value;
    }

    function ambiguous(uint256 value) external pure returns (uint256) {
        return value;
    }

    function ambiguous(address value) external pure returns (uint256) {
        return uint160(value);
    }

    function grid(Row[][] calldata rows) external pure returns (Row[][] memory) {
        return rows;
    }

    function fixedRows(Row[1][] calldata rows) external pure returns (Row[1][] memory) {
        return rows;
    }

    function fixedOuter(Row[][2] calldata rows) external pure returns (Row[][2] memory) {
        return rows;
    }

    function single() external pure returns (Single memory row) {
        return Single(9);
    }

    function nested() external pure returns (Nested memory row) {
        return Nested(Single(9));
    }

    function multiple() external pure returns (uint256 count, Single memory row) {
        return (2, Single(9));
    }

    function mutate() external returns (uint256) {
        ++counter;
        emit Changed(counter);
        return counter;
    }

    function createChild() external returns (address child) {
        child = address(new AbiChild());
        emit ChildCreated(child);
    }
}

/// @dev A fresh deployment for nonpayable constant-call CREATE coverage.
contract AbiChild {
    address public immutable owner = msg.sender;
}
