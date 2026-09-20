const {
  PROTOCOL_VERSIONS,
  DEFAULT_TALLY_THRESHOLD,
  RUNTIME_TRUSTEE_ID,
  createPhaseTwoProtocol,
  getPhaseTwoProtocol,
  resetPhaseTwoProtocol,
  isResearchProtocolEnabled,
  isEncryptedProtocolVersion
} = require('../protocol');
const Poll = require('../models/Poll');
const { getNetworkConfig, loadDeployment, normalizeNetworkKey } = require('../config/networks');

const buildPoll = ({ protocolVersion, optionVotes = 0 } = {}) => new Poll({
  title: 'Protocol boundary test poll',
  description: 'Synthetic poll used by the Phase 2 protocol tests',
  creator: '507f1f77bcf86cd799439011',
  creatorWallet: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
  endDate: new Date(Date.now() + 24 * 60 * 60 * 1000),
  protocolVersion,
  options: [
    { optionText: 'Candidate A', votes: optionVotes },
    { optionText: 'Candidate B', votes: 0 }
  ]
});

describe('Phase 2 protocol module boundaries', () => {
  test('eligible synthetic voter can receive an election-specific credential', () => {
    const protocol = createPhaseTwoProtocol();
    const electionId = 'election-2026';
    const voterId = 'synthetic-voter-1';

    protocol.eligibilityAuthority.registerVoter({
      voterId,
      identityRef: 'synthetic-identity-ref',
      electionId
    });
    protocol.eligibilityAuthority.verifyEligibility({ voterId, electionId });

    const credential = protocol.eligibilityAuthority.issueCredential({
      voterId,
      electionId,
      credentialProvider: protocol.credentialProvider
    });

    expect(credential.electionId).toBe(electionId);
    expect(credential.credentialId).toBeTruthy();
    expect(credential.securityNotice).toMatch(/Mock credential/);
  });

  test('ineligible voter cannot receive a credential', () => {
    const protocol = createPhaseTwoProtocol();
    const electionId = 'election-2026';
    const voterId = 'synthetic-voter-2';

    protocol.eligibilityAuthority.registerVoter({
      voterId,
      identityRef: 'synthetic-identity-ref',
      electionId
    });

    expect(() => protocol.eligibilityAuthority.issueCredential({
      voterId,
      electionId,
      credentialProvider: protocol.credentialProvider
    })).toThrow('Cannot issue credential');
  });

  test('revoked credential cannot produce a mock eligibility proof', () => {
    const protocol = createPhaseTwoProtocol();
    const credential = protocol.credentialProvider.issueCredential({
      subjectId: 'synthetic-voter-3',
      electionId: 'election-2026'
    });

    protocol.credentialProvider.revoke({ credentialId: credential.credentialId });

    expect(() => protocol.credentialProvider.proveEligibility({
      credential,
      electionId: 'election-2026'
    })).toThrow('revoked');
  });

  test('mock ballot carries eligibility proof without plaintext candidate in serialized ballot', () => {
    const protocol = createPhaseTwoProtocol();
    const electionId = 'election-2026';
    const credential = protocol.credentialProvider.issueCredential({
      subjectId: 'synthetic-voter-4',
      electionId
    });
    const eligibilityProof = protocol.credentialProvider.proveEligibility({ credential, electionId });

    const ballot = protocol.ballotService.createEncryptedBallot({
      electionId,
      candidateId: 'candidate-a',
      eligibilityProof
    });

    expect(protocol.ballotService.verifyBallot({
      ballot,
      credentialProvider: protocol.credentialProvider
    })).toBe(true);
    expect(protocol.ballotService.serializeBallot(ballot)).not.toContain('candidate-a');
  });

  test('mock tally coordinator enforces threshold before finalization', () => {
    const protocol = createPhaseTwoProtocol({ tallyThreshold: 3 });
    const electionId = 'election-2026';

    protocol.tallyCoordinator.registerTrustee({ trusteeId: 't1', publicKey: 'pk1' });
    protocol.tallyCoordinator.registerTrustee({ trusteeId: 't2', publicKey: 'pk2' });
    protocol.tallyCoordinator.registerTrustee({ trusteeId: 't3', publicKey: 'pk3' });

    protocol.tallyCoordinator.submitShare({ electionId, trusteeId: 't1', share: 'share1' });
    protocol.tallyCoordinator.submitShare({ electionId, trusteeId: 't2', share: 'share2' });
    expect(protocol.tallyCoordinator.canFinalize({ electionId })).toBe(false);

    protocol.tallyCoordinator.submitShare({ electionId, trusteeId: 't3', share: 'share3' });
    expect(protocol.tallyCoordinator.finalizeTally({ electionId, publicBallotCount: 10 }).finalized).toBe(true);
  });

  test('network registry loads Anvil and Polygon Amoy configuration and manifests', () => {
    expect(getNetworkConfig('anvil').chainId).toBe(31337);
    expect(getNetworkConfig('polygon-amoy').chainId).toBe(80002);
    expect(getNetworkConfig('amoy').key).toBe('polygon-amoy');
    expect(normalizeNetworkKey('local')).toBe('anvil');
    expect(loadDeployment('ElectionManager', 'anvil').contractName).toBe('ElectionManager');
    expect(loadDeployment('ElectionManager', 'polygon-amoy').network).toBe('polygon-amoy');
  });
});

describe('Phase 2 protocol version wiring', () => {
  test('new polls default to the legacy plaintext protocol', () => {
    const poll = buildPoll();

    expect(poll.protocolVersion).toBe(PROTOCOL_VERSIONS.LEGACY_PLAINTEXT);
    expect(poll.usesEncryptedProtocol()).toBe(false);
    expect(poll.validateSync()).toBeUndefined();
  });

  test('poll options receive a commitment so encrypted ballots can reference them', () => {
    const poll = buildPoll({ protocolVersion: PROTOCOL_VERSIONS.C0_MOCK_ENCRYPTED });
    const [firstOption] = poll.options;

    expect(firstOption.optionCommitment).toMatch(/^[0-9a-f]{64}$/);
    expect(poll.validateSync()).toBeUndefined();
    expect(Poll.createOptionCommitment('election-2026', 'Candidate A')).toMatch(/^[0-9a-f]{64}$/);
  });

  test('legacy polls keep publishing vote counts while encrypted polls hide them', () => {
    const legacyPoll = buildPoll({ protocolVersion: PROTOCOL_VERSIONS.LEGACY_PLAINTEXT, optionVotes: 7 });
    const legacyResults = legacyPoll.getResults();

    expect(legacyResults[0].votes).toBe(7);
    expect(legacyResults[0].hidden).toBeUndefined();

    const encryptedPoll = buildPoll({ protocolVersion: PROTOCOL_VERSIONS.C0_MOCK_ENCRYPTED, optionVotes: 7 });
    const hiddenResults = encryptedPoll.getResults();

    expect(hiddenResults[0].votes).toBeNull();
    expect(hiddenResults[0].hidden).toBe(true);

    encryptedPoll.tallyState = 'finalized';
    expect(encryptedPoll.getResults()[0].votes).toBe(7);
  });

  test('mock tally finalization is refused for legacy plaintext polls', async () => {
    const legacyPoll = buildPoll({ protocolVersion: PROTOCOL_VERSIONS.LEGACY_PLAINTEXT });

    await expect(legacyPoll.finalizeMockTally())
      .rejects.toThrow(/only available for the c0-mock-encrypted protocol/);
  });

  test('encrypted ballots require an eligibility proof nullifier', async () => {
    const encryptedPoll = buildPoll({ protocolVersion: PROTOCOL_VERSIONS.C0_MOCK_ENCRYPTED });
    const [firstOption] = encryptedPoll.options;

    await expect(encryptedPoll.addEncryptedBallot(firstOption._id, {}, '0xhash'))
      .rejects.toThrow(/eligibility proof and nullifier/);
  });

  test('encrypted ballots never store the plaintext choice and are deduplicated by nullifier', () => {
    const protocol = createPhaseTwoProtocol({ tallyThreshold: 1 });
    const electionId = '507f1f77bcf86cd799439012';
    const encryptedPoll = buildPoll({ protocolVersion: PROTOCOL_VERSIONS.C0_MOCK_ENCRYPTED });
    const [firstOption] = encryptedPoll.options;

    const credential = protocol.credentialProvider.issueCredential({
      subjectId: 'synthetic-voter-5',
      electionId
    });
    const eligibilityProof = protocol.credentialProvider.proveEligibility({ credential, electionId });
    const ballot = protocol.ballotService.createEncryptedBallot({
      electionId,
      candidateId: firstOption.optionCommitment,
      eligibilityProof
    });

    expect(ballot.encryptedCandidate).not.toBe(firstOption.optionCommitment);
    expect(encryptedPoll.hasNullifierVoted(eligibilityProof.nullifier)).toBe(false);

    // addEncryptedBallot writes through Mongoose, so the accepted ballot record
    // is pushed directly here to exercise the duplicate guard without a database.
    encryptedPoll.encryptedBallots.push({
      ballotId: ballot.ballotId,
      electionId: ballot.electionId,
      nullifier: eligibilityProof.nullifier,
      encryptedCandidate: ballot.encryptedCandidate,
      randomnessCommitment: ballot.randomnessCommitment,
      proof: ballot.proof,
      eligibilityProof: ballot.eligibilityProof
    });

    expect(encryptedPoll.hasNullifierVoted(eligibilityProof.nullifier)).toBe(true);
    expect(encryptedPoll.totalVotes).toBe(0);
  });
});

describe('Phase 2 protocol runtime wiring', () => {
  const originalFlag = process.env.RESEARCH_PROTOCOL_ENABLED;
  const originalThreshold = process.env.RESEARCH_TALLY_THRESHOLD;

  afterEach(() => {
    process.env.RESEARCH_PROTOCOL_ENABLED = originalFlag;
    process.env.RESEARCH_TALLY_THRESHOLD = originalThreshold;
    resetPhaseTwoProtocol();
  });

  test('the runtime protocol instance is reused and can be reset', () => {
    const first = getPhaseTwoProtocol();
    const second = getPhaseTwoProtocol();

    expect(first).toBe(second);
    expect(resetPhaseTwoProtocol()).not.toBe(first);
  });

  test('the runtime protocol honours RESEARCH_TALLY_THRESHOLD', () => {
    process.env.RESEARCH_TALLY_THRESHOLD = '2';
    const protocol = resetPhaseTwoProtocol();

    protocol.tallyCoordinator.registerTrustee({ trusteeId: RUNTIME_TRUSTEE_ID, publicKey: 'pk' });
    protocol.tallyCoordinator.submitShare({
      electionId: 'election-2026',
      trusteeId: RUNTIME_TRUSTEE_ID,
      share: 'share'
    });

    expect(protocol.tallyCoordinator.canFinalize({ electionId: 'election-2026' })).toBe(false);
    expect(DEFAULT_TALLY_THRESHOLD).toBe(1);
  });

  test('the research protocol can be switched off for operators', () => {
    delete process.env.RESEARCH_PROTOCOL_ENABLED;
    expect(isResearchProtocolEnabled()).toBe(true);

    process.env.RESEARCH_PROTOCOL_ENABLED = 'false';
    expect(isResearchProtocolEnabled()).toBe(false);

    expect(isEncryptedProtocolVersion(PROTOCOL_VERSIONS.C0_MOCK_ENCRYPTED)).toBe(true);
    expect(isEncryptedProtocolVersion(PROTOCOL_VERSIONS.LEGACY_PLAINTEXT)).toBe(false);
    expect(isEncryptedProtocolVersion(undefined)).toBe(false);
  });
});
