// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract EncryptedBallotRegistry {
    struct BallotReceipt {
        bytes32 pollId;
        bytes32 ballotId;
        bytes32 nullifierHash;
        bytes32 ballotCiphertextHash;
        uint256 timestamp;
        address submitter;
    }

    event EncryptedBallotSubmitted(
        bytes32 indexed pollId,
        bytes32 indexed nullifierHash,
        bytes32 indexed ballotId,
        bytes32 ballotCiphertextHash,
        address submitter,
        uint256 timestamp
    );

    mapping(bytes32 => mapping(bytes32 => bool)) public usedNullifiers;
    mapping(bytes32 => BallotReceipt[]) private pollReceipts;

    function submitEncryptedBallotReceipt(
        bytes32 pollId,
        bytes32 ballotId,
        bytes32 nullifierHash,
        bytes32 ballotCiphertextHash
    ) external {
        require(pollId != bytes32(0), "pollId required");
        require(ballotId != bytes32(0), "ballotId required");
        require(nullifierHash != bytes32(0), "nullifierHash required");
        require(ballotCiphertextHash != bytes32(0), "ciphertext hash required");
        require(!usedNullifiers[pollId][nullifierHash], "nullifier already used");

        usedNullifiers[pollId][nullifierHash] = true;
        pollReceipts[pollId].push(BallotReceipt({
            pollId: pollId,
            ballotId: ballotId,
            nullifierHash: nullifierHash,
            ballotCiphertextHash: ballotCiphertextHash,
            timestamp: block.timestamp,
            submitter: msg.sender
        }));

        emit EncryptedBallotSubmitted(
            pollId,
            nullifierHash,
            ballotId,
            ballotCiphertextHash,
            msg.sender,
            block.timestamp
        );
    }

    function getReceiptCount(bytes32 pollId) external view returns (uint256) {
        return pollReceipts[pollId].length;
    }

    function getReceipt(bytes32 pollId, uint256 index) external view returns (BallotReceipt memory) {
        require(index < pollReceipts[pollId].length, "receipt does not exist");
        return pollReceipts[pollId][index];
    }
}
