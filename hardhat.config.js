require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config();

const AMOY_RPC_URL = process.env.AMOY_RPC_URL || "";
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
    // Polygon Amoy is the current public Polygon testnet (replaced Mumbai).
    // Fill AMOY_RPC_URL and PRIVATE_KEY in a .env file before deploying here —
    // never commit that file. Get free test MATIC from a Polygon Amoy faucet.
    amoy: {
      url: AMOY_RPC_URL,
      accounts: PRIVATE_KEY ? [PRIVATE_KEY] : [],
      chainId: 80002
    }
  }
};
