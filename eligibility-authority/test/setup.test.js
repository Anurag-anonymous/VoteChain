'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const createSetupDirectory = (context, existingEnv) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'votechain-authority-setup-test-'));
  fs.copyFileSync(path.join(__dirname, '..', 'setup.js'), path.join(directory, 'setup.js'));
  if (existingEnv !== undefined) {
    fs.writeFileSync(path.join(directory, '.env'), existingEnv);
  }
  context.after(() => fs.promises.rm(directory, { recursive: true, force: true }));
  return directory;
};

test('adds a missing credential key without rotating existing authority secrets', (context) => {
  const existingEnv = [
    'ELIGIBILITY_AUTHORITY_ADMIN_PASSWORD=existing-reviewer-password',
    `ELIGIBILITY_AUTHORITY_DATA_KEY=${'a'.repeat(64)}`,
    `VOTECHAIN_ENROLLMENT_HMAC_SECRET=${'b'.repeat(64)}`,
    `VOTECHAIN_CALLBACK_HMAC_SECRET=${'c'.repeat(64)}`
  ].join('\n');
  const directory = createSetupDirectory(context, existingEnv);
  const output = execFileSync(process.execPath, ['setup.js'], {
    cwd: directory,
    encoding: 'utf8'
  });
  const updatedEnv = fs.readFileSync(path.join(directory, '.env'), 'utf8');
  const credentialKey = updatedEnv.match(/^ELIGIBILITY_AUTHORITY_CREDENTIAL_KEY=(.*)$/m)?.[1];

  assert.match(credentialKey || '', /^[a-f\d]{64}$/);
  assert.match(updatedEnv, /ELIGIBILITY_AUTHORITY_ADMIN_PASSWORD=existing-reviewer-password/);
  assert.match(updatedEnv, new RegExp(`ELIGIBILITY_AUTHORITY_DATA_KEY=${'a'.repeat(64)}`));
  assert.match(output, new RegExp(`ELIGIBILITY_AUTHORITY_CREDENTIAL_KEY=${credentialKey}`));
});

test('writes and prints the same credential key for a new setup', (context) => {
  const directory = createSetupDirectory(context);
  const output = execFileSync(process.execPath, ['setup.js'], {
    cwd: directory,
    encoding: 'utf8'
  });
  const env = fs.readFileSync(path.join(directory, '.env'), 'utf8');
  const credentialKey = env.match(/^ELIGIBILITY_AUTHORITY_CREDENTIAL_KEY=(.*)$/m)?.[1];

  assert.match(credentialKey || '', /^[a-f\d]{64}$/);
  assert.match(output, new RegExp(`ELIGIBILITY_AUTHORITY_CREDENTIAL_KEY=${credentialKey}`));
});
