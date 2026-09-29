const {
  PROTOCOL_VERSIONS,
  DEFAULT_TALLY_THRESHOLD,
  RUNTIME_TRUSTEE_ID,
  createC0Protocol,
  getC0Protocol,
  resetC0Protocol,
  isC0ProtocolEnabled,
  isEncryptedProtocolVersion,
  isProductionProtocolVersion,
  usesPanicCredentials,
  usesC1Revoting
} = require('../protocol');
const Poll = require('../models/Poll');
const blockchainService = require('../services/blockchainService');
const { getNetworkConfig, loadDeployment, normalizeNetworkKey } = require('../config/networks');

const buildPoll = ({ protocolVersion, optionVotes = 0 } = {}) => new Poll({
  title: 'Protocol boundary test poll',
  description: 'Synthetic poll used by the C0 protocol tests',
  creator: '507f1f77bcf86cd799439011',
  creatorWallet: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
  endDate: new Date(Date.now() + 24 * 60 * 60 * 1000),
  protocolVersion,
  options: [
    { optionText: 'Candidate A', votes: optionVotes },
    { optionText: 'Candidate B', votes: 0 }
  ]
});

describe('C0 protocol module boundaries', () => {
  test('production protocol gate excludes legacy and mock versions', () => {
    expect(isProductionProtocolVersion(PROTOCOL_VERSIONS.C0_ENCRYPTED)).toBe(true);
    expect(isProductionProtocolVersion(PROTOCOL_VERSIONS.C2_ENCRYPTED)).toBe(true);
    expect(isProductionProtocolVersion(PROTOCOL_VERSIONS.LEGACY_PLAINTEXT)).toBe(false);
    expect(isProductionProtocolVersion(PROTOCOL_VERSIONS.C0_MOCK_ENCRYPTED)).toBe(false);
  });

  test('eligible synthetic voter can receive an election-specific credential', () => {
    const protocol = createC0Protocol();
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
    expect(credential.provider).toBe('election-hmac');
  });

  test('ineligible voter cannot receive a credential', () => {
    const protocol = createC0Protocol();
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

  test('C2 panic credentials are random but privately tracked without public labeling', () => {
    const protocol = createC0Protocol();
    const electionId = 'election-2026';
    const voterId = 'synthetic-voter-c2';

    protocol.eligibilityAuthority.registerVoter({
      voterId,
      identityRef: 'synthetic-identity-ref',
      electionId
    });

    protocol.eligibilityAuthority.verifyEligibility({ voterId, electionId });

    const credential = protocol.eligibilityAuthority.issueCredential({
      voterId,
      electionId,
      credentialProvider: protocol.credentialProvider,
      credentialType: 'panic'
    });
    const eligibilityProof = protocol.credentialProvider.proveEligibility({ credential, electionId });

    expect(credential.credentialType).toBe('panic');
    expect(credential.credentialCommitment).toMatch(/^[0-9a-f]{64}$/);
    expect(eligibilityProof.credentialCommitment).toBe(credential.credentialCommitment);
    expect(JSON.stringify(eligibilityProof)).not.toContain('panic');
    expect(protocol.eligibilityAuthority.getCredentialStatus({ voterId, electionId }).isPanicCredential).toBe(true);
    expect(protocol.eligibilityAuthority.getPanicCredentialCommitments({ electionId })).toContain(credential.credentialCommitment);
  });

  test('C0 and C2/C3 select their intended credential and revoting modes', () => {
    expect(usesPanicCredentials(PROTOCOL_VERSIONS.C0_ENCRYPTED)).toBe(false);
    expect(usesPanicCredentials(PROTOCOL_VERSIONS.C2_ENCRYPTED)).toBe(true);
    expect(usesPanicCredentials(PROTOCOL_VERSIONS.C3_ENCRYPTED)).toBe(true);
    expect(usesC1Revoting(PROTOCOL_VERSIONS.C2_ENCRYPTED)).toBe(false);
    expect(usesC1Revoting(PROTOCOL_VERSIONS.C3_ENCRYPTED)).toBe(true);
    expect(isEncryptedProtocolVersion(PROTOCOL_VERSIONS.C2_ENCRYPTED)).toBe(true);
    expect(isEncryptedProtocolVersion(PROTOCOL_VERSIONS.C3_ENCRYPTED)).toBe(true);
  });

  test('C2 panic credentials are excluded during private cleansing before tally finalization', async () => {
    const protocol = createC0Protocol();
    const electionId = 'election-2026-c2-cleansing';
    const poll = new Poll({
      title: 'C2 panic cleansing test',
      description: 'Synthetic poll for panic credential cleanup',
      creator: '507f1f77bcf86cd799439011',
      creatorWallet: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
      endDate: new Date(Date.now() + 24 * 60 * 60 * 1000),
      protocolVersion: 'c0-encrypted',
      options: [
        { optionText: 'Candidate A', votes: 0 },
        { optionText: 'Candidate B', votes: 0 }
      ]
    });

    protocol.eligibilityAuthority.registerVoter({ voterId: 'genuine-voter', identityRef: 'genuine', electionId });
    protocol.eligibilityAuthority.registerVoter({ voterId: 'panic-voter', identityRef: 'panic', electionId });
    protocol.eligibilityAuthority.verifyEligibility({ voterId: 'genuine-voter', electionId });
    protocol.eligibilityAuthority.verifyEligibility({ voterId: 'panic-voter', electionId });

    const genuineCredential = protocol.eligibilityAuthority.issueCredential({
      voterId: 'genuine-voter',
      electionId,
      credentialProvider: protocol.credentialProvider,
      credentialType: 'genuine'
    });
    const panicCredential = protocol.eligibilityAuthority.issueCredential({
      voterId: 'panic-voter',
      electionId,
      credentialProvider: protocol.credentialProvider,
      credentialType: 'panic'
    });

    const genuineProof = protocol.credentialProvider.proveEligibility({ credential: genuineCredential, electionId });
    const panicProof = protocol.credentialProvider.proveEligibility({ credential: panicCredential, electionId });

    const genuineBallot = protocol.ballotService.createEncryptedBallot({
      electionId,
      candidateId: poll.options[0].optionCommitment,
      eligibilityProof: genuineProof
    });
    const panicBallot = protocol.ballotService.createEncryptedBallot({
      electionId,
      candidateId: poll.options[1].optionCommitment,
      eligibilityProof: panicProof
    });

    poll.encryptedBallots.push({
      ballotId: 'genuine-ballot',
      electionId,
      nullifier: genuineProof.nullifier,
      encryptedCandidate: genuineBallot.encryptedCandidate,
      randomnessCommitment: genuineBallot.randomnessCommitment,
      proof: genuineBallot.proof,
      eligibilityProof: genuineProof,
      tallyHintOptionId: poll.options[0]._id,
      acceptedAt: new Date()
    });
    poll.encryptedBallots.push({
      ballotId: 'panic-ballot',
      electionId,
      nullifier: panicProof.nullifier,
      encryptedCandidate: panicBallot.encryptedCandidate,
      randomnessCommitment: panicBallot.randomnessCommitment,
      proof: panicBallot.proof,
      eligibilityProof: panicProof,
      tallyHintOptionId: poll.options[1]._id,
      acceptedAt: new Date()
    });

    const finalizationResult = await poll.finalizeEncryptedTally({
      panicCredentialCommitments: protocol.eligibilityAuthority.getPanicCredentialCommitments({ electionId })
    });

    expect(finalizationResult.excludedPanicBallotCount).toBe(1);
    expect(finalizationResult.totalVotes).toBe(1);
    expect(finalizationResult.finalizedResults[0].votes).toBe(1);
    expect(finalizationResult.finalizedResults[1].votes).toBe(0);
  });

  test('revoked credential cannot produce an eligibility proof', () => {
    const protocol = createC0Protocol();
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

  test('eligibility proof verification rejects forged proof material', () => {
    const protocol = createC0Protocol();
    const credential = protocol.credentialProvider.issueCredential({
      subjectId: 'synthetic-voter-proof',
      electionId: 'election-proof'
    });
    const proof = protocol.credentialProvider.proveEligibility({
      credential,
      electionId: 'election-proof'
    });

    expect(protocol.credentialProvider.verifyEligibilityProof({
      proof,
      electionId: 'election-proof'
    })).toBe(true);
    expect(protocol.credentialProvider.verifyEligibilityProof({
      proof: { ...proof, nullifier: 'f'.repeat(64) },
      electionId: 'election-proof'
    })).toBe(false);
    expect(protocol.credentialProvider.verifyEligibilityProof({
      proof: { ...proof, proof: 'f'.repeat(64) },
      electionId: 'election-proof'
    })).toBe(false);
  });

  test('AES-GCM ballot carries eligibility proof without plaintext candidate in serialized ballot', () => {
    const protocol = createC0Protocol();
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
    expect(ballot.provider).toBe('aes-256-gcm');
    expect(protocol.ballotService.serializeBallot(ballot)).not.toContain('candidate-a');
    expect(protocol.ballotService.decryptBallot(ballot).candidateId).toBe('candidate-a');
  });

  test('development tally coordinator enforces threshold before finalization', () => {
    const protocol = createC0Protocol({ tallyThreshold: 3 });
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

  test('C1 receipt hashing deduplicates nullifiers per poll without storing plaintext', () => {
    const protocol = createC0Protocol();
    const electionId = 'election-2026';
    const credential = protocol.credentialProvider.issueCredential({
      subjectId: 'synthetic-voter-c1',
      electionId
    });
    const eligibilityProof = protocol.credentialProvider.proveEligibility({ credential, electionId });
    const ballot = protocol.ballotService.createEncryptedBallot({
      electionId,
      candidateId: 'candidate-a',
      eligibilityProof
    });

    blockchainService.resetLocalReceiptCache();
    const receipt = blockchainService.buildEncryptedBallotReceipt({ pollId: electionId, ballot });

    expect(receipt.pollIdHash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(receipt.nullifierHash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(JSON.stringify(receipt)).not.toContain(eligibilityProof.nullifier);

    expect(blockchainService.rememberEncryptedBallotReceipt({
      pollId: electionId,
      nullifierHash: receipt.nullifierHash
    })).toBe(true);
    expect(() => blockchainService.rememberEncryptedBallotReceipt({
      pollId: electionId,
      nullifierHash: receipt.nullifierHash
    })).toThrow(/already anchored/);
  });
});

describe('C0 protocol version wiring', () => {
  test('new polls default to the encrypted C0 protocol', () => {
    const poll = buildPoll();

    expect(poll.protocolVersion).toBe(PROTOCOL_VERSIONS.C0_ENCRYPTED);
    expect(poll.usesEncryptedProtocol()).toBe(true);
    expect(poll.validateSync()).toBeUndefined();
  });

  test('poll options receive a commitment so encrypted ballots can reference them', () => {
    const poll = buildPoll({ protocolVersion: PROTOCOL_VERSIONS.C0_ENCRYPTED });
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

    const encryptedPoll = buildPoll({ protocolVersion: PROTOCOL_VERSIONS.C0_ENCRYPTED, optionVotes: 7 });
    const hiddenResults = encryptedPoll.getResults();

    expect(hiddenResults[0].votes).toBeNull();
    expect(hiddenResults[0].hidden).toBe(true);

    encryptedPoll.tallyState = 'finalized';
    expect(encryptedPoll.getResults()[0].votes).toBe(7);
  });

  test('encrypted tally finalization is refused for legacy plaintext polls', async () => {
    const legacyPoll = buildPoll({ protocolVersion: PROTOCOL_VERSIONS.LEGACY_PLAINTEXT });

    await expect(legacyPoll.finalizeEncryptedTally())
      .rejects.toThrow(/only available for encrypted C0 polls/);
  });

  test('encrypted ballots require an eligibility proof nullifier', async () => {
    const encryptedPoll = buildPoll({ protocolVersion: PROTOCOL_VERSIONS.C0_ENCRYPTED });
    const [firstOption] = encryptedPoll.options;

    await expect(encryptedPoll.addEncryptedBallot(firstOption._id, {}, '0xhash'))
      .rejects.toThrow(/eligibility proof and nullifier/);
  });

  test('encrypted ballots never store the plaintext choice and are deduplicated by nullifier', () => {
    const protocol = createC0Protocol({ tallyThreshold: 1 });
    const electionId = '507f1f77bcf86cd799439012';
    const encryptedPoll = buildPoll({ protocolVersion: PROTOCOL_VERSIONS.C0_ENCRYPTED });
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

describe('C0 protocol runtime wiring', () => {
  const originalFlag = process.env.C0_PROTOCOL_ENABLED;
  const originalLegacyFlag = process.env.RESEARCH_PROTOCOL_ENABLED;
  const originalThreshold = process.env.RESEARCH_TALLY_THRESHOLD;

  afterEach(() => {
    process.env.C0_PROTOCOL_ENABLED = originalFlag;
    process.env.RESEARCH_PROTOCOL_ENABLED = originalLegacyFlag;
    process.env.RESEARCH_TALLY_THRESHOLD = originalThreshold;
    resetC0Protocol();
  });

  test('the runtime protocol instance is reused and can be reset', () => {
    const first = getC0Protocol();
    const second = getC0Protocol();

    expect(first).toBe(second);
    expect(resetC0Protocol()).not.toBe(first);
  });

  test('the runtime protocol honours RESEARCH_TALLY_THRESHOLD', () => {
    process.env.RESEARCH_TALLY_THRESHOLD = '2';
    const protocol = resetC0Protocol();

    protocol.tallyCoordinator.registerTrustee({ trusteeId: RUNTIME_TRUSTEE_ID, publicKey: 'pk' });
    protocol.tallyCoordinator.submitShare({
      electionId: 'election-2026',
      trusteeId: RUNTIME_TRUSTEE_ID,
      share: 'share'
    });

    expect(protocol.tallyCoordinator.canFinalize({ electionId: 'election-2026' })).toBe(false);
    expect(DEFAULT_TALLY_THRESHOLD).toBe(1);
  });

  test('the C0 protocol can be switched off for operators', () => {
    delete process.env.C0_PROTOCOL_ENABLED;
    delete process.env.RESEARCH_PROTOCOL_ENABLED;
    expect(isC0ProtocolEnabled()).toBe(true);

    process.env.C0_PROTOCOL_ENABLED = 'false';
    expect(isC0ProtocolEnabled()).toBe(false);

    delete process.env.C0_PROTOCOL_ENABLED;
    process.env.RESEARCH_PROTOCOL_ENABLED = 'false';
    expect(isC0ProtocolEnabled()).toBe(false);

    expect(isEncryptedProtocolVersion(PROTOCOL_VERSIONS.C0_ENCRYPTED)).toBe(true);
    expect(isEncryptedProtocolVersion(PROTOCOL_VERSIONS.C0_MOCK_ENCRYPTED)).toBe(true);
    expect(isEncryptedProtocolVersion(PROTOCOL_VERSIONS.LEGACY_PLAINTEXT)).toBe(false);
    expect(isEncryptedProtocolVersion(undefined)).toBe(false);
  });
});
