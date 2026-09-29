const VotingPoll = artifacts.require("VotingPoll");
const EncryptedBallotRegistry = artifacts.require("EncryptedBallotRegistry");
const ElectionBallotBox = artifacts.require("ElectionBallotBox");
const ElectionManager = artifacts.require("ElectionManager");

module.exports = async function (deployer, network, accounts) {
  const configuredTrustees = (process.env.TRUSTEE_ADDRESSES || '')
    .split(',')
    .map((address) => address.trim())
    .filter(Boolean);
  const trustees = configuredTrustees.length === 5
    ? configuredTrustees
    : accounts.slice(0, 5);

  if (trustees.length !== 5) {
    throw new Error('Exactly five trustee addresses are required');
  }

  await deployer.deploy(ElectionManager, trustees);

  // Legacy contracts remain available for local regression tests only. They
  // are never deployed by a production migration.
  if (process.env.NODE_ENV !== 'production' || process.env.TRUFFLE_TEST === 'true') {
    await deployer.deploy(VotingPoll);
    await deployer.deploy(EncryptedBallotRegistry);
    await deployer.deploy(ElectionBallotBox);
  }
};
