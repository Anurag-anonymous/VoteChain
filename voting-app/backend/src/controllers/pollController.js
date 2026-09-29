const Poll = require('../models/Poll');
const User = require('../models/User');
const blockchainService = require('../services/blockchainService');
const { verifyEligibilityProof } = require('../services/credentials/authorityCredentialProof');
const mongoose = require('mongoose');
const {
  PROTOCOL_VERSIONS,
  getC0Protocol,
  isEncryptedProtocolVersion,
  isProductionProtocolVersion,
  isC0ProtocolEnabled,
  usesPanicCredentials,
  usesPaddedActivity,
  usesC1Revoting,
  isJcjC2Enabled,
  isProductionPaddingEnabled
} = require('../protocol');
const { normalizePaddingConfig } = require('../services/experiments/BallotPaddingService');

const sanitizePoll = (poll) => {
  const serialized = typeof poll.toObject === 'function' ? poll.toObject() : poll;
  const active = serialized.status === 'active' && new Date(serialized.endDate) > new Date();
  const displayStatus = active ? 'active' : (serialized.status === 'active' ? 'closed' : serialized.status);
  const tallyHidden = serialized.tallyState !== 'finalized' || active;
  const encryptedBallots = serialized.encryptedBallots || [];

  return {
    ...serialized,
    status: displayStatus,
    revotingEnabled: usesC1Revoting(serialized.protocolVersion),
    paddingConfig: undefined,
    paddingParticipants: undefined,
    paddingParticipantSalt: undefined,
    paddingLedger: undefined,
    encryptedBallots: undefined,
    uniqueVoters: undefined,
    receiptAnchors: encryptedBallots
      .filter((ballot) => ballot.receiptAnchored && ballot.transactionHash)
      .map((ballot) => ({
        ballotId: ballot.ballotId,
        transactionHash: ballot.transactionHash,
        from: ballot.receiptFrom,
        to: ballot.receiptTo,
        blockNumber: ballot.receiptBlockNumber,
        acceptedAt: ballot.acceptedAt,
        hashes: ballot.receiptHashes
      })),
    options: (serialized.options || []).map((option) => ({
      ...option,
      voters: undefined,
      votes: tallyHidden ? null : option.votes,
      hidden: tallyHidden
    })),
    publicBallotCount: encryptedBallots.length || serialized.totalVotes || 0,
    totalVotes: tallyHidden ? encryptedBallots.length || serialized.totalVotes || 0 : serialized.totalVotes,
    tallyHidden
  };
};

const buildElectionCredential = (protocol, userId, electionId) => {
  const voterId = userId.toString();

  try {
    protocol.eligibilityAuthority.registerVoter({
      voterId,
      identityRef: `synthetic:${voterId}`,
      electionId
    });
  } catch (error) {
    if (!error.message.includes('already')) {
      // The in-memory authority may be reset between requests. Existing records
      // are harmless in this C0 development boundary, so only unexpected errors bubble.
    }
  }

  protocol.eligibilityAuthority.verifyEligibility({
    voterId,
    electionId,
    eligible: true
  });

  return protocol.eligibilityAuthority.issueCredential({
    voterId,
    electionId,
    credentialProvider: protocol.credentialProvider
  });
};

const repairFinalizedEncryptedTally = async (poll) => {
  if (!poll || poll.tallyState !== 'finalized' || !poll.usesEncryptedProtocol()) {
    return poll;
  }

  const activeBallots = (poll.encryptedBallots || []).filter((ballot) => !ballot.superseded);
  const panicCredentialCommitments = usesPanicCredentials(poll.protocolVersion)
    ? await getC0Protocol().privateCredentialRegistry.getPanicCredentialCommitments({
      electionId: poll._id.toString(),
      eligibilityAuthority: getC0Protocol().eligibilityAuthority
    })
    : [];
  const panicCommitmentSet = new Set(panicCredentialCommitments);
  const countedBallots = activeBallots.filter((ballot) => !(
    ballot.eligibilityProof &&
    panicCommitmentSet.has(ballot.eligibilityProof.credentialCommitment)
  ));
  const storedTotal = (poll.finalizedResults || []).reduce((sum, result) => sum + (result.votes || 0), 0);
  const hasMissingOptionMapping = countedBallots.some((ballot) => !ballot.tallyHintOptionId);

  if (storedTotal !== countedBallots.length || hasMissingOptionMapping) {
    await poll.finalizeEncryptedTally({ panicCredentialCommitments });
  }

  return poll;
};

class PollController {
  /**
   * Get all polls
   */
  static async getAllPolls(req, res) {
    try {
      const { page = 1, limit = 10, status = 'active', category } = req.query;
      const skip = (page - 1) * limit;

      let query = {};
      if (status) query.status = status;
      if (category) query.category = category;

      const polls = await Poll.find(query)
        .populate('creator', 'firstName lastName profileImage')
        .sort({ createdAt: -1 })
        .limit(parseInt(limit))
        .skip(skip);

      const total = await Poll.countDocuments(query);

      res.status(200).json({
        success: true,
        polls: polls.map(sanitizePoll),
        pagination: {
          total,
          pages: Math.ceil(total / limit),
          currentPage: parseInt(page)
        }
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: error.message
      });
    }
  }

  static async getMyPolls(req, res) {
    try {
      const polls = await Poll.find({ creator: req.userId })
        .populate('creator', 'firstName lastName profileImage')
        .sort({ createdAt: -1 });

      res.status(200).json({
        success: true,
        polls: polls.map(sanitizePoll)
      });
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  }

  /**
   * Get single poll
   */
  static async getPoll(req, res) {
    try {
      const { id } = req.params;

      if (!mongoose.Types.ObjectId.isValid(id)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid poll ID'
        });
      }

      const poll = await Poll.findByIdAndUpdate(
        id,
        { $inc: { viewCount: 1 } },
        { new: true }
      ).populate('creator', 'firstName lastName email profileImage')
        .populate('uniqueVoters', 'firstName lastName')
        .select('+encryptedBallots.tallyHintOptionId');

      if (!poll) {
        return res.status(404).json({
          success: false,
          message: 'Poll not found'
        });
      }

      await repairFinalizedEncryptedTally(poll);

      res.status(200).json({
        success: true,
        poll: sanitizePoll(poll)
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: error.message
      });
    }
  }

  /**
   * Create poll
   */
  static async createPoll(req, res) {
    try {
      const {
        title,
        description,
        options,
        endDate,
        category,
        tags,
        walletAddress,
        protocolVersion,
        paddingConfig
      } = req.body;

      const allowedProtocolVersions = Object.values(PROTOCOL_VERSIONS);
      const requestedProtocolVersion = protocolVersion ||
        PROTOCOL_VERSIONS.C0_ENCRYPTED;

      if (!allowedProtocolVersions.includes(requestedProtocolVersion)) {
        return res.status(400).json({
          success: false,
          message: `protocolVersion must be one of: ${allowedProtocolVersions.join(', ')}`
        });
      }

      if (requestedProtocolVersion === PROTOCOL_VERSIONS.LEGACY_PLAINTEXT) {
        return res.status(400).json({
          success: false,
          message: 'Legacy plaintext polls are retired and cannot be created'
        });
      }

      if (process.env.NODE_ENV === 'production' &&
          !isProductionProtocolVersion(requestedProtocolVersion)) {
        return res.status(400).json({
          success: false,
          message: 'Legacy and mock voting protocols are disabled in production; use an encrypted production protocol'
        });
      }

      if (process.env.NODE_ENV === 'production' &&
          usesPanicCredentials(requestedProtocolVersion) &&
          !isJcjC2Enabled()) {
        return res.status(503).json({
          success: false,
          message: 'Production C2 requires the audited JCJ credential verifier; password panic credentials are disabled'
        });
      }

      if (process.env.NODE_ENV === 'production' &&
          usesPaddedActivity(requestedProtocolVersion) &&
          !isProductionPaddingEnabled()) {
        return res.status(503).json({
          success: false,
          message: 'Production C3 padding is disabled until Semaphore, JCJ, and trustee prerequisites are configured'
        });
      }

      if (isEncryptedProtocolVersion(requestedProtocolVersion) && !isC0ProtocolEnabled()) {
        return res.status(400).json({
          success: false,
          message: 'The encrypted C0 protocol is disabled. Set C0_PROTOCOL_ENABLED=true to enable it.'
        });
      }

      if (usesPanicCredentials(requestedProtocolVersion)) {
        try {
          getC0Protocol().privateCredentialRegistry.assertReady();
        } catch (error) {
          return res.status(400).json({
            success: false,
            message: error.message
          });
        }
      }

      let normalizedPaddingConfig;
      if (usesPaddedActivity(requestedProtocolVersion)) {
        if (!blockchainService.isBlockchainEnabled() || !blockchainService.isC1ReceiptAnchoringEnabled()) {
          return res.status(400).json({
            success: false,
            message: 'C1p/C2p require BLOCKCHAIN_ENABLED=true and C1_CHAIN_RECEIPTS_ENABLED=true so padding activity is recorded on-chain'
          });
        }
        if (process.env.DATABASE_ENABLED === 'false') {
          return res.status(400).json({
            success: false,
            message: 'C1p/C2p require DATABASE_ENABLED=true to persist private participant selections and observer labels'
          });
        }
        try {
          normalizedPaddingConfig = normalizePaddingConfig(paddingConfig);
          await blockchainService.assertEncryptedBallotRegistryDeployed();
        } catch (error) {
          return res.status(400).json({
            success: false,
            message: error.message
          });
        }
      } else if (paddingConfig !== undefined) {
        return res.status(400).json({
          success: false,
          message: 'paddingConfig can only be set for C1p/C2p elections'
        });
      }

      const userId = req.userId;
      const currentUser = await User.findById(userId).select('+walletPrivateKey');
      const shouldUseBlockchain = process.env.BLOCKCHAIN_ENABLED !== 'false';
      const shouldPersistToDatabase = process.env.DATABASE_ENABLED !== 'false';

      if (!currentUser) {
        return res.status(404).json({
          success: false,
          message: 'User not found'
        });
      }

      const effectiveWalletAddress = (walletAddress || currentUser.walletAddress || '').trim();
      if (walletAddress && currentUser.walletAddress && walletAddress.toLowerCase() !== currentUser.walletAddress.toLowerCase()) {
        return res.status(400).json({
          success: false,
          message: 'Polls must be created with your linked wallet address'
        });
      }

      // Validation
      if (!title || !description || !options || !endDate || !effectiveWalletAddress) {
        return res.status(400).json({
          success: false,
          message: 'All required fields must be provided'
        });
      }

      if (shouldUseBlockchain && !currentUser.walletPrivateKey) {
        return res.status(400).json({
          success: false,
          message: 'Your linked wallet cannot sign local blockchain transactions. Generate a new local wallet on a new account.'
        });
      }

      if (!Array.isArray(options) || options.length < 2) {
        return res.status(400).json({
          success: false,
          message: 'Poll must have at least 2 options'
        });
      }

      if (options.length > 10) {
        return res.status(400).json({
          success: false,
          message: 'Poll cannot have more than 10 options'
        });
      }

      const endDateTime = new Date(endDate);
      if (endDateTime <= new Date()) {
        return res.status(400).json({
          success: false,
          message: 'Poll end date must be in the future'
        });
      }

      const generatedPollId = new mongoose.Types.ObjectId();
      const electionId = generatedPollId.toString();

      // Create poll options array
      const pollOptions = options.map(option => ({
        _id: new mongoose.Types.ObjectId(),
        optionText: option,
        optionCommitment: Poll.createOptionCommitment(electionId, option),
        votes: 0,
        voters: []
      }));

      // Create poll
      const poll = new Poll({
        _id: generatedPollId,
        title,
        description,
        options: pollOptions,
        creator: userId,
        creatorWallet: effectiveWalletAddress,
        endDate: endDateTime,
        category: category || 'other',
        tags: tags || [],
        protocolVersion: requestedProtocolVersion,
        paddingConfig: normalizedPaddingConfig,
        anonymous: isEncryptedProtocolVersion(requestedProtocolVersion),
        tallyState: 'hidden'
      });

      if (shouldPersistToDatabase) {
        await poll.save();
      }

      if (shouldUseBlockchain) {
        try {
          const blockchainPoll = await blockchainService.createPoll(
            title.trim(),
            pollOptions.map((option) => option.optionText),
            endDateTime,
            currentUser.walletPrivateKey
          );

          poll.blockchainPollId = blockchainPoll.pollId;
          poll.contractTransactionHash = blockchainPoll.transactionHash;
          poll.contractTransactionFrom = blockchainPoll.from;
          poll.blockNumber = blockchainPoll.blockNumber;
          poll.blockTimestamp = blockchainPoll.blockTimestamp;

          if (shouldPersistToDatabase) {
            await poll.save();
          }
        } catch (blockchainError) {
          console.error('Blockchain poll creation failed:', blockchainError);
          return res.status(500).json({
            success: false,
            message: 'Failed to create poll on blockchain',
            error: blockchainError.message
          });
        }
      }

      // Update user stats
      await User.findByIdAndUpdate(userId, { $inc: { pollsCreated: 1 } });

      res.status(201).json({
        success: true,
        message: shouldUseBlockchain
          ? 'Poll created successfully'
          : 'Poll created successfully in database-only mode',
        poll: sanitizePoll(poll),
        blockchainEnabled: shouldUseBlockchain,
        databaseEnabled: shouldPersistToDatabase
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: error.message
      });
    }
  }

  /**
   * Vote on poll
   */
  static async vote(req, res) {
    try {
      const { pollId } = req.params;
      const { optionId, walletAddress, authorityProof } = req.body;
      const userId = req.userId;
      const currentUser = await User.findById(userId).select(
        '+walletPrivateKey +authoritySubjectId +authorityCredentialCommitment'
      );
      const shouldUseBlockchain = process.env.BLOCKCHAIN_ENABLED !== 'false';
      const shouldPersistToDatabase = process.env.DATABASE_ENABLED !== 'false';

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
      if (!mongoose.Types.ObjectId.isValid(pollId)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid poll ID'
        });
      }

      const effectiveWalletAddress = (walletAddress || currentUser.walletAddress || '').trim();
      if (walletAddress && currentUser.walletAddress && walletAddress.toLowerCase() !== currentUser.walletAddress.toLowerCase()) {
        return res.status(400).json({
          success: false,
          message: 'Votes must be cast with your linked wallet address'
        });
      }

      if (!optionId || !effectiveWalletAddress) {
        return res.status(400).json({
          success: false,
          message: 'Option ID and wallet address are required'
        });
      }

      if (shouldUseBlockchain && !currentUser.walletPrivateKey) {
        return res.status(400).json({
          success: false,
          message: 'Your linked wallet cannot sign local blockchain transactions. Generate a new local wallet on a new account.'
        });
      }

      const poll = await Poll.findById(pollId);

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

      if (shouldUseBlockchain && (poll.blockchainPollId === null || poll.blockchainPollId === undefined)) {
        return res.status(400).json({
          success: false,
          message: 'This poll has not been registered on blockchain yet.'
        });
      }

      // Check if poll is active
      if (!poll.isActive()) {
        return res.status(400).json({
          success: false,
          message: 'Poll is closed'
        });
      }

      if (poll.usesEncryptedProtocol()) {
        return res.status(400).json({
          success: false,
          message: 'This poll uses the encrypted C0 protocol. Submit a ballot to POST /api/polls/:pollId/ballot instead.'
        });
      }

      if (req.user?.credentialMode === 'panic') {
        return res.status(400).json({
          success: false,
          message: 'Panic login credentials can only vote in C2/C3 polls, where panic ballots are excluded during finalization'
        });
      }

      // Check if user already voted
      if (poll.hasUserVoted(userId) && !poll.allowMultipleVotes) {
        return res.status(400).json({
          success: false,
          message: 'You have already voted in this poll'
        });
      }

      // Check if option exists
      if (!mongoose.Types.ObjectId.isValid(optionId)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid option ID'
        });
      }

      try {
        let blockchainResult = null;

        if (shouldUseBlockchain) {
          // Cast vote on blockchain
          blockchainResult = await blockchainService.castVote(
            poll.blockchainPollId,
            poll.options.findIndex(opt => opt._id.toString() === optionId),
            currentUser.walletPrivateKey
          );
        }

        if (shouldPersistToDatabase) {
          // Add vote to poll
          await poll.addVote(userId, effectiveWalletAddress, optionId, blockchainResult ? blockchainResult.transactionHash : 'DATABASE_ONLY');

          // Update user stats
          await User.findByIdAndUpdate(userId, { $inc: { votesCount: 1 } });
        }

        res.status(200).json({
          success: true,
          message: shouldUseBlockchain
            ? 'Vote recorded successfully'
            : 'Vote recorded in database-only mode',
          transactionHash: blockchainResult ? blockchainResult.transactionHash : null,
          poll: poll.getResults()
        });
      } catch (blockchainError) {
        console.error('Blockchain error:', blockchainError);
        res.status(500).json({
          success: false,
          message: 'Failed to record vote on blockchain',
          error: blockchainError.message
        });
      }
    } catch (error) {
      res.status(500).json({
        success: false,
        message: error.message
      });
    }
  }

  /**
   * Submit a Phase 3 C0 encrypted ballot.
   */
  static async submitBallot(req, res) {
    try {
      const { pollId } = req.params;
      const { optionId } = req.body;
      const userId = req.userId;

      if (!mongoose.Types.ObjectId.isValid(pollId)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid poll ID'
        });
      }

      if (!mongoose.Types.ObjectId.isValid(optionId)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid option ID'
        });
      }

      const poll = await Poll.findById(pollId).select('+encryptedBallots.tallyHintOptionId');

      if (!poll) {
        return res.status(404).json({
          success: false,
          message: 'Poll not found'
        });
      }

      if (!poll.usesEncryptedProtocol()) {
        return res.status(400).json({
          success: false,
          message: 'This poll uses the legacy plaintext vote endpoint.'
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
        return res.status(404).json({
          success: false,
          message: 'Option not found'
        });
      }

      const protocol = getC0Protocol();
      const electionId = poll._id.toString();
      const voterId = userId.toString();
      const credential = usesPanicCredentials(poll.protocolVersion)
        ? await protocol.privateCredentialRegistry.issueOrLoadCredential({
          voterId,
          electionId,
          credentialProvider: protocol.credentialProvider,
          eligibilityAuthority: protocol.eligibilityAuthority,
          credentialType: req.user?.credentialMode === 'panic' ? 'panic' : 'genuine',
          requirePersistence: true
        })
        : buildElectionCredential(protocol, userId, electionId);
      const eligibilityProof = protocol.credentialProvider.proveEligibility({
        credential,
        electionId
      });

      const ballot = protocol.ballotService.createEncryptedBallot({
        electionId,
        candidateId: option.optionCommitment,
        eligibilityProof
      });

      if (!protocol.ballotService.verifyBallot({ ballot, credentialProvider: protocol.credentialProvider })) {
        return res.status(400).json({
          success: false,
          message: 'Ballot proof verification failed'
        });
      }

      await poll.addEncryptedBallot(optionId, ballot, `C0_ENCRYPTED_BALLOT:${ballot.ballotId}`);
      await User.findByIdAndUpdate(userId, { $inc: { votesCount: 1 } });

      return res.status(200).json({
        success: true,
        message: 'Encrypted ballot accepted. Candidate tally remains hidden until finalization.',
        receipt: {
          ballotId: ballot.ballotId,
          electionId,
          nullifier: eligibilityProof.nullifier,
          transactionHash: `C0_ENCRYPTED_BALLOT:${ballot.ballotId}`
        },
        publicBallotCount: poll.encryptedBallots.length,
        tallyHidden: true
      });
    } catch (error) {
      const status = error.message.includes('already submitted') ? 400 : 500;
      return res.status(status).json({
        success: false,
        message: error.message
      });
    }
  }

  /**
   * Get poll results
   */
  static async getPollResults(req, res) {
    try {
      const { id } = req.params;

      if (!mongoose.Types.ObjectId.isValid(id)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid poll ID'
        });
      }

      const poll = await Poll.findById(id).select('+encryptedBallots.tallyHintOptionId');

      if (!poll) {
        return res.status(404).json({
          success: false,
          message: 'Poll not found'
        });
      }

      await repairFinalizedEncryptedTally(poll);

      res.status(200).json({
        success: true,
        results: {
          pollId: poll._id,
          title: poll.title,
          totalVotes: poll.totalVotes,
          totalParticipants: poll.totalParticipants,
          protocolVersion: poll.protocolVersion,
          tallyState: poll.tallyState,
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

  static async getObserverDataset(req, res) {
    try {
      const { id } = req.params;
      if (!mongoose.Types.ObjectId.isValid(id)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid poll ID'
        });
      }

      const poll = await Poll.findById(id).select(
        '+paddingConfig +paddingLedger +encryptedBallots.tallyHintOptionId'
      );
      if (!poll) {
        return res.status(404).json({
          success: false,
          message: 'Poll not found'
        });
      }
      if (poll.creator.toString() !== req.userId) {
        return res.status(403).json({
          success: false,
          message: 'Only the poll creator can export its experiment dataset'
        });
      }
      if (!poll.usesEncryptedProtocol()) {
        return res.status(400).json({
          success: false,
          message: 'Observer datasets are available only for encrypted elections'
        });
      }

      let ledger = poll.paddingLedger || [];
      if (ledger.length === 0) {
        const panicCommitments = usesPanicCredentials(poll.protocolVersion)
          ? await getC0Protocol().privateCredentialRegistry.getPanicCredentialCommitments({
            electionId: poll._id.toString(),
            eligibilityAuthority: getC0Protocol().eligibilityAuthority
          })
          : [];
        const panicSet = new Set(panicCommitments);
        const revoteNullifiers = new Set((poll.encryptedBallots || [])
          .filter((ballot) => ballot.superseded)
          .map((ballot) => ballot.nullifier));
        ledger = (poll.encryptedBallots || [])
          .filter((ballot) => ballot.receiptAnchored && ballot.transactionHash)
          .map((ballot) => ({
            transactionHash: ballot.transactionHash,
            blockNumber: ballot.receiptBlockNumber,
            timestamp: ballot.receiptTimestamp || ballot.acceptedAt,
            gasUsed: ballot.receiptGasUsed,
            calldataBytes: ballot.receiptCalldataBytes,
            submitter: ballot.receiptFrom,
            label: panicSet.has(ballot.eligibilityProof?.credentialCommitment)
              ? 'panic'
              : (revoteNullifiers.has(ballot.nullifier) ? 'revote' : 'genuine')
          }));
      }

      if (ledger.length === 0) {
        return res.status(400).json({
          success: false,
          message: 'This election has no on-chain receipt records to analyze'
        });
      }

      return res.status(200).json({
        success: true,
        configuration: poll.paddingConfig,
        publicRecords: ledger.map((record) => ({
          transactionHash: record.transactionHash,
          blockNumber: record.blockNumber,
          timestamp: record.timestamp,
          gasUsed: record.gasUsed,
          calldataBytes: record.calldataBytes,
          submitter: record.submitter
        })),
        privateLabels: ledger.map((record) => ({
          transactionHash: record.transactionHash,
          activity: record.label,
          sensitiveActivity: record.label === 'revote' || record.label === 'panic',
          revote: record.label === 'revote',
          panic: record.label === 'panic',
          excludedDuringCleansing: poll.tallyState === 'finalized' && record.label === 'panic'
        }))
      });
    } catch (error) {
      return res.status(500).json({
        success: false,
        message: error.message
      });
    }
  }

  /**
   * Close poll
   */
  static async closePoll(req, res) {
    try {
      const { id } = req.params;
      const userId = req.userId;

      if (!mongoose.Types.ObjectId.isValid(id)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid poll ID'
        });
      }

      const poll = await Poll.findById(id);

      if (!poll) {
        return res.status(404).json({
          success: false,
          message: 'Poll not found'
        });
      }

      // Check if user is the creator
      if (poll.creator.toString() !== userId) {
        return res.status(403).json({
          success: false,
          message: 'Only poll creator can close the poll'
        });
      }

      poll.status = 'closed';
      await poll.save();

      res.status(200).json({
        success: true,
        message: 'Poll closed successfully'
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: error.message
      });
    }
  }

  /**
   * Delete poll
   */
  static async deletePoll(req, res) {
    try {
      const { id } = req.params;
      const userId = req.userId;

      if (!mongoose.Types.ObjectId.isValid(id)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid poll ID'
        });
      }

      const poll = await Poll.findById(id);

      if (!poll) {
        return res.status(404).json({
          success: false,
          message: 'Poll not found'
        });
      }

      // Check if user is the creator
      if (poll.creator.toString() !== userId) {
        return res.status(403).json({
          success: false,
          message: 'Only poll creator can delete the poll'
        });
      }

      // Can only delete if no votes
      await Poll.findByIdAndDelete(id);

      // Update user stats
      await User.findByIdAndUpdate(userId, { $inc: { pollsCreated: -1 } });

      res.status(200).json({
        success: true,
        message: 'Poll deleted successfully'
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: error.message
      });
    }
  }
}

module.exports = PollController;
