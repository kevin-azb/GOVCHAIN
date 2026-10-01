require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config();

const SEPOLIA_RPC_URL = process.env.SEPOLIA_RPC_URL || "";
const PRIVATE_KEY = process.env.PRIVATE_KEY || "";

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    version: "0.8.24",
    settings: {
      optimizer: { enabled: true, runs: 200 }
    }
  },
  networks: {
    // Default local network — spun up with `npm run node`, used for all
    // development and the Hardhat test suite. No real funds, instant blocks.
    hardhat: {},
    localhost: {
      url: "http://127.0.0.1:8545"
    },
    // Ethereum Sepolia testnet. Fill SEPOLIA_RPC_URL and PRIVATE_KEY in a
    // .env file before deploying here — never commit that file. Get free
    // test ETH from a Sepolia faucet (e.g. Google Cloud Web3 faucet).
    sepolia: {
      url: SEPOLIA_RPC_URL,
      accounts: PRIVATE_KEY ? [PRIVATE_KEY] : [],
      chainId: 11155111
    }
  }
};