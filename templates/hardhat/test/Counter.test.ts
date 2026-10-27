import { expect } from "chai";
import { ethers } from "hardhat";

describe("Counter", function () {
  it("increments", async function () {
    const counter = await ethers.deployContract("Counter");
    await (await counter.increment()).wait();
    expect(await counter.number()).to.equal(1n);
  });
});
