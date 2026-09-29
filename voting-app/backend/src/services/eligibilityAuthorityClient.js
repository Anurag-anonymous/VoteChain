const crypto = require('crypto');

const MINIMUM_SECRET_LENGTH = 32;

const getRequiredSecret = (name) => {
  const secret = process.env[name];
  if (typeof secret !== 'string' || secret.length < MINIMUM_SECRET_LENGTH) {
    throw new Error(`${name} must be configured with at least ${MINIMUM_SECRET_LENGTH} characters`);
  }
  return secret;
};

const isConfigured = () => Boolean(
  process.env.ELIGIBILITY_AUTHORITY_URL &&
  process.env.ELIGIBILITY_AUTHORITY_ENROLLMENT_SECRET &&
  process.env.ELIGIBILITY_AUTHORITY_CALLBACK_SECRET &&
  process.env.ELIGIBILITY_AUTHORITY_CREDENTIAL_KEY
);

const buildApplicantPayload = (user) => ({
  voterId: user._id.toString(),
  firstName: user.firstName,
  lastName: user.lastName,
  email: user.email,
  phoneNumber: user.phoneNumber,
  aadhaarNumber: user.aadharNumber,
  emailVerified: Boolean(user.emailVerified),
  phoneVerified: Boolean(user.phoneVerified),
  aadhaarOtpVerified: Boolean(user.aadharVerified),
  registeredAt: user.createdAt ? new Date(user.createdAt).toISOString() : new Date().toISOString()
});

const signRequest = ({ timestamp, method, pathname, rawBody, secret }) => (
  crypto.createHmac('sha256', secret)
    .update(`${timestamp}\n${method}\n${pathname}\n${rawBody}`)
    .digest('hex')
);

const submitApplicant = async (user) => {
  if (!isConfigured()) {
    return { configured: false };
  }
  const endpoint = new URL('/api/integrations/cases', process.env.ELIGIBILITY_AUTHORITY_URL);
  if (!['http:', 'https:'].includes(endpoint.protocol) ||
      (endpoint.protocol === 'http:' && !['localhost', '127.0.0.1', '::1'].includes(endpoint.hostname))) {
    throw new Error('Eligibility Authority URL must use HTTPS outside localhost');
  }
  const rawBody = JSON.stringify(buildApplicantPayload(user));
  const timestamp = String(Date.now());
  const signature = signRequest({
    timestamp,
    method: 'POST',
    pathname: endpoint.pathname,
    rawBody,
    secret: getRequiredSecret('ELIGIBILITY_AUTHORITY_ENROLLMENT_SECRET')
  });
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-votechain-timestamp': timestamp,
      'x-votechain-signature': signature
    },
    body: rawBody,
    signal: AbortSignal.timeout(10000)
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(result.message || `Eligibility Authority rejected enrollment (${response.status})`);
  }
  return { configured: true, status: result.status || 'pending' };
};

const verifyDecisionSignature = (req) => {
  const timestamp = req.headers['x-votechain-timestamp'];
  const signature = req.headers['x-votechain-signature'];
  if (typeof timestamp !== 'string' || !/^\d{13}$/.test(timestamp) ||
      Math.abs(Date.now() - Number(timestamp)) > 5 * 60 * 1000 ||
      typeof signature !== 'string' || !Buffer.isBuffer(req.rawBody)) {
    return false;
  }
  let secret;
  try {
    secret = getRequiredSecret('ELIGIBILITY_AUTHORITY_CALLBACK_SECRET');
  } catch {
    return false;
  }
  const pathname = new URL(req.originalUrl, 'http://localhost').pathname;
  const expected = signRequest({
    timestamp,
    method: req.method,
    pathname,
    rawBody: req.rawBody.toString('utf8'),
    secret
  });
  const expectedBuffer = Buffer.from(expected);
  const signatureBuffer = Buffer.from(signature);
  return expectedBuffer.length === signatureBuffer.length &&
    crypto.timingSafeEqual(expectedBuffer, signatureBuffer);
};

module.exports = {
  buildApplicantPayload,
  isConfigured,
  submitApplicant,
  verifyDecisionSignature
};
