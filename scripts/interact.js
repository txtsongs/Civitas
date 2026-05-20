const fs = require("fs");
const path = require("path");
const hre = require("hardhat");

// Mirror of the enums in Solidity, for readable output.
const SpendingStatus = ["Approved", "Allocated", "Spent", "Audited", "Flagged"];
const PromiseStatusName = ["Active", "Kept", "Broken", "InProgress", "Expired"];

function header(title) {
  console.log("");
  console.log("===========================================");
  console.log(title);
  console.log("===========================================");
}

function subheader(title) {
  console.log("");
  console.log(`--- ${title} ---`);
}

function compare(field, actual, expected) {
  const a = typeof actual === "bigint" ? actual : actual;
  const e = typeof expected === "bigint" ? expected : expected;
  const match =
    typeof a === "bigint" || typeof e === "bigint"
      ? BigInt(a) === BigInt(e)
      : a === e;
  const marker = match ? "[OK]" : "[MISMATCH]";
  console.log(`  ${field}: got ${formatValue(a)}, expected ${formatValue(e)}  ${marker}`);
  return match;
}

function formatValue(v) {
  if (typeof v === "bigint") return v.toString();
  if (typeof v === "string" && v.length > 50) return `"${v.slice(0, 47)}..."`;
  if (typeof v === "string") return `"${v}"`;
  return String(v);
}

async function main() {
  // -------- A. Pre-flight: address book, network, caller, balance. --------
  const addressBookPath = path.join(
    __dirname,
    "..",
    "deployments",
    `${hre.network.name}.json`
  );
  if (!fs.existsSync(addressBookPath)) {
    throw new Error(
      `No address book at ${addressBookPath}. Run scripts/deploy.js --network ${hre.network.name} first.`
    );
  }
  const addressBook = JSON.parse(fs.readFileSync(addressBookPath, "utf8"));
  const addresses = addressBook.contracts;

  const network = await hre.ethers.provider.getNetwork();
  const [signer] = await hre.ethers.getSigners();
  const balance = await hre.ethers.provider.getBalance(signer.address);
  const symbol = network.chainId === 51n ? "TXDC" : "ETH";

  header("Civitas — Live Interaction Test");
  console.log(`Network:    ${hre.network.name} (chain id ${network.chainId})`);
  console.log(`Caller:     ${signer.address}`);
  console.log(`Balance:    ${hre.ethers.formatEther(balance)} ${symbol}`);
  console.log(`Address book: ${addressBookPath}`);
  for (const [name, addr] of Object.entries(addresses)) {
    console.log(`  ${name.padEnd(18)} ${addr}`);
  }

  const results = [];
  const runId = Date.now();

  // -------- C. CitizenIdentity --------
  subheader("CitizenIdentity");
  try {
    const c = await hre.ethers.getContractAt("CitizenIdentity", addresses.CitizenIdentity);
    const identityHash = hre.ethers.id(`test-citizen-${runId}`);
    const jurisdiction = "Civitas Test Strata #001";

    console.log(`Sending: verifyCitizen(${identityHash}, "${jurisdiction}")`);
    const tx = await c.verifyCitizen(identityHash, jurisdiction);
    console.log(`  tx submitted: ${tx.hash}`);
    const rcpt = await tx.wait();
    console.log(`  confirmed in block: ${rcpt.blockNumber}`);

    console.log(`Reading: getCitizen(${identityHash})`);
    const got = await c.getCitizen(identityHash);

    const ok = [
      compare("identityHash", got.identityHash, identityHash),
      compare("jurisdiction", got.jurisdiction, jurisdiction),
      compare("isVerified", got.isVerified, true),
      compare("participationCount", got.participationCount, 0n),
      compare("reputationScore", got.reputationScore, 100n),
    ].every(Boolean);

    console.log(`  RESULT: ${ok ? "PASS" : "FAIL"}`);
    results.push({ name: "CitizenIdentity", passed: ok });
  } catch (err) {
    console.error(`  ERROR: ${err.shortMessage || err.message}`);
    results.push({ name: "CitizenIdentity", passed: false, error: err.message });
  }

  // -------- D. PromiseRegistry --------
  subheader("PromiseRegistry");
  try {
    const c = await hre.ethers.getContractAt("PromiseRegistry", addresses.PromiseRegistry);
    const args = {
      politician: "Test Councillor Smith",
      party: "Independent",
      promiseText: `Resurface main road by end of fiscal year (run ${runId})`,
      sourceUrl: "https://example.org/council-minutes/2026-05",
      category: "Infrastructure",
      deadline: Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60,
      evidenceHash: "ipfs://bafy-initial-evidence",
    };

    const newId = await c.recordPromise.staticCall(
      args.politician,
      args.party,
      args.promiseText,
      args.sourceUrl,
      args.category,
      args.deadline,
      args.evidenceHash
    );
    console.log(`Sending: recordPromise(...) — expected new id ${newId}`);
    const tx = await c.recordPromise(
      args.politician,
      args.party,
      args.promiseText,
      args.sourceUrl,
      args.category,
      args.deadline,
      args.evidenceHash
    );
    console.log(`  tx submitted: ${tx.hash}`);
    const rcpt = await tx.wait();
    console.log(`  confirmed in block: ${rcpt.blockNumber}`);

    console.log(`Reading: getPromise(${newId})`);
    const got = await c.getPromise(newId);

    const checks = [
      compare("id", got.id, newId),
      compare("politician", got.politician, args.politician),
      compare("party", got.party, args.party),
      compare("promiseText", got.promiseText, args.promiseText),
      compare("sourceUrl", got.sourceUrl, args.sourceUrl),
      compare("category", got.category, args.category),
      compare("deadline", got.deadline, BigInt(args.deadline)),
      compare("evidenceHash", got.evidenceHash, args.evidenceHash),
      compare("keptVotes", got.keptVotes, 0n),
      compare("brokenVotes", got.brokenVotes, 0n),
      compare("status", `${got.status} (${PromiseStatusName[Number(got.status)]})`, "0 (Active)"),
    ];
    const tsOk = got.dateRecorded > 0n;
    console.log(`  dateRecorded: got ${got.dateRecorded} (block timestamp)  ${tsOk ? "[OK]" : "[MISMATCH]"}`);
    checks.push(tsOk);

    const ok = checks.every(Boolean);
    console.log(`  RESULT: ${ok ? "PASS" : "FAIL"}`);
    results.push({ name: "PromiseRegistry", passed: ok });
  } catch (err) {
    console.error(`  ERROR: ${err.shortMessage || err.message}`);
    results.push({ name: "PromiseRegistry", passed: false, error: err.message });
  }

  // -------- E. SpendingRecord --------
  subheader("SpendingRecord");
  try {
    const c = await hre.ethers.getContractAt("SpendingRecord", addresses.SpendingRecord);
    const args = {
      department: "Public Works",
      description: `Sidewalk repair (run ${runId})`,
      amount: 25_000n,
      contractorName: "Acme Concrete Inc.",
      documentHash: "ipfs://bafy-invoice-001",
    };
    const flagReason = "Test flag — pricing seems above market";

    const newId = await c.recordExpenditure.staticCall(
      args.department,
      args.description,
      args.amount,
      args.contractorName,
      args.documentHash
    );
    console.log(`Sending: recordExpenditure(...) — expected new id ${newId}`);
    const recTx = await c.recordExpenditure(
      args.department,
      args.description,
      args.amount,
      args.contractorName,
      args.documentHash
    );
    console.log(`  tx submitted: ${recTx.hash}`);
    const recRcpt = await recTx.wait();
    console.log(`  confirmed in block: ${recRcpt.blockNumber}`);

    console.log(`Sending: flagExpenditure(${newId}, "${flagReason}")`);
    const flagTx = await c.flagExpenditure(newId, flagReason);
    console.log(`  tx submitted: ${flagTx.hash}`);
    const flagRcpt = await flagTx.wait();
    console.log(`  confirmed in block: ${flagRcpt.blockNumber}`);

    console.log(`Reading: getExpenditure(${newId})`);
    const got = await c.getExpenditure(newId);

    const ok = [
      compare("id", got.id, newId),
      compare("department", got.department, args.department),
      compare("description", got.description, args.description),
      compare("amount", got.amount, args.amount),
      compare("currency", got.currency, "CAD"),
      compare("recordedBy", got.recordedBy, signer.address),
      compare("contractorName", got.contractorName, args.contractorName),
      compare("documentHash", got.documentHash, args.documentHash),
      compare("isFlagged", got.isFlagged, true),
      compare("flagReason", got.flagReason, flagReason),
      compare("flagCount", got.flagCount, 1n),
      compare("status", `${got.status} (${SpendingStatus[Number(got.status)]})`, "4 (Flagged)"),
    ].every(Boolean);

    console.log(`  RESULT: ${ok ? "PASS" : "FAIL"}`);
    results.push({ name: "SpendingRecord", passed: ok });
  } catch (err) {
    console.error(`  ERROR: ${err.shortMessage || err.message}`);
    results.push({ name: "SpendingRecord", passed: false, error: err.message });
  }

  // -------- F. CivicVote (time-sensitive) --------
  subheader("CivicVote");
  try {
    const c = await hre.ethers.getContractAt("CivicVote", addresses.CivicVote);

    const chainNow = (await hre.ethers.provider.getBlock("latest")).timestamp;
    const startTime = chainNow + 60;
    const endTime = chainNow + 600;
    const title = `Test Mayor Election (run ${runId})`;

    const newId = await c.createElection.staticCall(
      title,
      "Civitas Test Town",
      "Municipal",
      startTime,
      endTime,
      100
    );
    console.log(`Sending: createElection(...) — expected new id ${newId}`);
    console.log(`  startTime: ${startTime} (~${startTime - chainNow}s from now)`);
    console.log(`  endTime:   ${endTime}`);
    let tx = await c.createElection(title, "Civitas Test Town", "Municipal", startTime, endTime, 100);
    console.log(`  tx submitted: ${tx.hash}`);
    let rcpt = await tx.wait();
    console.log(`  confirmed in block: ${rcpt.blockNumber}`);

    for (const [name, party, platform] of [
      ["Alice Candidate", "Party A", "Lower taxes"],
      ["Bob Candidate", "Party B", "More green space"],
    ]) {
      console.log(`Sending: addCandidate(${newId}, "${name}", ...)`);
      tx = await c.addCandidate(newId, name, party, platform);
      console.log(`  tx submitted: ${tx.hash}`);
      rcpt = await tx.wait();
      console.log(`  confirmed in block: ${rcpt.blockNumber}`);
    }

    console.log(`Sending: openElection(${newId})`);
    tx = await c.openElection(newId);
    console.log(`  tx submitted: ${tx.hash}`);
    rcpt = await tx.wait();
    console.log(`  confirmed in block: ${rcpt.blockNumber}`);

    // Poll the chain's clock until it has advanced past startTime.
    // Block timestamps are monotonic, so once latest.timestamp >= startTime,
    // the next block (containing castVote) is guaranteed to satisfy block.timestamp >= startTime.
    let currentTs = (await hre.ethers.provider.getBlock("latest")).timestamp;
    let attempt = 0;
    while (currentTs < startTime) {
      attempt++;
      if (attempt > 20) {
        throw new Error(`Chain failed to reach startTime ${startTime} after 20 polls (current ${currentTs}).`);
      }
      const waitSec = Math.max(3, startTime - currentTs + 3);
      console.log(`  chain ts ${currentTs} < target ${startTime}, waiting ${waitSec}s (attempt ${attempt})...`);
      await new Promise((r) => setTimeout(r, waitSec * 1000));
      currentTs = (await hre.ethers.provider.getBlock("latest")).timestamp;
    }
    console.log(`  Voting window open (chain ts ${currentTs} >= ${startTime})`);

    const voterHash = hre.ethers.id(`voter-${runId}`);
    console.log(`Sending: castVote(${newId}, 0, ${voterHash})`);
    tx = await c.castVote(newId, 0, voterHash);
    console.log(`  tx submitted: ${tx.hash}`);
    rcpt = await tx.wait();
    console.log(`  confirmed in block: ${rcpt.blockNumber}`);

    console.log(`Reading: candidate 0 voteCount + election totalVotesCast + hasVoted`);
    const cand0 = await c.electionCandidates(newId, 0);
    const election = await c.elections(newId);
    const voted = await c.hasVoted(newId, voterHash);

    const ok = [
      compare("candidate[0].name", cand0.name, "Alice Candidate"),
      compare("candidate[0].voteCount", cand0.voteCount, 1n),
      compare("election.totalVotesCast", election.totalVotesCast, 1n),
      compare("hasVoted[id][voter]", voted, true),
    ].every(Boolean);

    console.log(`  RESULT: ${ok ? "PASS" : "FAIL"}`);
    results.push({ name: "CivicVote", passed: ok });
  } catch (err) {
    console.error(`  ERROR: ${err.shortMessage || err.message}`);
    results.push({ name: "CivicVote", passed: false, error: err.message });
  }

  // -------- G. Summary --------
  header("Summary");
  for (const r of results) {
    const tag = r.passed ? "PASS" : "FAIL";
    const tail = r.error ? `  (${r.error})` : "";
    console.log(`  ${r.name.padEnd(18)} ${tag}${tail}`);
  }
  const allPassed = results.every((r) => r.passed);
  console.log("===========================================");
  console.log(allPassed ? "All interactions succeeded." : "One or more interactions FAILED.");
  console.log("===========================================");
  process.exitCode = allPassed ? 0 : 1;
}

main().catch((err) => {
  console.error("");
  console.error("Interaction aborted.");
  console.error(err);
  process.exitCode = 1;
});
