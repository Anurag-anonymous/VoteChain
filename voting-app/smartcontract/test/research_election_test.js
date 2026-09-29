const ResearchElection = artifacts.require("ResearchElection");
const advanceTime = async (seconds) => {
  await new Promise((resolve, reject) => {
    web3.currentProvider.send(
      { jsonrpc: "2.0", method: "evm_increaseTime", params: [seconds], id: Date.now() },
      (error) => (error ? reject(error) : resolve())
    );
  });
  await new Promise((resolve, reject) => {
    web3.currentProvider.send(
      { jsonrpc: "2.0", method: "evm_mine", params: [], id: Date.now() },
      (error) => (error ? reject(error) : resolve())
    );
  });
};

contract("ResearchElection", (accounts) => {
  const hash = (value) => web3.utils.keccak256(value);
  const commitment = (electionId, nullifier, choice, salt) => (
    web3.utils.keccak256(web3.eth.abi.encodeParameters(
      ["bytes32", "bytes32", "uint32", "bytes32"],
      [electionId, nullifier, choice, salt]
    ))
  );

  it("enforces commit, reveal, replacement, and final tally transitions", async () => {
    const electionId = hash("research-revote-election");
    const election = await ResearchElection.new(electionId, true, 3600, 3600, { from: accounts[0] });
    const nullifier = hash("voter-nullifier");
    const oldSalt = hash("old-salt");
    const newSalt = hash("new-salt");
    const ballotOne = hash("ballot-one");
    const ballotTwo = hash("ballot-two");
    const choiceOne = 0;
    const choiceTwo = 1;

    await election.startCommit({ from: accounts[0] });
    await election.commit(
      ballotOne,
      nullifier,
      commitment(electionId, nullifier, choiceOne, oldSalt),
      1,
      { from: accounts[1] }
    );
    const replacement = await election.commit(
      ballotTwo,
      nullifier,
      commitment(electionId, nullifier, choiceTwo, newSalt),
      2,
      { from: accounts[1] }
    );
    assert.equal(replacement.logs[0].event, "BallotSuperseded");
    await advanceTime(3601);
    await election.endCommit({ from: accounts[0] });
    await election.reveal(ballotTwo, choiceTwo, newSalt, { from: accounts[1] });
    await advanceTime(3601);
    await election.finalize({ from: accounts[0] });

    assert.equal((await election.phase()).toString(), "3");
    assert.equal((await election.committedBallotCount()).toString(), "2");
    assert.equal((await election.revealedBallotCount()).toString(), "1");
    assert.equal((await election.tally(choiceOne)).toString(), "0");
    assert.equal((await election.tally(choiceTwo)).toString(), "1");
  });

  it("rejects replacement commits when revoting is disabled and rejects invalid reveals", async () => {
    const electionId = hash("research-baseline-election");
    const election = await ResearchElection.new(electionId, false, 3600, 3600, { from: accounts[0] });
    const nullifier = hash("baseline-nullifier");
    const salt = hash("baseline-salt");
    await election.startCommit({ from: accounts[0] });
    await election.commit(
      hash("baseline-ballot"),
      nullifier,
      commitment(electionId, nullifier, 0, salt),
      1,
      { from: accounts[1] }
    );
    try {
      await election.commit(
        hash("baseline-ballot-two"),
        nullifier,
        commitment(electionId, nullifier, 1, salt),
        2,
        { from: accounts[1] }
      );
      assert.fail("Expected replacement commit to fail");
    } catch (error) {
      assert(error.message.includes("revoting is disabled"));
    }
    await advanceTime(3601);
    await election.endCommit({ from: accounts[0] });
    try {
      await election.reveal(hash("baseline-ballot"), 1, salt, { from: accounts[1] });
      assert.fail("Expected mismatched reveal to fail");
    } catch (error) {
      assert(error.message.includes("commitment does not match reveal"));
    }
  });
});
