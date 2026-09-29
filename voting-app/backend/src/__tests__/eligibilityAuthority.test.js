const express = require('express');
const request = require('supertest');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const router = require('../routes/eligibilityAuthority');

const VOTER_ID = '507f1f77bcf86cd799439021';
const callbackSecret = 'a'.repeat(64);
const originalCallbackSecret = process.env.ELIGIBILITY_AUTHORITY_CALLBACK_SECRET;
const originalCredentialKey = process.env.ELIGIBILITY_AUTHORITY_CREDENTIAL_KEY;

const createCredentialEnvelope = (credential, commitment) => {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', Buffer.from('b'.repeat(64), 'hex'), iv);
  const ciphertext = Buffer.concat([cipher.update(credential, 'utf8'), cipher.final()]);
  return {
    scheme: 'jcj-civitas-v1-envelope',
    keyVersion: 'v1',
    credentialCommitment: commitment,
    ciphertext: [
      iv.toString('base64'),
      cipher.getAuthTag().toString('base64'),
      ciphertext.toString('base64')
    ].join('.')
  };
};

const createApp = () => {
  const app = express();
  app.use(express.json({
    verify: (req, res, buffer) => {
      req.rawBody = Buffer.from(buffer);
    }
  }));
  app.use('/api/eligibility-authority', router);
  return app;
};

const signedHeaders = (payload) => {
  const rawBody = JSON.stringify(payload);
  const timestamp = String(Date.now());
  const signature = crypto.createHmac('sha256', callbackSecret)
    .update(`${timestamp}\nPOST\n/api/eligibility-authority/decision\n${rawBody}`)
    .digest('hex');
  return {
    timestamp,
    signature,
    rawBody
  };
};

describe('Eligibility Authority callback', () => {
  beforeEach(() => {
    process.env.ELIGIBILITY_AUTHORITY_CALLBACK_SECRET = callbackSecret;
    process.env.ELIGIBILITY_AUTHORITY_CREDENTIAL_KEY = 'b'.repeat(64);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    if (originalCallbackSecret === undefined) {
      delete process.env.ELIGIBILITY_AUTHORITY_CALLBACK_SECRET;
    } else {
      process.env.ELIGIBILITY_AUTHORITY_CALLBACK_SECRET = originalCallbackSecret;
    }
    if (originalCredentialKey === undefined) {
      delete process.env.ELIGIBILITY_AUTHORITY_CREDENTIAL_KEY;
    } else {
      process.env.ELIGIBILITY_AUTHORITY_CREDENTIAL_KEY = originalCredentialKey;
    }
  });

  test('rejects decisions without a valid authority signature', async () => {
    const response = await request(createApp())
      .post('/api/eligibility-authority/decision')
      .send({
        voterId: VOTER_ID,
        status: 'eligible',
        decisionId: 'decision-1',
        decidedAt: new Date().toISOString()
      });

    expect(response.status).toBe(401);
  });

  test('rejects approval if the subject is not the credential commitment', async () => {
    const payload = {
      voterId: VOTER_ID,
      status: 'eligible',
      authoritySubjectId: crypto.randomBytes(32).toString('hex'),
      credentialCommitment: crypto.randomBytes(32).toString('hex'),
      decisionId: 'decision-invalid',
      decidedAt: new Date().toISOString()
    };
    const signed = signedHeaders(payload);
    const response = await request(createApp())
      .post('/api/eligibility-authority/decision')
      .set('x-votechain-timestamp', signed.timestamp)
      .set('x-votechain-signature', signed.signature)
      .set('content-type', 'application/json')
      .send(signed.rawBody);

    expect(response.status).toBe(400);
  });

  test('accepts a signed approval and stores only anonymous credential material', async () => {
    const credential = crypto.randomBytes(32).toString('hex');
    const commitment = crypto.createHash('sha256').update(credential).digest('hex');
    const subject = commitment;
    const user = {
      eligibilityStatus: 'pending',
      save: jest.fn().mockResolvedValue(undefined)
    };
    const query = Promise.resolve(user);
    query.select = jest.fn().mockResolvedValue(user);
    jest.spyOn(User, 'findById').mockReturnValue(query);
    const payload = {
      voterId: VOTER_ID,
      status: 'eligible',
      authoritySubjectId: subject,
      credentialCommitment: commitment,
      credentialEnvelope: createCredentialEnvelope(credential, commitment),
      decisionId: 'decision-1',
      decidedAt: new Date().toISOString()
    };
    const signed = signedHeaders(payload);
    const response = await request(createApp())
      .post('/api/eligibility-authority/decision')
      .set('x-votechain-timestamp', signed.timestamp)
      .set('x-votechain-signature', signed.signature)
      .set('content-type', 'application/json')
      .send(signed.rawBody);

    expect(response.status).toBe(200);
    expect(user.eligibilityStatus).toBe('eligible');
    expect(user.authoritySubjectId).toBe(subject);
    expect(user.authorityCredentialCommitment).toBe(commitment);
    expect(user.authorityCredentialEnvelope).not.toContain(credential);
    expect(user.save).toHaveBeenCalledTimes(1);
  });

  test('delivers the anonymous credential only to the authenticated eligible account', async () => {
    const credential = crypto.randomBytes(32).toString('hex');
    const commitment = crypto.createHash('sha256').update(credential).digest('hex');
    const { encryptCredential } = require('../services/authorityCredentialVault');
    const credentialEnvelope = createCredentialEnvelope(credential, commitment);
    const user = {
      _id: VOTER_ID,
      isActive: true,
      eligibilityStatus: 'eligible',
      authoritySubjectId: commitment,
      authorityCredentialCommitment: commitment,
      authorityCredentialEnvelope: encryptCredential(JSON.stringify(credentialEnvelope))
    };
    jest.spyOn(User, 'findById').mockReturnValue({
      select: jest.fn().mockResolvedValue(user)
    });

    const token = jwt.sign({ id: VOTER_ID }, process.env.JWT_SECRET || 'development-jwt-secret-change-me');
    const response = await request(createApp())
      .get('/api/eligibility-authority/credential')
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body.credential).toBe(credential);
    expect(response.body.credentialCommitment).toBe(commitment);
  });
});
