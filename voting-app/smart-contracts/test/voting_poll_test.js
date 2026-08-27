const VotingPoll = artifacts.require("VotingPoll");

contract("VotingPoll", accounts => {
  const creator = accounts[0];
  const voter1 = accounts[1];
  const voter2 = accounts[2];

  it("should create a poll", async () => {
    const instance = await VotingPoll.deployed();
    const title = "What is your favorite color?";
    const options = ["Red", "Blue", "Green"];
    const endTime = Math.floor(Date.now() / 1000) + 86400; // 1 day from now

    const tx = await instance.createPoll(title, options, endTime, { from: creator });
    
    assert.equal(tx.logs[0].event, "PollCreated", "PollCreated event not emitted");
    assert.equal(tx.logs[0].args.creator, creator, "Creator doesn't match");
  });

  it("should not allow poll with less than 2 options", async () => {
    const instance = await VotingPoll.deployed();
    const title = "Invalid poll";
    const options = ["Only one option"];
    const endTime = Math.floor(Date.now() / 1000) + 86400;

    try {
      await instance.createPoll(title, options, endTime, { from: creator });
      assert.fail("Should have thrown an error");
    } catch (error) {
      assert(error.message.includes("Poll must have at least 2 options"));
    }
  });

  it("should allow voting on a poll", async () => {
    const instance = await VotingPoll.deployed();
    const title = "Vote test";
    const options = ["Yes", "No"];
    const endTime = Math.floor(Date.now() / 1000) + 86400;

    const createTx = await instance.createPoll(title, options, endTime, { from: creator });
    const pollId = createTx.logs[0].args.pollId;

    const voteTx = await instance.vote(pollId, 0, { from: voter1 });
    
    assert.equal(voteTx.logs[0].event, "VoteCasted", "VoteCasted event not emitted");
  });

  it("should not allow duplicate votes", async () => {
    const instance = await VotingPoll.deployed();
    const polls = await instance.getTotalPolls();
    const pollId = polls - 1;

    try {
      await instance.vote(pollId, 1, { from: voter1 });
      assert.fail("Should have thrown an error");
    } catch (error) {
      assert(error.message.includes("Already voted"));
    }
  });

  it("should return correct poll results", async () => {
    const instance = await VotingPoll.deployed();
    const polls = await instance.getTotalPolls();
    const pollId = polls - 1;

    const results = await instance.getPollResults(pollId);
    assert.equal(results[0], 1, "Vote count for option 0 should be 1");
  });

  it("should check if user has voted", async () => {
    const instance = await VotingPoll.deployed();
    const polls = await instance.getTotalPolls();
    const pollId = polls - 1;

    const hasVoted = await instance.hasVoted(pollId, voter1);
    assert.equal(hasVoted, true, "Voter should have voted");

    const hasNotVoted = await instance.hasVoted(pollId, voter2);
    assert.equal(hasNotVoted, false, "Voter2 should not have voted");
  });
});
