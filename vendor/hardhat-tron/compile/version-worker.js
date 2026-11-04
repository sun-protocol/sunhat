'use strict';

// Keep soljson's process listeners and module state out of the host process.
const { parentPort, workerData } = require('node:worker_threads');
const wrapper = require('solc/wrapper');
const compiler = wrapper(require(workerData));
parentPort.postMessage(compiler.version());
