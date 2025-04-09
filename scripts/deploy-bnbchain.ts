import { ethers, run, network } from "hardhat";

async function main() {
  console.log(`Deploying BNBDash token to ${network.name}...`);

  // Deploy the BNBDash token
  const BNBDash = await ethers.getContractFactory("BNBDash");
  const bnbDash = await BNBDash.deploy();
  
  await bnbDash.waitForDeployment();
  const bnbDashAddress = await bnbDash.getAddress();
  
  console.log(`BNBDash token deployed to: ${bnbDashAddress}`);

  // Wait for a few block confirmations to ensure deployment is confirmed
  console.log("Waiting for block confirmations...");
  await new Promise(resolve => setTimeout(resolve, 30000)); // 30 seconds delay
  
  // Verify the contract on BscScan
  console.log("Verifying contract on BscScan...");
  try {
    await run("verify:verify", {
      address: bnbDashAddress,
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