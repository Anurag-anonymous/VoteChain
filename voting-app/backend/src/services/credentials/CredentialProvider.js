class CredentialProvider {
  issueCredential() {
    throw new Error('issueCredential must be implemented by a credential provider');
  }

  proveEligibility() {
    throw new Error('proveEligibility must be implemented by a credential provider');
  }

  verifyEligibilityProof() {
    throw new Error('verifyEligibilityProof must be implemented by a credential provider');
  }

  deriveElectionScopedIdentifier() {
    throw new Error('deriveElectionScopedIdentifier must be implemented by a credential provider');
  }

  revoke() {
    throw new Error('revoke must be implemented by a credential provider');
  }
}

module.exports = CredentialProvider;
