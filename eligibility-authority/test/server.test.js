'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const {
  encryptStore,
  decryptStore,
  verifySignedRequest,
  createAnonymousCredential
} = require('../server');

test('encrypts authority records at rest and authenticates stored bytes', () => {
  process.env.ELIGIBILITY_AUTHORITY_DATA_KEY = crypto.randomBytes(32).toString('hex');
  const store = { cases: [{ voterId: 'example', aadhaarNumber: '000000000000' }] };
  const encrypted = encryptStore(store);

  assert.equal(encrypted.includes(Buffer.from('000000000000')), false);
  assert.deepEqual(decryptStore(encrypted), store);
  encrypted[encrypted.length - 1] ^= 1;
  assert.throws(() => decryptStore(encrypted));
});

test('verifies timestamped request signatures and rejects stale requests', () => {
  const secret = crypto.randomBytes(32).toString('hex');
  const timestamp = String(Date.now());
  const rawBody = Buffer.from('{"voterId":"case"}');
  const pathname = '/api/integrations/cases';
  const signature = crypto.createHmac('sha256', secret)
    .update(`${timestamp}\nPOST\n${pathname}\n${rawBody.toString('utf8')}`)
    .digest('hex');
  const request = {
    method: 'POST',
    headers: {
      'x-votechain-timestamp': timestamp,
      'x-votechain-signature': signature
    }
  };

  assert.equal(verifySignedRequest(request, pathname, rawBody, secret), true);
  assert.equal(verifySignedRequest(request, pathname, rawBody, secret), false);
  assert.equal(verifySignedRequest(request, pathname, rawBody, `${secret}wrong`), false);
  request.headers['x-votechain-timestamp'] = String(Date.now() - 6 * 60 * 1000);
  assert.equal(verifySignedRequest(request, pathname, rawBody, secret), false);
});

test('issues random anonymous authority credentials with a verifiable commitment', () => {
  const issued = createAnonymousCredential();

  assert.match(issued.authoritySubjectId, /^[a-f\d]{512}$/);
  assert.equal(issued.authoritySubjectId, issued.credentialCommitment);
  assert.match(issued.credential, /^[a-f\d]{512}$/);
});

test('runs an authenticated human-review and signed-decision round trip', async (context) => {
  const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'votechain-authority-test-'));
  const callbackSecret = crypto.randomBytes(32).toString('hex');
  const enrollmentSecret = crypto.randomBytes(32).toString('hex');
  let callbackPayload;
  const callbackServer = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const rawBody = Buffer.concat(chunks).toString('utf8');
    const timestamp = req.headers['x-votechain-timestamp'];
    const signature = crypto.createHmac('sha256', callbackSecret)
      .update(`${timestamp}\nPOST\n/api/eligibility-authority/decision\n${rawBody}`)
      .digest('hex');
    callbackPayload = JSON.parse(rawBody);
    res.writeHead(signature === req.headers['x-votechain-signature'] ? 200 : 401);
    res.end('{}');
  });
  await new Promise((resolve) => callbackServer.listen(0, '127.0.0.1', resolve));
  const callbackPort = callbackServer.address().port;
  const adminPassword = crypto.randomBytes(24).toString('hex');
  const child = spawn(process.execPath, ['server.js'], {
    cwd: path.resolve(__dirname, '..'),
    env: {
      ...process.env,
      PORT: '0',
      HOST: '127.0.0.1',
      NODE_ENV: 'test',
      ELIGIBILITY_AUTHORITY_ADMIN_PASSWORD: adminPassword,
      ELIGIBILITY_AUTHORITY_DATA_KEY: crypto.randomBytes(32).toString('hex'),
      ELIGIBILITY_AUTHORITY_CREDENTIAL_KEY: crypto.randomBytes(32).toString('hex'),
      VOTECHAIN_ENROLLMENT_HMAC_SECRET: enrollmentSecret,
      VOTECHAIN_CALLBACK_HMAC_SECRET: callbackSecret,
      VOTECHAIN_CALLBACK_URL: `http://127.0.0.1:${callbackPort}/api/eligibility-authority/decision`,
      ELIGIBILITY_AUTHORITY_DATA_FILE: path.join(tempDirectory, 'cases.enc')
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  context.after(async () => {
    child.kill();
    await new Promise((resolve) => callbackServer.close(resolve));
    await fs.promises.rm(tempDirectory, { recursive: true, force: true });
  });

  let output = '';
  const authorityPort = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Authority failed to start: ${output}`)), 10000);
    child.stdout.on('data', (chunk) => {
      output += chunk.toString();
      const match = output.match(/http:\/\/127\.0\.0\.1:(\d+)/);
      if (match) {
        clearTimeout(timeout);
        resolve(Number(match[1]));
      }
    });
    child.stderr.on('data', (chunk) => { output += chunk.toString(); });
    child.once('exit', (code) => reject(new Error(`Authority exited with ${code}: ${output}`)));
  });
  const baseUrl = `http://127.0.0.1:${authorityPort}`;
  const htmlResponse = await fetch(baseUrl);
  const html = await htmlResponse.text();
  assert.equal(htmlResponse.status, 200);
  assert.match(htmlResponse.headers.get('content-security-policy'), /script-src 'nonce-/);
  assert.match(html, /nonce="[A-Za-z0-9+/=]+"/);

  const loginResponse = await fetch(`${baseUrl}/api/admin/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password: adminPassword })
  });
  assert.equal(loginResponse.status, 200);
  const cookie = loginResponse.headers.get('set-cookie').split(';')[0];

  const voterId = '507f1f77bcf86cd799439021';
  const applicant = {
    voterId,
    firstName: 'Test',
    lastName: 'Applicant',
    email: 'applicant@example.test',
    phoneNumber: '1234567890',
    aadhaarNumber: '123456789012',
    emailVerified: true,
    phoneVerified: true,
    aadhaarOtpVerified: true,
    registeredAt: new Date().toISOString()
  };
  const rawBody = JSON.stringify(applicant);
  const timestamp = String(Date.now());
  const signature = crypto.createHmac('sha256', enrollmentSecret)
    .update(`${timestamp}\nPOST\n/api/integrations/cases\n${rawBody}`)
    .digest('hex');
  const enrollmentResponse = await fetch(`${baseUrl}/api/integrations/cases`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-votechain-timestamp': timestamp,
      'x-votechain-signature': signature
    },
    body: rawBody
  });
  assert.equal(enrollmentResponse.status, 202);

  const casesResponse = await fetch(`${baseUrl}/api/admin/cases`, {
    headers: { cookie }
  });
  const cases = await casesResponse.json();
  assert.equal(cases.cases[0].status, 'pending');

  const decisionResponse = await fetch(`${baseUrl}/api/admin/cases/${voterId}/decision`, {
    method: 'PATCH',
    headers: {
      cookie,
      origin: baseUrl,
      'content-type': 'application/json'
    },
    body: JSON.stringify({ status: 'eligible', note: 'Identity checked against evidence.' })
  });
  assert.equal(decisionResponse.status, 200);
  assert.equal(callbackPayload.status, 'eligible');
  assert.match(callbackPayload.authoritySubjectId, /^[a-f\d]{512}$/);
  assert.equal(callbackPayload.authoritySubjectId, callbackPayload.credentialCommitment);
  assert.equal(callbackPayload.anonymousCredential, undefined);
  assert.equal(callbackPayload.credentialEnvelope.scheme, 'jcj-civitas-v1-envelope');
  assert.equal(callbackPayload.credentialEnvelope.credentialCommitment, callbackPayload.credentialCommitment);
});
