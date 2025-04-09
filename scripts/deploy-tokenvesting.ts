import { ethers, run } from "hardhat";

async function main() {
  // 获取合约工厂
  const TokenVesting = await ethers.getContractFactory("TokenVesting");

  // 部署合约
  console.log("Deploying TokenVesting contract...");
  const tokenVesting = await TokenVesting.deploy();

  // 等待部署完成
  await tokenVesting.waitForDeployment();
  const tokenVestingAddress = await tokenVesting.getAddress();

  console.log("TokenVesting deployed to:", tokenVestingAddress);

  // Verify the contract on BscScan
  console.log("Verifying contract on BscScan...");
  try {
    await run("verify:verify", {
      address: tokenVestingAddress,
      constructorArguments: [],
    });
    console.log("Contract verified successfully");
  } catch (error) {
    console.error("Error verifying contract:", error);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
