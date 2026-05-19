// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

contract CitizenIdentity {

    struct Citizen {
        bytes32 identityHash;
        string jurisdiction;
        bool isVerified;
        uint256 verifiedDate;
        uint256 participationCount;
        uint256 reputationScore;
    }

    mapping(bytes32 => Citizen) public citizens;

    event CitizenVerified(bytes32 identityHash, string jurisdiction, uint256 timestamp);
    event ParticipationRecorded(bytes32 identityHash, uint256 newCount);

    function verifyCitizen(
        bytes32 _identityHash,
        string memory _jurisdiction
    ) public {
        require(!citizens[_identityHash].isVerified, "Already verified");
        citizens[_identityHash] = Citizen({
            identityHash: _identityHash,
            jurisdiction: _jurisdiction,
            isVerified: true,
            verifiedDate: block.timestamp,
            participationCount: 0,
            reputationScore: 100
        });
        emit CitizenVerified(_identityHash, _jurisdiction, block.timestamp);
    }

    function recordParticipation(bytes32 _identityHash) public {
        require(citizens[_identityHash].isVerified, "Citizen not verified");
        citizens[_identityHash].participationCount++;
        citizens[_identityHash].reputationScore += 5;
        emit ParticipationRecorded(_identityHash, citizens[_identityHash].participationCount);
    }

    function isVerifiedCitizen(bytes32 _identityHash) public view returns (bool) {
        return citizens[_identityHash].isVerified;
    }

    function getCitizen(bytes32 _identityHash) public view returns (Citizen memory) {
        require(citizens[_identityHash].isVerified, "Citizen not found");
        return citizens[_identityHash];
    }
}
