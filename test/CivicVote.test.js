const { expect } = require("chai");
const { loadFixture, time } = require("@nomicfoundation/hardhat-network-helpers");
const { ethers } = require("hardhat");

const ElectionStatus = {
  Setup: 0n,
  Active: 1n,
  Closed: 2n,
  Tallied: 3n,
  Certified: 4n,
};

const hashAlice = ethers.id("voter-alice");
const hashBob = ethers.id("voter-bob");
const hashCarol = ethers.id("voter-carol");

async function deployFixture() {
  const signers = await ethers.getSigners();
  const CivicVote = await ethers.getContractFactory("CivicVote");
  const contract = await CivicVote.deploy();
  return { contract, signers };
}

async function createBasicElection(contract, overrides = {}) {
  const now = await time.latest();
  const startTime = overrides.startTime ?? now + 100;
  const endTime = overrides.endTime ?? now + 1000;
  await contract.createElection(
    overrides.title ?? "Mayor 2026",
    overrides.jurisdiction ?? "Maple Ridge",
    overrides.electionType ?? "Municipal",
    startTime,
    endTime,
    overrides.registeredVoters ?? 1000
  );
  return { electionId: 1, startTime, endTime };
}

async function addNCandidates(contract, electionId, n) {
  for (let i = 0; i < n; i++) {
    await contract.addCandidate(
      electionId,
      `Candidate ${i + 1}`,
      `Party ${i + 1}`,
      `Platform ${i + 1}`
    );
  }
}

describe("CivicVote", function () {
  describe("createElection", function () {
    it("1. electionCount starts at 0; first call returns 1; stores all 10 fields", async function () {
      const { contract } = await loadFixture(deployFixture);
      expect(await contract.electionCount()).to.equal(0n);

      const now = await time.latest();
      const startTime = now + 100;
      const endTime = now + 1000;

      const id = await contract.createElection.staticCall(
        "Mayor 2026",
        "Maple Ridge",
        "Municipal",
        startTime,
        endTime,
        1000
      );
      expect(id).to.equal(1n);

      await contract.createElection(
        "Mayor 2026",
        "Maple Ridge",
        "Municipal",
        startTime,
        endTime,
        1000
      );
      expect(await contract.electionCount()).to.equal(1n);

      const e = await contract.elections(1);
      expect(e.id).to.equal(1n);
      expect(e.title).to.equal("Mayor 2026");
      expect(e.jurisdiction).to.equal("Maple Ridge");
      expect(e.electionType).to.equal("Municipal");
      expect(e.startTime).to.equal(BigInt(startTime));
      expect(e.endTime).to.equal(BigInt(endTime));
      expect(e.totalVotesCast).to.equal(0n);
      expect(e.registeredVoters).to.equal(1000n);
      expect(e.status).to.equal(ElectionStatus.Setup);
      expect(e.resultsPublic).to.equal(false);
    });

    it("2. emits ElectionCreated(id, title, jurisdiction, startTime, endTime)", async function () {
      const { contract } = await loadFixture(deployFixture);
      const now = await time.latest();
      const startTime = now + 100;
      const endTime = now + 1000;
      await expect(
        contract.createElection("Mayor 2026", "Maple Ridge", "Municipal", startTime, endTime, 1000)
      )
        .to.emit(contract, "ElectionCreated")
        .withArgs(1n, "Mayor 2026", "Maple Ridge", BigInt(startTime), BigInt(endTime));
    });

    it("3. reverts 'End time must be after start' when endTime <= startTime", async function () {
      const { contract } = await loadFixture(deployFixture);
      const now = await time.latest();
      const startTime = now + 100;
      await expect(
        contract.createElection("T", "J", "E", startTime, startTime - 1, 100)
      ).to.be.revertedWith("End time must be after start");
      await expect(
        contract.createElection("T", "J", "E", startTime, startTime, 100)
      ).to.be.revertedWith("End time must be after start");
    });

    it("4. reverts 'Start time must be in future' when startTime <= block.timestamp", async function () {
      const { contract } = await loadFixture(deployFixture);
      const now = await time.latest();
      const nextBlockTs = now + 10;
      await time.setNextBlockTimestamp(nextBlockTs);
      await expect(
        contract.createElection("T", "J", "E", nextBlockTs, nextBlockTs + 100, 100)
      ).to.be.revertedWith("Start time must be in future");

      const pastNext = nextBlockTs + 10;
      await time.setNextBlockTimestamp(pastNext);
      await expect(
        contract.createElection("T", "J", "E", pastNext - 1, pastNext + 100, 100)
      ).to.be.revertedWith("Start time must be in future");
    });

    it("5. three elections get sequential ids 1, 2, 3 with independent state", async function () {
      const { contract } = await loadFixture(deployFixture);
      const now = await time.latest();
      await contract.createElection("E1", "J1", "T1", now + 100, now + 1000, 100);
      await contract.createElection("E2", "J2", "T2", now + 200, now + 2000, 200);
      await contract.createElection("E3", "J3", "T3", now + 300, now + 3000, 300);

      expect(await contract.electionCount()).to.equal(3n);
      const e1 = await contract.elections(1);
      const e2 = await contract.elections(2);
      const e3 = await contract.elections(3);
      expect(e1.id).to.equal(1n);
      expect(e2.id).to.equal(2n);
      expect(e3.id).to.equal(3n);
      expect(e1.title).to.equal("E1");
      expect(e2.title).to.equal("E2");
      expect(e3.title).to.equal("E3");
      expect(e1.registeredVoters).to.equal(100n);
      expect(e2.registeredVoters).to.equal(200n);
      expect(e3.registeredVoters).to.equal(300n);
    });
  });

  describe("addCandidate", function () {
    it("6. sequential 1-indexed candidate ids; voteCount=0; stored at array positions 0, 1, 2", async function () {
      const { contract } = await loadFixture(deployFixture);
      await createBasicElection(contract);
      await contract.addCandidate(1, "Alice", "Party A", "Platform A");
      await contract.addCandidate(1, "Bob", "Party B", "Platform B");
      await contract.addCandidate(1, "Carol", "Party C", "Platform C");

      const c0 = await contract.electionCandidates(1, 0);
      const c1 = await contract.electionCandidates(1, 1);
      const c2 = await contract.electionCandidates(1, 2);

      expect(c0.id).to.equal(1n);
      expect(c0.name).to.equal("Alice");
      expect(c0.party).to.equal("Party A");
      expect(c0.platform).to.equal("Platform A");
      expect(c0.voteCount).to.equal(0n);

      expect(c1.id).to.equal(2n);
      expect(c1.name).to.equal("Bob");
      expect(c1.voteCount).to.equal(0n);

      expect(c2.id).to.equal(3n);
      expect(c2.name).to.equal("Carol");
      expect(c2.voteCount).to.equal(0n);
    });

    it("7. reverts 'Election already started' once status is Active", async function () {
      const { contract } = await loadFixture(deployFixture);
      await createBasicElection(contract);
      await addNCandidates(contract, 1, 2);
      await contract.openElection(1);
      await expect(
        contract.addCandidate(1, "Late", "Late Party", "Late")
      ).to.be.revertedWith("Election already started");
    });

    it("8. PHANTOM: addCandidate to a nonexistent electionId succeeds silently", async function () {
      const { contract } = await loadFixture(deployFixture);
      await expect(contract.addCandidate(999, "Phantom", "P", "P")).to.not.be.reverted;
      const c = await contract.electionCandidates(999, 0);
      expect(c.id).to.equal(1n);
      expect(c.name).to.equal("Phantom");
      expect(await contract.electionCount()).to.equal(0n);
    });
  });

  describe("openElection", function () {
    it("9. reverts 'Not in setup' when called a second time", async function () {
      const { contract } = await loadFixture(deployFixture);
      await createBasicElection(contract);
      await addNCandidates(contract, 1, 2);
      await contract.openElection(1);
      await expect(contract.openElection(1)).to.be.revertedWith("Not in setup");
    });

    it("10. reverts 'Need at least 2 candidates' for 0 and 1 candidates", async function () {
      const { contract } = await loadFixture(deployFixture);
      await createBasicElection(contract);
      await expect(contract.openElection(1)).to.be.revertedWith("Need at least 2 candidates");
      await addNCandidates(contract, 1, 1);
      await expect(contract.openElection(1)).to.be.revertedWith("Need at least 2 candidates");
    });

    it("11. with exactly 2 candidates, status becomes Active", async function () {
      const { contract } = await loadFixture(deployFixture);
      await createBasicElection(contract);
      await addNCandidates(contract, 1, 2);
      await contract.openElection(1);
      const e = await contract.elections(1);
      expect(e.status).to.equal(ElectionStatus.Active);
    });

    it("12. PHANTOM: openElection on uncreated electionId works after 2 phantom addCandidate calls", async function () {
      const { contract } = await loadFixture(deployFixture);
      await contract.addCandidate(999, "P1", "Q", "X");
      await contract.addCandidate(999, "P2", "Q", "X");
      await expect(contract.openElection(999)).to.not.be.reverted;
      const e = await contract.elections(999);
      expect(e.status).to.equal(ElectionStatus.Active);
      expect(e.id).to.equal(0n);
      expect(await contract.electionCount()).to.equal(0n);
    });
  });

  describe("castVote", function () {
    it("13. reverts 'Election is not active' while status is Setup", async function () {
      const { contract } = await loadFixture(deployFixture);
      await createBasicElection(contract);
      await addNCandidates(contract, 1, 2);
      await expect(contract.castVote(1, 0, hashAlice)).to.be.revertedWith(
        "Election is not active"
      );
    });

    it("14. reverts 'Voting has not started' when status=Active but block.timestamp < startTime", async function () {
      const { contract } = await loadFixture(deployFixture);
      const now = await time.latest();
      const startTime = now + 1000;
      const endTime = now + 10000;
      await contract.createElection("E", "J", "T", startTime, endTime, 100);
      await addNCandidates(contract, 1, 2);
      await contract.openElection(1);
      await expect(contract.castVote(1, 0, hashAlice)).to.be.revertedWith(
        "Voting has not started"
      );
    });

    it("15. reverts 'Voting has ended' when block.timestamp > endTime", async function () {
      const { contract } = await loadFixture(deployFixture);
      const { electionId, endTime } = await createBasicElection(contract);
      await addNCandidates(contract, electionId, 2);
      await contract.openElection(electionId);
      await time.increaseTo(endTime + 100);
      await expect(contract.castVote(electionId, 0, hashAlice)).to.be.revertedWith(
        "Voting has ended"
      );
    });

    it("16. reverts 'Already voted in this election' on a second vote with the same voterHash", async function () {
      const { contract } = await loadFixture(deployFixture);
      const { electionId, startTime } = await createBasicElection(contract);
      await addNCandidates(contract, electionId, 2);
      await contract.openElection(electionId);
      await time.increaseTo(startTime + 1);
      await contract.castVote(electionId, 0, hashAlice);
      await expect(contract.castVote(electionId, 1, hashAlice)).to.be.revertedWith(
        "Already voted in this election"
      );
    });

    it("17. reverts 'Invalid candidate' for candidateIndex == length and beyond", async function () {
      const { contract } = await loadFixture(deployFixture);
      const { electionId, startTime } = await createBasicElection(contract);
      await addNCandidates(contract, electionId, 2);
      await contract.openElection(electionId);
      await time.increaseTo(startTime + 1);
      await expect(contract.castVote(electionId, 2, hashAlice)).to.be.revertedWith(
        "Invalid candidate"
      );
      await expect(contract.castVote(electionId, 99, hashAlice)).to.be.revertedWith(
        "Invalid candidate"
      );
    });

    it("18. happy path: hasVoted=true, voteCount+1, totalVotesCast+1, emits VoteCast", async function () {
      const { contract } = await loadFixture(deployFixture);
      const { electionId, startTime } = await createBasicElection(contract);
      await addNCandidates(contract, electionId, 2);
      await contract.openElection(electionId);
      const voteTs = startTime + 10;
      await time.setNextBlockTimestamp(voteTs);
      await expect(contract.castVote(electionId, 0, hashAlice))
        .to.emit(contract, "VoteCast")
        .withArgs(BigInt(electionId), BigInt(voteTs));
      expect(await contract.hasVoted(electionId, hashAlice)).to.equal(true);
      const c0 = await contract.electionCandidates(electionId, 0);
      expect(c0.voteCount).to.equal(1n);
      const e = await contract.elections(electionId);
      expect(e.totalVotesCast).to.equal(1n);
    });

    it("19. three voters voting for different candidates have independent tallies", async function () {
      const { contract } = await loadFixture(deployFixture);
      const { electionId, startTime } = await createBasicElection(contract);
      await addNCandidates(contract, electionId, 2);
      await contract.openElection(electionId);
      await time.increaseTo(startTime + 1);

      await contract.castVote(electionId, 0, hashAlice);
      await contract.castVote(electionId, 1, hashBob);
      await contract.castVote(electionId, 0, hashCarol);

      const c0 = await contract.electionCandidates(electionId, 0);
      const c1 = await contract.electionCandidates(electionId, 1);
      const e = await contract.elections(electionId);
      expect(c0.voteCount).to.equal(2n);
      expect(c1.voteCount).to.equal(1n);
      expect(e.totalVotesCast).to.equal(3n);
    });

    it("20. boundary: votes at exactly startTime and exactly endTime are accepted", async function () {
      const { contract } = await loadFixture(deployFixture);
      const { electionId, startTime, endTime } = await createBasicElection(contract);
      await addNCandidates(contract, electionId, 2);
      await contract.openElection(electionId);

      await time.setNextBlockTimestamp(startTime);
      await contract.castVote(electionId, 0, hashAlice);

      await time.setNextBlockTimestamp(endTime);
      await contract.castVote(electionId, 0, hashBob);

      const e = await contract.elections(electionId);
      expect(e.totalVotesCast).to.equal(2n);
    });
  });

  describe("closeElection", function () {
    it("21. reverts 'Election period not ended' when timestamp <= endTime", async function () {
      const { contract } = await loadFixture(deployFixture);
      const { electionId, endTime } = await createBasicElection(contract);
      await addNCandidates(contract, electionId, 2);
      await contract.openElection(electionId);
      await expect(contract.closeElection(electionId)).to.be.revertedWith(
        "Election period not ended"
      );
      await time.setNextBlockTimestamp(endTime);
      await expect(contract.closeElection(electionId)).to.be.revertedWith(
        "Election period not ended"
      );
    });

    it("22. status becomes Closed after timestamp > endTime", async function () {
      const { contract } = await loadFixture(deployFixture);
      const { electionId, endTime } = await createBasicElection(contract);
      await addNCandidates(contract, electionId, 2);
      await contract.openElection(electionId);
      await time.increaseTo(endTime + 1);
      await contract.closeElection(electionId);
      const e = await contract.elections(electionId);
      expect(e.status).to.equal(ElectionStatus.Closed);
    });

    it("23. BUG SNAPSHOT: closeElection after certifyResults regresses status Certified -> Closed", async function () {
      const { contract } = await loadFixture(deployFixture);
      const { electionId, startTime, endTime } = await createBasicElection(contract);
      await addNCandidates(contract, electionId, 2);
      await contract.openElection(electionId);
      await time.increaseTo(startTime + 1);
      await contract.castVote(electionId, 0, hashAlice);
      await time.increaseTo(endTime + 1);
      await contract.closeElection(electionId);
      await contract.certifyResults(electionId);

      let e = await contract.elections(electionId);
      expect(e.status).to.equal(ElectionStatus.Certified);
      expect(e.resultsPublic).to.equal(true);

      await contract.closeElection(electionId);
      e = await contract.elections(electionId);
      expect(e.status).to.equal(ElectionStatus.Closed);
      expect(e.resultsPublic).to.equal(true);
    });
  });

  describe("certifyResults", function () {
    it("24. reverts 'Election not closed' from Setup, Active, and already-Certified states", async function () {
      const { contract } = await loadFixture(deployFixture);
      const { electionId, endTime } = await createBasicElection(contract);

      await expect(contract.certifyResults(electionId)).to.be.revertedWith("Election not closed");

      await addNCandidates(contract, electionId, 2);
      await contract.openElection(electionId);

      await expect(contract.certifyResults(electionId)).to.be.revertedWith("Election not closed");

      await time.increaseTo(endTime + 1);
      await contract.closeElection(electionId);
      await contract.certifyResults(electionId);

      await expect(contract.certifyResults(electionId)).to.be.revertedWith("Election not closed");
    });

    it("25. sets status=Certified, resultsPublic=true; emits ElectionCertified(id, totalVotes, timestamp)", async function () {
      const { contract } = await loadFixture(deployFixture);
      const { electionId, startTime, endTime } = await createBasicElection(contract);
      await addNCandidates(contract, electionId, 2);
      await contract.openElection(electionId);
      await time.increaseTo(startTime + 1);
      await contract.castVote(electionId, 0, hashAlice);
      await contract.castVote(electionId, 1, hashBob);
      await time.increaseTo(endTime + 1);
      await contract.closeElection(electionId);

      const certifyTs = endTime + 100;
      await time.setNextBlockTimestamp(certifyTs);
      await expect(contract.certifyResults(electionId))
        .to.emit(contract, "ElectionCertified")
        .withArgs(BigInt(electionId), 2n, BigInt(certifyTs));

      const e = await contract.elections(electionId);
      expect(e.status).to.equal(ElectionStatus.Certified);
      expect(e.resultsPublic).to.equal(true);
    });
  });

  describe("view functions and phantom end-to-end", function () {
    it("26. verifyVoteCounted: true for voter who voted, false for others, false for nonexistent election", async function () {
      const { contract } = await loadFixture(deployFixture);
      const { electionId, startTime } = await createBasicElection(contract);
      await addNCandidates(contract, electionId, 2);
      await contract.openElection(electionId);
      await time.increaseTo(startTime + 1);
      await contract.castVote(electionId, 0, hashAlice);

      expect(await contract.verifyVoteCounted(electionId, hashAlice)).to.equal(true);
      expect(await contract.verifyVoteCounted(electionId, hashBob)).to.equal(false);
      expect(await contract.verifyVoteCounted(999, hashAlice)).to.equal(false);
    });

    it("27. getResults reverts before certifyResults; returns array after, with current voteCounts", async function () {
      const { contract } = await loadFixture(deployFixture);
      const { electionId, startTime, endTime } = await createBasicElection(contract);
      await addNCandidates(contract, electionId, 2);
      await contract.openElection(electionId);
      await time.increaseTo(startTime + 1);
      await contract.castVote(electionId, 0, hashAlice);
      await contract.castVote(electionId, 0, hashBob);
      await contract.castVote(electionId, 1, hashCarol);

      await expect(contract.getResults(electionId)).to.be.revertedWith("Results not yet public");

      await time.increaseTo(endTime + 1);
      await contract.closeElection(electionId);
      await contract.certifyResults(electionId);

      const results = await contract.getResults(electionId);
      expect(results.length).to.equal(2);
      expect(results[0].name).to.equal("Candidate 1");
      expect(results[0].voteCount).to.equal(2n);
      expect(results[1].name).to.equal("Candidate 2");
      expect(results[1].voteCount).to.equal(1n);
    });

    it("28. FULL PHANTOM-ELECTION ATTACK: nonexistent electionId becomes Certified with zero metadata", async function () {
      const { contract } = await loadFixture(deployFixture);
      const phantomId = 999;

      await contract.addCandidate(phantomId, "Phantom A", "Party A", "Platform A");
      await contract.addCandidate(phantomId, "Phantom B", "Party B", "Platform B");

      await contract.openElection(phantomId);
      let e = await contract.elections(phantomId);
      expect(e.status).to.equal(ElectionStatus.Active);

      await contract.closeElection(phantomId);
      e = await contract.elections(phantomId);
      expect(e.status).to.equal(ElectionStatus.Closed);

      await contract.certifyResults(phantomId);
      e = await contract.elections(phantomId);
      expect(e.status).to.equal(ElectionStatus.Certified);
      expect(e.resultsPublic).to.equal(true);

      const results = await contract.getResults(phantomId);
      expect(results.length).to.equal(2);
      expect(results[0].name).to.equal("Phantom A");
      expect(results[0].voteCount).to.equal(0n);
      expect(results[1].name).to.equal("Phantom B");
      expect(results[1].voteCount).to.equal(0n);

      const meta = await contract.getElection(phantomId);
      expect(meta.id).to.equal(0n);
      expect(meta.title).to.equal("");
      expect(meta.jurisdiction).to.equal("");
      expect(meta.startTime).to.equal(0n);
      expect(meta.endTime).to.equal(0n);
      expect(meta.registeredVoters).to.equal(0n);
      expect(meta.totalVotesCast).to.equal(0n);
      expect(meta.status).to.equal(ElectionStatus.Certified);
      expect(meta.resultsPublic).to.equal(true);

      expect(await contract.electionCount()).to.equal(0n);
    });
  });
});
