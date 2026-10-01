const hre = require("hardhat");

async function main() {
  const [deployer] = await hre.ethers.getSigners();

  console.log("Deploying GovChainVerification with account:", deployer.address);

  const GovChainVerification = await hre.ethers.getContractFactory("GovChainVerification");
  const contract = await GovChainVerification.deploy();
  await contract.waitForDeployment();

  const address = await contract.getAddress();
  console.log("GovChainVerification deployed to:", address);

  // Demo setup so the frontend has something to point at immediately.
  // On a public testnet we only have ONE funded account (the deployer),
  // so that same account is registered as both admin and institution
  // officer, and also added as the review panel member. In the real
  // pilot these would be three separate wallets; for testing on Sepolia
  // with a single funded account, one wallet plays all three roles.
  const institutionId = hre.ethers.encodeBytes32String("NYARUGENGE-DIST");
  await (await contract.registerInstitution(institutionId, "Nyarugenge District Office")).wait();
  console.log("Registered institution: Nyarugenge District Office");

  await (await contract.authorizeOfficer(institutionId, deployer.address)).wait();
  console.log("Authorized institution officer:", deployer.address);

  await (await contract.addReviewPanelMember(deployer.address)).wait();
  console.log("Added review panel member:", deployer.address);

  console.log("\n--- Save these for the frontend config ---");
  console.log("CONTRACT_ADDRESS:", address);
  console.log("INSTITUTION_ID (bytes32):", institutionId);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});