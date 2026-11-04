// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Counter} from "../contracts/Counter.sol";

/// @dev Verifies artifact lookup outside the conventional contracts directory.
contract CustomCounter is Counter {}
