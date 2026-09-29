const mongoose = require('mongoose');
const crypto = require('crypto');
const Poll = require('../models/Poll');
const User = require('../models/User');
const blockchainService = require('../services/blockchainService');
const { verifyEligibilityProof } = require('../services/credentials/authorityCredentialProof');
const {
  RUNTIME_TRUSTEE_ID,
  getC0Protocol,
  isC0ProtocolEnabled,
  usesPanicCredentials,
  usesC1Revoting,
  usesPaddedActivity
} = require('../protocol');
const { BallotPaddingService } = require('../services/experiments/BallotPaddingService');

const ballotPaddingService = new BallotPaddingService({
  anchorDummyReceipt: (receiptRequest) => blockchainService.anchorDummyEncryptedBallotReceipt(receiptRequest)
});

/**
 * Controller for the opt-in C0 encrypted ballot protocol.
 *
 * Ballots are randomized AES-256-GCM ciphertexts. The current tally coordinator
 * is still a single-backend development coordinator, so trustee separation is
 * not complete yet.
 */
class ResearchProtocolController {
  /**
   * Cast an encrypted ballot
   *
   * The candidate choice is never stored in plaintext and is never returned to
   * the caller. The response exposes public submission metadata only.
   */
  static async castEncryptedBallot(req, res) {
    try {
      const { pollId } = req.params;
      const { optionId, authorityProof } = req.body;
      const userId = req.userId;

      if (!isC0ProtocolEnabled()) {
        return res.status(400).json({
          success: false,
          message: 'The encrypted C0 protocol is disabled'
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

      const currentUser = await User.findById(userId).select(
        '+walletPrivateKey +authoritySubjectId +authorityCredentialCommitment'
      );

      if (!currentUser) {
        return res.status(404).json({
          success: false,
          message: 'User not found'
        });
      }
      if (currentUser.eligibilityStatus !== 'eligible' ||
          !currentUser.authoritySubjectId ||
          !currentUser.authorityCredentialCommitment) {
        return res.status(403).json({
          success: false,
          message: 'Voting requires approval from the independent Eligibility Authority'
        });
      }
      const pollQuery = Poll.findById(pollId);
      const poll = typeof pollQuery.select === 'function'
        ? await pollQuery.select('+encryptedBallots.tallyHintOptionId +paddingConfig +paddingParticipants +paddingParticipantSalt +paddingLedger')
        : await pollQuery;

      if (!poll) {
        return res.status(404).json({
          success: false,
          message: 'Poll not found'
        });
      }

      if (!verifyEligibilityProof({
        proof: authorityProof,
        credentialCommitment: currentUser.authoritySubjectId,
        electionId: poll._id.toString()
      })) {
        return res.status(403).json({
          success: false,
          message: 'A valid zero-knowledge proof of Eligibility Authority credential possession is required'
        });
      }

      if (!poll.usesEncryptedProtocol()) {
        return res.status(400).json({
          success: false,
          message: 'This poll uses the legacy plaintext flow. Use POST /api/polls/:pollId/vote instead.'
        });
      }

      if (req.user?.credentialMode === 'panic' && !usesPanicCredentials(poll.protocolVersion)) {
        return res.status(400).json({
          success: false,
          message: 'Panic login credentials can only vote in C2/C3 polls, where panic ballots are excluded during finalization'
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

      const protocol = getC0Protocol();
      const electionId = poll._id.toString();
      const voterId = currentUser.authoritySubjectId;

      // The eligibility authority keeps the identity reference private and only
      // hands the credential provider a derived, election-scoped credential.
      protocol.eligibilityAuthority.registerVoter({
        voterId,
        identityRef: `synthetic:${voterId}`,
        electionId
      });
      protocol.eligibilityAuthority.verifyEligibility({ voterId, electionId });

      const credential = usesPanicCredentials(poll.protocolVersion)
        ? await protocol.privateCredentialRegistry.issueOrLoadCredential({
          voterId,
          electionId,
          credentialProvider: protocol.credentialProvider,
          eligibilityAuthority: protocol.eligibilityAuthority,
          credentialType: req.user?.credentialMode === 'panic' ? 'panic' : 'genuine',
          requirePersistence: true
        })
        : protocol.eligibilityAuthority.issueCredential({
          voterId,
          electionId,
          credentialProvider: protocol.credentialProvider,
          credentialType: 'genuine',
          randomizeCredentialType: false
        });
      const eligibilityProof = protocol.credentialProvider.proveEligibility({ credential, electionId });
      const allowReplacement = usesC1Revoting(poll.protocolVersion);

      const isReplacementBallot = poll.hasNullifierVoted(eligibilityProof.nullifier);
      const replacedBallot = isReplacementBallot
        ? poll.encryptedBallots.find((item) => item.nullifier === eligibilityProof.nullifier && !item.superseded)
        : null;

      if (isReplacementBallot && !allowReplacement) {
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
          message: 'Encrypted ballot verification failed'
        });
      }

      const isPaddedProtocol = usesPaddedActivity(poll.protocolVersion);
      const participantSelectedForPadding = isPaddedProtocol
        ? ballotPaddingService.selectParticipant(poll, voterId)
        : false;
      if (isPaddedProtocol) {
        try {
          ballotPaddingService.assertLedgerCapacity(poll, participantSelectedForPadding);
        } catch (error) {
          return res.status(503).json({
            success: false,
            message: error.message,
            ballotAccepted: false
          });
        }
      }

      const chainReceipt = await blockchainService.anchorEncryptedBallotReceipt({
        pollId: electionId,
        ballot,
        walletPrivateKey: currentUser.walletPrivateKey
      });

      if (isPaddedProtocol && !chainReceipt.enabled) {
        throw new Error('C1p/C2p require a successful on-chain ballot receipt before padding can run');
      }
      if (isPaddedProtocol) {
        if (replacedBallot?.transactionHash) {
          const replacedLedgerEntry = (poll.paddingLedger || []).find((entry) => (
            entry.transactionHash === replacedBallot.transactionHash
          ));
          if (replacedLedgerEntry) {
            replacedLedgerEntry.label = 'revote';
          }
        }
        poll.paddingLedger = poll.paddingLedger || [];
        poll.paddingLedger.push({
          transactionHash: chainReceipt.transactionHash,
          blockNumber: chainReceipt.blockNumber,
          timestamp: chainReceipt.timestamp,
          gasUsed: chainReceipt.gasUsed,
          calldataBytes: chainReceipt.calldataBytes,
          submitter: chainReceipt.from,
          label: req.user?.credentialMode === 'panic'
            ? 'panic'
            : (isReplacementBallot ? 'revote' : 'genuine')
        });
      }

      await poll.addEncryptedBallot(optionId, ballot, chainReceipt, {
        allowReplacement: isReplacementBallot && allowReplacement
      });

      if (isPaddedProtocol) {
        try {
          await ballotPaddingService.submitPadding({
            poll,
            walletPrivateKey: currentUser.walletPrivateKey,
            participantSelected: participantSelectedForPadding
          });
        } catch (error) {
          return res.status(502).json({
            success: false,
            message: `Ballot was accepted, but configured padding failed: ${error.message}`,
            ballotAccepted: true,
            ballotId: ballot.ballotId
          });
        }
      }

      await User.findByIdAndUpdate(userId, { $inc: { votesCount: 1 } });

      res.status(201).json({
        success: true,
        message: isReplacementBallot ? 'Encrypted ballot replaced' : 'Encrypted ballot accepted',
        ballot: {
          ballotId: ballot.ballotId,
          electionId: ballot.electionId,
          nullifier: eligibilityProof.nullifier,
          acceptedAt: new Date().toISOString()
        },
        tallyState: poll.tallyState,
        replacedPreviousBallot: isReplacementBallot && allowReplacement,
        chainReceipt,
        provider: ballot.provider
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
   * Finalize the encrypted C0 tally
   *
   * A single backend development trustee stands in for the trustee set. The share is
   * derived from public data (poll id and accepted ballot count) so experiment
   * runs stay reproducible, and the threshold is controlled by
   * RESEARCH_TALLY_THRESHOLD for operator testing.
   */
  static async finalizeTally(req, res) {
    try {
      const { id } = req.params;
      const userId = req.userId;

      if (!isC0ProtocolEnabled()) {
        return res.status(400).json({
          success: false,
          message: 'The encrypted C0 protocol is disabled'
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
          message: 'Tally finalization only applies to encrypted C0 polls'
        });
      }

      if (poll.tallyState === 'finalized') {
        return res.status(400).json({
          success: false,
          message: 'Tally has already been finalized'
        });
      }

      const protocol = getC0Protocol();
      const electionId = poll._id.toString();
      const panicCredentialCommitments = await protocol.privateCredentialRegistry.getPanicCredentialCommitments({
        electionId,
        eligibilityAuthority: protocol.eligibilityAuthority
      });

      protocol.tallyCoordinator.registerTrustee({
        trusteeId: RUNTIME_TRUSTEE_ID,
        publicKey: `development-public-key:${electionId}`
      });
      const activeBallotCount = poll.encryptedBallots.filter((ballot) => !ballot.superseded).length;
      const shareStatus = protocol.tallyCoordinator.submitShare({
        electionId,
        trusteeId: RUNTIME_TRUSTEE_ID,
        share: crypto
          .createHash('sha256')
          .update(`share:${electionId}:${activeBallotCount}`)
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
        publicBallotCount: activeBallotCount
      });

      const finalizedPoll = await poll.finalizeEncryptedTally({
        panicCredentialCommitments
      });

      res.status(200).json({
        success: true,
        message: 'Encrypted C0 tally finalized',
        tally,
        results: {
          pollId: finalizedPoll._id,
          title: finalizedPoll.title,
          protocolVersion: finalizedPoll.protocolVersion,
          tallyState: finalizedPoll.tallyState,
          totalVotes: finalizedPoll.totalVotes,
          options: finalizedPoll.getResults()
        },
        cleansing: {
          policy: 'private-registrar-cleansing',
          excludedPanicBallotCount: finalizedPoll.excludedPanicBallotCount || 0,
          includedBallotCount: finalizedPoll.totalVotes
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
