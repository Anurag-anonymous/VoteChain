'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const envPath = path.join(__dirname, '.env');
const force = process.argv.includes('--force') || process.argv.includes('-f');
const placeholderPattern = /replace-with-|must-be-configured|change-me/i;

const existingEnv = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';
const isExistingConfigUsable = existingEnv.includes('ELIGIBILITY_AUTHORITY_ADMIN_PASSWORD=') &&
  !placeholderPattern.test(existingEnv) &&
  /ELIGIBILITY_AUTHORITY_ADMIN_PASSWORD=.{16,}/.test(existingEnv);
const existingCredentialKey = existingEnv.match(/^ELIGIBILITY_AUTHORITY_CREDENTIAL_KEY=(.*)$/m)?.[1];
const hasValidCredentialKey = /^[a-f\d]{64}$/i.test(existingCredentialKey || '');

if (fs.existsSync(envPath) && !force && isExistingConfigUsable) {
  if (hasValidCredentialKey) {
    console.error('.env already exists with a valid configuration. Nothing changed.');
    console.error('If you need to regenerate secrets, rerun: npm run setup -- --force');
    process.exit(0);
  }

  const credentialKey = crypto.randomBytes(32).toString('hex');
  const updatedEnv = existingCredentialKey === undefined
    ? `${existingEnv.trimEnd()}\nELIGIBILITY_AUTHORITY_CREDENTIAL_KEY=${credentialKey}\n`
    : existingEnv.replace(
      /^ELIGIBILITY_AUTHORITY_CREDENTIAL_KEY=.*$/m,
      `ELIGIBILITY_AUTHORITY_CREDENTIAL_KEY=${credentialKey}`
    );
  fs.writeFileSync(envPath, updatedEnv, { mode: 0o600 });
  console.log('Added the missing credential-encryption key to .env.');
  console.log('Set this same key in VoteChain backend/.env:');
  console.log(`ELIGIBILITY_AUTHORITY_CREDENTIAL_KEY=${credentialKey}`);
  process.exit(0);
}

if (fs.existsSync(envPath) && !force) {
  console.warn('.env already exists but looks incomplete or placeholder-based.');
  console.warn('Regenerating it will rotate reviewer credentials and HMAC secrets.');
  console.warn('Run: npm run setup -- --force');
  process.exit(1);
}

const reviewerPassword = crypto.randomBytes(32).toString('base64url');
const dataKey = crypto.randomBytes(32).toString('hex');
const enrollmentSecret = crypto.randomBytes(32).toString('hex');
const callbackSecret = crypto.randomBytes(32).toString('hex');
const credentialKey = crypto.randomBytes(32).toString('hex');
const env = [
  'PORT=5100',
  'HOST=127.0.0.1',
  'NODE_ENV=development',
  `ELIGIBILITY_AUTHORITY_ADMIN_PASSWORD=${reviewerPassword}`,
  `ELIGIBILITY_AUTHORITY_DATA_KEY=${dataKey}`,
  `ELIGIBILITY_AUTHORITY_CREDENTIAL_KEY=${credentialKey}`,
  `VOTECHAIN_ENROLLMENT_HMAC_SECRET=${enrollmentSecret}`,
  'VOTECHAIN_CALLBACK_URL=http://127.0.0.1:5000/api/eligibility-authority/decision',
  `VOTECHAIN_CALLBACK_HMAC_SECRET=${callbackSecret}`,
  ''
].join('\n');

fs.writeFileSync(envPath, env, { mode: 0o600 });
console.log('Eligibility Authority configuration created in .env.');
console.log('Set the matching secrets in VoteChain backend/.env:');
console.log(`ELIGIBILITY_AUTHORITY_ENROLLMENT_SECRET=${enrollmentSecret}`);
console.log(`ELIGIBILITY_AUTHORITY_CALLBACK_SECRET=${callbackSecret}`);
console.log(`ELIGIBILITY_AUTHORITY_CREDENTIAL_KEY=${credentialKey}`);
console.log('');
console.log('Save this one-time reviewer password securely:');
console.log(reviewerPassword);
console.log('');
console.log('Then start the service with: npm start');
