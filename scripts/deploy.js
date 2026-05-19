const fs = require("fs");
const path = require("path");
const hre = require("hardhat");

const CONTRACTS_IN_ORDER = [
  "CitizenIdentity",
  "PromiseRegistry",
  "SpendingRecord",
  "CivicVote",
];

async function main() {
  // -------- 1. Pre-flight: who are we, where are we, do we have funds? --------
  const network = await hre.ethers.provider.getNetwork();
  const signers = await hre.ethers.getSigners();
  if (signers.length === 0) {
    throw new Error(
      "No signer available. Check that DEPLOYER_PRIVATE_KEY is set in .env."
    );
  }
  const deployer = signers[0];
  const balance = await hre.ethers.provider.getBalance(deployer.address);
  const symbol = network.chainId === 51n ? "TXDC" : "ETH";

  console.log("===========================================");
  console.log("Civitas — Smart Contract Deployment");
  console.log("===========================================");
  console.log(`Network:   ${hre.network.name} (chain id ${network.chainId})`);
  console.log(`Deployer:  ${deployer.address}`);
  console.log(`Balance:   ${hre.ethers.formatEther(balance)} ${symbol}`);
  console.log("===========================================");
  console.log("");

  if (balance === 0n) {
    throw new Error(
      `Deployer wallet has 0 ${symbol}. Fund it from the Apothem faucet (https://faucet.apothem.network) before deploying.`
    );
  }

  // -------- 2. Deploy each contract in order, waiting for confirmation. --------
  const deployed = {};

  for (const name of CONTRACTS_IN_ORDER) {
    let contract;
    let txHash;
    try {
      console.log(`Deploying ${name}...`);
      const Factory = await hre.ethers.getContractFactory(name);
      contract = await Factory.deploy();
      txHash = contract.deploymentTransaction().hash;
      console.log(`  tx submitted: ${txHash}`);
      await contract.waitForDeployment();
    } catch (err) {
      console.error("");
      console.error(`ERROR: deployment of ${name} failed.`);
      console.error(`  ${err.message}`);
      throw err;
    }

    const address = await contract.getAddress();
    deployed[name] = address;
    console.log(`  confirmed at: ${address}`);
    console.log("");
  }

  // -------- 3. Persist the address book. --------
  const outDir = path.join(__dirname, "..", "deployments");
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }
  const outPath = path.join(outDir, `${hre.network.name}.json`);
  const payload = {
    network: hre.network.name,
    chainId: Number(network.chainId),
    deployer: deployer.address,
    deployedAt: new Date().toISOString(),
    contracts: deployed,
  };
  fs.writeFileSync(outPath, JSON.stringify(payload, null, 2) + "\n");

  console.log("===========================================");
  console.log("Deployment complete.");
  console.log(`Saved address book to ${outPath}`);
  console.log("===========================================");
}

main().catch((err) => {
  console.error("");
  console.error("Deployment aborted.");
  console.error(err);
  process.exitCode = 1;
});
