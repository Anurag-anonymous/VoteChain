const crypto = require('crypto');

const getKey = () => {
  const value = process.env.ELIGIBILITY_AUTHORITY_CREDENTIAL_KEY;
  if (typeof value !== 'string' || !/^[a-f\d]{64}$/i.test(value)) {
    throw new Error('ELIGIBILITY_AUTHORITY_CREDENTIAL_KEY must be set to 32 random bytes encoded as 64 hex characters');
  }
  return Buffer.from(value, 'hex');
};

const encryptCredential = (credential) => {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', getKey(), iv);
  const ciphertext = Buffer.concat([
    cipher.update(credential, 'utf8'),
    cipher.final()
  ]);
  return [
    iv.toString('base64'),
    cipher.getAuthTag().toString('base64'),
    ciphertext.toString('base64')
  ].join('.');
};

const decryptCredential = (envelope) => {
  if (typeof envelope !== 'string') throw new Error('No anonymous credential is stored');
  const [iv, tag, ciphertext] = envelope.split('.');
  if (!iv || !tag || !ciphertext) throw new Error('Stored anonymous credential is malformed');
  const decipher = crypto.createDecipheriv('aes-256-gcm', getKey(), Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertext, 'base64')),
    decipher.final()
  ]).toString('utf8');
};

const decryptCredentialEnvelope = (envelope) => {
  if (!envelope || envelope.scheme !== 'jcj-civitas-v1-envelope' ||
      typeof envelope.ciphertext !== 'string') {
    throw new Error('JCJ credential envelope is malformed');
  }
  const [iv, tag, ciphertext] = envelope.ciphertext.split('.');
  if (!iv || !tag || !ciphertext) throw new Error('JCJ credential ciphertext is malformed');
  const decipher = crypto.createDecipheriv('aes-256-gcm', getKey(), Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertext, 'base64')),
    decipher.final()
  ]).toString('utf8');
};

module.exports = { encryptCredential, decryptCredential, decryptCredentialEnvelope };
