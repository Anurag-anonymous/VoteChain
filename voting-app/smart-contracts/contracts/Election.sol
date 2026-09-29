// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract Election {
    enum Status { Pending, Open, Finalized }

    bytes32 public immutable electionId;
    uint64 public immutable opensAt;
    uint64 public immutable closesAt;
    Status public status;
    address public immutable manager;

    constructor(bytes32 id, uint64 opening, uint64 closing, address owner) {
        require(id != bytes32(0), "electionId required");
        require(closing > opening, "closing must follow opening");
        electionId = id;
        opensAt = opening;
        closesAt = closing;
        manager = owner;
        status = Status.Pending;
    }

    modifier onlyManager() {
        require(msg.sender == manager, "manager required");
        _;
    }

    function open() external onlyManager {
        require(status == Status.Pending, "invalid election state");
        require(block.timestamp >= opensAt, "opening time not reached");
        status = Status.Open;
    }

    function finalize() external onlyManager {
        require(status == Status.Open, "invalid election state");
        require(block.timestamp >= closesAt, "election is still open");
        status = Status.Finalized;
    }
}
