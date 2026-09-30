const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("GovChainVerification", function () {
  let contract, admin, officer, citizen, reviewer, outsider;
  let institutionId, recordId, docHash;

  beforeEach(async function () {
    [admin, officer, citizen, reviewer, outsider] = await ethers.getSigners();

    const Factory = await ethers.getContractFactory("GovChainVerification");
    contract = await Factory.deploy();
    await contract.waitForDeployment();

    institutionId = ethers.encodeBytes32String("DIST-01");
    recordId = ethers.encodeBytes32String("TENDER-2026-001");
    docHash = ethers.keccak256(ethers.toUtf8Bytes("tender-award-document-contents"));

    await contract.registerInstitution(institutionId, "Test District Office");
    await contract.authorizeOfficer(institutionId, officer.address);
    await contract.addReviewPanelMember(reviewer.address);
  });

  describe("FR2 — Record Anchoring", function () {
    it("allows an authorized officer to anchor a record", async function () {
      await expect(
        contract.connect(officer).anchorRecord(recordId, institutionId, docHash, 0)
      ).to.emit(contract, "RecordAnchored");

      const record = await contract.getRecord(recordId);
      expect(record.hash).to.equal(docHash);
    });

    it("rejects anchoring from an unauthorized address", async function () {
      await expect(
        contract.connect(outsider).anchorRecord(recordId, institutionId, docHash, 0)
      ).to.be.revertedWith("GovChain: caller is not an officer of this institution");
    });

    it("rejects anchoring the same record id twice", async function () {
      await contract.connect(officer).anchorRecord(recordId, institutionId, docHash, 0);
      await expect(
        contract.connect(officer).anchorRecord(recordId, institutionId, docHash, 0)
      ).to.be.revertedWith("GovChain: record already anchored");
    });
  });

  describe("FR3 — Public Verification", function () {
    beforeEach(async function () {
      await contract.connect(officer).anchorRecord(recordId, institutionId, docHash, 0);
    });

    it("confirms a match for anyone, wallet or not, using the correct hash", async function () {
      const [matches] = await contract.connect(outsider).verifyRecord(recordId, docHash);
      expect(matches).to.equal(true);
    });

    it("flags a mismatch when the candidate hash differs", async function () {
      const wrongHash = ethers.keccak256(ethers.toUtf8Bytes("tampered-document"));
      const [matches] = await contract.verifyRecord(recordId, wrongHash);
      expect(matches).to.equal(false);
    });
  });

  describe("FR4 & FR5 & FR6 — Flagging, review, and reputation reward", function () {
    beforeEach(async function () {
      await contract.connect(officer).anchorRecord(recordId, institutionId, docHash, 0);
    });

    it("lets a citizen flag a discrepancy with evidence", async function () {
      const flagId = ethers.encodeBytes32String("FLAG-001");
      await expect(
        contract.connect(citizen).flagDiscrepancy(flagId, recordId, "ipfs://evidence-doc")
      ).to.emit(contract, "DiscrepancyFlagged");
    });

    it("awards a reputation token when the review panel confirms the flag", async function () {
      const flagId = ethers.encodeBytes32String("FLAG-002");
      await contract.connect(citizen).flagDiscrepancy(flagId, recordId, "ipfs://evidence-doc");

      // FlagStatus.Confirmed == 3
      await expect(contract.connect(reviewer).resolveFlag(flagId, 3))
        .to.emit(contract, "ReputationTokenAwarded")
        .withArgs(citizen.address, 10, flagId);

      expect(await contract.reputationBalance(citizen.address)).to.equal(10);
    });

    it("does NOT award a token when the flag is disputed", async function () {
      const flagId = ethers.encodeBytes32String("FLAG-003");
      await contract.connect(citizen).flagDiscrepancy(flagId, recordId, "ipfs://evidence-doc");

      // FlagStatus.Disputed == 2
      await contract.connect(reviewer).resolveFlag(flagId, 2);
      expect(await contract.reputationBalance(citizen.address)).to.equal(0);
    });

    it("rejects resolution attempts from non-review-panel accounts", async function () {
      const flagId = ethers.encodeBytes32String("FLAG-004");
      await contract.connect(citizen).flagDiscrepancy(flagId, recordId, "ipfs://evidence-doc");

      await expect(
        contract.connect(outsider).resolveFlag(flagId, 3)
      ).to.be.revertedWith("GovChain: caller is not a review panel member");
    });
  });
});