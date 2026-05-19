// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

contract PromiseRegistry {

    enum PromiseStatus {
        Active,
        Kept,
        Broken,
        InProgress,
        Expired
    }

    struct Promise {
        uint256 id;
        string politician;
        string party;
        string promiseText;
        string sourceUrl;
        string category;
        uint256 dateRecorded;
        uint256 deadline;
        uint256 keptVotes;
        uint256 brokenVotes;
        string evidenceHash;
        PromiseStatus status;
    }

    mapping(uint256 => Promise) public promises;
    mapping(uint256 => mapping(address => bool)) public hasVoted;
    uint256 public promiseCount;

    event PromiseRecorded(uint256 id, string politician, string promiseText, uint256 dateRecorded);
    event PromiseVoted(uint256 id, bool keptVote, uint256 newKeptCount, uint256 newBrokenCount);
    event StatusUpdated(uint256 id, PromiseStatus newStatus);

    function recordPromise(
        string memory _politician,
        string memory _party,
        string memory _promiseText,
        string memory _sourceUrl,
        string memory _category,
        uint256 _deadline,
        string memory _evidenceHash
    ) public returns (uint256) {
        promiseCount++;
        promises[promiseCount] = Promise({
            id: promiseCount,
            politician: _politician,
            party: _party,
            promiseText: _promiseText,
            sourceUrl: _sourceUrl,
            category: _category,
            dateRecorded: block.timestamp,
            deadline: _deadline,
            keptVotes: 0,
            brokenVotes: 0,
            evidenceHash: _evidenceHash,
            status: PromiseStatus.Active
        });
        emit PromiseRecorded(promiseCount, _politician, _promiseText, block.timestamp);
        return promiseCount;
    }

    function voteOnPromise(uint256 _id, bool _wasKept, string memory _evidenceHash) public {
        require(promises[_id].id != 0, "Promise does not exist");
        require(!hasVoted[_id][msg.sender], "Already voted on this promise");
        hasVoted[_id][msg.sender] = true;
        if (_wasKept) {
            promises[_id].keptVotes++;
        } else {
            promises[_id].brokenVotes++;
        }
        promises[_id].evidenceHash = _evidenceHash;
        _updateStatus(_id);
        emit PromiseVoted(_id, _wasKept, promises[_id].keptVotes, promises[_id].brokenVotes);
    }

    function _updateStatus(uint256 _id) internal {
        Promise storage p = promises[_id];
        uint256 totalVotes = p.keptVotes + p.brokenVotes;
        if (totalVotes < 10) return;
        uint256 keptPercentage = (p.keptVotes * 100) / totalVotes;
        if (keptPercentage >= 70) {
            p.status = PromiseStatus.Kept;
        } else if (keptPercentage <= 30) {
            p.status = PromiseStatus.Broken;
        }
        if (block.timestamp > p.deadline && p.status == PromiseStatus.Active) {
            p.status = PromiseStatus.Expired;
        }
        emit StatusUpdated(_id, p.status);
    }

    function getPromise(uint256 _id) public view returns (Promise memory) {
        require(promises[_id].id != 0, "Promise does not exist");
        return promises[_id];
    }
}
