import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";

const config: HardhatUserConfig = {
  solidity: "0.8.28",
  typechain: {
    outDir: "typechain-types",
    target: "ethers-v5",
  },
  paths: {
    sources: "./contracts",
    tests: "./test",
    artifacts: "./artifacts",
  },
  networks: {
    hardhat: {
      blockGasLimit: 30_000_000,
    },
  },
};

export default config;
