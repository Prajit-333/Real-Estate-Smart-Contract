const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
  const [admin, verifier] = await hre.ethers.getSigners();
  const factory = await hre.ethers.getContractFactory("RealEstateVault");
  const contract = await factory.deploy(verifier.address);
  await contract.waitForDeployment();
  const address = await contract.getAddress();
  const addressFile = path.join(__dirname, "..", "frontend", "src", "contract", "address.js");
  fs.writeFileSync(addressFile, `export const CONTRACT_ADDRESS = "${address}";\n`);
  console.log(`RealEstateVault deployed to: ${address}`);
  console.log(`Frontend contract address updated: ${addressFile}`);
  console.log(`Admin: ${admin.address}`);
  console.log(`Verifier: ${verifier.address}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
