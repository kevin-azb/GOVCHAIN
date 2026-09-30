const hre = require("hardhat");

async function main() {
  const [deployer, institutionOfficer, reviewPanelMember] = await hre.ethers.getSigners();

  console.log("Deploying GovChainVerification with account:", deployer.address);

  const GovChainVerification = await hre.ethers.getContractFactory("GovChainVerification");
  const contract = await GovChainVerification.deploy();
  await contract.waitForDeployment();

  const address = await contract.getAddress();
  console.log("GovChainVerification deployed to:", address);

  // Demo setup so the frontend has something to point at immediately.
  const institutionId = hre.ethers.encodeBytes32String("NYARUGENGE-DIST");
  await (await contract.registerInstitution(institutionId, "Nyarugenge District Office")).wait();
  console.log("Registered institution: Nyarugenge District Office");

  if (institutionOfficer) {
    await (await contract.authorizeOfficer(institutionId, institutionOfficer.address)).wait();
    console.log("Authorized institution officer:", institutionOfficer.address);
  }

  if (reviewPanelMember) {
    await (await contract.addReviewPanelMember(reviewPanelMember.address)).wait();
    console.log("Added review panel member:", reviewPanelMember.address);
  }

  console.log("\n--- Save these for the frontend config ---");
  console.log("CONTRACT_ADDRESS:", address);
  console.log("INSTITUTION_ID (bytes32):", institutionId);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
