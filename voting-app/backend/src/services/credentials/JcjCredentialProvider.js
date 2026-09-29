const CredentialProvider = require('./CredentialProvider');

/**
 * Adapter for an independently audited JCJ/Civitas cryptographic service.
 * Node.js never implements group arithmetic or zero-knowledge proofs here.
 */
class JcjCredentialProvider extends CredentialProvider {
  constructor({ baseUrl = process.env.JCJ_PROVIDER_URL } = {}) {
    super();
    if (!baseUrl) {
      throw new Error('JCJ_PROVIDER_URL must point to the audited credential service');
    }
    const endpoint = new URL(baseUrl);
    if (process.env.NODE_ENV === 'production' && endpoint.protocol !== 'https:') {
      throw new Error('JCJ_PROVIDER_URL must use HTTPS in production');
    }
    this.baseUrl = endpoint;
  }

  async call(path, payload) {
    const response = await fetch(new URL(path, this.baseUrl), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10000)
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(result.message || `JCJ provider rejected ${path}`);
    }
    return result;
  }

  issueCredential(payload) {
    return this.call('/v1/credentials/issue', payload);
  }

  proveEligibility(payload) {
    return this.call('/v1/credentials/prove', payload);
  }

  verifyEligibilityProof(payload) {
    return this.call('/v1/credentials/verify', payload);
  }

  revoke(payload) {
    return this.call('/v1/credentials/revoke', payload);
  }
}

module.exports = JcjCredentialProvider;
