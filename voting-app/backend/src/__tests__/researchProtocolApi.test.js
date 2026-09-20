/**
 * API wiring tests for the opt-in C0 mock-encrypted research protocol.
 *
 * These tests exercise the Express routes added in Phase 2 without touching
 * MongoDB or a chain node: the User model is replaced through the require cache
 * and poll documents are kept in memory.
 */
const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');

const Poll = require('../models/Poll');
const { PROTOCOL_VERSIONS, resetPhaseTwoProtocol } = require('../protocol');

const VOTER_ID = '507f1f77bcf86cd799439021';
const OTHER_VOTER_ID = '507f1f77bcf86cd799439022';
const FAKE_WALLET = '0x0000000000000000000000000000000000000021';
const JWT_SECRET = process.env.JWT_SECRET || 'development-jwt-secret-change-me';

// The real User model is replaced because these tests must not open a database
// connection. The factory may only close over `mock`-prefixed bindings.
const mockUser = {
  _id: VOTER_ID,
  walletAddress: FAKE_WALLET,
  walletPrivateKey: '0x0000000000000000000000000000000000000000000000000000000000000001',
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
let token;

const buildApp = () => {
  const testApp = express();
  testApp.use(express.json());
  testApp.use('/api/polls', require('../routes/polls'));
  return testApp;
};

const authHeader = () => ({ Authorization: `Bearer ${token}` });

const buildPoll = ({
  protocolVersion = PROTOCOL_VERSIONS.C0_MOCK_ENCRYPTED,
  creator = VOTER_ID,
  optionTexts = ['Candidate A', 'Candidate B']
} = {}) => {
  const poll = new Poll({
    title: 'Phase 2 research poll',
    description: 'In-memory poll used by research protocol API tests',
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
  token = jwt.sign({ id: VOTER_ID }, JWT_SECRET, { expiresIn: '1h' });
});

const originalFlag = process.env.RESEARCH_PROTOCOL_ENABLED;
const originalThreshold = process.env.RESEARCH_TALLY_THRESHOLD;

afterEach(() => {
  if (originalFlag === undefined) {
    delete process.env.RESEARCH_PROTOCOL_ENABLED;
  } else {
    process.env.RESEARCH_PROTOCOL_ENABLED = originalFlag;
  }

  if (originalThreshold === undefined) {
    delete process.env.RESEARCH_TALLY_THRESHOLD;
  } else {
    process.env.RESEARCH_TALLY_THRESHOLD = originalThreshold;
  }

  jest.restoreAllMocks();
  resetPhaseTwoProtocol();
});

describe('POST /api/polls/:pollId/ballot', () => {
  test('accepts a mock encrypted ballot without returning the plaintext choice', async () => {
    const poll = buildPoll();
    jest.spyOn(Poll, 'findById').mockResolvedValue(poll);

    const chosen = poll.options[0];
    const response = await request(app)
      .post(`/api/polls/${poll._id}/ballot`)
      .set(authHeader())
      .send({ optionId: chosen._id.toString() });

    expect(response.status).toBe(201);
    expect(response.body.success).toBe(true);
    expect(response.body.ballot.ballotId).toBeTruthy();
    expect(response.body.ballot.nullifier).toBeTruthy();
    expect(response.body.securityNotice).toMatch(/mock/i);

    const serializedResponse = JSON.stringify(response.body);
    expect(serializedResponse).not.toContain('Candidate A');
    expect(serializedResponse).not.toContain(chosen.optionCommitment);

    expect(poll.encryptedBallots).toHaveLength(1);
    expect(poll.encryptedBallots[0].encryptedCandidate).not.toBe(chosen.optionCommitment);
    expect(poll.getResults()[0].votes).toBeNull();
  });

  test('refuses a second ballot from the same credential', async () => {
    const poll = buildPoll();
    jest.spyOn(Poll, 'findById').mockResolvedValue(poll);

    const chosen = poll.options[1]._id.toString();

    const first = await request(app)
      .post(`/api/polls/${poll._id}/ballot`)
      .set(authHeader())
      .send({ optionId: chosen });

    const second = await request(app)
      .post(`/api/polls/${poll._id}/ballot`)
      .set(authHeader())
      .send({ optionId: chosen });

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
      .send({ optionId: optionId(poll, 0) });

    expect(closed.status).toBe(400);
    expect(closed.body.message).toBe('Poll is closed');
    expect(poll.encryptedBallots).toHaveLength(0);
  });

  test('requires authentication', async () => {
    const poll = buildPoll();
    jest.spyOn(Poll, 'findById').mockResolvedValue(poll);

    const response = await request(app)
      .post(`/api/polls/${poll._id}/ballot`)
      .send({ optionId: optionId(poll, 0) });

    expect(response.status).toBe(401);
    expect(poll.encryptedBallots).toHaveLength(0);
  });
});

describe('POST /api/polls/:id/finalize', () => {
  test('finalizes the mock tally for the poll creator', async () => {
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

  test('blocks finalization until the trustee threshold is reached', async () => {
    process.env.RESEARCH_TALLY_THRESHOLD = '2';
    resetPhaseTwoProtocol();

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
      .send({ optionId: optionId(poll, 0) });

    expect(response.status).toBe(400);
    expect(response.body.message).toMatch(/legacy plaintext flow/);
    expect(poll.encryptedBallots).toHaveLength(0);
  });

  test('the legacy vote endpoint refuses c0-mock-encrypted polls', async () => {
    const poll = buildPoll();
    // Registered on chain so the legacy flow reaches its protocol guard.
    poll.blockchainPollId = 1;
    jest.spyOn(Poll, 'findById').mockResolvedValue(poll);

    const response = await request(app)
      .post(`/api/polls/${poll._id}/vote`)
      .set(authHeader())
      .send({ optionId: optionId(poll, 0), walletAddress: FAKE_WALLET });

    expect(response.status).toBe(400);
    expect(response.body.message).toMatch(/c0-mock-encrypted protocol/);
  });

  test('the research surface can be switched off with RESEARCH_PROTOCOL_ENABLED=false', async () => {
    process.env.RESEARCH_PROTOCOL_ENABLED = 'false';
    const poll = buildPoll();
    jest.spyOn(Poll, 'findById').mockResolvedValue(poll);

    const response = await request(app)
      .post(`/api/polls/${poll._id}/ballot`)
      .set(authHeader())
      .send({ optionId: optionId(poll, 0) });

    expect(response.status).toBe(400);
    expect(response.body.message).toMatch(/research protocol is disabled/);
  });
});

