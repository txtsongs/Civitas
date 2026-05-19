// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

contract SpendingRecord {

    enum SpendingStatus {
        Approved,
        Allocated,
        Spent,
        Audited,
        Flagged
    }

    struct Expenditure {
        uint256 id;
        string department;
        string description;
        uint256 amount;
        string currency;
        address recordedBy;
        uint256 approvalDate;
        uint256 disbursementDate;
        string contractorName;
        string documentHash;
        SpendingStatus status;
        bool isFlagged;
        string flagReason;
        uint256 flagCount;
    }

    mapping(uint256 => Expenditure) public expenditures;
    mapping(uint256 => mapping(address => bool)) public hasFlagged;
    uint256 public expenditureCount;
    uint256 public totalRecorded;

    event ExpenditureRecorded(uint256 id, string department, uint256 amount, string contractorName);
    event ExpenditureFlagged(uint256 id, string reason, address flaggedBy);
    event ExpenditureAudited(uint256 id, address auditedBy);

    function recordExpenditure(
        string memory _department,
        string memory _description,
        uint256 _amount,
        string memory _contractorName,
        string memory _documentHash
    ) public returns (uint256) {
        expenditureCount++;
        totalRecorded += _amount;
        expenditures[expenditureCount] = Expenditure({
            id: expenditureCount,
            department: _department,
            description: _description,
            amount: _amount,
            currency: "CAD",
            recordedBy: msg.sender,
            approvalDate: block.timestamp,
            disbursementDate: 0,
            contractorName: _contractorName,
            documentHash: _documentHash,
            status: SpendingStatus.Approved,
            isFlagged: false,
            flagReason: "",
            flagCount: 0
        });
        emit ExpenditureRecorded(expenditureCount, _department, _amount, _contractorName);
        return expenditureCount;
    }

    function flagExpenditure(uint256 _id, string memory _reason) public {
        require(expenditures[_id].id != 0, "Expenditure does not exist");
        require(!hasFlagged[_id][msg.sender], "Already flagged this expenditure");
        hasFlagged[_id][msg.sender] = true;
        expenditures[_id].flagCount++;
        expenditures[_id].isFlagged = true;
        expenditures[_id].flagReason = _reason;
        expenditures[_id].status = SpendingStatus.Flagged;
        emit ExpenditureFlagged(_id, _reason, msg.sender);
    }

    function markDisbursed(uint256 _id) public {
        require(expenditures[_id].id != 0, "Expenditure does not exist");
        expenditures[_id].disbursementDate = block.timestamp;
        expenditures[_id].status = SpendingStatus.Spent;
    }

    function markAudited(uint256 _id) public {
        require(expenditures[_id].id != 0, "Expenditure does not exist");
        expenditures[_id].status = SpendingStatus.Audited;
        emit ExpenditureAudited(_id, msg.sender);
    }

    function getExpenditure(uint256 _id) public view returns (Expenditure memory) {
        require(expenditures[_id].id != 0, "Expenditure does not exist");
        return expenditures[_id];
    }
}
