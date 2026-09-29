const EncryptedBallotRegistry = artifacts.require("EncryptedBallotRegistry");

contract("EncryptedBallotRegistry", accounts => {
  const submitter = accounts[0];

  const hash = (value) => web3.utils.keccak256(value);

  it("stores an encrypted ballot receipt", async () => {
    const registry = await EncryptedBallotRegistry.deployed();
    const pollId = hash("poll-1");
    const ballotId = hash("ballot-1");
    const nullifierHash = hash("nullifier-1");
    const ciphertextHash = hash("ciphertext-1");

    const tx = await registry.submitEncryptedBallotReceipt(
      pollId,
      ballotId,
      nullifierHash,
      ciphertextHash,
      { from: submitter }
    );

    assert.equal(tx.logs[0].event, "EncryptedBallotSubmitted");
    assert.equal(await registry.usedNullifiers(pollId, nullifierHash), true);
    assert.equal((await registry.getReceiptCount(pollId)).toNumber(), 1);
  });

  it("rejects duplicate nullifier hashes for the same poll", async () => {
    const registry = await EncryptedBallotRegistry.deployed();
    const pollId = hash("poll-duplicate");
    const nullifierHash = hash("same-nullifier");

    await registry.submitEncryptedBallotReceipt(
      pollId,
      hash("ballot-a"),
      nullifierHash,
      hash("ciphertext-a"),
      { from: submitter }
    );

    try {
      await registry.submitEncryptedBallotReceipt(
        pollId,
        hash("ballot-b"),
        nullifierHash,
        hash("ciphertext-b"),
        { from: submitter }
      );
      assert.fail("Expected duplicate nullifier to be rejected");
    } catch (error) {
      assert(error.message.includes("nullifier already used"));
    }
  });
});
