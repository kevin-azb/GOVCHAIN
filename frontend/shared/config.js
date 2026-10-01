const GOVCHAIN_CONFIG = {
    // Deployed on Ethereum Sepolia testnet.
    CONTRACT_ADDRESS: "0x431902D28F405b6BD0f60012097a0936baE985bF",

    // Copy this directly from YOUR terminal's `npm run deploy:sepolia` output
    // (the line starting "INSTITUTION_ID (bytes32):") — do not retype it.
    INSTITUTION_ID: "0x4e5941525547454e47452d444953540000000000000000000000000000000000",

    EXPECTED_CHAIN_ID: 11155111, // Ethereum Sepolia

    // Same Alchemy endpoint used for deployment — lets the Citizen App and
    // Audit Export pages read the chain with no wallet required (FR3, NFR6).
    READ_ONLY_RPC_URL: "https://eth-sepolia.g.alchemy.com/v2/alch_JgComxDeQIUGpiBFyv3vh"
};