const ElectionManager = artifacts.require("ElectionManager");
const Election = artifacts.require("Election");
const BallotBox = artifacts.require("BallotBox");
const TallyVerifier = artifacts.require("TallyVerifier");

contract("Modular election", (accounts) => {
  const hash = (value) => web3.utils.keccak256(value);

  it("supports C1 sequence supersession and 3-of-5 tally approval", async () => {
    const manager = await ElectionManager.new(accounts.slice(0, 5));
    const now = Number((await web3.eth.getBlock("latest")).timestamp);
    const electionId = hash("modular-election");
    const tx = await manager.createElection(electionId, now + 1, now + 3600);
    const electionAddress = tx.logs[0].args.election;
    const boxAddress = tx.logs[0].args.ballotBox;
    const election = await Election.at(electionAddress);
    const box = await BallotBox.at(boxAddress);

    await web3.currentProvider.send({ jsonrpc: "2.0", method: "evm_increaseTime", params: [2], id: Date.now() }, () => {});
    await web3.currentProvider.send({ jsonrpc: "2.0", method: "evm_mine", params: [], id: Date.now() }, () => {});
    await manager.openElection(electionId);

    const nullifier = hash("nullifier");
    await box.submitEncryptedBallot(hash("ballot-1"), nullifier, hash("cipher-1"), hash("proof-1"), 1, { from: accounts[1] });
    await box.submitEncryptedBallot(hash("ballot-2"), nullifier, hash("cipher-2"), hash("proof-2"), 2, { from: accounts[2] });
    assert.equal((await box.getBallotCount(nullifier)).toString(), "2");
    assert.equal((await box.latestBallotId(nullifier)), hash("ballot-2"));

    const verifier = await TallyVerifier.at(await manager.tallyVerifier());
    const commitment = hash("tally");
    await verifier.approveTally(electionId, commitment, { from: accounts[0] });
    await verifier.approveTally(electionId, commitment, { from: accounts[1] });
    await verifier.approveTally(electionId, commitment, { from: accounts[2] });
    assert.equal(await verifier.isVerified(electionId), true);
    assert.equal((await election.status()).toString(), "1");
  });
});
