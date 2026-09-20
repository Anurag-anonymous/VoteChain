const mongoose = require('mongoose');
const crypto = require('crypto');
const {
  PROTOCOL_VERSIONS,
  isEncryptedProtocolVersion
} = require('../protocol');

const pollSchema = new mongoose.Schema({
  title: {
    type: String,
    required: true,
    trim: true,
    maxlength: 200
  },
  description: {
    type: String,
    required: true,
    trim: true
  },
  
  // Creator info
  creator: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  creatorWallet: {
    type: String,
    required: true
  },

  // Poll options
  options: [{
    // Declaring _id opts out of Mongoose automatic subdocument ids, so the
    // default is set explicitly. The research protocol needs a stable option
    // id to commit a ballot against, whichever path created the poll.
    _id: {
      type: mongoose.Schema.Types.ObjectId,
      default: () => new mongoose.Types.ObjectId()
    },
    optionText: {
      type: String,
      required: true
    },
    optionCommitment: {
      type: String,
      required: true,
      default() {
        const optionText = this.optionText || '';
        return crypto.createHash('sha256').update(`option:${optionText}`).digest('hex');
      }
    },
    votes: {
      type: Number,
      default: 0
    },
    voters: [{
      userId: mongoose.Schema.Types.ObjectId,
      walletAddress: String,
      transactionHash: String,
      votedAt: Date
    }]
  }],

  // Poll status
  status: {
    type: String,
    enum: ['active', 'closed', 'paused'],
    default: 'active'
  },

  // Timing
  startDate: {
    type: Date,
    default: Date.now
  },
  endDate: {
    type: Date,
    required: true
  },
  
  // Statistics
  totalVotes: {
    type: Number,
    default: 0
  },
  totalParticipants: {
    type: Number,
    default: 0
  },
  uniqueVoters: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }],

  protocolVersion: {
    type: String,
    enum: [PROTOCOL_VERSIONS.LEGACY_PLAINTEXT, PROTOCOL_VERSIONS.C0_MOCK_ENCRYPTED],
    default: PROTOCOL_VERSIONS.LEGACY_PLAINTEXT
  },
  tallyState: {
    type: String,
    enum: ['hidden', 'finalized'],
    default: 'hidden'
  },
  encryptedBallots: [{
    ballotId: String,
    electionId: String,
    nullifier: {
      type: String,
      index: true
    },
    encryptedCandidate: String,
    randomnessCommitment: String,
    proof: mongoose.Schema.Types.Mixed,
    eligibilityProof: mongoose.Schema.Types.Mixed,
    transactionHash: String,
    acceptedAt: {
      type: Date,
      default: Date.now
    },
    tallyHintOptionId: {
      type: mongoose.Schema.Types.ObjectId,
      select: false
    }
  }],
  finalizedResults: [{
    optionId: mongoose.Schema.Types.ObjectId,
    optionText: String,
    votes: Number,
    percentage: Number
  }],

  // Blockchain
  blockchainPollId: {
    type: Number,
    default: null
  },
  contractAddress: String,
  contractTransactionHash: String,
  contractTransactionFrom: String,
  blockNumber: Number,
  blockTimestamp: Date,

  // Metadata
  category: {
    type: String,
    enum: ['political', 'social', 'educational', 'sports', 'entertainment', 'other'],
    default: 'other'
  },
  tags: [String],
  visibility: {
    type: String,
    enum: ['public', 'private'],
    default: 'public'
  },
  allowMultipleVotes: {
    type: Boolean,
    default: false
  },
  anonymous: {
    type: Boolean,
    default: false
  },

  // Engagement
  viewCount: {
    type: Number,
    default: 0
  },
  commentCount: {
    type: Number,
    default: 0
  },
  shareCount: {
    type: Number,
    default: 0
  },

  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }

}, { timestamps: true });

// Method to add vote
pollSchema.methods.addVote = async function(userId, walletAddress, optionId, transactionHash) {
  const option = this.options.id(optionId);
  if (!option) {
    throw new Error('Option not found');
  }

  option.votes += 1;
  option.voters.push({
    userId,
    walletAddress,
    transactionHash,
    votedAt: new Date()
  });

  this.totalVotes += 1;
  
  // Check if unique voter
  if (!this.uniqueVoters.includes(userId)) {
    this.uniqueVoters.push(userId);
    this.totalParticipants += 1;
  }

  return await this.save();
};

pollSchema.methods.addEncryptedBallot = async function(optionId, ballot, transactionHash) {
  if (!ballot || !ballot.eligibilityProof || !ballot.eligibilityProof.nullifier) {
    throw new Error('A ballot with an eligibility proof and nullifier is required');
  }

  const option = this.options.id(optionId);
  if (!option) {
    throw new Error('Option not found');
  }

  if (this.hasNullifierVoted(ballot.eligibilityProof.nullifier) && !this.allowMultipleVotes) {
    throw new Error('Credential has already submitted a ballot in this poll');
  }

  this.encryptedBallots.push({
    ballotId: ballot.ballotId,
    electionId: ballot.electionId,
    nullifier: ballot.eligibilityProof.nullifier,
    encryptedCandidate: ballot.encryptedCandidate,
    randomnessCommitment: ballot.randomnessCommitment,
    proof: ballot.proof,
    eligibilityProof: ballot.eligibilityProof,
    transactionHash,
    acceptedAt: new Date(),
    tallyHintOptionId: option._id
  });

  this.totalVotes = this.encryptedBallots.length;
  this.totalParticipants = this.encryptedBallots.length;

  return await this.save();
};

// Method to check if user already voted
pollSchema.methods.hasUserVoted = function(userId) {
  return this.uniqueVoters.includes(userId);
};

pollSchema.methods.hasNullifierVoted = function(nullifier) {
  return this.encryptedBallots.some((ballot) => ballot.nullifier === nullifier);
};

pollSchema.methods.usesEncryptedProtocol = function() {
  return this.protocolVersion === 'c0-mock-encrypted';
};

pollSchema.methods.usesEncryptedProtocol = function() {
  return isEncryptedProtocolVersion(this.protocolVersion);
};

// Method to get results
pollSchema.methods.getResults = function() {
  if (isEncryptedProtocolVersion(this.protocolVersion) && this.tallyState !== 'finalized') {
    return this.options.map(option => ({
      _id: option._id,
      optionText: option.optionText,
      votes: null,
      percentage: null,
      hidden: true
    }));
  }

  if (this.finalizedResults.length > 0) {
    return this.finalizedResults;
  }

  return this.options.map(option => ({
    _id: option._id,
    optionText: option.optionText,
    votes: option.votes,
    percentage: this.totalVotes > 0 ? ((option.votes / this.totalVotes) * 100).toFixed(2) : 0
  }));
};

pollSchema.methods.finalizeMockTally = async function() {
  if (!this.usesEncryptedProtocol()) {
    throw new Error('Mock tally finalization is only available for the c0-mock-encrypted protocol');
  }

  const counts = new Map(this.options.map((option) => [option._id.toString(), 0]));

  this.encryptedBallots.forEach((ballot) => {
    const optionId = ballot.tallyHintOptionId ? ballot.tallyHintOptionId.toString() : null;
    if (optionId && counts.has(optionId)) {
      counts.set(optionId, counts.get(optionId) + 1);
    }
  });

  this.totalVotes = this.encryptedBallots.length;
  this.totalParticipants = this.encryptedBallots.length;
  this.finalizedResults = this.options.map((option) => {
    const votes = counts.get(option._id.toString()) || 0;
    return {
      optionId: option._id,
      optionText: option.optionText,
      votes,
      percentage: this.totalVotes > 0 ? Number(((votes / this.totalVotes) * 100).toFixed(2)) : 0
    };
  });
  this.tallyState = 'finalized';
  this.status = 'closed';

  return await this.save();
};

pollSchema.statics.createOptionCommitment = function(electionId, optionText) {
  return crypto
    .createHash('sha256')
    .update(`${electionId}:${optionText}:${crypto.randomBytes(16).toString('hex')}`)
    .digest('hex');
};

// Method to check if poll is active
pollSchema.methods.isActive = function() {
  return this.status === 'active' && this.endDate > new Date();
};

// Check if poll has ended
pollSchema.pre('save', function(next) {
  if (this.endDate < new Date() && this.status === 'active') {
    this.status = 'closed';
  }
  next();
});

pollSchema.pre('validate', function(next) {
  const electionId = this._id ? this._id.toString() : new mongoose.Types.ObjectId().toString();
  this.options.forEach((option) => {
    if (!option.optionCommitment && option.optionText) {
      option.optionCommitment = this.constructor.createOptionCommitment(electionId, option.optionText);
    }
  });
  next();
});

// Indexes
pollSchema.index({ creator: 1 });
pollSchema.index({ createdAt: -1 });
pollSchema.index({ status: 1 });
pollSchema.index({ category: 1 });
pollSchema.index({ visibility: 1 });
pollSchema.index({ 'options._id': 1 });
pollSchema.index({ _id: 1, 'encryptedBallots.nullifier': 1 });

module.exports = mongoose.model('Poll', pollSchema);
