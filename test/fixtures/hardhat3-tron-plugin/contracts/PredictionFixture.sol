// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @dev Exposes constructor state to verify prebuilt deployment identity.
contract PredictionFixture {
    string public first;
    string public second;
    uint256 public immutable initialValue;

    event Constructed(string first, string second, uint256 value);

    constructor(string memory first_, string memory second_) payable {
        first = first_;
        second = second_;
        initialValue = msg.value;
        emit Constructed(first_, second_, msg.value);
    }
}

/// @dev An address-like field must not hide other tuple fields in a cache key.
contract PredictionStructFixture {
    struct Settings {
        address target;
        uint256 amount;
        string[] labels;
    }

    bytes32 public immutable digest;

    event Configured(bytes32 digest);

    constructor(Settings memory settings) {
        digest = keccak256(abi.encode(settings));
        emit Configured(digest);
    }

    function hashSettings(Settings calldata settings) external pure returns (bytes32) {
        return keccak256(abi.encode(settings));
    }
}
