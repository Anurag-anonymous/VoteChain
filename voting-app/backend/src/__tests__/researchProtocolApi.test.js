  /**
 * API wiring tests for the encrypted C0 protocol.
 *
 * These tests exercise the Express routes added for C0 without touching
 * MongoDB or a chain node: the User model is replaced through the require cache
 * and poll documents are kept in memory.
 */
const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const crypto = require('crypto');
const {
  createCommitment,
  createEligibilityProof
} = require('../services/credentials/authorityCredentialProof');

const Poll = require('../models/Poll');
const { PROTOCOL_VERSIONS, getC0Protocol, resetC0Protocol } = require('../protocol');
const blockchainService = require('../services/blockchainService');
const { encryptCredentialMode } = require('../utils/credentialMode');

const VOTER_ID = '507f1f77bcf86cd799439021';
const OTHER_VOTER_ID = '507f1f77bcf86cd799439022';
const FAKE_WALLET = '0x0000000000000000000000000000000000000021';
const mockAuthorityCredential = crypto.randomBytes(32).toString('hex').padStart(512, '0');
const mockAuthorityCredentialCommitment = createCommitment(mockAuthorityCredential);
const authorityProofFor = (electionId) => createEligibilityProof({
  credential: mockAuthorityCredential,
  credentialCommitment: mockAuthorityCredentialCommitment,
  electionId
});
const JWT_SECRET = process.env.JWT_SECRET || 'development-jwt-secret-change-me';

// The real User model is replaced because these tests must not open a database
// connection. The factory may only close over `mock`-prefixed bindings.
const mockUser = {
  _id: VOTER_ID,
  walletAddress: FAKE_WALLET,
  walletPrivateKey: '0x0000000000000000000000000000000000000000000000000000000000000001',
  eligibilityStatus: 'eligible',
  authoritySubjectId: mockAuthorityCredentialCommitment,
  authorityCredentialCommitment: mockAuthorityCredentialCommitment,
  isActive: true,
  emailVerified: true,
  phoneVerified: true
};

jest.mock('../models/User', () => {
  const resolveUser = () => {
    const query = Promise.resolve(mockUser);
    query.select = () => Promise.resolve(mockUser);
    return query;
  };

  return {
    findById: jest.fn(resolveUser),
    findByIdAndUpdate: jest.fn(() => Promise.resolve(mockUser)),
    findOne: jest.fn(resolveUser),
    findByIdAndDelete: jest.fn(() => Promise.resolve(mockUser))
  };
});

let app;

const buildApp = () => {
  const testApp = express();
  testApp.use(express.json());
  testApp.use('/api/polls', require('../routes/polls'));
  return testApp;
};

const authHeader = (credentialMode = 'genuine') => ({
  Authorization: `Bearer ${jwt.sign({
    id: VOTER_ID,
    credentialModeEnvelope: encryptCredentialMode(credentialMode)
  }, JWT_SECRET, { expiresIn: '1h' })}`
});

const buildPoll = ({
  protocolVersion = PROTOCOL_VERSIONS.C0_ENCRYPTED,
  creator = VOTER_ID,
  optionTexts = ['Candidate A', 'Candidate B']
} = {}) => {
  const poll = new Poll({
    title: 'C0 encrypted poll',
    description: 'In-memory poll used by C0 protocol API tests',
    creator,
    creatorWallet: FAKE_WALLET,
    endDate: new Date(Date.now() + 60 * 60 * 1000),
    protocolVersion,
    options: optionTexts.map((optionText) => ({
      _id: new mongoose.Types.ObjectId(),
      optionText,
      votes: 0,
      voters: []
    }))
  });

  // Keep the document in memory: persistence is out of scope for these tests.
  poll.save = jest.fn(async () => poll);
  return poll;
};

const optionId = (poll, index) => poll.options[index]._id.toString();

beforeAll(() => {
  app = buildApp();
});

const originalFlag = process.env.C0_PROTOCOL_ENABLED;
const originalLegacyFlag = process.env.RESEARCH_PROTOCOL_ENABLED;
const originalC1Flag = process.env.C1_CHAIN_RECEIPTS_ENABLED;
const originalRevotingFlag = process.env.C1_REVOTING_ENABLED;
const originalThreshold = process.env.RESEARCH_TALLY_THRESHOLD;

afterEach(() => {
  mockUser.eligibilityStatus = 'eligible';
  mockUser.authoritySubjectId = mockAuthorityCredentialCommitment;
  mockUser.authorityCredentialCommitment = mockAuthorityCredentialCommitment;

  if (originalFlag === undefined) {
    delete process.env.C0_PROTOCOL_ENABLED;
  } else {
    process.env.C0_PROTOCOL_ENABLED = originalFlag;
  }

  if (originalLegacyFlag === undefined) {
    delete process.env.RESEARCH_PROTOCOL_ENABLED;
  } else {
    process.env.RESEARCH_PROTOCOL_ENABLED = originalLegacyFlag;
  }

  if (originalC1Flag === undefined) {
    delete process.env.C1_CHAIN_RECEIPTS_ENABLED;
  } else {
    process.env.C1_CHAIN_RECEIPTS_ENABLED = originalC1Flag;
  }

  if (originalRevotingFlag === undefined) {
    delete process.env.C1_REVOTING_ENABLED;
  } else {
    process.env.C1_REVOTING_ENABLED = originalRevotingFlag;
  }

  if (originalThreshold === undefined) {
    delete process.env.RESEARCH_TALLY_THRESHOLD;
  } else {
    process.env.RESEARCH_TALLY_THRESHOLD = originalThreshold;
  }

  jest.restoreAllMocks();
  resetC0Protocol();
});

describe('POST /api/polls/:pollId/ballot', () => {
  test('blocks encrypted ballots until the independent authority approves the voter', async () => {
    const poll = buildPoll();
    mockUser.eligibilityStatus = 'pending';
    jest.spyOn(Poll, 'findById').mockResolvedValue(poll);

    const response = await request(app)
      .post(`/api/polls/${poll._id}/ballot`)
      .set(authHeader())
      .send({ optionId: optionId(poll, 0), authorityProof: authorityProofFor(poll._id.toString()) });

    expect(response.status).toBe(403);
    expect(response.body.message).toMatch(/independent Eligibility Authority/);
    expect(poll.encryptedBallots).toHaveLength(0);
  });

  test('blocks legacy blockchain voting until the independent authority approves the voter', async () => {
    mockUser.eligibilityStatus = 'pending';
    const response = await request(app)
      .post(`/api/polls/${new mongoose.Types.ObjectId()}/vote`)
      .set(authHeader())
      .send({ optionId: new mongoose.Types.ObjectId().toString() });

    expect(response.status).toBe(403);
    expect(response.body.message).toMatch(/independent Eligibility Authority/);
  });

  test('accepts an encrypted ballot without returning the plaintext choice', async () => {
    const poll = buildPoll();
    jest.spyOn(Poll, 'findById').mockResolvedValue(poll);

    const chosen = poll.options[0];
    const response = await request(app)
      .post(`/api/polls/${poll._id}/ballot`)
      .set(authHeader())
      .send({ optionId: chosen._id.toString(), authorityProof: authorityProofFor(poll._id.toString()) });

    expect(response.status).toBe(201);
    expect(response.body.success).toBe(true);
    expect(response.body.ballot.ballotId).toBeTruthy();
    expect(response.body.ballot.nullifier).toBeTruthy();
    expect(response.body.provider).toBe('aes-256-gcm');

    const serializedResponse = JSON.stringify(response.body);
    expect(serializedResponse).not.toContain('Candidate A');
    expect(serializedResponse).not.toContain(chosen.optionCommitment);

    expect(poll.encryptedBallots).toHaveLength(1);
    expect(poll.encryptedBallots[0].encryptedCandidate).not.toBe(chosen.optionCommitment);
    expect(poll.getResults()[0].votes).toBeNull();
  });

  test('rejects a modified zero-knowledge proof and does not accept the bearer secret', async () => {
    const poll = buildPoll();
    jest.spyOn(Poll, 'findById').mockResolvedValue(poll);
    const proof = authorityProofFor(poll._id.toString());
    proof.response = '0'.repeat(512);

    const response = await request(app)
      .post(`/api/polls/${poll._id}/ballot`)
      .set(authHeader())
      .send({
        optionId: optionId(poll, 0),
        authorityProof: proof,
        authorityCredential: mockAuthorityCredential
      });

    expect(response.status).toBe(403);
    expect(response.body.message).toMatch(/zero-knowledge proof/);
    expect(poll.encryptedBallots).toHaveLength(0);

    const bearerOnlyResponse = await request(app)
      .post(`/api/polls/${poll._id}/ballot`)
      .set(authHeader())
      .send({
        optionId: optionId(poll, 0),
        authorityCredential: mockAuthorityCredential
      });

    expect(bearerOnlyResponse.status).toBe(403);
    expect(poll.encryptedBallots).toHaveLength(0);
  });

  test('rejects panic login credentials for protocols without panic cleansing', async () => {
    const poll = buildPoll({ protocolVersion: PROTOCOL_VERSIONS.C0_ENCRYPTED });
    jest.spyOn(Poll, 'findById').mockResolvedValue(poll);

    const response = await request(app)
      .post(`/api/polls/${poll._id}/ballot`)
      .set(authHeader('panic'))
      .send({ optionId: optionId(poll, 0), authorityProof: authorityProofFor(poll._id.toString()) });

    expect(response.status).toBe(400);
    expect(response.body.message).toMatch(/only vote in C2\/C3/);
    expect(poll.encryptedBallots).toHaveLength(0);
  });

  test('accepts a C2 ballot without exposing its private credential type and cleanses it at finalization', async () => {
    const poll = buildPoll({ protocolVersion: PROTOCOL_VERSIONS.C2_ENCRYPTED });
    jest.spyOn(Poll, 'findById').mockResolvedValue(poll);
    const protocol = getC0Protocol();
    const issueCredential = jest.spyOn(protocol.privateCredentialRegistry, 'issueOrLoadCredential')
      .mockImplementation(async ({ voterId, electionId, credentialProvider, eligibilityAuthority }) => (
        eligibilityAuthority.issueCredential({
          voterId,
          electionId,
          credentialProvider,
          credentialType: 'panic'
        })
      ));

    const castResponse = await request(app)
      .post(`/api/polls/${poll._id}/ballot`)
      .set(authHeader('panic'))
      .send({ optionId: optionId(poll, 0), authorityProof: authorityProofFor(poll._id.toString()) });

    expect(castResponse.status).toBe(201);
    expect(issueCredential).toHaveBeenCalledWith(expect.objectContaining({
      credentialType: 'panic',
      requirePersistence: true
    }));
    expect(JSON.stringify(castResponse.body)).not.toContain('panic');
    expect(poll.encryptedBallots[0]).not.toHaveProperty('credentialType');

    jest.spyOn(protocol.privateCredentialRegistry, 'getPanicCredentialCommitments')
      .mockResolvedValue([poll.encryptedBallots[0].eligibilityProof.credentialCommitment]);

    const finalizeResponse = await request(app)
      .post(`/api/polls/${poll._id}/finalize`)
      .set(authHeader())
      .send();
    expect(finalizeResponse.status).toBe(200);
    expect(finalizeResponse.body.cleansing.excludedPanicBallotCount).toBe(1);
    expect(finalizeResponse.body.results.totalVotes).toBe(0);
    expect(poll).not.toHaveProperty('panicCredentialCommitments');
  });

  test('C1p records revotes privately and submits configured padding receipts', async () => {
    const poll = buildPoll({ protocolVersion: PROTOCOL_VERSIONS.C1P_PADDED });
    poll.paddingConfig = {
      paddingRatePercent: 100,
      selectionStrategy: 'population-sample',
      timingDistribution: 'immediate',
      timingWindowSeconds: 0,
      dummyTransactionsPerBallot: 1,
      electionPopulation: 1
    };
    poll.paddingParticipants = [];
    poll.paddingLedger = [];
    jest.spyOn(Poll, 'findById').mockResolvedValue(poll);
    const realReceipt = jest.spyOn(blockchainService, 'anchorEncryptedBallotReceipt')
      .mockResolvedValueOnce({
        enabled: true,
        transactionHash: '0xreal-one',
        blockNumber: 10,
        timestamp: new Date().toISOString(),
        gasUsed: '55000',
        calldataBytes: 132,
        from: FAKE_WALLET
      })
      .mockResolvedValueOnce({
        enabled: true,
        transactionHash: '0xreal-two',
        blockNumber: 12,
        timestamp: new Date().toISOString(),
        gasUsed: '55000',
        calldataBytes: 132,
        from: FAKE_WALLET
      });
    const dummyReceipt = jest.spyOn(blockchainService, 'anchorDummyEncryptedBallotReceipt')
      .mockResolvedValueOnce({
        transactionHash: '0xdummy-one',
        blockNumber: 11,
        timestamp: new Date().toISOString(),
        gasUsed: '55000',
        calldataBytes: 132,
        from: FAKE_WALLET
      })
      .mockResolvedValueOnce({
        transactionHash: '0xdummy-two',
        blockNumber: 13,
        timestamp: new Date().toISOString(),
        gasUsed: '55000',
        calldataBytes: 132,
        from: FAKE_WALLET
      });

    const first = await request(app)
      .post(`/api/polls/${poll._id}/ballot`)
      .set(authHeader())
      .send({ optionId: optionId(poll, 0), authorityProof: authorityProofFor(poll._id.toString()) });
    const second = await request(app)
      .post(`/api/polls/${poll._id}/ballot`)
      .set(authHeader())
      .send({ optionId: optionId(poll, 1), authorityProof: authorityProofFor(poll._id.toString()) });

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(realReceipt).toHaveBeenCalledTimes(2);
    expect(dummyReceipt).toHaveBeenCalledTimes(2);
    expect(poll.encryptedBallots.filter((ballot) => !ballot.superseded)).toHaveLength(1);
    expect(poll.paddingLedger.map((entry) => entry.label)).toEqual([
      'revote',
      'padding',
      'revote',
      'padding'
    ]);
    expect(JSON.stringify(first.body)).not.toContain('padding');
    expect(JSON.stringify(first.body)).not.toContain('revote');
  });

  test('C2p accepts a panic credential while adding indistinguishable padding receipts', async () => {
    const poll = buildPoll({ protocolVersion: PROTOCOL_VERSIONS.C2P_PADDED });
    poll.paddingConfig = {
      paddingRatePercent: 100,
      selectionStrategy: 'per-ballot',
      timingDistribution: 'fixed',
      timingWindowSeconds: 0,
      dummyTransactionsPerBallot: 1,
      electionPopulation: 1
    };
    poll.paddingParticipants = [];
    poll.paddingLedger = [];
    jest.spyOn(Poll, 'findById').mockResolvedValue(poll);
    const protocol = getC0Protocol();
    jest.spyOn(protocol.privateCredentialRegistry, 'issueOrLoadCredential')
      .mockImplementation(async ({ voterId, electionId, credentialProvider, eligibilityAuthority }) => (
        eligibilityAuthority.issueCredential({
          voterId,
          electionId,
          credentialProvider,
          credentialType: 'panic'
        })
      ));
    jest.spyOn(blockchainService, 'anchorEncryptedBallotReceipt').mockResolvedValue({
      enabled: true,
      transactionHash: '0xc2p-real',
      blockNumber: 21,
      timestamp: new Date().toISOString(),
      gasUsed: '55000',
      calldataBytes: 132,
      from: FAKE_WALLET
    });
    const dummyReceipt = jest.spyOn(blockchainService, 'anchorDummyEncryptedBallotReceipt')
      .mockResolvedValue({
        transactionHash: '0xc2p-padding',
        blockNumber: 22,
        timestamp: new Date().toISOString(),
        gasUsed: '55000',
        calldataBytes: 132,
        from: FAKE_WALLET
      });

    const response = await request(app)
      .post(`/api/polls/${poll._id}/ballot`)
      .set(authHeader('panic'))
      .send({ optionId: optionId(poll, 0), authorityProof: authorityProofFor(poll._id.toString()) });

    expect(response.status).toBe(201);
    expect(dummyReceipt).toHaveBeenCalledTimes(1);
    expect(poll.paddingLedger.map((entry) => entry.label)).toEqual(['panic', 'padding']);
    expect(JSON.stringify(response.body)).not.toContain('panic');
    expect(JSON.stringify(response.body)).not.toContain('padding');
  });

  test('refuses a second ballot from the same credential in C0 mode', async () => {
    const poll = buildPoll({
      optionTexts: ['Candidate A', 'Candidate B']
    });
    poll.allowMultipleVotes = true;
    jest.spyOn(Poll, 'findById').mockResolvedValue(poll);

    const chosen = poll.options[1]._id.toString();

    const first = await request(app)
      .post(`/api/polls/${poll._id}/ballot`)
      .set(authHeader())
      .send({ optionId: chosen, authorityProof: authorityProofFor(poll._id.toString()) });

    const second = await request(app)
      .post(`/api/polls/${poll._id}/ballot`)
      .set(authHeader())
      .send({ optionId: chosen, authorityProof: authorityProofFor(poll._id.toString()) });

    expect(first.status).toBe(201);
    expect(second.status).toBe(400);
    expect(second.body.message).toMatch(/already submitted a ballot/);
    expect(poll.encryptedBallots).toHaveLength(1);
  });

  test('rejects ballots for closed polls', async () => {
    const poll = buildPoll();
    poll.status = 'closed';
    jest.spyOn(Poll, 'findById').mockResolvedValue(poll);

    const closed = await request(app)
      .post(`/api/polls/${poll._id}/ballot`)
      .set(authHeader())
      .send({ optionId: optionId(poll, 0), authorityProof: authorityProofFor(poll._id.toString()) });

    expect(closed.status).toBe(400);
    expect(closed.body.message).toBe('Poll is closed');
    expect(poll.encryptedBallots).toHaveLength(0);
  });

  test('requires authentication', async () => {
    const poll = buildPoll();
    jest.spyOn(Poll, 'findById').mockResolvedValue(poll);

    const response = await request(app)
      .post(`/api/polls/${poll._id}/ballot`)
      .send({ optionId: optionId(poll, 0), authorityProof: authorityProofFor(poll._id.toString()) });

    expect(response.status).toBe(401);
    expect(poll.encryptedBallots).toHaveLength(0);
  });
});

describe('POST /api/polls/:id/finalize', () => {
  test('finalizes the encrypted C0 tally for the poll creator', async () => {
    const poll = buildPoll();
    jest.spyOn(Poll, 'findById').mockResolvedValue(poll);

    const response = await request(app)
      .post(`/api/polls/${poll._id}/finalize`)
      .set(authHeader())
      .send();

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.tally.finalized).toBe(true);
    expect(response.body.results.tallyState).toBe('finalized');
    expect(response.body.results.options).toHaveLength(2);
  });

  test('does not re-finalize an already cleansed C2 tally when results are loaded', async () => {
    const poll = buildPoll({ protocolVersion: PROTOCOL_VERSIONS.C2_ENCRYPTED });
    const panicCommitment = 'panic-credential-commitment';
    const genuineCommitment = 'genuine-credential-commitment';
    poll.encryptedBallots.push(
      {
        ballotId: 'panic-ballot',
        nullifier: 'panic-nullifier',
        eligibilityProof: { credentialCommitment: panicCommitment },
        tallyHintOptionId: poll.options[0]._id,
        superseded: false
      },
      {
        ballotId: 'genuine-ballot',
        nullifier: 'genuine-nullifier',
        eligibilityProof: { credentialCommitment: genuineCommitment },
        tallyHintOptionId: poll.options[1]._id,
        superseded: false
      }
    );
    await poll.finalizeEncryptedTally({
      panicCredentialCommitments: [panicCommitment]
    });

    const finalizeSpy = jest.spyOn(poll, 'finalizeEncryptedTally');
    jest.spyOn(Poll, 'findById').mockReturnValue({
      select: jest.fn().mockResolvedValue(poll)
    });
    jest.spyOn(getC0Protocol().privateCredentialRegistry, 'getPanicCredentialCommitments')
      .mockResolvedValue([panicCommitment]);

    const response = await request(app)
      .get(`/api/polls/${poll._id}/results`);

    expect(response.status).toBe(200);
    expect(response.body.results.totalVotes).toBe(1);
    expect(response.body.results.options[1].votes).toBe(1);
    expect(finalizeSpy).not.toHaveBeenCalled();
  });

  test('blocks finalization until the trustee threshold is reached', async () => {
    process.env.RESEARCH_TALLY_THRESHOLD = '2';
    resetC0Protocol();

    const poll = buildPoll();
    jest.spyOn(Poll, 'findById').mockResolvedValue(poll);

    const response = await request(app)
      .post(`/api/polls/${poll._id}/finalize`)
      .set(authHeader())
      .send();

    expect(response.status).toBe(400);
    expect(response.body.message).toMatch(/Not enough trustee shares/);
    expect(poll.tallyState).toBe('hidden');
  });

  test('refuses finalization from a voter who is not the creator', async () => {
    const poll = buildPoll({ creator: OTHER_VOTER_ID });
    jest.spyOn(Poll, 'findById').mockResolvedValue(poll);

    const response = await request(app)
      .post(`/api/polls/${poll._id}/finalize`)
      .set(authHeader())
      .send();

    expect(response.status).toBe(403);
    expect(response.body.message).toMatch(/Only poll creator/);
  });
});

describe('protocol routing guards', () => {
  test('the ballot endpoint rejects polls that use the legacy plaintext flow', async () => {
    const poll = buildPoll({ protocolVersion: PROTOCOL_VERSIONS.LEGACY_PLAINTEXT });
    jest.spyOn(Poll, 'findById').mockResolvedValue(poll);

    const response = await request(app)
      .post(`/api/polls/${poll._id}/ballot`)
      .set(authHeader())
      .send({ optionId: optionId(poll, 0), authorityProof: authorityProofFor(poll._id.toString()) });

    expect(response.status).toBe(400);
    expect(response.body.message).toMatch(/legacy plaintext flow/);
    expect(poll.encryptedBallots).toHaveLength(0);
  });

  describe('GET /api/polls/:id/observer-dataset', () => {
    test('exports public receipt metadata separately from private labels', async () => {
      const poll = buildPoll({ protocolVersion: PROTOCOL_VERSIONS.C1P_PADDED });
      poll.paddingConfig = {
        paddingRatePercent: 50,
        selectionStrategy: 'population-sample',
        timingDistribution: 'uniform',
        timingWindowSeconds: 5,
        dummyTransactionsPerBallot: 1,
        electionPopulation: 10
      };
      poll.paddingLedger = [{
        transactionHash: '0xpublic',
        blockNumber: 2,
        timestamp: new Date(),
        gasUsed: '55000',
        calldataBytes: 132,
        submitter: FAKE_WALLET,
        label: 'padding'
      }];
      jest.spyOn(Poll, 'findById').mockReturnValue({
        select: jest.fn().mockResolvedValue(poll)
      });

      const response = await request(app)
        .get(`/api/polls/${poll._id}/observer-dataset`)
        .set(authHeader());

      expect(response.status).toBe(200);
      expect(response.body.publicRecords[0]).not.toHaveProperty('label');
      expect(response.body.publicRecords[0]).not.toHaveProperty('voterId');
      expect(response.body.privateLabels).toEqual([{
        transactionHash: '0xpublic',
        activity: 'padding',
        sensitiveActivity: false,
        revote: false,
        panic: false,
        excludedDuringCleansing: false
      }]);
    });

    test('exports private panic labels for receipt-anchored C2 baseline polls', async () => {
      const poll = buildPoll({ protocolVersion: PROTOCOL_VERSIONS.C2_ENCRYPTED });
      poll.tallyState = 'finalized';
      const panicCommitment = 'private-panic-commitment';
      poll.encryptedBallots.push({
        transactionHash: '0xpanic',
        receiptAnchored: true,
        receiptFrom: FAKE_WALLET,
        receiptBlockNumber: 3,
        receiptTimestamp: new Date(),
        receiptGasUsed: '55000',
        receiptCalldataBytes: 132,
        nullifier: 'panic-nullifier',
        eligibilityProof: { credentialCommitment: panicCommitment }
      });
      jest.spyOn(Poll, 'findById').mockReturnValue({
        select: jest.fn().mockResolvedValue(poll)
      });
      jest.spyOn(getC0Protocol().privateCredentialRegistry, 'getPanicCredentialCommitments')
        .mockResolvedValue([panicCommitment]);

      const response = await request(app)
        .get(`/api/polls/${poll._id}/observer-dataset`)
        .set(authHeader());

      expect(response.status).toBe(200);
      expect(response.body.publicRecords[0]).not.toHaveProperty('activity');
      expect(response.body.privateLabels[0]).toMatchObject({
        transactionHash: '0xpanic',
        activity: 'panic',
        sensitiveActivity: true,
        panic: true,
        excludedDuringCleansing: true
      });
    });

    test('restricts observer dataset exports to the poll creator', async () => {
      const poll = buildPoll({
        protocolVersion: PROTOCOL_VERSIONS.C1P_PADDED,
        creator: OTHER_VOTER_ID
      });
      jest.spyOn(Poll, 'findById').mockReturnValue({
        select: jest.fn().mockResolvedValue(poll)
      });

      const response = await request(app)
        .get(`/api/polls/${poll._id}/observer-dataset`)
        .set(authHeader());

      expect(response.status).toBe(403);
    });
  });

  test('the legacy vote endpoint refuses encrypted C0 polls', async () => {
    const poll = buildPoll();
    // Registered on chain so the legacy flow reaches its protocol guard.
    poll.blockchainPollId = 1;
    jest.spyOn(Poll, 'findById').mockResolvedValue(poll);

    const response = await request(app)
      .post(`/api/polls/${poll._id}/vote`)
      .set(authHeader())
      .send({ optionId: optionId(poll, 0), walletAddress: FAKE_WALLET, authorityProof: authorityProofFor(poll._id.toString()) });

    expect(response.status).toBe(400);
    expect(response.body.message).toMatch(/encrypted C0 protocol/);
  });

  test('the C0 surface can be switched off with C0_PROTOCOL_ENABLED=false', async () => {
    process.env.C0_PROTOCOL_ENABLED = 'false';
    const poll = buildPoll();
    jest.spyOn(Poll, 'findById').mockResolvedValue(poll);

    const response = await request(app)
      .post(`/api/polls/${poll._id}/ballot`)
      .set(authHeader())
      .send({ optionId: optionId(poll, 0), authorityProof: authorityProofFor(poll._id.toString()) });

    expect(response.status).toBe(400);
    expect(response.body.message).toMatch(/encrypted C0 protocol is disabled/);
  });

  test('anchors a C1 receipt when chain receipts are enabled', async () => {
    process.env.C1_CHAIN_RECEIPTS_ENABLED = 'true';
    const poll = buildPoll();
    jest.spyOn(Poll, 'findById').mockResolvedValue(poll);
    const anchorSpy = jest.spyOn(blockchainService, 'anchorEncryptedBallotReceipt').mockResolvedValue({
      enabled: true,
      transactionHash: '0xc1receipt',
      blockNumber: 12,
      from: FAKE_WALLET,
      to: '0x00000000000000000000000000000000000000c1',
      hashes: {
        pollIdHash: '0x' + '1'.repeat(64),
        ballotIdHash: '0x' + '2'.repeat(64),
        nullifierHash: '0x' + '3'.repeat(64),
        ballotCiphertextHash: '0x' + '4'.repeat(64)
      }
    });

    const response = await request(app)
      .post(`/api/polls/${poll._id}/ballot`)
      .set(authHeader())
      .send({ optionId: optionId(poll, 0), authorityProof: authorityProofFor(poll._id.toString()) });

    expect(response.status).toBe(201);
    expect(anchorSpy).toHaveBeenCalledWith(expect.objectContaining({
      pollId: poll._id.toString(),
      walletPrivateKey: mockUser.walletPrivateKey
    }));
    expect(response.body.chainReceipt.transactionHash).toBe('0xc1receipt');
    expect(poll.encryptedBallots[0].receiptAnchored).toBe(true);
    expect(poll.encryptedBallots[0].transactionHash).toBe('0xc1receipt');
  });

  test('allows C1 revoting and only the replacement ballot remains active', async () => {
    process.env.C1_REVOTING_ENABLED = 'true';
    const poll = buildPoll();
    jest.spyOn(Poll, 'findById').mockResolvedValue(poll);

    const first = await request(app)
      .post(`/api/polls/${poll._id}/ballot`)
      .set(authHeader())
      .send({ optionId: optionId(poll, 0), authorityProof: authorityProofFor(poll._id.toString()) });
    const replacement = await request(app)
      .post(`/api/polls/${poll._id}/ballot`)
      .set(authHeader())
      .send({ optionId: optionId(poll, 1), authorityProof: authorityProofFor(poll._id.toString()) });

    expect(first.status).toBe(201);
    expect(replacement.status).toBe(201);
    expect(replacement.body.replacedPreviousBallot).toBe(true);
    expect(poll.encryptedBallots).toHaveLength(2);
    expect(poll.encryptedBallots[0].superseded).toBe(true);
    expect(poll.encryptedBallots[1].superseded).toBe(false);
    expect(poll.totalVotes).toBe(1);

    await poll.finalizeEncryptedTally();

    expect(poll.finalizedResults[0].votes).toBe(0);
    expect(poll.finalizedResults[1].votes).toBe(1);
  });

  test('allows repeated C1 replacements while keeping only the newest ballot active', async () => {
    process.env.C1_REVOTING_ENABLED = 'true';
    const poll = buildPoll();
    jest.spyOn(Poll, 'findById').mockResolvedValue(poll);

    const first = await request(app)
      .post(`/api/polls/${poll._id}/ballot`)
      .set(authHeader())
      .send({ optionId: optionId(poll, 0), authorityProof: authorityProofFor(poll._id.toString()) });
    const second = await request(app)
      .post(`/api/polls/${poll._id}/ballot`)
      .set(authHeader())
      .send({ optionId: optionId(poll, 1), authorityProof: authorityProofFor(poll._id.toString()) });
    const third = await request(app)
      .post(`/api/polls/${poll._id}/ballot`)
      .set(authHeader())
      .send({ optionId: optionId(poll, 0), authorityProof: authorityProofFor(poll._id.toString()) });

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(third.status).toBe(201);
    expect(poll.encryptedBallots).toHaveLength(3);
    expect(poll.encryptedBallots.filter((ballot) => ballot.superseded).length).toBe(2);
    expect(poll.totalVotes).toBe(1);

    await poll.finalizeEncryptedTally();

    expect(poll.finalizedResults[0].votes).toBe(1);
    expect(poll.finalizedResults[1].votes).toBe(0);
    expect(poll.encryptedBallots[2].superseded).toBe(false);
  });
});
