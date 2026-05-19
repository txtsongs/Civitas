const { expect } = require("chai");
const { loadFixture, time } = require("@nomicfoundation/hardhat-network-helpers");
const { ethers } = require("hardhat");

const SpendingStatus = {
  Approved: 0n,
  Allocated: 1n,
  Spent: 2n,
  Audited: 3n,
  Flagged: 4n,
};

const SAMPLE = {
  department: "Public Works",
  description: "Sidewalk repair, blocks 100-150",
  amount: 25_000n,
  contractorName: "Acme Concrete Inc.",
  documentHash: "ipfs://bafy-invoice-001",
};

async function deployFixture() {
  const signers = await ethers.getSigners();
  const SpendingRecord = await ethers.getContractFactory("SpendingRecord");
  const contract = await SpendingRecord.deploy();
  return { contract, signers };
}

async function record(contract, signer, overrides = {}) {
  const params = { ...SAMPLE, ...overrides };
  const c = signer ? contract.connect(signer) : contract;
  return c.recordExpenditure(
    params.department,
    params.description,
    params.amount,
    params.contractorName,
    params.documentHash
  );
}

describe("SpendingRecord", function () {
  describe("recordExpenditure", function () {
    it("1. counters start at 0; first record returns id 1 and updates counters", async function () {
      const { contract } = await loadFixture(deployFixture);
      expect(await contract.expenditureCount()).to.equal(0n);
      expect(await contract.totalRecorded()).to.equal(0n);
      const id = await contract.recordExpenditure.staticCall(
        SAMPLE.department,
        SAMPLE.description,
        SAMPLE.amount,
        SAMPLE.contractorName,
        SAMPLE.documentHash
      );
      expect(id).to.equal(1n);
      await record(contract);
      expect(await contract.expenditureCount()).to.equal(1n);
      expect(await contract.totalRecorded()).to.equal(SAMPLE.amount);
    });

    it("2. stores all 14 struct fields correctly", async function () {
      const { contract, signers } = await loadFixture(deployFixture);
      const tx = await record(contract, signers[0]);
      const receipt = await tx.wait();
      const block = await ethers.provider.getBlock(receipt.blockNumber);
      const e = await contract.expenditures(1);
      expect(e.id).to.equal(1n);
      expect(e.department).to.equal(SAMPLE.department);
      expect(e.description).to.equal(SAMPLE.description);
      expect(e.amount).to.equal(SAMPLE.amount);
      expect(e.currency).to.equal("CAD");
      expect(e.recordedBy).to.equal(signers[0].address);
      expect(e.approvalDate).to.equal(BigInt(block.timestamp));
      expect(e.disbursementDate).to.equal(0n);
      expect(e.contractorName).to.equal(SAMPLE.contractorName);
      expect(e.documentHash).to.equal(SAMPLE.documentHash);
      expect(e.status).to.equal(SpendingStatus.Approved);
      expect(e.isFlagged).to.equal(false);
      expect(e.flagReason).to.equal("");
      expect(e.flagCount).to.equal(0n);
    });

    it("3. emits ExpenditureRecorded(id, department, amount, contractorName)", async function () {
      const { contract } = await loadFixture(deployFixture);
      await expect(record(contract))
        .to.emit(contract, "ExpenditureRecorded")
        .withArgs(1n, SAMPLE.department, SAMPLE.amount, SAMPLE.contractorName);
    });

    it("4. three records from three senders: ids 1/2/3, totalRecorded sums, recordedBy per-sender", async function () {
      const { contract, signers } = await loadFixture(deployFixture);
      await record(contract, signers[0], { amount: 100n });
      await record(contract, signers[1], { amount: 200n });
      await record(contract, signers[2], { amount: 300n });
      expect(await contract.expenditureCount()).to.equal(3n);
      expect(await contract.totalRecorded()).to.equal(600n);
      const e1 = await contract.expenditures(1);
      const e2 = await contract.expenditures(2);
      const e3 = await contract.expenditures(3);
      expect(e1.recordedBy).to.equal(signers[0].address);
      expect(e2.recordedBy).to.equal(signers[1].address);
      expect(e3.recordedBy).to.equal(signers[2].address);
      expect(e1.amount).to.equal(100n);
      expect(e2.amount).to.equal(200n);
      expect(e3.amount).to.equal(300n);
    });

    it("5. zero amount, hardcoded CAD, and empty strings accepted (snapshot)", async function () {
      const { contract, signers } = await loadFixture(deployFixture);
      await record(contract, signers[1], {
        department: "",
        description: "",
        amount: 0n,
        contractorName: "",
        documentHash: "",
      });
      const e = await contract.expenditures(1);
      expect(e.amount).to.equal(0n);
      expect(e.currency).to.equal("CAD");
      expect(e.department).to.equal("");
      expect(e.description).to.equal("");
      expect(e.contractorName).to.equal("");
      expect(e.documentHash).to.equal("");
      expect(e.status).to.equal(SpendingStatus.Approved);
      expect(await contract.totalRecorded()).to.equal(0n);
    });
  });

  describe("flagExpenditure", function () {
    it("6. reverts 'Expenditure does not exist' for id 0 and an out-of-range id", async function () {
      const { contract } = await loadFixture(deployFixture);
      await record(contract);
      await expect(contract.flagExpenditure(0, "r")).to.be.revertedWith("Expenditure does not exist");
      await expect(contract.flagExpenditure(999, "r")).to.be.revertedWith("Expenditure does not exist");
    });

    it("7. reverts 'Already flagged this expenditure' on a second flag from the same address", async function () {
      const { contract, signers } = await loadFixture(deployFixture);
      await record(contract);
      await contract.connect(signers[1]).flagExpenditure(1, "first");
      await expect(contract.connect(signers[1]).flagExpenditure(1, "second"))
        .to.be.revertedWith("Already flagged this expenditure");
    });

    it("8. hasFlagged[id][flagger] flips to true; remains false for non-flaggers", async function () {
      const { contract, signers } = await loadFixture(deployFixture);
      await record(contract);
      expect(await contract.hasFlagged(1, signers[1].address)).to.equal(false);
      expect(await contract.hasFlagged(1, signers[2].address)).to.equal(false);
      await contract.connect(signers[1]).flagExpenditure(1, "r");
      expect(await contract.hasFlagged(1, signers[1].address)).to.equal(true);
      expect(await contract.hasFlagged(1, signers[2].address)).to.equal(false);
    });

    it("9. first flag sets flagCount=1, isFlagged=true, flagReason, status=Flagged; emits event", async function () {
      const { contract, signers } = await loadFixture(deployFixture);
      await record(contract);
      await expect(contract.connect(signers[1]).flagExpenditure(1, "Suspicious"))
        .to.emit(contract, "ExpenditureFlagged")
        .withArgs(1n, "Suspicious", signers[1].address);
      const e = await contract.expenditures(1);
      expect(e.flagCount).to.equal(1n);
      expect(e.isFlagged).to.equal(true);
      expect(e.flagReason).to.equal("Suspicious");
      expect(e.status).to.equal(SpendingStatus.Flagged);
    });

    it("10. three distinct flaggers: flagCount=3, flagReason==latest, status stays Flagged", async function () {
      const { contract, signers } = await loadFixture(deployFixture);
      await record(contract);
      await contract.connect(signers[1]).flagExpenditure(1, "reason-1");
      await contract.connect(signers[2]).flagExpenditure(1, "reason-2");
      await contract.connect(signers[3]).flagExpenditure(1, "reason-3");
      const e = await contract.expenditures(1);
      expect(e.flagCount).to.equal(3n);
      expect(e.flagReason).to.equal("reason-3");
      expect(e.isFlagged).to.equal(true);
      expect(e.status).to.equal(SpendingStatus.Flagged);
    });
  });

  describe("markDisbursed", function () {
    it("11. reverts 'Expenditure does not exist' for id 0 and an out-of-range id", async function () {
      const { contract } = await loadFixture(deployFixture);
      await record(contract);
      await expect(contract.markDisbursed(0)).to.be.revertedWith("Expenditure does not exist");
      await expect(contract.markDisbursed(999)).to.be.revertedWith("Expenditure does not exist");
    });

    it("12. sets disbursementDate=block.timestamp, status=Spent; emits no event", async function () {
      const { contract } = await loadFixture(deployFixture);
      await record(contract);
      const tx = await contract.markDisbursed(1);
      const receipt = await tx.wait();
      const block = await ethers.provider.getBlock(receipt.blockNumber);
      const contractLogs = receipt.logs.filter(
        (l) => l.address.toLowerCase() === contract.target.toLowerCase()
      );
      expect(contractLogs.length).to.equal(0);
      const e = await contract.expenditures(1);
      expect(e.disbursementDate).to.equal(BigInt(block.timestamp));
      expect(e.status).to.equal(SpendingStatus.Spent);
    });

    it("13. callable on Flagged state; status flips to Spent while isFlagged & flagCount persist", async function () {
      const { contract, signers } = await loadFixture(deployFixture);
      await record(contract);
      await contract.connect(signers[1]).flagExpenditure(1, "concern");
      let e = await contract.expenditures(1);
      expect(e.status).to.equal(SpendingStatus.Flagged);
      expect(e.isFlagged).to.equal(true);
      expect(e.flagCount).to.equal(1n);

      await contract.markDisbursed(1);
      e = await contract.expenditures(1);
      expect(e.status).to.equal(SpendingStatus.Spent);
      expect(e.isFlagged).to.equal(true);
      expect(e.flagCount).to.equal(1n);
      expect(e.flagReason).to.equal("concern");
      const firstDisburseDate = e.disbursementDate;
      expect(firstDisburseDate).to.be.greaterThan(0n);

      await time.increase(60);
      await contract.markDisbursed(1);
      e = await contract.expenditures(1);
      expect(e.disbursementDate).to.be.greaterThan(firstDisburseDate);
    });
  });

  describe("markAudited", function () {
    it("14. reverts 'Expenditure does not exist' for id 0 and an out-of-range id", async function () {
      const { contract } = await loadFixture(deployFixture);
      await record(contract);
      await expect(contract.markAudited(0)).to.be.revertedWith("Expenditure does not exist");
      await expect(contract.markAudited(999)).to.be.revertedWith("Expenditure does not exist");
    });

    it("15. sets status=Audited and emits ExpenditureAudited; callable on Flagged (washes status)", async function () {
      const { contract, signers } = await loadFixture(deployFixture);
      await record(contract);
      await contract.connect(signers[1]).flagExpenditure(1, "concern");

      await expect(contract.connect(signers[5]).markAudited(1))
        .to.emit(contract, "ExpenditureAudited")
        .withArgs(1n, signers[5].address);
      const e = await contract.expenditures(1);
      expect(e.status).to.equal(SpendingStatus.Audited);
      expect(e.isFlagged).to.equal(true);
      expect(e.flagCount).to.equal(1n);
    });
  });

  describe("getExpenditure", function () {
    it("16. reverts 'Expenditure does not exist' for id 0 and an out-of-range id", async function () {
      const { contract } = await loadFixture(deployFixture);
      await record(contract);
      await expect(contract.getExpenditure(0)).to.be.revertedWith("Expenditure does not exist");
      await expect(contract.getExpenditure(999)).to.be.revertedWith("Expenditure does not exist");
    });

    it("17. returns full struct after a flag -> disburse -> audit sequence", async function () {
      const { contract, signers } = await loadFixture(deployFixture);
      const tx = await record(contract, signers[0]);
      const receipt = await tx.wait();
      const block = await ethers.provider.getBlock(receipt.blockNumber);

      await contract.connect(signers[1]).flagExpenditure(1, "Suspicious");
      await contract.markDisbursed(1);
      await contract.markAudited(1);

      const e = await contract.getExpenditure(1);
      expect(e.id).to.equal(1n);
      expect(e.department).to.equal(SAMPLE.department);
      expect(e.amount).to.equal(SAMPLE.amount);
      expect(e.currency).to.equal("CAD");
      expect(e.recordedBy).to.equal(signers[0].address);
      expect(e.approvalDate).to.equal(BigInt(block.timestamp));
      expect(e.disbursementDate).to.be.greaterThan(0n);
      expect(e.status).to.equal(SpendingStatus.Audited);
      expect(e.isFlagged).to.equal(true);
      expect(e.flagReason).to.equal("Suspicious");
      expect(e.flagCount).to.equal(1n);
    });
  });

  describe("cross-cutting", function () {
    it("18. no state-machine enforcement: Approved -> Spent -> Audited -> Flagged -> Spent", async function () {
      const { contract, signers } = await loadFixture(deployFixture);
      await record(contract);

      await contract.markDisbursed(1);
      let e = await contract.expenditures(1);
      expect(e.status).to.equal(SpendingStatus.Spent);

      await contract.markAudited(1);
      e = await contract.expenditures(1);
      expect(e.status).to.equal(SpendingStatus.Audited);

      await contract.connect(signers[1]).flagExpenditure(1, "concern");
      e = await contract.expenditures(1);
      expect(e.status).to.equal(SpendingStatus.Flagged);
      expect(e.isFlagged).to.equal(true);
      expect(e.flagCount).to.equal(1n);

      await time.increase(60);
      await contract.markDisbursed(1);
      e = await contract.expenditures(1);
      expect(e.status).to.equal(SpendingStatus.Spent);
      expect(e.isFlagged).to.equal(true);
      expect(e.flagCount).to.equal(1n);
      expect(e.disbursementDate).to.be.greaterThan(0n);
    });

    it("19. totalRecorded only accumulates: 100 + 200 + 300 = 600, never decremented", async function () {
      const { contract, signers } = await loadFixture(deployFixture);
      await record(contract, signers[0], { amount: 100n });
      expect(await contract.totalRecorded()).to.equal(100n);
      await record(contract, signers[0], { amount: 200n });
      expect(await contract.totalRecorded()).to.equal(300n);
      await record(contract, signers[0], { amount: 300n });
      expect(await contract.totalRecorded()).to.equal(600n);

      await contract.markDisbursed(1);
      await contract.markAudited(1);
      await contract.connect(signers[1]).flagExpenditure(1, "r");
      expect(await contract.totalRecorded()).to.equal(600n);
    });

    it("20. open-access design: a non-recorder can flag, markDisbursed, markAudited", async function () {
      const { contract, signers } = await loadFixture(deployFixture);
      await record(contract, signers[0]);
      await expect(contract.connect(signers[5]).flagExpenditure(1, "from stranger")).to.not.be.reverted;
      await expect(contract.connect(signers[5]).markDisbursed(1)).to.not.be.reverted;
      await expect(contract.connect(signers[5]).markAudited(1)).to.not.be.reverted;
      const e = await contract.expenditures(1);
      expect(e.flagCount).to.equal(1n);
      expect(e.status).to.equal(SpendingStatus.Audited);
    });
  });
});
