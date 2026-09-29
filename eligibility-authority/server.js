'use strict';

const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { URL } = require('url');

const envFile = path.join(__dirname, '.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (!match || line.trimStart().startsWith('#') || process.env[match[1]] !== undefined) continue;
    const value = match[2].replace(/^(['"])(.*)\1$/, '$2');
    process.env[match[1]] = value;
  }
}

const PORT = Number.parseInt(process.env.PORT || '5100', 10);
const HOST = process.env.HOST || '127.0.0.1';
const DATA_FILE = process.env.ELIGIBILITY_AUTHORITY_DATA_FILE ||
  path.join(__dirname, 'data', 'cases.enc');
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const REQUEST_WINDOW_MS = 5 * 60 * 1000;
const MAX_BODY_BYTES = 64 * 1024;
const JCJ_P = BigInt(`0xFFFFFFFFFFFFFFFFC90FDAA22168C234C4C6628B80DC1CD129024E088A67CC74020BBEA63B139B22514A08798E3404DDEF9519B3CD3A431B302B0A6DF25F14374FE1356D6D51C245E485B576625E7EC6F44C42E9A637ED6B0BFF5CB6F406B7EDEE386BFB5A899FA5AE9F24117C4B1FE649286651ECE45B3DC2007CB8A163BF0598DA48361C55D39A69163FA8FD24CF5F83655D23DCA3AD961C62F356208552BB9ED529077096966D670C354E4ABC9804F1746C08CA18217C32905E462E36CE3BE39E772C180E86039B2783A2EC07A28FB5C55DF06F4C52C9DE2BCBF6955817183995497CEA956AE515D2261898FA051015728E5A8AACAA68FFFFFFFFFFFFFFFF`);
const JCJ_Q = (JCJ_P - 1n) / 2n;
const jcjModPow = (base, exponent, modulus) => {
  let result = 1n;
  let value = base % modulus;
  let power = exponent;
  while (power > 0n) {
    if (power & 1n) result = (result * value) % modulus;
    value = (value * value) % modulus;
    power >>= 1n;
  }
  return result;
};
const sessions = new Map();
const loginAttempts = new Map();
const replayedRequests = new Map();

const requiredSecret = (name, minimumLength = 32) => {
  const value = process.env[name];
  if (!value || value.length < minimumLength) {
    throw new Error(
      `${name} is missing or too short. From this directory, run "npm run setup" once, ` +
      'or rerun with "npm run setup -- --force" if your existing .env is placeholder-based. ' +
      'Then run "npm start". Keep the generated reviewer password and .env file private.'
    );
  }
  return value;
};

const getEncryptionKey = () => {
  const key = requiredSecret('ELIGIBILITY_AUTHORITY_DATA_KEY', 64);
  if (!/^[0-9a-f]{64}$/i.test(key)) {
    throw new Error('ELIGIBILITY_AUTHORITY_DATA_KEY must be 32 bytes encoded as 64 hexadecimal characters');
  }
  return Buffer.from(key, 'hex');
};

const safeEqual = (left, right) => {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
};

const sendJson = (res, status, body, extraHeaders = {}) => {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    ...extraHeaders
  });
  res.end(payload);
};

const encryptStore = (value) => {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', getEncryptionKey(), iv);
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(value), 'utf8'),
    cipher.final()
  ]);
  return Buffer.concat([Buffer.from('VCEA1'), iv, cipher.getAuthTag(), ciphertext]);
};

const decryptStore = (value) => {
  if (value.subarray(0, 5).toString() !== 'VCEA1' || value.length < 33) {
    throw new Error('Encrypted authority case store has an unsupported format');
  }
  const iv = value.subarray(5, 17);
  const tag = value.subarray(17, 33);
  const decipher = crypto.createDecipheriv('aes-256-gcm', getEncryptionKey(), iv);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([
    decipher.update(value.subarray(33)),
    decipher.final()
  ]).toString('utf8');
  return JSON.parse(plaintext);
};

let store = { cases: [] };
let writeQueue = Promise.resolve();

const loadStore = () => {
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true, mode: 0o700 });
  try {
    store = decryptStore(fs.readFileSync(DATA_FILE));
    if (!store || !Array.isArray(store.cases)) {
      throw new Error('Authority case store is malformed');
    }
  } catch (error) {
    if (error.code === 'ENOENT') return;
    throw error;
  }
};

const persistStore = () => {
  const payload = encryptStore(store);
  const tempFile = `${DATA_FILE}.${crypto.randomBytes(8).toString('hex')}.tmp`;
  const write = writeQueue.then(async () => {
    await fs.promises.writeFile(tempFile, payload, { mode: 0o600, flag: 'wx' });
    await fs.promises.rename(tempFile, DATA_FILE);
  });
  writeQueue = write.catch(async (error) => {
    await fs.promises.rm(tempFile, { force: true });
  });
  return write;
};

const readBody = (req) => new Promise((resolve, reject) => {
  let size = 0;
  let tooLarge = false;
  const chunks = [];
  req.on('data', (chunk) => {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      tooLarge = true;
      chunks.length = 0;
      return;
    }
    if (!tooLarge) chunks.push(chunk);
  });
  req.on('end', () => {
    if (tooLarge) {
      reject(Object.assign(new Error('Request body is too large'), { statusCode: 413 }));
      return;
    }
    try {
      const raw = Buffer.concat(chunks);
      const value = raw.length ? JSON.parse(raw.toString('utf8')) : {};
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        reject(Object.assign(new Error('Request JSON must be an object'), { statusCode: 400 }));
        return;
      }
      resolve({ raw, value });
    } catch {
      reject(Object.assign(new Error('Request body must be valid JSON'), { statusCode: 400 }));
    }
  });
  req.on('error', reject);
});

const verifySignedRequest = (req, pathname, rawBody, secret) => {
  const timestamp = req.headers['x-votechain-timestamp'];
  const signature = req.headers['x-votechain-signature'];
  if (typeof timestamp !== 'string' || !/^\d{13}$/.test(timestamp) ||
      Math.abs(Date.now() - Number(timestamp)) > REQUEST_WINDOW_MS ||
      typeof signature !== 'string') {
    return false;
  }
  const content = `${timestamp}\n${req.method}\n${pathname}\n${rawBody.toString('utf8')}`;
  const expected = crypto.createHmac('sha256', secret).update(content).digest('hex');
  if (!safeEqual(signature, expected)) return false;

  const replayKey = `${req.method}:${pathname}:${signature}`;
  const now = Date.now();
  for (const [key, expiresAt] of replayedRequests) {
    if (expiresAt <= now) replayedRequests.delete(key);
  }
  if (replayedRequests.has(replayKey)) return false;
  replayedRequests.set(replayKey, now + REQUEST_WINDOW_MS);
  return true;
};

const getCookie = (req, key) => {
  const cookie = req.headers.cookie || '';
  const match = cookie.split(';').map((part) => part.trim())
    .find((part) => part.startsWith(`${key}=`));
  return match ? decodeURIComponent(match.slice(key.length + 1)) : '';
};

const getSession = (req) => {
  const token = getCookie(req, 'ea_session');
  const session = sessions.get(token);
  if (!session || session.expiresAt <= Date.now()) {
    sessions.delete(token);
    return null;
  }
  return { token, session };
};

const requireReviewer = (req, res) => {
  if (getSession(req)) return true;
  sendJson(res, 401, { success: false, message: 'Reviewer login required' });
  return false;
};

const secureCookieOptions = () => (
  `HttpOnly; SameSite=Strict; Path=/; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}` +
  (process.env.NODE_ENV === 'production' ? '; Secure' : '')
);

const createAnonymousCredential = () => {
  const scalar = (BigInt(`0x${crypto.randomBytes(32).toString('hex')}`) % JCJ_Q) || 1n;
  const credential = scalar.toString(16).padStart(512, '0');
  const credentialCommitment = jcjModPow(2n, scalar, JCJ_P).toString(16).padStart(512, '0');
  return {
    authoritySubjectId: credentialCommitment,
    credential,
    credentialCommitment
  };
};

const encryptCredentialEnvelope = (credential, credentialCommitment) => {
    const keyValue = requiredSecret('ELIGIBILITY_AUTHORITY_CREDENTIAL_KEY');
    if (!/^[a-f\d]{64}$/i.test(keyValue)) {
      throw new Error('ELIGIBILITY_AUTHORITY_CREDENTIAL_KEY must be 32 random bytes encoded as 64 hex characters');
    }
    const key = Buffer.from(keyValue, 'hex');
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const ciphertext = Buffer.concat([cipher.update(credential, 'utf8'), cipher.final()]);
    return {
      scheme: 'jcj-civitas-v1-envelope',
      keyVersion: process.env.ELIGIBILITY_AUTHORITY_CREDENTIAL_KEY_VERSION || 'v1',
      credentialCommitment,
      ciphertext: [
        iv.toString('base64'),
        cipher.getAuthTag().toString('base64'),
        ciphertext.toString('base64')
      ].join('.')
  };
};

const sendDecisionToVoteChain = async (record) => {
  const callbackUrl = process.env.VOTECHAIN_CALLBACK_URL;
  if (!callbackUrl) {
    throw new Error('VOTECHAIN_CALLBACK_URL is not configured');
  }
  const payload = {
    voterId: record.voterId,
    status: record.status,
    authoritySubjectId: record.status === 'eligible' ? record.authoritySubjectId : null,
    credentialCommitment: record.status === 'eligible' ? record.credentialCommitment : null,
    credentialEnvelope: record.status === 'eligible'
      ? encryptCredentialEnvelope(record.credential, record.credentialCommitment)
      : null,
    decisionId: record.decisionId,
    decidedAt: record.decidedAt
  };
  const rawBody = JSON.stringify(payload);
  const timestamp = String(Date.now());
  const endpoint = new URL(callbackUrl);
  if (!['http:', 'https:'].includes(endpoint.protocol) ||
      (endpoint.protocol === 'http:' && !['localhost', '127.0.0.1', '::1'].includes(endpoint.hostname))) {
    throw new Error('VoteChain callback URL must use HTTPS outside localhost');
  }
  const signature = crypto.createHmac('sha256', requiredSecret('VOTECHAIN_CALLBACK_HMAC_SECRET'))
    .update(`${timestamp}\nPOST\n${endpoint.pathname}\n${rawBody}`)
    .digest('hex');
  const response = await fetch(callbackUrl, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-votechain-timestamp': timestamp,
      'x-votechain-signature': signature
    },
    body: rawBody,
    signal: AbortSignal.timeout(10000)
  });
  if (!response.ok) {
    const responseText = await response.text();
    throw new Error(`VoteChain decision sync failed (${response.status}): ${responseText.slice(0, 300)}`);
  }
};

const html = fs.readFileSync(path.join(__dirname, 'public', 'index.html'));

const handleRequest = async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = url.pathname;

  if (req.method === 'GET' && pathname === '/') {
    const nonce = crypto.randomBytes(18).toString('base64');
    const page = html.toString().replaceAll('__CSP_NONCE__', nonce);
    const pageBuffer = Buffer.from(page);
    res.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      'content-length': pageBuffer.length,
      'cache-control': 'no-store',
      'content-security-policy': `default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'nonce-${nonce}'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'`,
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer'
    });
    res.end(pageBuffer);
    return;
  }

  if (req.method === 'GET' && pathname === '/api/health') {
    sendJson(res, 200, { success: true, service: 'eligibility-authority' });
    return;
  }

  const body = ['POST', 'PATCH'].includes(req.method)
    ? await readBody(req)
    : { raw: Buffer.alloc(0), value: {} };

  if (req.method === 'POST' && pathname === '/api/admin/login') {
    const ip = req.socket.remoteAddress || 'unknown';
    const attempts = loginAttempts.get(ip) || { count: 0, resetAt: Date.now() + 15 * 60 * 1000 };
    if (attempts.resetAt <= Date.now()) {
      attempts.count = 0;
      attempts.resetAt = Date.now() + 15 * 60 * 1000;
    }
    if (attempts.count >= 5) {
      sendJson(res, 429, { success: false, message: 'Too many login attempts; try again later' });
      return;
    }
    const supplied = typeof body.value.password === 'string' ? body.value.password : '';
    const configured = requiredSecret('ELIGIBILITY_AUTHORITY_ADMIN_PASSWORD', 16);
    const suppliedDigest = crypto.scryptSync(supplied, 'votechain-authority-reviewer-v1', 32);
    const configuredDigest = crypto.scryptSync(configured, 'votechain-authority-reviewer-v1', 32);
    if (!safeEqual(suppliedDigest, configuredDigest)) {
      attempts.count += 1;
      loginAttempts.set(ip, attempts);
      sendJson(res, 401, { success: false, message: 'Invalid reviewer password' });
      return;
    }
    loginAttempts.delete(ip);
    const token = crypto.randomBytes(32).toString('base64url');
    sessions.set(token, { expiresAt: Date.now() + SESSION_TTL_MS });
    sendJson(res, 200, { success: true }, { 'set-cookie': `ea_session=${encodeURIComponent(token)}; ${secureCookieOptions()}` });
    return;
  }

  if (req.method === 'POST' && pathname === '/api/admin/logout') {
    const current = getSession(req);
    if (current) sessions.delete(current.token);
    sendJson(res, 200, { success: true }, {
      'set-cookie': 'ea_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0'
    });
    return;
  }

  if (req.method === 'POST' && pathname === '/api/integrations/cases') {
    if (!verifySignedRequest(req, pathname, body.raw, requiredSecret('VOTECHAIN_ENROLLMENT_HMAC_SECRET'))) {
      sendJson(res, 401, { success: false, message: 'Invalid or expired VoteChain signature' });
      return;
    }
    const applicant = body.value;
    const voterId = typeof applicant.voterId === 'string' ? applicant.voterId : '';
    if (!/^[a-f\d]{24}$/i.test(voterId) ||
        typeof applicant.firstName !== 'string' || !applicant.firstName.trim() ||
        typeof applicant.lastName !== 'string' || !applicant.lastName.trim() ||
        typeof applicant.email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(applicant.email) ||
        typeof applicant.phoneNumber !== 'string' || !/^\d{10,15}$/.test(applicant.phoneNumber) ||
        !/^\d{12}$/.test(applicant.aadhaarNumber || '')) {
      sendJson(res, 400, { success: false, message: 'Required applicant identity fields are missing' });
      return;
    }
    let record = store.cases.find((item) => item.voterId === voterId);
    if (!record) {
      record = {
        voterId,
        status: 'pending',
        submittedAt: new Date().toISOString(),
        applicant: {},
        audit: []
      };
      store.cases.push(record);
    }
    if (record.status === 'pending' || record.status === 'needs_info') {
      record.applicant = {
        firstName: String(applicant.firstName).slice(0, 100),
        lastName: String(applicant.lastName).slice(0, 100),
        email: String(applicant.email).slice(0, 254),
        phoneNumber: String(applicant.phoneNumber).slice(0, 32),
        aadhaarNumber: String(applicant.aadhaarNumber).slice(0, 12),
        emailVerified: Boolean(applicant.emailVerified),
        phoneVerified: Boolean(applicant.phoneVerified),
        aadhaarOtpVerified: Boolean(applicant.aadhaarOtpVerified),
        registeredAt: String(applicant.registeredAt || '').slice(0, 40)
      };
    } else if (record.status === 'rejected') {
      sendJson(res, 409, {
        success: false,
        message: 'This case has a rejection decision; contact the Eligibility Authority to appeal'
      });
      return;
    }
    record.lastReceivedAt = new Date().toISOString();
    await persistStore();
    sendJson(res, 202, { success: true, status: record.status });
    return;
  }

  if (req.method === 'GET' && pathname === '/api/admin/session') {
    sendJson(res, getSession(req) ? 200 : 401, { success: Boolean(getSession(req)) });
    return;
  }

  if (req.method === 'GET' && pathname === '/api/admin/cases') {
    if (!requireReviewer(req, res)) return;
    const status = url.searchParams.get('status');
    const records = store.cases
      .filter((record) => !status || record.status === status)
      .sort((left, right) => right.submittedAt.localeCompare(left.submittedAt))
      .map((record) => ({
        voterId: record.voterId,
        name: `${record.applicant.firstName} ${record.applicant.lastName}`,
        email: record.applicant.email,
        status: record.status,
        submittedAt: record.submittedAt,
        emailVerified: record.applicant.emailVerified,
        phoneVerified: record.applicant.phoneVerified,
        aadhaarOtpVerified: record.applicant.aadhaarOtpVerified,
        callbackPending: Boolean(record.callbackPending)
      }));
    sendJson(res, 200, { success: true, cases: records });
    return;
  }

  const caseMatch = pathname.match(/^\/api\/admin\/cases\/([a-f\d]{24})(?:\/decision)?$/i);
  if (req.method === 'GET' && caseMatch && !pathname.endsWith('/decision')) {
    if (!requireReviewer(req, res)) return;
    const record = store.cases.find((item) => item.voterId === caseMatch[1]);
    if (!record) {
      sendJson(res, 404, { success: false, message: 'Case not found' });
      return;
    }
    sendJson(res, 200, {
      success: true,
      case: {
        voterId: record.voterId,
        applicant: record.applicant,
        status: record.status,
        submittedAt: record.submittedAt,
        note: record.note || '',
        audit: record.audit,
        callbackPending: Boolean(record.callbackPending)
      }
    });
    return;
  }

  if (req.method === 'PATCH' && caseMatch && pathname.endsWith('/decision')) {
    if (!requireReviewer(req, res)) return;
    if (req.headers.origin) {
      let origin;
      try {
        origin = new URL(req.headers.origin);
      } catch {
        sendJson(res, 403, { success: false, message: 'Cross-origin reviewer request refused' });
        return;
      }
      if (req.headers.host && origin.host !== req.headers.host) {
        sendJson(res, 403, { success: false, message: 'Cross-origin reviewer request refused' });
        return;
      }
    }
    const record = store.cases.find((item) => item.voterId === caseMatch[1]);
    const { status, note = '' } = body.value;
    if (!record) {
      sendJson(res, 404, { success: false, message: 'Case not found' });
      return;
    }
    if (!['eligible', 'rejected', 'needs_info'].includes(status) || typeof note !== 'string' || note.length > 2000) {
      sendJson(res, 400, { success: false, message: 'Decision must be eligible, rejected, or needs_info; note limit is 2,000 characters' });
      return;
    }
    const priorStatus = record.status;
    record.status = status;
    record.note = note.trim();
    record.decidedAt = new Date().toISOString();
    record.decisionId = crypto.randomUUID();
    if (status === 'eligible') {
      const credential = createAnonymousCredential();
      record.authoritySubjectId = credential.authoritySubjectId;
      record.credential = credential.credential;
      record.credentialCommitment = credential.credentialCommitment;
    } else {
      record.authoritySubjectId = null;
      record.credential = null;
      record.credentialCommitment = null;
    }
    record.audit.push({
      from: priorStatus,
      to: status,
      at: record.decidedAt,
      note: record.note
    });
    try {
      await sendDecisionToVoteChain(record);
      record.callbackPending = false;
    } catch (error) {
      record.callbackPending = true;
      record.lastCallbackError = error.message;
      await persistStore();
      sendJson(res, 502, {
        success: false,
        message: 'Decision saved in the authority but could not sync to VoteChain',
        syncPending: true
      });
      return;
    }
    record.lastCallbackError = null;
    await persistStore();
    sendJson(res, 200, { success: true, status: record.status, decisionId: record.decisionId });
    return;
  }

  sendJson(res, 404, { success: false, message: 'Not found' });
};

const start = () => {
  requiredSecret('ELIGIBILITY_AUTHORITY_ADMIN_PASSWORD', 16);
  requiredSecret('VOTECHAIN_ENROLLMENT_HMAC_SECRET');
  requiredSecret('VOTECHAIN_CALLBACK_HMAC_SECRET');
  requiredSecret('ELIGIBILITY_AUTHORITY_CREDENTIAL_KEY');
  getEncryptionKey();
  loadStore();
  const server = http.createServer((req, res) => {
    handleRequest(req, res).catch((error) => {
      const status = error.statusCode || 500;
      sendJson(res, status, {
        success: false,
        message: status === 500 ? 'Eligibility authority request failed' : error.message
      });
      if (status === 500) console.error('Eligibility authority request failed:', error.message);
    });
  });
  server.listen(PORT, HOST, () => {
    console.log(`Eligibility Authority listening at http://${HOST}:${server.address().port}`);
  });
  server.on('error', (error) => {
    console.error('Eligibility Authority failed to start:', error.message);
    process.exitCode = 1;
  });
};

if (require.main === module) start();

module.exports = {
  encryptStore,
  decryptStore,
  verifySignedRequest,
  createAnonymousCredential
};
