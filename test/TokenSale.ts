import { expect } from "chai";
import { ethers } from "hardhat";
import {
  keccak256,
  parseUnits,
  solidityPackedKeccak256,
  ZeroAddress,
} from "ethers";
import { MerkleTree } from "merkletreejs";
import { TokenSale, MockERC20 } from "../typechain-types";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import BigNumber from "bignumber.js";

describe("TokenSale Contract", function () {
  let TokenSale;
  let tokenSale: TokenSale;
  let tier1: SignerWithAddress[];
  let tier2: SignerWithAddress[];
  let tier3: SignerWithAddress[];
  let notWhitelisted: SignerWithAddress[];
  let usdt: MockERC20;
  let usdc: MockERC20;
  let projectToken: MockERC20;
  let merkleTree: MerkleTree;

  const targetRaised = parseUnits("10000000", 18);

  beforeEach(async function () {
    const accounts = await ethers.getSigners();
    tier1 = accounts.slice(0, 5);
    tier2 = accounts.slice(5, 10);
    tier3 = accounts.slice(10, 15);
    notWhitelisted = accounts.slice(15, 20);

    const leaves = tier1
      .map((account) =>
        solidityPackedKeccak256(["address", "uint8"], [account.address, 1])
      )
      .concat(
        tier2
          .map((account) =>
            solidityPackedKeccak256(["address", "uint8"], [account.address, 2])
          )
          .concat(
            tier3.map((account) =>
              solidityPackedKeccak256(
                ["address", "uint8"],
                [account.address, 3]
              )
            )
          )
      );

    merkleTree = new MerkleTree(leaves, keccak256, {
      sortPairs: true,
    });

    const merkleRoot = merkleTree.getHexRoot();

    const MockERC20 = await ethers.getContractFactory("MockERC20");
    usdt = await MockERC20.deploy(
      "USDT",
      "USDT",
      6,
      parseUnits("1000000000000000000", 6)
    );

    usdc = await MockERC20.deploy(
      "USDC",
      "USDC",
      6,
      parseUnits("1000000000000000000", 6)
    );

    projectToken = await MockERC20.deploy(
      "ProjectToken",
      "PTK",
      18,
      parseUnits("1000000000000000000", 18)
    );

    await multipleTransfer(usdt, accounts, parseUnits("10000", 6));
    await multipleTransfer(usdc, accounts, parseUnits("10000", 6));

    TokenSale = await ethers.getContractFactory("TokenSale");
    tokenSale = await TokenSale.deploy(merkleRoot, targetRaised);
    await multipleApprove(
      usdt,
      accounts,
      parseUnits("10000", 6),
      await tokenSale.getAddress()
    );
    await multipleApprove(
      usdc,
      accounts,
      parseUnits("10000", 6),
      await tokenSale.getAddress()
    );
    await tokenSale.configureToken(usdt.getAddress(), 6);
    await tokenSale.configureToken(usdc.getAddress(), 6);
  });

  it("should verify tier merkle proof", async function () {
    const tier1Leaf = solidityPackedKeccak256(
      ["address", "uint8"],
      [tier1[0].address, 1]
    );

    const tier2Leaf = solidityPackedKeccak256(
      ["address", "uint8"],
      [tier2[0].address, 2]
    );

    const tier3Leaf = solidityPackedKeccak256(
      ["address", "uint8"],
      [tier3[0].address, 3]
    );

    const notWhitelistedLeaf = solidityPackedKeccak256(
      ["address", "uint8"],
      [notWhitelisted[0].address, 0]
    );

    const tier1Proof = merkleTree.getHexProof(tier1Leaf);
    const tier2Proof = merkleTree.getHexProof(tier2Leaf);
    const tier3Proof = merkleTree.getHexProof(tier3Leaf);
    const notWhitelistedProof = merkleTree.getHexProof(notWhitelistedLeaf);

    const tier1VerifyResult = await tokenSale.verifyTier(
      tier1[0].address,
      1,
      tier1Proof
    );

    const tier2VerifyResult = await tokenSale.verifyTier(
      tier2[0].address,
      2,
      tier2Proof
    );

    const tier3VerifyResult = await tokenSale.verifyTier(
      tier3[0].address,
      3,
      tier3Proof
    );

    const notWhitelistedVerifyResult = await tokenSale.verifyTier(
      notWhitelisted[0].address,
      1,
      notWhitelistedProof
    );

    expect(tier1VerifyResult).to.equal(true);
    expect(tier2VerifyResult).to.equal(true);
    expect(tier3VerifyResult).to.equal(true);
    expect(notWhitelistedVerifyResult).to.equal(false);
  });

  it("should allow the owner to configure tokens", async function () {
    await tokenSale.configureToken(usdt.getAddress(), 6);
    await tokenSale.configureToken(usdc.getAddress(), 6);

    expect((await tokenSale.tokenConfigs(usdt.getAddress())).decimals).to.equal(
      6
    );
  });

  describe("Tier Limits and Settings", function () {
    it("should return correct tier limits", async function () {
      expect(await tokenSale.getTierLimit(1)).to.equal(parseUnits("5000", 6));
      expect(await tokenSale.getTierLimit(2)).to.equal(parseUnits("3000", 6));
      expect(await tokenSale.getTierLimit(3)).to.equal(parseUnits("2000", 6));
    });

    it("should revert when getting tier limit for invalid tier", async function () {
      await expect(tokenSale.getTierLimit(0)).to.be.revertedWith(
        "Invalid tier level"
      );
      await expect(tokenSale.getTierLimit(4)).to.be.revertedWith(
        "Invalid tier level"
      );
    });

    it("should allow owner to set tier limit", async function () {
      await tokenSale.setTierLimit(1, parseUnits("6000", 6));
      expect(await tokenSale.tierLimits(1)).to.equal(parseUnits("6000", 6));
    });

    it("should revert when non-owner tries to set tier limit", async function () {
      await expect(
        tokenSale.connect(tier1[1]).setTierLimit(1, parseUnits("6000", 6))
      ).to.be.revertedWithCustomError(
        tokenSale.connect(tier1[1]),
        "OwnableUnauthorizedAccount"
      );
    });

    it("should revert when setting tier limit with invalid tier or zero limit", async function () {
      await expect(
        tokenSale.setTierLimit(0, parseUnits("6000", 6))
      ).to.be.revertedWith("Invalid tier level");
      await expect(tokenSale.setTierLimit(1, 0)).to.be.revertedWith(
        "Limit cannot be zero"
      );
    });
  });

  describe("Project Token and Sale Price Settings", function () {
    it("should allow owner to set project token", async function () {
      const projectTokenAddress = await projectToken.getAddress();
      await tokenSale.setProjectToken(projectTokenAddress, 18);
      const config = await tokenSale.projectToken();
      expect(config.tokenAddress).to.equal(projectTokenAddress);
      expect(config.decimals).to.equal(18);
    });

    it("should revert when setting project token with zero address or invalid decimals", async function () {
      await expect(
        tokenSale.setProjectToken(ZeroAddress, 18)
      ).to.be.revertedWith("Invalid token address");
      await expect(
        tokenSale.setProjectToken(projectToken.getAddress(), 0)
      ).to.be.revertedWith("Invalid decimals");
      await expect(
        tokenSale.setProjectToken(projectToken.getAddress(), 19)
      ).to.be.revertedWith("Invalid decimals");
    });

    it("should allow owner to set sale price", async function () {
      const newPrice = parseUnits("0.002", 18);
      await tokenSale.setSalePrice(newPrice);
      expect(await tokenSale.salePrice()).to.equal(newPrice);
    });

    it("should revert when setting sale price to zero", async function () {
      await expect(tokenSale.setSalePrice(0)).to.be.revertedWith(
        "Price must be greater than 0"
      );
    });

    it("should allow owner to set sale phase", async function () {
      await tokenSale.setSalePhase(1);
      expect(await tokenSale.phase()).to.equal(1);
    });

    it("should revert when non-owner tries to set sale phase", async function () {
      await expect(
        tokenSale.connect(tier1[1]).setSalePhase(1)
      ).to.be.revertedWithCustomError(
        tokenSale.connect(tier1[1]),
        "OwnableUnauthorizedAccount"
      );
    });

    it("should revert when setting an invalid sale phase", async function () {
      // await expect(tokenSale.setSalePhase(5)).to.be.revertedWith(
      //   "Invalid phase"
      // );
      await expect(tokenSale.setSalePhase(5)).to.be.revertedWithoutReason();
    });
  });

  describe("Contributions", function () {
    beforeEach(async function () {
      await tokenSale.setSalePhase(1);
      await usdt.transfer(tier1[1].address, parseUnits("10000", 6));
      await usdc.transfer(tier1[1].address, parseUnits("10000", 6));

      const usdtAddress = await usdt.getAddress();
      const usdcAddress = await usdc.getAddress();
      const tokenSaleAddress = await tokenSale.getAddress();
      await tokenSale.configureToken(usdtAddress, 6);
      await tokenSale.configureToken(usdcAddress, 6);

      await usdt
        .connect(tier1[1])
        .approve(tokenSaleAddress, parseUnits("10000", 6));
      await usdc
        .connect(tier1[1])
        .approve(tokenSaleAddress, parseUnits("10000", 6));
    });

    it("should revert if sale is not active", async function () {
      await tokenSale.setSalePhase(0);
      const proof = merkleTree.getHexProof(
        solidityPackedKeccak256(["address", "uint8"], [tier1[1].address, 1])
      );
      const usdtAddress = await usdt.getAddress();
      await expect(
        tokenSale.connect(tier1[1]).contribute(1, proof, usdtAddress, 1000)
      ).to.be.revertedWith("Sale not active");
    });

    it("should revert if token is not supported", async function () {
      const proof = merkleTree.getHexProof(
        solidityPackedKeccak256(["address", "uint8"], [tier1[1].address, 1])
      );
      await expect(
        tokenSale.connect(tier1[1]).contribute(1, proof, ZeroAddress, 1000)
      ).to.be.revertedWith("Unsupported token");
    });

    it("should revert if tier proof is invalid", async function () {
      const wrongProof = merkleTree.getHexProof(
        solidityPackedKeccak256(["address", "uint8"], [tier1[1].address, 2])
      );
      const usdtAddress = await usdt.getAddress();
      await expect(
        tokenSale.connect(tier1[1]).contribute(1, wrongProof, usdtAddress, 1000)
      ).to.be.revertedWith("Invalid tier proof");
    });

    it("should revert on duplicate contribution", async function () {
      const proof = merkleTree.getHexProof(
        solidityPackedKeccak256(["address", "uint8"], [tier1[1].address, 1])
      );
      const usdtAddress = await usdt.getAddress();
      await tokenSale.connect(tier1[1]).contribute(1, proof, usdtAddress, 1000);
      await expect(
        tokenSale.connect(tier1[1]).contribute(1, proof, usdtAddress, 1000)
      ).to.be.revertedWith("Already purchased");
    });

    it("should revert if contribution exceeds tier limit", async function () {
      const excessiveAmount = parseUnits("5001", 6);
      const proof = merkleTree.getHexProof(
        solidityPackedKeccak256(["address", "uint8"], [tier1[1].address, 1])
      );
      const usdtAddress = await usdt.getAddress();
      await expect(
        tokenSale
          .connect(tier1[1])
          .contribute(1, proof, usdtAddress, excessiveAmount)
      ).to.be.revertedWith("Exceeds tier limit");
    });

    it("should record contribution correctly and update totalRaised", async function () {
      const amount = parseUnits("1000", 6);
      const proof = merkleTree.getHexProof(
        solidityPackedKeccak256(["address", "uint8"], [tier1[1].address, 1])
      );
      const usdtAddress = await usdt.getAddress();
      const initialTotalRaised = await tokenSale.totalRaised();
      await expect(
        tokenSale.connect(tier1[1]).contribute(1, proof, usdtAddress, amount)
      )
        .to.emit(tokenSale, "ContributionReceived")
        .withArgs(tier1[1].address, usdtAddress, amount);
      const record = await tokenSale.contributions(tier1[1].address);
      expect(record.amount).to.equal(amount);
      expect(record.paymentToken).to.equal(usdtAddress);
      expect(record.decimals).to.equal(6);
      const finalTotalRaised = await tokenSale.totalRaised();
      expect(finalTotalRaised - initialTotalRaised).to.equal(amount);
    });

    it("should allow zero contribution if allowed by business logic", async function () {
      const amount = parseUnits("0", 6);
      const proof = merkleTree.getHexProof(
        solidityPackedKeccak256(["address", "uint8"], [tier1[1].address, 1])
      );
      const usdtAddress = await usdt.getAddress();
      await expect(
        tokenSale.connect(tier1[1]).contribute(1, proof, usdtAddress, amount)
      ).to.be.revertedWith("Contribution amount must be greater than 0");
    });
  });

  describe("Refunds", function () {
    beforeEach(async function () {
      await tokenSale.setSalePhase(1);
      await usdt.transfer(tier1[1].address, parseUnits("10000", 6));
      await usdc.transfer(tier1[1].address, parseUnits("10000", 6));

      const usdtAddress = await usdt.getAddress();
      const usdcAddress = await usdc.getAddress();
      const tokenSaleAddress = await tokenSale.getAddress();
      await tokenSale.configureToken(usdtAddress, 6);
      await tokenSale.configureToken(usdcAddress, 6);

      await usdt
        .connect(tier1[1])
        .approve(tokenSaleAddress, parseUnits("10000", 6));

      await usdc
        .connect(tier1[1])
        .approve(tokenSaleAddress, parseUnits("10000", 6));

      const proof = merkleTree.getHexProof(
        solidityPackedKeccak256(["address", "uint8"], [tier1[1].address, 1])
      );

      await tokenSale
        .connect(tier1[1])
        .contribute(1, proof, usdtAddress, parseUnits("5000", 6));
    });

    it("should revert refund if sale phase is not COMPLETED_REFUND", async function () {
      await expect(
        tokenSale.connect(tier1[1]).claimRefund()
      ).to.be.revertedWith("Sale not completed");
    });

    it("should revert refund if no funds raised (or no need to refund)", async function () {
      // 此处 totalRaised 为 1000，而 targetRaised 设定为 10000，不满足退款条件
      await tokenSale.setSalePhase(2); // COMPLETED_REFUND
      await expect(
        tokenSale.connect(tier1[1]).claimRefund()
      ).to.be.revertedWith("No need to refund");
    });

    it("should revert refund if contribution does not exist", async function () {
      const lowerTarget = parseUnits("500", 6);
      const TokenSaleFactory = await ethers.getContractFactory("TokenSale");

      const tokenSaleRefund = await TokenSaleFactory.deploy(
        merkleTree.getHexRoot(),
        lowerTarget
      );

      const usdtAddress = await usdt.getAddress();
      await tokenSaleRefund.configureToken(usdtAddress, 6);
      await tokenSaleRefund.setSalePhase(1);
      const tokenSaleRefundAddress = await tokenSaleRefund.getAddress();
      await usdt
        .connect(tier1[1])
        .approve(tokenSaleRefundAddress, parseUnits("2000", 6));

      const proof = merkleTree.getHexProof(
        solidityPackedKeccak256(["address", "uint8"], [tier1[1].address, 1])
      );

      await tokenSaleRefund.setSalePhase(1);

      await tokenSaleRefund
        .connect(tier1[1])
        .contribute(1, proof, usdtAddress, parseUnits("2000", 6));

      await tokenSaleRefund.setSalePhase(2);
      await expect(
        tokenSaleRefund.connect(tier1[2]).claimRefund()
      ).to.be.revertedWith("No contribution");
    });

    it("should calculate and issue refund correctly", async function () {
      // 为了触发退款逻辑，部署一个 targetRaised 较低的合约实例
      const lowerTarget = parseUnits("500", 6);
      const TokenSaleFactory = await ethers.getContractFactory("TokenSale");

      const tokenSaleRefund = await TokenSaleFactory.deploy(
        merkleTree.getHexRoot(),
        lowerTarget
      );

      const usdtAddress = await usdt.getAddress();
      await tokenSaleRefund.configureToken(usdtAddress, 6);
      await tokenSaleRefund.setSalePhase(1);
      const tokenSaleRefundAddress = await tokenSaleRefund.getAddress();
      await usdt
        .connect(tier1[1])
        .approve(tokenSaleRefundAddress, parseUnits("1000", 6));

      const proof = merkleTree.getHexProof(
        solidityPackedKeccak256(["address", "uint8"], [tier1[1].address, 1])
      );

      const contributionAmount = new BigNumber(
        parseUnits("1000", 6).toString()
      );

      await tokenSaleRefund
        .connect(tier1[1])
        .contribute(1, proof, usdtAddress, contributionAmount.toString());

      // 将 phase 切换至 COMPLETED_REFUND
      await tokenSaleRefund.setSalePhase(2);
      // 此时 totalRaised 为 1000，targetRaised 为 500，退款比例 = ((1000 - 500)*1e18)/1000 = 0.5e18
      const expectedRefund = contributionAmount.multipliedBy(0.5);
      const balanceBefore = await usdt.balanceOf(tier1[1].address);
      await expect(tokenSaleRefund.connect(tier1[1]).claimRefund()).to.emit(
        tokenSaleRefund,
        "RefundIssued"
      );

      const record = await tokenSaleRefund.contributions(tier1[1].address);
      expect(record.refundAmount).to.equal(expectedRefund);
      const balanceAfter = await usdt.balanceOf(tier1[1].address);
      expect(
        new BigNumber(balanceAfter.toString())
          .minus(balanceBefore.toString())
          .toString()
      ).to.equal(expectedRefund.toString());
    });

    it("should revert on double refund claim", async function () {
      const lowerTarget = parseUnits("500", 6);
      const TokenSaleFactory = await ethers.getContractFactory("TokenSale");
      const tokenSaleRefund = await TokenSaleFactory.deploy(
        merkleTree.getHexRoot(),
        lowerTarget
      );
      const usdtAddress = await usdt.getAddress();
      await tokenSaleRefund.configureToken(usdtAddress, 6);
      await tokenSaleRefund.setSalePhase(1);
      const tokenSaleRefundAddress = await tokenSaleRefund.getAddress();
      await usdt
        .connect(tier1[1])
        .approve(tokenSaleRefundAddress, parseUnits("10000", 6));
      const proof = merkleTree.getHexProof(
        solidityPackedKeccak256(["address", "uint8"], [tier1[1].address, 1])
      );
      const contributionAmount = parseUnits("1000", 6);
      await tokenSaleRefund
        .connect(tier1[1])
        .contribute(1, proof, usdtAddress, contributionAmount);
      await tokenSaleRefund.setSalePhase(2);
      await tokenSaleRefund.connect(tier1[1]).claimRefund();
      await expect(
        tokenSaleRefund.connect(tier1[1]).claimRefund()
      ).to.be.revertedWith("Already refunded");
    });
  });

  describe("Token Claim", function () {
    beforeEach(async function () {
      await tokenSale.setTargetRaised(parseUnits("1000", 6));
      const projectTokenAddress = await projectToken.getAddress();
      await tokenSale.setProjectToken(projectTokenAddress, 18);
      await tokenSale.setSalePrice(parseUnits("0.002", 18));

      const usdtAddress = await usdt.getAddress();
      const usdcAddress = await usdc.getAddress();

      const tokenSaleAddress = await tokenSale.getAddress();

      await tokenSale.configureToken(usdtAddress, 6);
      await tokenSale.configureToken(usdcAddress, 6);

      await usdt
        .connect(tier1[1])
        .approve(tokenSaleAddress, parseUnits("10000", 6));

      await usdc
        .connect(tier1[1])
        .approve(tokenSaleAddress, parseUnits("10000", 6));

      await tokenSale.setSalePhase(1);
      const proof = merkleTree.getHexProof(
        solidityPackedKeccak256(["address", "uint8"], [tier1[1].address, 1])
      );

      await tokenSale
        .connect(tier1[1])
        .contribute(1, proof, usdtAddress, parseUnits("1000", 6));

      await tokenSale.setSalePhase(3);

      await projectToken.transfer(
        tokenSaleAddress,
        parseUnits("500000000", 18)
      );
    });

    it("should revert if sale phase is not COMPLETED_CLAIM", async function () {
      await tokenSale.setSalePhase(2); // COMPLETED_REFUND
      await expect(tokenSale.connect(tier1[1]).claimToken()).to.be.revertedWith(
        "Still in refund period"
      );
    });

    it("should revert if project token not set", async function () {
      const TokenSaleFactory = await ethers.getContractFactory("TokenSale");
      const saleTarget = parseUnits("1000", 6);
      const newSale = await TokenSaleFactory.deploy(
        merkleTree.getHexRoot(),
        saleTarget
      );
      await newSale.setSalePhase(1);
      const proof = merkleTree.getHexProof(
        solidityPackedKeccak256(["address", "uint8"], [tier1[1].address, 1])
      );
      const usdtAddress = await usdt.getAddress();
      const newSaleAddress = await newSale.getAddress();
      await newSale.configureToken(usdtAddress, 6);
      await usdt
        .connect(tier1[1])
        .approve(newSaleAddress, parseUnits("10000", 6));
      await newSale
        .connect(tier1[1])
        .contribute(1, proof, usdtAddress, parseUnits("1000", 6));
      await newSale.setSalePhase(3);
      await expect(newSale.connect(tier1[1]).claimToken()).to.be.revertedWith(
        "Token not set"
      );
    });

    it("should revert if user did not contribute", async function () {
      await expect(tokenSale.connect(tier1[2]).claimToken()).to.be.revertedWith(
        "No token to claim"
      );
    });

    it("should revert if user has already claimed", async function () {
      await tokenSale.connect(tier1[1]).claimToken();
      await expect(tokenSale.connect(tier1[1]).claimToken()).to.be.revertedWith(
        "Already claimed"
      );
    });

    it("should calculate and transfer claim token correctly", async function () {
      // 假设未退款，则 effectiveAmount = 1000
      // 根据公式：
      // claimTokenAmount = (1000 * 1e18 * 1e18) / (0.002*1e18 * 1e18) = 1000/0.002 = 500000
      const expectedClaim = 500000;
      const balanceBefore = await projectToken.balanceOf(tier1[1].address);
      await expect(tokenSale.connect(tier1[1]).claimToken()).to.emit(
        tokenSale,
        "ClaimToken"
      );
      const balanceAfter = await projectToken.balanceOf(tier1[1]);
      const balanceAfterBigNumber = new BigNumber(balanceAfter.toString());
      expect(
        balanceAfterBigNumber.minus(balanceBefore.toString()).div(10 ** 18)
      ).to.equal(expectedClaim);
    });
  });

  describe("Multiple Users Contribution", function () {
    it("should record contributions for multiple users correctly", async function () {
      await tokenSale.setSalePhase(1);
      const proof1 = merkleTree.getHexProof(
        solidityPackedKeccak256(["address", "uint8"], [tier1[1].address, 1])
      );
      const proof2 = merkleTree.getHexProof(
        solidityPackedKeccak256(["address", "uint8"], [tier2[1].address, 2])
      );

      const usdtAddress = await usdt.getAddress();
      await tokenSale
        .connect(tier1[1])
        .contribute(1, proof1, usdtAddress, parseUnits("3000", 6));
      await tokenSale
        .connect(tier2[1])
        .contribute(2, proof2, usdtAddress, parseUnits("1000", 6));
      const record1 = await tokenSale.contributions(tier1[1].address);
      const record2 = await tokenSale.contributions(tier2[1].address);
      expect(record1.amount).to.equal(parseUnits("3000", 6));
      expect(record2.amount).to.equal(parseUnits("1000", 6));
      const totalRaised = await tokenSale.totalRaised();
      expect(totalRaised).to.equal(parseUnits("4000", 6));
    });
  });

  describe("TokenSale Full Lifecycle", function () {
    let TokenSale;
    let tokenSaleFullLifecycle: TokenSale;

    const DECIMALS_USD = 6; // USDT/USDC decimals
    const DECIMALS_PROJECT = 18; // Project token decimals
    const TARGET_RAISED = 10_00; // 10K USD (in 6 decimals)
    const PARTICIPANTS = 5; // Reduced from 50k for test performance
    const tierMapping: { [key: number]: number } = {
      1: 5000,
      2: 3000,
      3: 2000,
    };

    before(async function () {
      // Generate participants data
      this.participants = [];
      const leaves = [];
      const [deployer] = await ethers.getSigners();

      // Generate random participants with different tiers
      for (let i = 0; i < PARTICIPANTS; i++) {
        const wallet = ethers.Wallet.createRandom().connect(ethers.provider);
        await deployer.sendTransaction({
          to: wallet.address,
          value: ethers.parseEther("1.0"),
        });
        const tier = Math.floor(Math.random() * 3) + 1; // 1-3
        const amount = ethers.parseUnits(
          (Math.random() * tierMapping[tier]).toFixed(2), // 500-2500 USD
          DECIMALS_USD
        );

        leaves.push(
          keccak256(
            ethers.solidityPacked(["address", "uint8"], [wallet.address, tier])
          )
        );

        this.participants.push({
          wallet,
          tier,
          amount,
          token: Math.random() > 0.5 ? usdt : usdc, // Random select token
        });
      }

      // Build Merkle Tree
      this.merkleTree = new MerkleTree(leaves, keccak256, { sort: true });
      this.merkleRoot = this.merkleTree.getHexRoot();

      // Deploy TokenSale
      TokenSale = await ethers.getContractFactory("TokenSale");
      tokenSaleFullLifecycle = await TokenSale.deploy(
        this.merkleRoot,
        ethers.parseUnits(TARGET_RAISED.toString(), 6) // Convert to 6 decimals
      );

      const usdtAddress = await usdt.getAddress();
      const usdcAddress = await usdc.getAddress();
      const projectTokenAddress = await projectToken.getAddress();

      // Configure tokens
      await tokenSaleFullLifecycle.configureToken(usdtAddress, DECIMALS_USD);
      await tokenSaleFullLifecycle.configureToken(usdcAddress, DECIMALS_USD);
      await tokenSaleFullLifecycle.setProjectToken(
        projectTokenAddress,
        DECIMALS_PROJECT
      );

      // Set sale price (0.002 USD with 18 decimals precision)
      await tokenSaleFullLifecycle.setSalePrice(ethers.parseUnits("0.002", 18));
    });

    it("Should complete full lifecycle", async function () {
      // Phase 1: Active Sale
      await tokenSaleFullLifecycle.setSalePhase(1); // ACTIVE

      // Simulate contributions
      let totalRaised = new BigNumber(0);

      for (const p of this.participants) {
        const token = p.token;
        const proof = this.merkleTree.getHexProof(
          keccak256(
            ethers.solidityPacked(
              ["address", "uint8"],
              [p.wallet.address, p.tier]
            )
          )
        );

        // Fund user
        await token.transfer(p.wallet.address, p.amount);
        await token
          .connect(p.wallet)
          .approve(await tokenSaleFullLifecycle.getAddress(), p.amount);

        // Make contribution
        await tokenSaleFullLifecycle
          .connect(p.wallet)
          .contribute(p.tier, proof, await token.getAddress(), p.amount);

        totalRaised = totalRaised.plus(p.amount);
      }

      // console.log(totalRaised.toString());
      // Verify total raised
      expect(await tokenSaleFullLifecycle.totalRaised()).to.equal(
        totalRaised.toString()
      );

      // Phase 2: Refund (Assume totalRaised > target)
      await tokenSaleFullLifecycle.setSalePhase(2); // COMPLETED_REFUND

      // Verify refund calculation
      const target = await tokenSaleFullLifecycle.targetRaised();
      expect(totalRaised.toNumber()).to.be.gt(target);

      // Process refunds
      for (const p of this.participants) {
        const beforeBalance = await p.token.balanceOf(p.wallet.address);

        await tokenSaleFullLifecycle.connect(p.wallet).claimRefund();

        const afterBalance = await p.token.balanceOf(p.wallet.address);
        const record = await tokenSaleFullLifecycle.contributions(
          p.wallet.address
        );

        // console.log(`record.amount: ${record.amount.toString()}`);
        // console.log(`beforeBalance: ${beforeBalance.toString()}`);
        // console.log(`afterBalance: ${afterBalance.toString()}`);
        // Verify refund amount
        // const expectedRefund =
        //   (record.amount * (totalRaised - target)) / totalRaised;
        const expectedRefund = new BigNumber(record.amount.toString())
          .multipliedBy(totalRaised.minus(target.toString()))
          .dividedBy(totalRaised.toString())
          .dp(0, 1)
          .toString();
        // console.log(`expectedRefund: ${expectedRefund}`);
        expect(record.refundAmount).to.equal(expectedRefund);
        expect(
          new BigNumber(afterBalance.toString())
            .minus(beforeBalance.toString())
            .toString()
        ).to.equal(expectedRefund.toString());
      }

      // Phase 3: Claim Tokens
      await tokenSaleFullLifecycle.setSalePhase(3); // COMPLETED_CLAIM

      let totalTokensClaimed = new BigNumber(0);

      const tokenSaleContractAddress =
        await tokenSaleFullLifecycle.getAddress();

      // Fund project tokens to contract

      // Fund project tokens to contract
      // await projectToken.approve(
      //   tokenSaleContractAddress,
      //   ethers.parseUnits("100000000", DECIMALS_PROJECT)
      // );

      // await tokenSaleFullLifecycle.deposit(
      //   ethers.parseUnits("100000000", DECIMALS_PROJECT)
      // );

      await projectToken.transfer(
        tokenSaleContractAddress,
        ethers.parseUnits("1000000000", DECIMALS_PROJECT)
      );

      const initialContractBalance = await projectToken.balanceOf(
        tokenSaleContractAddress
      );

      console.log(
        `initialContractBalance: ${initialContractBalance.toString()}`
      );

      // Process claims
      for (const p of this.participants) {
        const initialUserBalance = await projectToken.balanceOf(
          p.wallet.address
        );
        console.log(`initialUserBalance: ${initialUserBalance.toString()}`);
        const initialContractBalance = await projectToken.balanceOf(
          tokenSaleContractAddress
        );

        console.log(
          `initialContractBalance: ${initialContractBalance.toString()}`
        );

        await tokenSaleFullLifecycle.connect(p.wallet).claimToken();

        const finalUserBalance = await projectToken.balanceOf(p.wallet.address);
        console.log(`finalUserBalance: ${finalUserBalance.toString()}`);

        const finalContractBalance = await projectToken.balanceOf(
          tokenSaleContractAddress
        );

        console.log(`finalContractBalance: ${finalContractBalance.toString()}`);

        const record = await tokenSaleFullLifecycle.contributions(
          p.wallet.address
        );
        console.log(`record: ${record}`);
        expect(record.hasClaimed).to.equal(true);

        console.log(`record.amount: ${record.amount.toString()}`);
        const salePrice = await tokenSaleFullLifecycle.salePrice();
        console.log(`salePrice: ${salePrice.toString()}`);

        // Verify token claim
        const effectiveAmount = new BigNumber(record.amount.toString())
          .minus(record.refundAmount.toString())
          .toString();
        console.log(`effectiveAmount: ${effectiveAmount}`);
        const expectedTokens = new BigNumber(effectiveAmount)
          .multipliedBy(10 ** DECIMALS_PROJECT)
          .dividedBy(salePrice.toString());

        console.log(`expectedTokens: ${expectedTokens.div(1e6).toString()}`);
        expect(finalUserBalance - initialUserBalance).to.equal(
          expectedTokens.toString()
        );
        expect(initialContractBalance - finalContractBalance).to.equal(
          expectedTokens
        );
        totalTokensClaimed = expectedTokens.plus(totalTokensClaimed.toString());
      }

      const finalContractBalance = await projectToken.balanceOf(
        tokenSaleContractAddress
      );

      expect(initialContractBalance - finalContractBalance).to.equal(
        totalTokensClaimed
      );

      // 验证总供应量守恒
      expect(
        totalTokensClaimed.plus(finalContractBalance.toString()).toString()
      ).to.equal(initialContractBalance.toString());

      console.log(`totalTokensClaimed: ${totalTokensClaimed.toString()}`);
    });
  });
});

export const multipleTransfer = async (
  token: MockERC20,
  tos: SignerWithAddress[],
  amount: bigint
) => {
  for (const to of tos) {
    await token.transfer(to.address, amount);
  }
};

export const multipleApprove = async (
  token: MockERC20,
  tos: SignerWithAddress[],
  amount: bigint,
  tokenSaleAddress: string
) => {
  for (const to of tos) {
    await token.connect(to).approve(tokenSaleAddress, amount);
  }
};
