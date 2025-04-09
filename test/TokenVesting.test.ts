import { expect } from "chai";
import { ethers } from "hardhat";
import { Signer } from "ethers";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { MockERC20 } from "../typechain-types";

describe("TokenVesting", function () {
  let token: MockERC20;
  let vesting: any; // Using any type for now since we don't have the generated types
  let owner: Signer;
  let addr1: Signer;
  let addr2: Signer;
  let ownerAddress: string;
  const INITIAL_SUPPLY = ethers.parseEther("1000000000"); // 1 billion tokens
  const VESTING_AMOUNT = ethers.parseEther("100000000"); // 100 million tokens
  const VESTING_DURATION = 360 * 24 * 60 * 60; // 360 days in seconds
  const CLIFF_DURATION = 30 * 24 * 60 * 60; // 30 days in seconds
  const VESTING_PERIODS = 12;
  const ONE_DAY = 86400;
  const ONE_MONTH = CLIFF_DURATION + ONE_DAY;
  const TWO_MONTH = CLIFF_DURATION * 2 + ONE_DAY;
  const THREE_MONTH = CLIFF_DURATION * 3 + ONE_DAY;

  beforeEach(async function () {
    // Get signers
    [owner, addr1, addr2] = await ethers.getSigners();
    ownerAddress = await owner.getAddress();

    // Deploy mock ERC20 token
    const MockToken = await ethers.getContractFactory("MockERC20");
    token = (await MockToken.deploy(
      "Mock Token",
      "MTK",
      INITIAL_SUPPLY
    )) as unknown as MockERC20;
    await token.waitForDeployment();

    // Deploy TokenVesting contract
    const TokenVesting = await ethers.getContractFactory("TokenVesting");
    vesting = await TokenVesting.deploy(await token.getAddress());
    await vesting.waitForDeployment();

    // Transfer tokens to owner
    await token.transfer(ownerAddress, INITIAL_SUPPLY);
  });

  describe("Deployment", function () {
    it("Should set the right owner", async function () {
      expect(await vesting.owner()).to.equal(ownerAddress);
    });

    it("Should set the correct token address", async function () {
      expect(await vesting.token()).to.equal(await token.getAddress());
    });

    it("Should initialize with correct values", async function () {
      expect(await vesting.initialized()).to.equal(false);
      expect(await vesting.totalLocked()).to.equal(0);
      expect(await vesting.totalClaimed()).to.equal(0);
      expect(await vesting.startTime()).to.equal(0);
    });
  });

  describe("Token Deposits", function () {
    it("Should allow owner to deposit tokens", async function () {
      await token.approve(await vesting.getAddress(), VESTING_AMOUNT);
      await vesting.depositTokens(VESTING_AMOUNT);

      expect(await vesting.initialized()).to.equal(true);
      expect(await vesting.totalLocked()).to.equal(VESTING_AMOUNT);
      expect(await vesting.startTime()).to.not.equal(0);
      expect(await token.balanceOf(await vesting.getAddress())).to.equal(
        VESTING_AMOUNT
      );
    });

    it("Should not allow non-owner to deposit tokens", async function () {
      await token
        .connect(addr1)
        .approve(await vesting.getAddress(), VESTING_AMOUNT);
      await expect(vesting.connect(addr1).depositTokens(VESTING_AMOUNT)).to.be
        .reverted;
    });

    it("Should not allow depositing 0 tokens", async function () {
      await token.approve(await vesting.getAddress(), VESTING_AMOUNT);
      await expect(vesting.depositTokens(0)).to.be.revertedWith(
        "Cannot deposit 0 tokens"
      );
    });

    it("Should not allow depositing tokens twice", async function () {
      await token.approve(await vesting.getAddress(), VESTING_AMOUNT);
      await vesting.depositTokens(VESTING_AMOUNT);

      await expect(vesting.depositTokens(VESTING_AMOUNT)).to.be.revertedWith(
        "Vesting already initialized"
      );
    });

    it("Should not allow depositing more tokens than approved", async function () {
      const approvedAmount = ethers.parseEther("50000");
      await token.approve(await vesting.getAddress(), approvedAmount);

      await expect(vesting.depositTokens(VESTING_AMOUNT)).to.be.reverted;
    });
  });

  describe("Token Claims", function () {
    beforeEach(async function () {
      await token.approve(await vesting.getAddress(), VESTING_AMOUNT);
      await vesting.depositTokens(VESTING_AMOUNT);
    });

    it("Should not allow claiming tokens during cliff period", async function () {
      await expect(vesting.claimTokens()).to.be.revertedWith(
        "No tokens available to claim"
      );
    });

    it("Should allow claiming tokens after cliff period", async function () {
      // Advance time past cliff period
      await time.increase(ONE_MONTH);

      // Calculate expected claimable amount (1 period worth)
      const expectedClaimable = VESTING_AMOUNT / BigInt(VESTING_PERIODS);
      await vesting.claimTokens();

      expect(await vesting.totalClaimed()).to.equal(expectedClaimable);
      expect(await token.balanceOf(ownerAddress)).to.equal(
        INITIAL_SUPPLY - VESTING_AMOUNT + expectedClaimable
      );
    });

    it("Should allow claiming tokens after full vesting period", async function () {
      // Advance time past full vesting period
      await time.increase(VESTING_DURATION + 86400);

      await vesting.claimTokens();

      expect(await vesting.totalClaimed()).to.equal(VESTING_AMOUNT);
      expect(await token.balanceOf(ownerAddress)).to.equal(INITIAL_SUPPLY);
    });

    it("Should not allow non-owner to claim tokens", async function () {
      // Advance time past cliff period
      await time.increase(CLIFF_DURATION + 86400);

      await expect(vesting.connect(addr1).claimTokens()).to.be.reverted;
    });

    it("Should calculate claimable amount correctly", async function () {
      // Advance time to halfway through vesting period
      const halfwayTime = CLIFF_DURATION + VESTING_DURATION / 2;
      await time.increase(halfwayTime);

      const totalLocked = await vesting.totalLocked();
      console.log("totalLocked ", totalLocked);

      // Calculate expected vested periods based on new logic
      const vestedPeriods = Math.floor(halfwayTime / CLIFF_DURATION);
      const finalVestedPeriods =
        vestedPeriods >= VESTING_PERIODS ? VESTING_PERIODS : vestedPeriods;

      console.log("finalVestedPeriods ", finalVestedPeriods);
      // Expected to have vested based on finalVestedPeriods
      const expectedClaimable =
        (VESTING_AMOUNT * BigInt(finalVestedPeriods)) / BigInt(VESTING_PERIODS);

      expect(await vesting.calculateClaimable()).to.equal(expectedClaimable);
    });

    it("Should allow claiming tokens after 2 periods", async function () {
      // Advance time past 2 periods
      const twoPeriodsTime = CLIFF_DURATION * 2 + ONE_DAY;
      await time.increase(twoPeriodsTime);

      // Calculate expected claimable amount (2 periods worth)
      const expectedClaimable =
        (VESTING_AMOUNT * BigInt(2)) / BigInt(VESTING_PERIODS);

      await vesting.claimTokens();

      expect(await vesting.totalClaimed()).to.equal(expectedClaimable);
      expect(await token.balanceOf(ownerAddress)).to.equal(
        INITIAL_SUPPLY - VESTING_AMOUNT + expectedClaimable
      );
    });

    it("Should allow claiming tokens after 3 periods", async function () {
      // Advance time past 3 periods
      const threePeriodsTime = CLIFF_DURATION * 3 + ONE_DAY;
      await time.increase(threePeriodsTime);

      // Calculate expected claimable amount (3 periods worth)
      const expectedClaimable =
        (VESTING_AMOUNT * BigInt(3)) / BigInt(VESTING_PERIODS);

      await vesting.claimTokens();

      expect(await vesting.totalClaimed()).to.equal(expectedClaimable);
      expect(await token.balanceOf(ownerAddress)).to.equal(
        INITIAL_SUPPLY - VESTING_AMOUNT + expectedClaimable
      );
    });
  });

  describe("Surplus Withdrawal", function () {
    beforeEach(async function () {
      await token.approve(await vesting.getAddress(), VESTING_AMOUNT);
      await vesting.depositTokens(VESTING_AMOUNT);
    });

    it("Should allow owner to withdraw surplus tokens", async function () {
      // Send extra tokens to the vesting contract
      const surplusAmount = ethers.parseEther("10000");
      await token.transfer(await vesting.getAddress(), surplusAmount);

      await vesting.withdrawSurplus();

      expect(await token.balanceOf(ownerAddress)).to.equal(
        INITIAL_SUPPLY - VESTING_AMOUNT
      );
    });

    it("Should not allow non-owner to withdraw surplus tokens", async function () {
      // Send extra tokens to the vesting contract
      const surplusAmount = ethers.parseEther("10000");
      await token.transfer(await vesting.getAddress(), surplusAmount);

      await expect(vesting.connect(addr1).withdrawSurplus()).to.be.reverted;
    });

    it("Should not allow withdrawing when there is no surplus", async function () {
      await expect(vesting.withdrawSurplus()).to.be.revertedWith(
        "No surplus tokens"
      );
    });
  });

  describe("Emergency Functions", function () {
    it("Should allow owner to pause and unpause the contract", async function () {
      await vesting.pause();
      expect(await vesting.paused()).to.equal(true);

      await vesting.unpause();
      expect(await vesting.paused()).to.equal(false);
    });

    it("Should not allow non-owner to pause the contract", async function () {
      await expect(vesting.connect(addr1).pause()).to.be.reverted;
    });

    it("Should not allow non-owner to unpause the contract", async function () {
      await vesting.pause();
      await expect(vesting.connect(addr1).unpause()).to.be.reverted;
    });

    it("Should allow emergency withdrawal when paused", async function () {
      await token.approve(await vesting.getAddress(), VESTING_AMOUNT);
      await vesting.depositTokens(VESTING_AMOUNT);

      await vesting.pause();
      await vesting.emergencyWithdraw();

      expect(await token.balanceOf(ownerAddress)).to.equal(INITIAL_SUPPLY);
    });

    it("Should not allow emergency withdrawal when not paused", async function () {
      await token.approve(await vesting.getAddress(), VESTING_AMOUNT);
      await vesting.depositTokens(VESTING_AMOUNT);

      await expect(vesting.emergencyWithdraw()).to.be.reverted;
    });

    it("Should not allow non-owner to perform emergency withdrawal", async function () {
      await token.approve(await vesting.getAddress(), VESTING_AMOUNT);
      await vesting.depositTokens(VESTING_AMOUNT);

      await vesting.pause();

      await expect(vesting.connect(addr1).emergencyWithdraw()).to.be.reverted;
    });
  });

  describe("View Functions", function () {
    it("Should return correct remaining tokens", async function () {
      expect(await vesting.remainingTokens()).to.equal(0);

      await token.approve(await vesting.getAddress(), VESTING_AMOUNT);
      await vesting.depositTokens(VESTING_AMOUNT);

      expect(await vesting.remainingTokens()).to.equal(VESTING_AMOUNT);
    });

    it("Should return correct vesting information", async function () {
      expect(await vesting.initialized()).to.equal(false);
      expect(await vesting.totalLocked()).to.equal(0);
      expect(await vesting.totalClaimed()).to.equal(0);
      expect(await vesting.startTime()).to.equal(0);

      await token.approve(await vesting.getAddress(), VESTING_AMOUNT);
      await vesting.depositTokens(VESTING_AMOUNT);

      expect(await vesting.initialized()).to.equal(true);
      expect(await vesting.totalLocked()).to.equal(VESTING_AMOUNT);
      expect(await vesting.totalClaimed()).to.equal(0);
      expect(await vesting.startTime()).to.not.equal(0);
    });
  });
});
