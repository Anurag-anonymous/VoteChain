// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract ResearchElection {
    enum Phase {
        Created,
        Commit,
        Reveal,
        Finalized
    }

    struct Ballot {
        bytes32 nullifier;
        bytes32 commitment;
        uint64 sequence;
        bool revealed;
        bool superseded;
        uint32 choice;
    }

    address public immutable administrator;
    bytes32 public immutable electionId;
    bool public immutable revotingEnabled;
    uint64 public immutable commitDurationSeconds;
    uint64 public immutable revealDurationSeconds;
    Phase public phase;
    uint64 public commitStartedAt;
    uint64 public revealStartedAt;
    uint256 public committedBallotCount;
    uint256 public revealedBallotCount;
    bytes32[] private ballotIds;
    mapping(bytes32 => Ballot) public ballots;
    mapping(bytes32 => uint64) public latestSequence;
    mapping(bytes32 => bytes32) public latestBallotId;
    mapping(uint32 => uint256) public tally;
    bytes32 public tallyCommitment;

    event CommitPhaseStarted(bytes32 indexed electionId, uint64 startedAt, uint64 closesAt);
    event CommitPhaseEnded(bytes32 indexed electionId);
    event RevealPhaseStarted(bytes32 indexed electionId, uint64 startedAt, uint64 closesAt);
    event BallotCommitted(
        bytes32 indexed electionId,
        bytes32 indexed ballotId,
        bytes32 indexed nullifier,
        bytes32 commitment,
        uint64 sequence
    );
    event BallotSuperseded(
        bytes32 indexed electionId,
        bytes32 indexed ballotId,
        bytes32 indexed nullifier,
        uint64 sequence
    );
    event BallotRevealed(
        bytes32 indexed electionId,
        bytes32 indexed ballotId,
        uint32 choice
    );
    event ElectionFinalized(
        bytes32 indexed electionId,
        uint256 committedBallotCount,
        uint256 revealedBallotCount,
        bytes32 tallyCommitment
    );

    modifier onlyAdministrator() {
        require(msg.sender == administrator, "administrator required");
        _;
    }

    constructor(
        bytes32 id,
        bool allowRevoting,
        uint64 commitDuration,
        uint64 revealDuration
    ) {
        require(id != bytes32(0), "electionId required");
        require(commitDuration > 0 && revealDuration > 0, "phase duration required");
        administrator = msg.sender;
        electionId = id;
        revotingEnabled = allowRevoting;
        commitDurationSeconds = commitDuration;
        revealDurationSeconds = revealDuration;
        phase = Phase.Created;
    }

    function startCommit() external onlyAdministrator {
        require(phase == Phase.Created, "invalid election phase");
        phase = Phase.Commit;
        commitStartedAt = uint64(block.timestamp);
        emit CommitPhaseStarted(
            electionId,
            commitStartedAt,
            commitStartedAt + commitDurationSeconds
        );
    }

    function endCommit() external onlyAdministrator {
        require(phase == Phase.Commit, "invalid election phase");
        require(
            block.timestamp >= commitStartedAt + commitDurationSeconds,
            "commit phase is still open"
        );
        phase = Phase.Reveal;
        emit CommitPhaseEnded(electionId);
        revealStartedAt = uint64(block.timestamp);
        emit RevealPhaseStarted(
            electionId,
            revealStartedAt,
            revealStartedAt + revealDurationSeconds
        );
    }

    function commit(
        bytes32 ballotId,
        bytes32 nullifier,
        bytes32 commitment,
        uint64 sequence
    ) external {
        require(phase == Phase.Commit, "commit phase is not open");
        require(
            block.timestamp < commitStartedAt + commitDurationSeconds,
            "commit phase is closed"
        );
        require(ballotId != bytes32(0) && nullifier != bytes32(0), "ballot identity required");
        require(commitment != bytes32(0), "commitment required");
        require(ballots[ballotId].commitment == bytes32(0), "ballot already exists");
        require(sequence == latestSequence[nullifier] + 1, "invalid ballot sequence");
        require(revotingEnabled || sequence == 1, "revoting is disabled");

        bytes32 previousBallotId = latestBallotId[nullifier];
        if (previousBallotId != bytes32(0)) {
            ballots[previousBallotId].superseded = true;
            emit BallotSuperseded(
                electionId,
                previousBallotId,
                nullifier,
                latestSequence[nullifier]
            );
        }
        ballots[ballotId] = Ballot({
            nullifier: nullifier,
            commitment: commitment,
            sequence: sequence,
            revealed: false,
            superseded: false,
            choice: 0
        });
        ballotIds.push(ballotId);
        latestSequence[nullifier] = sequence;
        latestBallotId[nullifier] = ballotId;
        committedBallotCount += 1;
        emit BallotCommitted(electionId, ballotId, nullifier, commitment, sequence);
    }

    function reveal(bytes32 ballotId, uint32 choice, bytes32 salt) external {
        require(phase == Phase.Reveal, "reveal phase is not open");
        require(
            block.timestamp < revealStartedAt + revealDurationSeconds,
            "reveal phase is closed"
        );
        Ballot storage ballot = ballots[ballotId];
        require(ballot.commitment != bytes32(0), "ballot does not exist");
        require(!ballot.superseded, "ballot was superseded");
        require(!ballot.revealed, "ballot already revealed");
        require(
            latestBallotId[ballot.nullifier] == ballotId,
            "ballot is not the latest"
        );
        require(
            ballot.commitment == keccak256(
                abi.encode(electionId, ballot.nullifier, choice, salt)
            ),
            "commitment does not match reveal"
        );
        ballot.revealed = true;
        ballot.choice = choice;
        tally[choice] += 1;
        revealedBallotCount += 1;
        tallyCommitment = keccak256(abi.encode(tallyCommitment, ballotId, choice));
        emit BallotRevealed(electionId, ballotId, choice);
    }

    function finalize() external onlyAdministrator {
        require(phase == Phase.Reveal, "invalid election phase");
        require(
            block.timestamp >= revealStartedAt + revealDurationSeconds,
            "reveal phase is still open"
        );
        phase = Phase.Finalized;
        emit ElectionFinalized(
            electionId,
            committedBallotCount,
            revealedBallotCount,
            tallyCommitment
        );
    }

    function getBallotCount() external view returns (uint256) {
        return ballotIds.length;
    }

    function getBallotId(uint256 index) external view returns (bytes32) {
        require(index < ballotIds.length, "ballot does not exist");
        return ballotIds[index];
    }
}
