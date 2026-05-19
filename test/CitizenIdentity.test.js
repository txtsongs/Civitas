const { expect } = require("chai");
const { loadFixture, time } = require("@nomicfoundation/hardhat-network-helpers");
const { ethers } = require("hardhat");

describe("CitizenIdentity", function () {
  async function deployFixture() {
    const [deployer, otherUser, registrar] = await ethers.getSigners();
    const CitizenIdentity = await ethers.getContractFactory("CitizenIdentity");
    const contract = await CitizenIdentity.deploy();
    return { contract, deployer, otherUser, registrar };
  }

  const hashAlice = ethers.id("alice-property-101");
  const hashBob = ethers.id("bob-property-202");
  const ZERO_HASH = ethers.ZeroHash;
  const JURISDICTION = "Maple Ridge Strata #1234";

  describe("verifyCitizen", function () {
    it("1. stores identityHash and jurisdiction on a happy-path call", async function () {
      const { contract } = await loadFixture(deployFixture);
      await contract.verifyCitizen(hashAlice, JURISDICTION);
      const c = await contract.citizens(hashAlice);
      expect(c.identityHash).to.equal(hashAlice);
      expect(c.jurisdiction).to.equal(JURISDICTION);
    });

    it("2. sets isVerified=true, verifiedDate=block.timestamp, participationCount=0, reputationScore=100", async function () {
      const { contract } = await loadFixture(deployFixture);
      const tx = await contract.verifyCitizen(hashAlice, JURISDICTION);
      const receipt = await tx.wait();
      const block = await ethers.provider.getBlock(receipt.blockNumber);
      const c = await contract.citizens(hashAlice);
      expect(c.isVerified).to.equal(true);
      expect(c.verifiedDate).to.equal(block.timestamp);
      expect(c.participationCount).to.equal(0n);
      expect(c.reputationScore).to.equal(100n);
    });

    it("3. emits CitizenVerified with (hash, jurisdiction, timestamp)", async function () {
      const { contract } = await loadFixture(deployFixture);
      const expectedTimestamp = (await time.latest()) + 60;
      await time.setNextBlockTimestamp(expectedTimestamp);
      await expect(contract.verifyCitizen(hashAlice, JURISDICTION))
        .to.emit(contract, "CitizenVerified")
        .withArgs(hashAlice, JURISDICTION, expectedTimestamp);
    });

    it("4. reverts with 'Already verified' on duplicate hash", async function () {
      const { contract } = await loadFixture(deployFixture);
      await contract.verifyCitizen(hashAlice, JURISDICTION);
      await expect(contract.verifyCitizen(hashAlice, JURISDICTION))
        .to.be.revertedWith("Already verified");
    });

    it("5. accepts two different hashes independently", async function () {
      const { contract } = await loadFixture(deployFixture);
      await contract.verifyCitizen(hashAlice, "Jurisdiction A");
      await contract.verifyCitizen(hashBob, "Jurisdiction B");
      const a = await contract.citizens(hashAlice);
      const b = await contract.citizens(hashBob);
      expect(a.isVerified).to.equal(true);
      expect(a.jurisdiction).to.equal("Jurisdiction A");
      expect(b.isVerified).to.equal(true);
      expect(b.jurisdiction).to.equal("Jurisdiction B");
    });

    it("6. allows empty jurisdiction string and bytes32(0) hash (behavior snapshot)", async function () {
      const { contract } = await loadFixture(deployFixture);
      await contract.verifyCitizen(hashAlice, "");
      const a = await contract.citizens(hashAlice);
      expect(a.jurisdiction).to.equal("");
      expect(a.isVerified).to.equal(true);

      await contract.verifyCitizen(ZERO_HASH, JURISDICTION);
      const z = await contract.citizens(ZERO_HASH);
      expect(z.isVerified).to.equal(true);
    });
  });

  describe("recordParticipation", function () {
    it("7. reverts with 'Citizen not verified' for an unverified hash", async function () {
      const { contract } = await loadFixture(deployFixture);
      await expect(contract.recordParticipation(hashAlice))
        .to.be.revertedWith("Citizen not verified");
    });

    it("8. increments participationCount by exactly 1 per call", async function () {
      const { contract } = await loadFixture(deployFixture);
      await contract.verifyCitizen(hashAlice, JURISDICTION);
      await contract.recordParticipation(hashAlice);
      const c = await contract.citizens(hashAlice);
      expect(c.participationCount).to.equal(1n);
    });

    it("9. increases reputationScore by exactly 5 per call", async function () {
      const { contract } = await loadFixture(deployFixture);
      await contract.verifyCitizen(hashAlice, JURISDICTION);
      await contract.recordParticipation(hashAlice);
      const c = await contract.citizens(hashAlice);
      expect(c.reputationScore).to.equal(105n);
    });

    it("10. emits ParticipationRecorded(hash, newCount) with post-increment count", async function () {
      const { contract } = await loadFixture(deployFixture);
      await contract.verifyCitizen(hashAlice, JURISDICTION);
      await expect(contract.recordParticipation(hashAlice))
        .to.emit(contract, "ParticipationRecorded")
        .withArgs(hashAlice, 1n);
    });

    it("11. three calls produce count=3, score=115; multiple citizens' counters are independent", async function () {
      const { contract } = await loadFixture(deployFixture);
      await contract.verifyCitizen(hashAlice, JURISDICTION);
      await contract.verifyCitizen(hashBob, JURISDICTION);
      await contract.recordParticipation(hashAlice);
      await contract.recordParticipation(hashAlice);
      await contract.recordParticipation(hashAlice);
      const a = await contract.citizens(hashAlice);
      const b = await contract.citizens(hashBob);
      expect(a.participationCount).to.equal(3n);
      expect(a.reputationScore).to.equal(115n);
      expect(b.participationCount).to.equal(0n);
      expect(b.reputationScore).to.equal(100n);
    });
  });

  describe("isVerifiedCitizen", function () {
    it("12. returns false for any random/unset hash, including bytes32(0)", async function () {
      const { contract } = await loadFixture(deployFixture);
      expect(await contract.isVerifiedCitizen(hashAlice)).to.equal(false);
      expect(await contract.isVerifiedCitizen(ZERO_HASH)).to.equal(false);
    });

    it("13. returns true after verifyCitizen succeeds", async function () {
      const { contract } = await loadFixture(deployFixture);
      await contract.verifyCitizen(hashAlice, JURISDICTION);
      expect(await contract.isVerifiedCitizen(hashAlice)).to.equal(true);
    });
  });

  describe("getCitizen", function () {
    it("14. reverts with 'Citizen not found' for unverified hash", async function () {
      const { contract } = await loadFixture(deployFixture);
      await expect(contract.getCitizen(hashAlice))
        .to.be.revertedWith("Citizen not found");
    });

    it("15. returns full struct matching all 6 fields after verification", async function () {
      const { contract } = await loadFixture(deployFixture);
      const tx = await contract.verifyCitizen(hashAlice, JURISDICTION);
      const receipt = await tx.wait();
      const block = await ethers.provider.getBlock(receipt.blockNumber);
      const c = await contract.getCitizen(hashAlice);
      expect(c.identityHash).to.equal(hashAlice);
      expect(c.jurisdiction).to.equal(JURISDICTION);
      expect(c.isVerified).to.equal(true);
      expect(c.verifiedDate).to.equal(block.timestamp);
      expect(c.participationCount).to.equal(0n);
      expect(c.reputationScore).to.equal(100n);
    });

    it("16. reflects updated count and score after participations", async function () {
      const { contract } = await loadFixture(deployFixture);
      await contract.verifyCitizen(hashAlice, JURISDICTION);
      await contract.recordParticipation(hashAlice);
      await contract.recordParticipation(hashAlice);
      const c = await contract.getCitizen(hashAlice);
      expect(c.participationCount).to.equal(2n);
      expect(c.reputationScore).to.equal(110n);
    });
  });

  describe("cross-cutting", function () {
    it("17. recordParticipation can be called by a non-verifier (open-access by design)", async function () {
      const { contract, deployer, otherUser } = await loadFixture(deployFixture);
      await contract.connect(deployer).verifyCitizen(hashAlice, JURISDICTION);
      await expect(contract.connect(otherUser).recordParticipation(hashAlice))
        .to.not.be.reverted;
      const c = await contract.citizens(hashAlice);
      expect(c.participationCount).to.equal(1n);
    });
  });
});
