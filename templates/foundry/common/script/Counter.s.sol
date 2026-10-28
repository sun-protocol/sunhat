// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Counter} from "../src/Counter.sol";

// forge-lint: disable-next-line(multi-contract-file)
interface IVm {
    function startBroadcast() external;
    function stopBroadcast() external;
}

/// @title DeployCounter
/// @notice Deploys Counter using Foundry's broadcast cheatcodes without an external script library.
// forge-lint: disable-next-line(multi-contract-file)
contract DeployCounter {
    IVm private constant VM = IVm(address(uint160(uint256(keccak256("hevm cheat code")))));

    function run() external returns (Counter counter) {
        VM.startBroadcast();
        counter = new Counter();
        VM.stopBroadcast();
    }
}
