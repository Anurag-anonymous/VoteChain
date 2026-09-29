const ElectionBallotBox = artifacts.require("ElectionBallotBox");

contract("ElectionBallotBox", (accounts) => {
  const administrator = accounts[0];
  const hash = (value) => web3.utils.keccak256(value);

  it("accepts encrypted ballots without storing voter addresses", async () => {
    const box = await ElectionBallotBox.new({ from: administrator });
    const now = Number((await web3.eth.getBlock("latest")).timestamp);
    const electionId = hash("election-1");

    await box.createElection(electionId, now + 1, now + 3600, { from: administrator });
    await web3.currentProvider.send({ jsonrpc: "2.0", method: "evm_increaseTime", params: [2], id: Date.now() }, () => {});
    await web3.currentProvider.send({ jsonrpc: "2.0", method: "evm_mine", params: [], id: Date.now() }, () => {});
    await box.openElection(electionId, { from: administrator });
    const tx = await box.submitEncryptedBallot(
      electionId,
      hash("ballot-1"),
      hash("nullifier-1"),
      hash("ciphertext-1"),
      hash("proof-1"),
      { from: accounts[1] }
    );

    assert.equal(tx.logs[0].event, "EncryptedBallotSubmitted");
    assert.equal((await box.getBallotCount(electionId)).toString(), "1");
    const ballot = await box.getBallot(electionId, 0);
    assert.equal(ballot.ballotId, hash("ballot-1"));
    assert.equal(ballot.ciphertextHash, hash("ciphertext-1"));
    assert.equal(ballot.proofHash, hash("proof-1"));
  });

  it("rejects duplicate nullifiers and late submissions", async () => {
    const box = await ElectionBallotBox.new({ from: administrator });
    const now = Number((await web3.eth.getBlock("latest")).timestamp);
    const electionId = hash("election-2");
    const nullifier = hash("nullifier-2");

    await box.createElection(electionId, now + 1, now + 3600, { from: administrator });
    await web3.currentProvider.send({ jsonrpc: "2.0", method: "evm_increaseTime", params: [2], id: Date.now() }, () => {});
    await web3.currentProvider.send({ jsonrpc: "2.0", method: "evm_mine", params: [], id: Date.now() }, () => {});
    await box.openElection(electionId, { from: administrator });
    await box.submitEncryptedBallot(
      electionId,
      hash("ballot-2"),
      nullifier,
      hash("ciphertext-2"),
      hash("proof-2"),
      { from: accounts[2] }
    );

    try {
      await box.submitEncryptedBallot(
        electionId,
        hash("ballot-3"),
        nullifier,
        hash("ciphertext-3"),
        hash("proof-3"),
        { from: accounts[3] }
      );
      assert.fail("Expected duplicate nullifier to be rejected");
    } catch (error) {
      assert(error.message.includes("nullifier already used"));
    }
  });
});
