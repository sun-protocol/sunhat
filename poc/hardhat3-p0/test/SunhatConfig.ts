import assert from "node:assert/strict";
import { config } from "hardhat";

describe("Sunhat Hardhat 3 config hook", function () {
  it("exposes the immutable normalized config on the HRE", function () {
    assert.equal(config.sunhat.compilation.defaultTarget, "evm");
    assert.equal(
      config.sunhat.compilation.targets.evm.compilers[0].version,
      "0.8.25",
    );
    assert.equal(config.sunhat.networks.hardhatMainnet.target, "evm");
    assert.equal(Object.isFrozen(config.sunhat), true);
    assert.equal(Object.isFrozen(config.sunhat.compilation.targets.evm), true);
  });
});
