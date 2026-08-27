const VotingPoll = artifacts.require("VotingPoll");

module.exports = function (deployer) {
  deployer.deploy(VotingPoll);
};
