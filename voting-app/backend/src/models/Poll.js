const mongoose = require('mongoose');

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
    _id: mongoose.Schema.Types.ObjectId,
    optionText: {
      type: String,
      required: true
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

  // Blockchain
  contractAddress: String,
  contractTransactionHash: String,
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

// Method to check if user already voted
pollSchema.methods.hasUserVoted = function(userId) {
  return this.uniqueVoters.includes(userId);
};

// Method to get results
pollSchema.methods.getResults = function() {
  return this.options.map(option => ({
    _id: option._id,
    optionText: option.optionText,
    votes: option.votes,
    percentage: this.totalVotes > 0 ? ((option.votes / this.totalVotes) * 100).toFixed(2) : 0
  }));
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

// Indexes
pollSchema.index({ creator: 1 });
pollSchema.index({ createdAt: -1 });
pollSchema.index({ status: 1 });
pollSchema.index({ category: 1 });
pollSchema.index({ visibility: 1 });
pollSchema.index({ 'options._id': 1 });

module.exports = mongoose.model('Poll', pollSchema);
