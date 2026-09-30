// Fill these in after each `npm run deploy:local` — the deploy script prints
// fresh values every time you restart `npm run node` (the local chain resets).
const GOVCHAIN_CONFIG = {
  // Paste these two values EXACTLY as printed by `npm run deploy:local` in your
  // own terminal — do not retype them by hand, copy/paste to avoid typos in
  // these long hex strings.
  CONTRACT_ADDRESS: "0x5FbDB2315678afecb367f032d93F642f64180aa3",
  INSTITUTION_ID: "0x4e5941525547454e47452d444953540000000000000000000000000000000000",
  EXPECTED_CHAIN_ID: 31337, // Hardhat Local. Use 80002 for Polygon Amoy later.

  // Used by the Citizen App so record verification (FR3) works even for a
  // visitor with no wallet installed at all — a read-only connection straight
  // to the chain, no MetaMask required.
  READ_ONLY_RPC_URL: "http://127.0.0.1:8545"
};