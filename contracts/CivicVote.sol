// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

contract CivicVote {

    enum ElectionStatus {
        Setup,
        Active,
        Closed,
        Tallied,
        Certified
    }

    struct Candidate {
        uint256 id;
        string name;
        string party;
        string platform;
        uint256 voteCount;
    }

    struct Election {
        uint256 id;
        string title;
        string jurisdiction;
        string electionType;
        uint256 startTime;
        uint256 endTime;
        uint256 totalVotesCast;
        uint256 registeredVoters;
        ElectionStatus status;
        bool resultsPublic;
    }

    mapping(uint256 => Election) public elections;
    mapping(uint256 => Candidate[]) public electionCandidates;
    mapping(uint256 => mapping(bytes32 => bool)) public hasVoted;
    uint256 public electionCount;

    event ElectionCreated(uint256 id, string title, string jurisdiction, uint256 startTime, uint256 endTime);
    event VoteCast(uint256 electionId, uint256 timestamp);
    event ElectionCertified(uint256 electionId, uint256 totalVotes, uint256 timestamp);

    function createElection(
        string memory _title,
        string memory _jurisdiction,
        string memory _electionType,
        uint256 _startTime,
        uint256 _endTime,
        uint256 _registeredVoters
    ) public returns (uint256) {
        require(_endTime > _startTime, "End time must be after start");
        require(_startTime > block.timestamp, "Start time must be in future");
        electionCount++;
        elections[electionCount] = Election({
            id: electionCount,
            title: _title,
            jurisdiction: _jurisdiction,
            electionType: _electionType,
            startTime: _startTime,
            endTime: _endTime,
            totalVotesCast: 0,
            registeredVoters: _registeredVoters,
            status: ElectionStatus.Setup,
            resultsPublic: false
        });
        emit ElectionCreated(electionCount, _title, _jurisdiction, _startTime, _endTime);
        return electionCount;
    }

    function addCandidate(
        uint256 _electionId,
        string memory _name,
        string memory _party,
        string memory _platform
    ) public {
        require(elections[_electionId].status == ElectionStatus.Setup, "Election already started");
        uint256 candidateId = electionCandidates[_electionId].length + 1;
        electionCandidates[_electionId].push(Candidate({
            id: candidateId,
            name: _name,
            party: _party,
            platform: _platform,
            voteCount: 0
        }));
    }

    function openElection(uint256 _electionId) public {
        require(elections[_electionId].status == ElectionStatus.Setup, "Not in setup");
        require(electionCandidates[_electionId].length > 1, "Need at least 2 candidates");
        elections[_electionId].status = ElectionStatus.Active;
    }

    function castVote(
        uint256 _electionId,
        uint256 _candidateIndex,
        bytes32 _voterHash
    ) public {
        Election storage election = elections[_electionId];
        require(election.status == ElectionStatus.Active, "Election is not active");
        require(block.timestamp >= election.startTime, "Voting has not started");
        require(block.timestamp <= election.endTime, "Voting has ended");
        require(!hasVoted[_electionId][_voterHash], "Already voted in this election");
        require(_candidateIndex < electionCandidates[_electionId].length, "Invalid candidate");
        hasVoted[_electionId][_voterHash] = true;
        electionCandidates[_electionId][_candidateIndex].voteCount++;
        election.totalVotesCast++;
        emit VoteCast(_electionId, block.timestamp);
    }

    function closeElection(uint256 _electionId) public {
        require(block.timestamp > elections[_electionId].endTime, "Election period not ended");
        elections[_electionId].status = ElectionStatus.Closed;
    }

    function certifyResults(uint256 _electionId) public {
        require(elections[_electionId].status == ElectionStatus.Closed, "Election not closed");
        elections[_electionId].status = ElectionStatus.Certified;
        elections[_electionId].resultsPublic = true;
        emit ElectionCertified(_electionId, elections[_electionId].totalVotesCast, block.timestamp);
    }

    function verifyVoteCounted(uint256 _electionId, bytes32 _voterHash) public view returns (bool) {
        return hasVoted[_electionId][_voterHash];
    }

    function getResults(uint256 _electionId) public view returns (Candidate[] memory) {
        require(elections[_electionId].resultsPublic, "Results not yet public");
        return electionCandidates[_electionId];
    }

    function getElection(uint256 _id) public view returns (Election memory) {
        return elections[_id];
    }
}
