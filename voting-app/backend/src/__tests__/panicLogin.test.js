const jwt = require('jsonwebtoken');
const User = require('../models/User');
const AuthController = require('../controllers/authController');
const {
  decryptCredentialMode,
  encryptCredentialMode
} = require('../utils/credentialMode');

jest.mock('../models/User', () => ({
  findOne: jest.fn(),
  findById: jest.fn()
}));

const JWT_SECRET = process.env.JWT_SECRET || 'development-jwt-secret-change-me';

const makeResponse = () => {
  const response = {};
  response.status = jest.fn(() => response);
  response.json = jest.fn(() => response);
  return response;
};

describe('panic login credentials', () => {
  afterEach(() => {
    jest.resetAllMocks();
  });

  test('session mode has an encrypted fixed-length token representation', () => {
    const genuineEnvelope = encryptCredentialMode('genuine');
    const panicEnvelope = encryptCredentialMode('panic');

    expect(genuineEnvelope).not.toBe(panicEnvelope);
    expect(genuineEnvelope).toHaveLength(panicEnvelope.length);
    expect(decryptCredentialMode(genuineEnvelope)).toBe('genuine');
    expect(decryptCredentialMode(panicEnvelope)).toBe('panic');
  });

  test('panic password login issues a session marked for private panic credentials', async () => {
    const user = {
      _id: 'voter-1',
      email: 'voter@example.com',
      firstName: 'Test',
      lastName: 'Voter',
      emailVerified: true,
      phoneVerified: true,
      aadharVerified: true,
      accountLocked: false,
      comparePassword: jest.fn().mockResolvedValue(false),
      comparePanicPassword: jest.fn().mockResolvedValue(true),
      resetLoginAttempts: jest.fn().mockResolvedValue(undefined)
    };
    User.findOne.mockReturnValue({
      select: jest.fn().mockResolvedValue(user)
    });
    const response = makeResponse();

    await AuthController.login({
      body: { email: user.email, password: 'panic-secret' }
    }, response);

    expect(response.status).toHaveBeenCalledWith(200);
    const responseBody = response.json.mock.calls[0][0];
    const accessPayload = jwt.verify(responseBody.token, JWT_SECRET);
    const refreshPayload = jwt.verify(
      responseBody.refreshToken,
      process.env.REFRESH_TOKEN_SECRET || 'development-refresh-secret-change-me'
    );
    expect(accessPayload).not.toHaveProperty('credentialMode');
    expect(refreshPayload).not.toHaveProperty('credentialMode');
    expect(decryptCredentialMode(accessPayload.credentialModeEnvelope)).toBe('panic');
    expect(decryptCredentialMode(refreshPayload.credentialModeEnvelope)).toBe('panic');
    expect(responseBody.user).not.toHaveProperty('credentialMode');
  });

  test('registration requires a distinct decoy password', async () => {
    const response = makeResponse();

    await AuthController.register({
      body: {
        firstName: 'Test',
        lastName: 'Voter',
        email: 'voter@example.com',
        phoneNumber: '9876543210',
        aadharNumber: '123456789012',
        password: 'normal-password'
      }
    }, response);

    expect(response.status).toHaveBeenCalledWith(400);
    expect(response.json.mock.calls[0][0].message).toMatch(/decoy account password are required/i);

    const matchingPasswordResponse = makeResponse();
    await AuthController.register({
      body: {
        firstName: 'Test',
        lastName: 'Voter',
        email: 'voter@example.com',
        phoneNumber: '9876543210',
        aadharNumber: '123456789012',
        password: 'same-password',
        panicPassword: 'same-password'
      }
    }, matchingPasswordResponse);

    expect(matchingPasswordResponse.status).toHaveBeenCalledWith(400);
    expect(matchingPasswordResponse.json.mock.calls[0][0].message).toMatch(/must differ/i);
  });

  test('registration rejects decoy passwords shorter than eight characters', async () => {
    const response = makeResponse();

    await AuthController.register({
      body: {
        firstName: 'Test',
        lastName: 'Voter',
        email: 'voter@example.com',
        phoneNumber: '9876543210',
        aadharNumber: '123456789012',
        password: 'normal-password',
        panicPassword: 'short'
      }
    }, response);

    expect(response.status).toHaveBeenCalledWith(400);
    expect(response.json.mock.calls[0][0].message).toMatch(/at least 8 characters/i);
  });
});
