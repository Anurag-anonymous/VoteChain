// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract TallyVerifier {
    uint256 public constant TRUSTEE_COUNT = 5;
    uint256 public constant REQUIRED_APPROVALS = 3;
    address[TRUSTEE_COUNT] public trustees;
    mapping(bytes32 => uint256) public approvals;
    mapping(bytes32 => mapping(address => bool)) public approvedBy;
    mapping(bytes32 => bytes32) public tallyCommitments;

    event TallyApproved(bytes32 indexed electionId, bytes32 tallyCommitment, address indexed trustee);
    event TallyVerified(bytes32 indexed electionId, bytes32 tallyCommitment);

    constructor(address[TRUSTEE_COUNT] memory trusteeSet) {
        for (uint256 i = 0; i < TRUSTEE_COUNT; i++) {
            require(trusteeSet[i] != address(0), "trustee required");
            trustees[i] = trusteeSet[i];
        }
    }

    function isTrustee(address account) public view returns (bool) {
        for (uint256 i = 0; i < TRUSTEE_COUNT; i++) {
            if (trustees[i] == account) return true;
        }
        return false;
    }

    function approveTally(bytes32 electionId, bytes32 commitment) external {
        require(isTrustee(msg.sender), "trustee required");
        require(commitment != bytes32(0), "commitment required");
        require(!approvedBy[electionId][msg.sender], "trustee already approved");
        if (approvals[electionId] > 0) {
            require(tallyCommitments[electionId] == commitment, "commitment mismatch");
        } else {
            tallyCommitments[electionId] = commitment;
        }
        approvedBy[electionId][msg.sender] = true;
        approvals[electionId] += 1;
        emit TallyApproved(electionId, commitment, msg.sender);
        if (approvals[electionId] == REQUIRED_APPROVALS) {
            emit TallyVerified(electionId, commitment);
        }
    }

    function isVerified(bytes32 electionId) external view returns (bool) {
        return approvals[electionId] >= REQUIRED_APPROVALS;
    }
}
