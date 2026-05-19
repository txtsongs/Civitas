const { expect } = require("chai");
const { loadFixture, time } = require("@nomicfoundation/hardhat-network-helpers");
const { ethers } = require("hardhat");

const PromiseStatus = {
  Active: 0n,
  Kept: 1n,
  Broken: 2n,
  InProgress: 3n,
  Expired: 4n,
};

const SAMPLE = {
  politician: "Jane Doe",
  party: "Independent",
  promiseText: "Build 10,000 affordable units",
  sourceUrl: "https://example.org/speech-2026",
  category: "Housing",
  evidenceHash: "ipfs://bafy-initial",
};

async function deployFixture() {
  const signers = await ethers.getSigners();
  const PromiseRegistry = await ethers.getContractFactory("PromiseRegistry");
  const contract = await PromiseRegistry.deploy();
  return { contract, signers };
}

async function recordSample(contract, overrides = {}) {
  const params = { ...SAMPLE, ...overrides };
  const deadline =
    overrides.deadline ?? ((await time.latest()) + 365 * 24 * 60 * 60);
  return contract.recordPromise(
    params.politician,
    params.party,
    params.promiseText,
    params.sourceUrl,
    params.category,
    deadline,
    params.evidenceHash
  );
}

describe("PromiseRegistry", function () {
  describe("recordPromise", function () {
    it("1. promiseCount starts at 0; first recordPromise returns 1 and sets count to 1", async function () {
      const { contract } = await loadFixture(deployFixture);
      expect(await contract.promiseCount()).to.equal(0n);
      const deadline = (await time.latest()) + 1000;
      const returnedId = await contract.recordPromise.staticCall(
        SAMPLE.politician,
        SAMPLE.party,
        SAMPLE.promiseText,
        SAMPLE.sourceUrl,
        SAMPLE.category,
        deadline,
        SAMPLE.evidenceHash
      );
      expect(returnedId).to.equal(1n);
      await contract.recordPromise(
        SAMPLE.politician,
        SAMPLE.party,
        SAMPLE.promiseText,
        SAMPLE.sourceUrl,
        SAMPLE.category,
        deadline,
        SAMPLE.evidenceHash
      );
      expect(await contract.promiseCount()).to.equal(1n);
    });

    it("2. stores all 12 struct fields correctly", async function () {
      const { contract } = await loadFixture(deployFixture);
      const deadline = (await time.latest()) + 1000;
      const tx = await recordSample(contract, { deadline });
      const receipt = await tx.wait();
      const block = await ethers.provider.getBlock(receipt.blockNumber);

      const p = await contract.promises(1);
      expect(p.id).to.equal(1n);
      expect(p.politician).to.equal(SAMPLE.politician);
      expect(p.party).to.equal(SAMPLE.party);
      expect(p.promiseText).to.equal(SAMPLE.promiseText);
      expect(p.sourceUrl).to.equal(SAMPLE.sourceUrl);
      expect(p.category).to.equal(SAMPLE.category);
      expect(p.dateRecorded).to.equal(BigInt(block.timestamp));
      expect(p.deadline).to.equal(BigInt(deadline));
      expect(p.keptVotes).to.equal(0n);
      expect(p.brokenVotes).to.equal(0n);
      expect(p.evidenceHash).to.equal(SAMPLE.evidenceHash);
      expect(p.status).to.equal(PromiseStatus.Active);
    });

    it("3. emits PromiseRecorded(id, politician, promiseText, dateRecorded)", async function () {
      const { contract } = await loadFixture(deployFixture);
      const expectedTimestamp = (await time.latest()) + 60;
      await time.setNextBlockTimestamp(expectedTimestamp);
      const deadline = expectedTimestamp + 10000;
      await expect(
        contract.recordPromise(
          SAMPLE.politician,
          SAMPLE.party,
          SAMPLE.promiseText,
          SAMPLE.sourceUrl,
          SAMPLE.category,
          deadline,
          SAMPLE.evidenceHash
        )
      )
        .to.emit(contract, "PromiseRecorded")
        .withArgs(1n, SAMPLE.politician, SAMPLE.promiseText, BigInt(expectedTimestamp));
    });

    it("4. recording two promises produces ids 1 and 2 with independent state", async function () {
      const { contract } = await loadFixture(deployFixture);
      await recordSample(contract, { politician: "Alice" });
      await recordSample(contract, { politician: "Bob" });

      expect(await contract.promiseCount()).to.equal(2n);
      const p1 = await contract.promises(1);
      const p2 = await contract.promises(2);
      expect(p1.id).to.equal(1n);
      expect(p2.id).to.equal(2n);
      expect(p1.politician).to.equal("Alice");
      expect(p2.politician).to.equal("Bob");
    });
  });

  describe("voteOnPromise — access control", function () {
    it("5. reverts 'Promise does not exist' for id 0 and an id above promiseCount", async function () {
      const { contract } = await loadFixture(deployFixture);
      await recordSample(contract);
      await expect(
        contract.voteOnPromise(0, true, "ipfs://x")
      ).to.be.revertedWith("Promise does not exist");
      await expect(
        contract.voteOnPromise(999, true, "ipfs://x")
      ).to.be.revertedWith("Promise does not exist");
    });

    it("6. reverts 'Already voted on this promise' on a second vote from the same address", async function () {
      const { contract, signers } = await loadFixture(deployFixture);
      await recordSample(contract);
      await contract.connect(signers[1]).voteOnPromise(1, true, "ipfs://a");
      await expect(
        contract.connect(signers[1]).voteOnPromise(1, false, "ipfs://b")
      ).to.be.revertedWith("Already voted on this promise");
    });

    it("7. hasVoted[id][voter] flips to true; remains false for non-voters", async function () {
      const { contract, signers } = await loadFixture(deployFixture);
      await recordSample(contract);
      expect(await contract.hasVoted(1, signers[1].address)).to.equal(false);
      expect(await contract.hasVoted(1, signers[2].address)).to.equal(false);
      await contract.connect(signers[1]).voteOnPromise(1, true, "ipfs://a");
      expect(await contract.hasVoted(1, signers[1].address)).to.equal(true);
      expect(await contract.hasVoted(1, signers[2].address)).to.equal(false);
    });

    it("8. different addresses can each vote independently on the same promise", async function () {
      const { contract, signers } = await loadFixture(deployFixture);
      await recordSample(contract);
      await contract.connect(signers[1]).voteOnPromise(1, true, "ipfs://a");
      await contract.connect(signers[2]).voteOnPromise(1, false, "ipfs://b");
      await contract.connect(signers[3]).voteOnPromise(1, true, "ipfs://c");
      const p = await contract.promises(1);
      expect(p.keptVotes).to.equal(2n);
      expect(p.brokenVotes).to.equal(1n);
    });
  });

  describe("voteOnPromise — tallies + evidence", function () {
    it("9. wasKept=true increments keptVotes; wasKept=false increments brokenVotes", async function () {
      const { contract, signers } = await loadFixture(deployFixture);
      await recordSample(contract);
      await contract.connect(signers[1]).voteOnPromise(1, true, "ipfs://a");
      let p = await contract.promises(1);
      expect(p.keptVotes).to.equal(1n);
      expect(p.brokenVotes).to.equal(0n);
      await contract.connect(signers[2]).voteOnPromise(1, false, "ipfs://b");
      p = await contract.promises(1);
      expect(p.keptVotes).to.equal(1n);
      expect(p.brokenVotes).to.equal(1n);
    });

    it("10. evidenceHash is overwritten by every voter's submission (snapshot)", async function () {
      const { contract, signers } = await loadFixture(deployFixture);
      await recordSample(contract, { evidenceHash: "ipfs://initial" });
      let p = await contract.promises(1);
      expect(p.evidenceHash).to.equal("ipfs://initial");

      await contract.connect(signers[1]).voteOnPromise(1, true, "ipfs://first-voter");
      p = await contract.promises(1);
      expect(p.evidenceHash).to.equal("ipfs://first-voter");

      await contract.connect(signers[2]).voteOnPromise(1, false, "ipfs://second-voter");
      p = await contract.promises(1);
      expect(p.evidenceHash).to.equal("ipfs://second-voter");
    });

    it("11. emits PromiseVoted(id, wasKept, newKeptCount, newBrokenCount) with current running tallies", async function () {
      const { contract, signers } = await loadFixture(deployFixture);
      await recordSample(contract);
      await expect(contract.connect(signers[1]).voteOnPromise(1, true, "x"))
        .to.emit(contract, "PromiseVoted")
        .withArgs(1n, true, 1n, 0n);
      await expect(contract.connect(signers[2]).voteOnPromise(1, false, "x"))
        .to.emit(contract, "PromiseVoted")
        .withArgs(1n, false, 1n, 1n);
      await expect(contract.connect(signers[3]).voteOnPromise(1, true, "x"))
        .to.emit(contract, "PromiseVoted")
        .withArgs(1n, true, 2n, 1n);
    });
  });

  describe("_updateStatus thresholds", function () {
    it("12. with 9 total votes (below threshold): status stays Active and no StatusUpdated event fires", async function () {
      const { contract, signers } = await loadFixture(deployFixture);
      await recordSample(contract);
      for (let i = 1; i <= 8; i++) {
        await contract.connect(signers[i]).voteOnPromise(1, true, "x");
      }
      const ninth = await contract.connect(signers[9]).voteOnPromise(1, true, "x");
      await expect(ninth).to.not.emit(contract, "StatusUpdated");
      const p = await contract.promises(1);
      expect(p.status).to.equal(PromiseStatus.Active);
      expect(p.keptVotes + p.brokenVotes).to.equal(9n);
    });

    it("13. 10 votes with 7 kept / 3 broken (exactly 70%) becomes Kept", async function () {
      const { contract, signers } = await loadFixture(deployFixture);
      await recordSample(contract);
      for (let i = 1; i <= 7; i++) {
        await contract.connect(signers[i]).voteOnPromise(1, true, "x");
      }
      for (let i = 8; i <= 9; i++) {
        await contract.connect(signers[i]).voteOnPromise(1, false, "x");
      }
      // 10th vote: brings total to 10, 7 kept / 3 broken
      await expect(contract.connect(signers[10]).voteOnPromise(1, false, "x"))
        .to.emit(contract, "StatusUpdated")
        .withArgs(1n, PromiseStatus.Kept);
      const p = await contract.promises(1);
      expect(p.status).to.equal(PromiseStatus.Kept);
      expect(p.keptVotes).to.equal(7n);
      expect(p.brokenVotes).to.equal(3n);
    });

    it("14. 10 votes with 3 kept / 7 broken (exactly 30%) becomes Broken", async function () {
      const { contract, signers } = await loadFixture(deployFixture);
      await recordSample(contract);
      for (let i = 1; i <= 3; i++) {
        await contract.connect(signers[i]).voteOnPromise(1, true, "x");
      }
      for (let i = 4; i <= 9; i++) {
        await contract.connect(signers[i]).voteOnPromise(1, false, "x");
      }
      await expect(contract.connect(signers[10]).voteOnPromise(1, false, "x"))
        .to.emit(contract, "StatusUpdated")
        .withArgs(1n, PromiseStatus.Broken);
      const p = await contract.promises(1);
      expect(p.status).to.equal(PromiseStatus.Broken);
      expect(p.keptVotes).to.equal(3n);
      expect(p.brokenVotes).to.equal(7n);
    });

    it("15. 10 votes with 5 kept / 5 broken stays Active but StatusUpdated(Active) still fires", async function () {
      const { contract, signers } = await loadFixture(deployFixture);
      await recordSample(contract);
      for (let i = 1; i <= 5; i++) {
        await contract.connect(signers[i]).voteOnPromise(1, true, "x");
      }
      for (let i = 6; i <= 9; i++) {
        await contract.connect(signers[i]).voteOnPromise(1, false, "x");
      }
      await expect(contract.connect(signers[10]).voteOnPromise(1, false, "x"))
        .to.emit(contract, "StatusUpdated")
        .withArgs(1n, PromiseStatus.Active);
      const p = await contract.promises(1);
      expect(p.status).to.equal(PromiseStatus.Active);
    });

    it("16. status can flip Kept -> Broken when ratio later drops to <=30%", async function () {
      const { contract, signers } = await loadFixture(deployFixture);
      await recordSample(contract);
      // Phase 1: 7 kept, 3 broken => Kept
      for (let i = 1; i <= 7; i++) {
        await contract.connect(signers[i]).voteOnPromise(1, true, "x");
      }
      for (let i = 8; i <= 10; i++) {
        await contract.connect(signers[i]).voteOnPromise(1, false, "x");
      }
      let p = await contract.promises(1);
      expect(p.status).to.equal(PromiseStatus.Kept);

      // Phase 2: add 14 more broken voters (signers 11..24), totals: 7K/17B = 24 votes, keptPct = 7/24 = 29.17%
      for (let i = 11; i <= 23; i++) {
        await contract.connect(signers[i]).voteOnPromise(1, false, "x");
      }
      // 24th vote (signer 24) should flip to Broken
      await expect(contract.connect(signers[24]).voteOnPromise(1, false, "x"))
        .to.emit(contract, "StatusUpdated")
        .withArgs(1n, PromiseStatus.Broken);
      p = await contract.promises(1);
      expect(p.status).to.equal(PromiseStatus.Broken);
      expect(p.keptVotes).to.equal(7n);
      expect(p.brokenVotes).to.equal(17n);
    });
  });

  describe("expiry behavior", function () {
    it("17. past deadline + 10 votes + 5/5 split becomes Expired", async function () {
      const { contract, signers } = await loadFixture(deployFixture);
      const deadline = (await time.latest()) + 1000;
      await recordSample(contract, { deadline });

      // Cast 9 votes (5 kept, 4 broken) before the deadline
      for (let i = 1; i <= 5; i++) {
        await contract.connect(signers[i]).voteOnPromise(1, true, "x");
      }
      for (let i = 6; i <= 9; i++) {
        await contract.connect(signers[i]).voteOnPromise(1, false, "x");
      }
      // Advance past deadline
      await time.increaseTo(deadline + 100);
      // 10th vote: brings total to 10 with 5/5 split, past deadline -> Expired
      await expect(contract.connect(signers[10]).voteOnPromise(1, false, "x"))
        .to.emit(contract, "StatusUpdated")
        .withArgs(1n, PromiseStatus.Expired);
      const p = await contract.promises(1);
      expect(p.status).to.equal(PromiseStatus.Expired);
    });

    it("18. past deadline but already Kept stays Kept (does not flip to Expired)", async function () {
      const { contract, signers } = await loadFixture(deployFixture);
      const deadline = (await time.latest()) + 1000;
      await recordSample(contract, { deadline });

      // Reach Kept with 7K/3B at 10 votes
      for (let i = 1; i <= 7; i++) {
        await contract.connect(signers[i]).voteOnPromise(1, true, "x");
      }
      for (let i = 8; i <= 10; i++) {
        await contract.connect(signers[i]).voteOnPromise(1, false, "x");
      }
      let p = await contract.promises(1);
      expect(p.status).to.equal(PromiseStatus.Kept);

      // Advance past deadline; cast one more kept vote
      await time.increaseTo(deadline + 100);
      await contract.connect(signers[11]).voteOnPromise(1, true, "x");
      p = await contract.promises(1);
      expect(p.status).to.equal(PromiseStatus.Kept);
    });
  });

  describe("getPromise", function () {
    it("19. reverts 'Promise does not exist' for id 0 and an out-of-range id", async function () {
      const { contract } = await loadFixture(deployFixture);
      await recordSample(contract);
      await expect(contract.getPromise(0)).to.be.revertedWith("Promise does not exist");
      await expect(contract.getPromise(999)).to.be.revertedWith("Promise does not exist");
    });

    it("20. returns full struct on creation and reflects tally/status updates after votes", async function () {
      const { contract, signers } = await loadFixture(deployFixture);
      const deadline = (await time.latest()) + 100000;
      const tx = await recordSample(contract, { deadline });
      const receipt = await tx.wait();
      const block = await ethers.provider.getBlock(receipt.blockNumber);

      let p = await contract.getPromise(1);
      expect(p.id).to.equal(1n);
      expect(p.politician).to.equal(SAMPLE.politician);
      expect(p.party).to.equal(SAMPLE.party);
      expect(p.promiseText).to.equal(SAMPLE.promiseText);
      expect(p.sourceUrl).to.equal(SAMPLE.sourceUrl);
      expect(p.category).to.equal(SAMPLE.category);
      expect(p.dateRecorded).to.equal(BigInt(block.timestamp));
      expect(p.deadline).to.equal(BigInt(deadline));
      expect(p.keptVotes).to.equal(0n);
      expect(p.brokenVotes).to.equal(0n);
      expect(p.evidenceHash).to.equal(SAMPLE.evidenceHash);
      expect(p.status).to.equal(PromiseStatus.Active);

      // Vote enough to reach Kept
      for (let i = 1; i <= 7; i++) {
        await contract.connect(signers[i]).voteOnPromise(1, true, "ipfs://latest");
      }
      for (let i = 8; i <= 10; i++) {
        await contract.connect(signers[i]).voteOnPromise(1, false, "ipfs://latest");
      }
      p = await contract.getPromise(1);
      expect(p.keptVotes).to.equal(7n);
      expect(p.brokenVotes).to.equal(3n);
      expect(p.status).to.equal(PromiseStatus.Kept);
      expect(p.evidenceHash).to.equal("ipfs://latest");
    });
  });
});
