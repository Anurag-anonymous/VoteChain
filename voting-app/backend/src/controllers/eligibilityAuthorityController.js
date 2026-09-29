const crypto = require('crypto');
const mongoose = require('mongoose');
const User = require('../models/User');
const {
  submitApplicant,
  verifyDecisionSignature
} = require('../services/eligibilityAuthorityClient');
const {
  encryptCredential,
  decryptCredential,
  decryptCredentialEnvelope
} = require('../services/authorityCredentialVault');
const JcjCivitasCredentialProvider = require('../services/credentials/JcjCivitasCredentialProvider');

class EligibilityAuthorityController {
  static async receiveDecision(req, res) {
    try {
      if (!verifyDecisionSignature(req)) {
        return res.status(401).json({
          success: false,
          message: 'Eligibility Authority signature is invalid or expired'
        });
      }

      const {
        voterId,
        status,
        authoritySubjectId,
        credentialCommitment,
        anonymousCredential,
        credentialEnvelope,
        decisionId,
        decidedAt
      } = req.body;
      if (!mongoose.Types.ObjectId.isValid(voterId) ||
          !['eligible', 'rejected', 'needs_info'].includes(status) ||
          typeof decisionId !== 'string' || !decisionId ||
          !Number.isFinite(Date.parse(decidedAt))) {
        return res.status(400).json({
          success: false,
          message: 'Decision payload is incomplete or invalid'
        });
      }
      const commitmentPattern = process.env.NODE_ENV === 'production'
        ? /^[a-f\d]{512}$/i
        : /^[a-f\d]{64,512}$/i;
      if (status === 'eligible' &&
          (!commitmentPattern.test(authoritySubjectId || '') ||
           !commitmentPattern.test(credentialCommitment || '') ||
           authoritySubjectId.toLowerCase() !== credentialCommitment.toLowerCase() ||
           !credentialEnvelope ||
           credentialEnvelope.scheme !== 'jcj-civitas-v1-envelope' ||
           credentialEnvelope.credentialCommitment !== credentialCommitment ||
           typeof credentialEnvelope.ciphertext !== 'string')) {
        return res.status(400).json({
          success: false,
          message: 'Approved decisions require a credential matching its opaque subject and commitment'
        });
      }
      if (status !== 'eligible' && (authoritySubjectId || credentialCommitment || anonymousCredential || credentialEnvelope)) {
        return res.status(400).json({
          success: false,
          message: 'Non-eligible decisions must not include credential material'
        });
      }

      const user = await User.findById(voterId).select('+authorityDecisionId +authorityDecisionAt');
      if (!user) {
        return res.status(404).json({
          success: false,
          message: 'Applicant account not found'
        });
      }
      const incomingTime = new Date(decidedAt);
      if (user.authorityDecisionAt &&
          incomingTime < user.authorityDecisionAt &&
          user.authorityDecisionId !== decisionId) {
        return res.status(409).json({
          success: false,
          message: 'A newer eligibility decision is already recorded'
        });
      }

      user.eligibilityStatus = status;
      user.authoritySubjectId = status === 'eligible' ? authoritySubjectId : undefined;
      user.authorityCredentialCommitment = status === 'eligible' ? credentialCommitment : undefined;
      user.authorityCredentialEnvelope = status === 'eligible'
        ? encryptCredential(JSON.stringify(credentialEnvelope))
        : undefined;
      user.authorityDecisionId = decisionId;
      user.authorityDecisionAt = incomingTime;
      await user.save();

      return res.status(200).json({ success: true, status });
    } catch (error) {
      return res.status(500).json({
        success: false,
        message: error.message
      });
    }
  }

  static async getCredential(req, res) {
    try {
      const user = await User.findById(req.userId).select(
        '+authoritySubjectId +authorityCredentialCommitment +authorityCredentialEnvelope'
      );
      if (!user) {
        return res.status(404).json({ success: false, message: 'User not found' });
      }
      if (user.eligibilityStatus !== 'eligible' || !user.authorityCredentialEnvelope) {
        return res.status(403).json({
          success: false,
          message: 'Anonymous credential is available after Eligibility Authority approval'
        });
      }
      const credential = decryptCredential(user.authorityCredentialEnvelope);
      const envelope = JSON.parse(credential);
      if (envelope.scheme !== 'jcj-civitas-v1-envelope' ||
          envelope.credentialCommitment !== user.authorityCredentialCommitment) {
        throw new Error('Stored JCJ credential envelope failed its commitment check');
      }
      const rawCredential = decryptCredentialEnvelope(envelope);
      if (user.authorityCredentialCommitment.length === 512) {
        const provider = new JcjCivitasCredentialProvider();
        const credential = {
          credentialValue: rawCredential,
          credentialCommitment: user.authorityCredentialCommitment,
          electionId: 'authority-envelope'
        };
        const proof = provider.proveEligibility({ credential, electionId: 'authority-envelope' });
        if (!provider.verifyEligibilityProof({ proof, electionId: 'authority-envelope' })) {
          throw new Error('JCJ credential failed its commitment check');
        }
      } else if (crypto.createHash('sha256').update(rawCredential).digest('hex') !==
                 user.authorityCredentialCommitment) {
        throw new Error('Stored credential failed its commitment check');
      }
      res.set('Cache-Control', 'no-store');
      return res.status(200).json({
        success: true,
        credential: rawCredential,
        credentialCommitment: user.authorityCredentialCommitment
      });
    } catch (error) {
      return res.status(500).json({ success: false, message: error.message });
    }
  }

  static async submitApplicant(req, res) {
    try {
      const user = await User.findById(req.userId).select('+aadharNumber');
      if (!user) {
        return res.status(404).json({
          success: false,
          message: 'User not found'
        });
      }
      if (!user.emailVerified || !user.phoneVerified || !user.aadharVerified) {
        return res.status(403).json({
          success: false,
          message: 'Verify email, phone, and Aadhaar OTPs before submitting eligibility details'
        });
      }
      if (user.eligibilityStatus === 'eligible') {
        return res.status(409).json({
          success: false,
          message: 'Eligibility has already been approved'
        });
      }
      const result = await submitApplicant(user);
      if (!result.configured) {
        return res.status(503).json({
          success: false,
          message: 'Eligibility Authority integration is not configured on the VoteChain backend'
        });
      }
      return res.status(202).json({
        success: true,
        eligibilityStatus: result.status || user.eligibilityStatus || 'pending',
        message: 'Your details were submitted for independent human review'
      });
    } catch (error) {
      return res.status(502).json({
        success: false,
        message: `Could not submit your eligibility case: ${error.message}`
      });
    }
  }
}

module.exports = EligibilityAuthorityController;
