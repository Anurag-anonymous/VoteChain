const mongoose = require('mongoose');
const crypto = require('crypto');
const Poll = require('../models/Poll');
const User = require('../models/User');
const {
  RUNTIME_TRUSTEE_ID,
  getPhaseTwoProtocol,
  isResearchProtocolEnabled
} = require('../protocol');

/**
 * Controller for the opt-in C0 mock-encrypted research protocol.
 *
 * Everything in this controller is a research boundary. Credentials, ballots,
 * and tally shares are mock values, and the tally hint is kept inside the poll
 * document instead of being published. The legacy plaintext flow stays in
 * pollController and is unaffected by this file.
 */
class ResearchProtocolController {
  /**
   * Cast an encrypted mock ballot
   *
   * The candidate choice is never stored in plaintext and is never returned to
   * the caller. The response exposes public submission metadata only.
   */
  static async castEncryptedBallot(req, res) {
    try {
      const { pollId } = req.params;
      const { optionId } = req.body;
      const userId = req.userId;

      if (!isResearchProtocolEnabled()) {
        return res.status(400).json({
          success: false,
          message: 'The c0-mock-encrypted research protocol is disabled'
        });
      }

      if (!mongoose.Types.ObjectId.isValid(pollId)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid poll ID'
        });
      }

      if (!optionId || !mongoose.Types.ObjectId.isValid(optionId)) {
        return res.status(400).json({
          success: false,
          message: 'A valid option ID is required'
        });
      }

      const currentUser = await User.findById(userId);

      if (!currentUser) {
        return res.status(404).json({
          success: false,
          message: 'User not found'
        });
      }

      const poll = await Poll.findById(pollId);

      if (!poll) {
        return res.status(404).json({
          success: false,
          message: 'Poll not found'
        });
      }

      if (!poll.usesEncryptedProtocol()) {
        return res.status(400).json({
          success: false,
          message: 'This poll uses the legacy plaintext flow. Use POST /api/polls/:pollId/vote instead.'
        });
      }

      if (!poll.isActive()) {
        return res.status(400).json({
          success: false,
          message: 'Poll is closed'
        });
      }

      const option = poll.options.id(optionId);

      if (!option) {
        return res.status(400).json({
          success: false,
          message: 'Option not found'
        });
      }

      const protocol = getPhaseTwoProtocol();
      const electionId = poll._id.toString();
      const voterId = userId.toString();

      // The eligibility authority keeps the identity reference private and only
      // hands the credential provider a derived, election-scoped credential.
      protocol.eligibilityAuthority.registerVoter({
        voterId,
        identityRef: `synthetic:${voterId}`,
        electionId
      });
      protocol.eligibilityAuthority.verifyEligibility({ voterId, electionId });

      const credential = protocol.eligibilityAuthority.issueCredential({
        voterId,
        electionId,
        credentialProvider: protocol.credentialProvider
      });
      const eligibilityProof = protocol.credentialProvider.proveEligibility({ credential, electionId });

      if (poll.hasNullifierVoted(eligibilityProof.nullifier) && !poll.allowMultipleVotes) {
        return res.status(400).json({
          success: false,
          message: 'This credential has already submitted a ballot in this poll'
        });
      }

      const ballot = protocol.ballotService.createEncryptedBallot({
        electionId,
        candidateId: option.optionCommitment,
        eligibilityProof
      });

      if (!protocol.ballotService.verifyBallot({ ballot, credentialProvider: protocol.credentialProvider })) {
        return res.status(400).json({
          success: false,
          message: 'Mock ballot verification failed'
        });
      }

      await poll.addEncryptedBallot(optionId, ballot, null);
      await User.findByIdAndUpdate(userId, { $inc: { votesCount: 1 } });

      res.status(201).json({
        success: true,
        message: 'Mock encrypted ballot accepted',
        ballot: {
          ballotId: ballot.ballotId,
          electionId: ballot.electionId,
          nullifier: eligibilityProof.nullifier,
          acceptedAt: new Date().toISOString()
        },
        tallyState: poll.tallyState,
        securityNotice: ballot.securityNotice
      });
    } catch (error) {
      const status = error.message.includes('already submitted') ? 400 : 500;
      res.status(status).json({
        success: false,
        message: error.message
      });
    }
  }

  /**
   * Finalize the mock tally
   *
   * A single backend mock trustee stands in for the trustee set. The share is
   * derived from public data (poll id and accepted ballot count) so experiment
   * runs stay reproducible, and the threshold is controlled by
   * RESEARCH_TALLY_THRESHOLD for operator testing.
   */
  static async finalizeTally(req, res) {
    try {
      const { id } = req.params;
      const userId = req.userId;

      if (!isResearchProtocolEnabled()) {
        return res.status(400).json({
          success: false,
          message: 'The c0-mock-encrypted research protocol is disabled'
        });
      }

      if (!mongoose.Types.ObjectId.isValid(id)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid poll ID'
        });
      }

      const pollQuery = Poll.findById(id);
      const poll = typeof pollQuery.select === 'function'
        ? await pollQuery.select('+encryptedBallots.tallyHintOptionId')
        : await pollQuery;

      if (!poll) {
        return res.status(404).json({
          success: false,
          message: 'Poll not found'
        });
      }

      if (poll.creator.toString() !== userId) {
        return res.status(403).json({
          success: false,
          message: 'Only poll creator can finalize the tally'
        });
      }

      if (!poll.usesEncryptedProtocol()) {
        return res.status(400).json({
          success: false,
          message: 'Mock tally finalization only applies to c0-mock-encrypted polls'
        });
      }

      if (poll.tallyState === 'finalized') {
        return res.status(400).json({
          success: false,
          message: 'Tally has already been finalized'
        });
      }

      const protocol = getPhaseTwoProtocol();
      const electionId = poll._id.toString();

      protocol.tallyCoordinator.registerTrustee({
        trusteeId: RUNTIME_TRUSTEE_ID,
        publicKey: `mock-public-key:${electionId}`
      });
      const shareStatus = protocol.tallyCoordinator.submitShare({
        electionId,
        trusteeId: RUNTIME_TRUSTEE_ID,
        share: crypto
          .createHash('sha256')
          .update(`share:${electionId}:${poll.encryptedBallots.length}`)
          .digest('hex')
      });

      if (!protocol.tallyCoordinator.canFinalize({ electionId })) {
        return res.status(400).json({
          success: false,
          message: `Not enough trustee shares to finalize. Collected ${shareStatus.acceptedShares} of ${shareStatus.threshold}.`
        });
      }

      const tally = protocol.tallyCoordinator.finalizeTally({
        electionId,
        publicBallotCount: poll.encryptedBallots.length
      });

      await poll.finalizeMockTally();

      res.status(200).json({
        success: true,
        message: 'Mock tally finalized',
        tally,
        results: {
          pollId: poll._id,
          title: poll.title,
          protocolVersion: poll.protocolVersion,
          tallyState: poll.tallyState,
          totalVotes: poll.totalVotes,
          options: poll.getResults()
        }
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: error.message
      });
    }
  }
}

module.exports = ResearchProtocolController;
