// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IElectionState {
    function status() external view returns (uint8);
    function closesAt() external view returns (uint64);
}

contract BallotBox {
    struct Ballot {
        bytes32 ballotId;
        bytes32 nullifierHash;
        bytes32 ciphertextHash;
        bytes32 proofHash;
        uint64 sequence;
        uint64 submittedAt;
        bool superseded;
    }

    address public immutable election;
    mapping(bytes32 => uint64) public latestSequence;
    mapping(bytes32 => bytes32) public latestBallotId;
    mapping(bytes32 => Ballot[]) private ballotsByNullifier;

    event EncryptedBallotSubmitted(
        bytes32 indexed ballotId,
        bytes32 indexed nullifierHash,
        bytes32 ciphertextHash,
        bytes32 proofHash,
        uint64 sequence
    );
    event BallotSuperseded(bytes32 indexed nullifierHash, bytes32 indexed ballotId, uint64 sequence);

    constructor(address electionAddress) {
        require(electionAddress != address(0), "election required");
        election = electionAddress;
    }

    function submitEncryptedBallot(
        bytes32 ballotId,
        bytes32 nullifierHash,
        bytes32 ciphertextHash,
        bytes32 proofHash,
        uint64 sequence
    ) external {
        require(IElectionState(election).status() == 1, "election is not open");
        require(block.timestamp < IElectionState(election).closesAt(), "election is closed");
        require(ballotId != bytes32(0) && nullifierHash != bytes32(0), "ballot identity required");
        require(ciphertextHash != bytes32(0) && proofHash != bytes32(0), "encrypted ballot required");
        require(sequence > latestSequence[nullifierHash], "sequence must increase");

        uint256 priorLength = ballotsByNullifier[nullifierHash].length;
        if (priorLength > 0) {
            ballotsByNullifier[nullifierHash][priorLength - 1].superseded = true;
            emit BallotSuperseded(nullifierHash, latestBallotId[nullifierHash], latestSequence[nullifierHash]);
        }
        ballotsByNullifier[nullifierHash].push(Ballot({
            ballotId: ballotId,
            nullifierHash: nullifierHash,
            ciphertextHash: ciphertextHash,
            proofHash: proofHash,
            sequence: sequence,
            submittedAt: uint64(block.timestamp),
            superseded: false
        }));
        latestSequence[nullifierHash] = sequence;
        latestBallotId[nullifierHash] = ballotId;
        emit EncryptedBallotSubmitted(ballotId, nullifierHash, ciphertextHash, proofHash, sequence);
    }

    function getBallotCount(bytes32 nullifierHash) external view returns (uint256) {
        return ballotsByNullifier[nullifierHash].length;
    }

    function getBallot(bytes32 nullifierHash, uint256 index) external view returns (Ballot memory) {
        require(index < ballotsByNullifier[nullifierHash].length, "ballot does not exist");
        return ballotsByNullifier[nullifierHash][index];
    }
}
