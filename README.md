# GovChain Pilot

Implementation of the GovChain SRS: a permissioned anchoring platform for
district-level procurement tender decisions.

## Step 1 of the build: Verification Layer smart contract

This step contains only the on-chain core (`contracts/GovChainVerification.sol`),
its tests, and a deploy script. Nothing else depends on network access to try —
you'll run these commands yourself.

### Prerequisites
- Node.js 18+ installed
- npm

### Run it

```bash
# from the govchain-pilot/ folder
npm install
npm run compile
npm test
```

You should see all tests passing (record anchoring, public verification,
discrepancy flagging, review + reputation reward, and access-control checks).

### Try it on a local blockchain

```bash
# terminal 1 — start a local Hardhat blockchain
npm run node

# terminal 2 — deploy to it
npm run deploy:local
```

The deploy script will print a `CONTRACT_ADDRESS` and `INSTITUTION_ID` —
keep those, we'll wire them into the Institution Console and Citizen App
frontends in the next steps.

### Later: deploying to Polygon Amoy testnet

1. Copy `.env.example` to `.env`
2. Fill in `AMOY_RPC_URL` (free from Alchemy or Infura) and `PRIVATE_KEY`
   (a throwaway wallet funded with free test MATIC from an Amoy faucet)
3. `npm run deploy:amoy`

We don't need to do this yet — local Hardhat is faster to iterate on. We'll
switch to Amoy once the full flow works end-to-end locally.

## What this contract covers

| SRS requirement | Where |
|---|---|
| FR2 Record Anchoring | `anchorRecord()` |
| FR3 Public Record Verification | `verifyRecord()`, `getRecord()` |
| FR4 Discrepancy Flagging | `flagDiscrepancy()` |
| FR5 Flag Review Workflow | `resolveFlag()` |
| FR6 Reputation and Token Reward | automatic inside `resolveFlag()` on Confirmed |
| FR9 Audit Log Export | `getRecordIdAt()`, `getFlagIdAt()` + events, enumerable by anyone |
| NFR1 client-side signing | inherent — the contract never receives or stores private keys |
| NFR6 independent auditability | all read functions are public, no permission gate |

## Project structure

```
govchain-pilot/
├── contracts/
│   └── GovChainVerification.sol   # the Verification Layer
├── scripts/
│   └── deploy.js                  # deploy + demo setup
├── test/
│   └── GovChainVerification.test.js
├── frontend/
│   ├── citizen-app/                (next step)
│   └── institution-console/        (next step)
├── hardhat.config.js
├── package.json
└── .env.example
```

## Next steps

1. ✅ Verification Layer contract (this step)
2. Institution Console (plain HTML/JS) — anchor records, view dashboard
3. Citizen Application (plain HTML/JS) — connect wallet, verify, flag
4. Review panel flow + notifications