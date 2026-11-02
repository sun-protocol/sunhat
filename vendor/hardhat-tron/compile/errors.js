'use strict';

// Adapted from @openzeppelin/hardhat-tron 0.1.0; see ../provenance.json and LICENSE.
module.exports = function createModule() {
  // Retain compiler error causes without depending on Hardhat 2 error classes.
  const PLUGIN_NAME = '@openzeppelin/hardhat-tron';

  class TronCompileError extends Error {
    constructor(message, parentError) {
      super(
        message,
        parentError === undefined ? undefined : { cause: parentError },
      );
    }
  }

  return { TronCompileError, PLUGIN_NAME };
};
