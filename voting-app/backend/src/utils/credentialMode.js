const crypto = require('crypto');

const getEncryptionKey = () => crypto
  .createHash('sha256')
  .update(process.env.JWT_SECRET || 'development-jwt-secret-change-me')
  .digest();

const encryptCredentialMode = (mode) => {
  if (mode !== 'genuine' && mode !== 'panic') {
    throw new Error('Invalid credential mode');
  }

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', getEncryptionKey(), iv);
  const plaintext = `${mode.padEnd(8, ' ')}:${crypto.randomBytes(32).toString('hex')}`;
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final()
  ]);
  return [
    iv.toString('base64'),
    cipher.getAuthTag().toString('base64'),
    ciphertext.toString('base64')
  ].join('.');
};

const decryptCredentialMode = (encryptedMode) => {
  const [ivValue, authTagValue, ciphertextValue] = String(encryptedMode || '').split('.');
  if (!ivValue || !authTagValue || !ciphertextValue) {
    throw new Error('Credential mode token claim is malformed');
  }

  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    getEncryptionKey(),
    Buffer.from(ivValue, 'base64')
  );
  decipher.setAuthTag(Buffer.from(authTagValue, 'base64'));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(ciphertextValue, 'base64')),
    decipher.final()
  ]).toString('utf8');
  const mode = plaintext.slice(0, 8).trim();
  if (mode !== 'genuine' && mode !== 'panic') {
    throw new Error('Credential mode token claim is invalid');
  }
  return mode;
};

const readCredentialMode = (tokenPayload) => {
  if (tokenPayload.credentialModeEnvelope) {
    return decryptCredentialMode(tokenPayload.credentialModeEnvelope);
  }
  return tokenPayload.credentialMode === 'panic' ? 'panic' : 'genuine';
};

module.exports = {
  encryptCredentialMode,
  decryptCredentialMode,
  readCredentialMode
};
