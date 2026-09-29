const { getC0Protocol, resetC0Protocol } = require('./src/protocol');
(async () => {
  const protocol = getC0Protocol();
  const electionId = 'test-election';
  const voterId = '507f1f77bcf86cd799439021';
  try {
    protocol.eligibilityAuthority.registerVoter({ voterId, identityRef: `synthetic:${voterId}`, electionId });
  } catch (e) {}
  protocol.eligibilityAuthority.verifyEligibility({ voterId, electionId });

  const cred1 = protocol.eligibilityAuthority.issueCredential({ voterId, electionId, credentialProvider: protocol.credentialProvider });
  const proof1 = protocol.credentialProvider.proveEligibility({ credential: cred1, electionId });

  console.log('CRED1', cred1);
  console.log('PROOF1', proof1);

  const cred2 = protocol.eligibilityAuthority.issueCredential({ voterId, electionId, credentialProvider: protocol.credentialProvider });
  const proof2 = protocol.credentialProvider.proveEligibility({ credential: cred2, electionId });

  console.log('CRED2', cred2);
  console.log('PROOF2', proof2);

  console.log('cred1==cred2?', cred1.credentialCommitment === cred2.credentialCommitment);
  console.log('null1==null2?', proof1.nullifier === proof2.nullifier);
})();