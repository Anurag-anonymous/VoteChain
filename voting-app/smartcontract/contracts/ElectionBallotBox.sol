// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title ElectionBallotBox
 * @notice Public bulletin board for election-scoped encrypted ballots.
 *
 * The contract deliberately never accepts candidate identifiers, plaintext
 * votes, wallet identities, or voter-to-ballot mappings. A credential verifier
 * and an independent tally service must validate proof and ciphertext meaning
 * off-chain before a deployment is considered production-ready.
 */
contract ElectionBallotBox {
    enum Status {
        Pending,
        Open,
        Finalized
    }

    struct Election {
        bytes32 electionId;
        uint64 opensAt;
        uint64 closesAt;
        Status status;
        uint256 ballotCount;
    }

    struct Ballot {
        bytes32 ballotId;
        bytes32 nullifierHash;
        bytes32 ciphertextHash;
        bytes32 proofHash;
        uint64 submittedAt;
    }

    address public immutable administrator;
    mapping(bytes32 => Election) public elections;
    mapping(bytes32 => mapping(bytes32 => bool)) public usedNullifiers;
    mapping(bytes32 => Ballot[]) private ballots;

    event ElectionCreated(bytes32 indexed electionId, uint64 opensAt, uint64 closesAt);
    event ElectionOpened(bytes32 indexed electionId);
    event EncryptedBallotSubmitted(
        bytes32 indexed electionId,
        bytes32 indexed ballotId,
        bytes32 indexed nullifierHash,
        bytes32 ciphertextHash,
        bytes32 proofHash,
        uint64 submittedAt
    );
    event ElectionFinalized(bytes32 indexed electionId, uint256 ballotCount);

    modifier onlyAdministrator() {
        require(msg.sender == administrator, "administrator required");
        _;
    }

    modifier existingElection(bytes32 electionId) {
        require(elections[electionId].electionId != bytes32(0), "election does not exist");
        _;
    }

    constructor() {
        administrator = msg.sender;
    }

    function createElection(
        bytes32 electionId,
        uint64 opensAt,
        uint64 closesAt
    ) external onlyAdministrator {
        require(electionId != bytes32(0), "electionId required");
        require(elections[electionId].electionId == bytes32(0), "election already exists");
        require(opensAt >= block.timestamp, "opening must be in the future");
        require(closesAt > opensAt, "closing must follow opening");

        elections[electionId] = Election({
            electionId: electionId,
            opensAt: opensAt,
            closesAt: closesAt,
            status: Status.Pending,
            ballotCount: 0
        });
        emit ElectionCreated(electionId, opensAt, closesAt);
    }

    function openElection(bytes32 electionId)
        external
        onlyAdministrator
        existingElection(electionId)
    {
        Election storage election = elections[electionId];
        require(election.status == Status.Pending, "invalid election state");
        require(block.timestamp >= election.opensAt, "opening time not reached");
        election.status = Status.Open;
        emit ElectionOpened(electionId);
    }

    function submitEncryptedBallot(
        bytes32 electionId,
        bytes32 ballotId,
        bytes32 nullifierHash,
        bytes32 ciphertextHash,
        bytes32 proofHash
    ) external existingElection(electionId) {
        Election storage election = elections[electionId];
        require(election.status == Status.Open, "election is not open");
        require(block.timestamp < election.closesAt, "election is closed");
        require(ballotId != bytes32(0), "ballotId required");
        require(nullifierHash != bytes32(0), "nullifierHash required");
        require(ciphertextHash != bytes32(0), "ciphertext hash required");
        require(proofHash != bytes32(0), "proof hash required");
        require(!usedNullifiers[electionId][nullifierHash], "nullifier already used");

        usedNullifiers[electionId][nullifierHash] = true;
        ballots[electionId].push(Ballot({
            ballotId: ballotId,
            nullifierHash: nullifierHash,
            ciphertextHash: ciphertextHash,
            proofHash: proofHash,
            submittedAt: uint64(block.timestamp)
        }));
        election.ballotCount += 1;

        emit EncryptedBallotSubmitted(
            electionId,
            ballotId,
            nullifierHash,
            ciphertextHash,
            proofHash,
            uint64(block.timestamp)
        );
    }

    function finalizeElection(bytes32 electionId)
        external
        onlyAdministrator
        existingElection(electionId)
    {
        Election storage election = elections[electionId];
        require(election.status == Status.Open, "invalid election state");
        require(block.timestamp >= election.closesAt, "election is still open");
        election.status = Status.Finalized;
        emit ElectionFinalized(electionId, election.ballotCount);
    }

    function getBallotCount(bytes32 electionId)
        external
        view
        existingElection(electionId)
        returns (uint256)
    {
        return ballots[electionId].length;
    }

    function getBallot(bytes32 electionId, uint256 index)
        external
        view
        existingElection(electionId)
        returns (Ballot memory)
    {
        require(index < ballots[electionId].length, "ballot does not exist");
        return ballots[electionId][index];
    }
}
