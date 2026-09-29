// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./Election.sol";
import "./BallotBox.sol";
import "./TallyVerifier.sol";

contract ElectionManager {
    address public immutable administrator;
    TallyVerifier public immutable tallyVerifier;
    mapping(bytes32 => address) public elections;
    mapping(bytes32 => address) public ballotBoxes;

    event ElectionCreated(bytes32 indexed electionId, address indexed election, address ballotBox);

    modifier onlyAdministrator() {
        require(msg.sender == administrator, "administrator required");
        _;
    }

    constructor(address[5] memory trustees) {
        administrator = msg.sender;
        tallyVerifier = new TallyVerifier(trustees);
    }

    function createElection(bytes32 electionId, uint64 opensAt, uint64 closesAt)
        external
        onlyAdministrator
        returns (address electionAddress, address ballotBoxAddress)
    {
        require(elections[electionId] == address(0), "election already exists");
        Election election = new Election(electionId, opensAt, closesAt, address(this));
        BallotBox ballotBox = new BallotBox(address(election));
        elections[electionId] = address(election);
        ballotBoxes[electionId] = address(ballotBox);
        emit ElectionCreated(electionId, address(election), address(ballotBox));
        return (address(election), address(ballotBox));
    }

    function openElection(bytes32 electionId) external onlyAdministrator {
        Election(elections[electionId]).open();
    }

    function finalizeElection(bytes32 electionId) external onlyAdministrator {
        Election(elections[electionId]).finalize();
    }
}
