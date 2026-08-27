const mongoose = require('mongoose');

const commentSchema = new mongoose.Schema({
  author: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  content: {
    type: String,
    required: true,
    trim: true,
    maxlength: 2000
  },
  likes: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }],
  replies: [{
    author: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    content: {
      type: String,
      required: true,
      trim: true,
      maxlength: 1000
    },
    createdAt: {
      type: Date,
      default: Date.now
    }
  }],
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
}, { _id: true });

const discussionSchema = new mongoose.Schema({
  title: {
    type: String,
    required: true,
    trim: true,
    maxlength: 200
  },
  description: {
    type: String,
    required: true,
    trim: true,
    maxlength: 5000
  },
  
  // Author info
  author: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },

  // Content
  category: {
    type: String,
    enum: ['politics', 'society', 'education', 'technology', 'health', 'environment', 'other'],
    default: 'other'
  },
  tags: [String],

  // Comments
  comments: [commentSchema],

  // Engagement
  likes: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }],
  viewCount: {
    type: Number,
    default: 0
  },
  commentCount: {
    type: Number,
    default: 0
  },
  likeCount: {
    type: Number,
    default: 0
  },

  // Status
  isArchived: {
    type: Boolean,
    default: false
  },
  isPinned: {
    type: Boolean,
    default: false
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

// Method to add comment
discussionSchema.methods.addComment = async function(userId, content) {
  const comment = {
    _id: new mongoose.Types.ObjectId(),
    author: userId,
    content,
    createdAt: new Date()
  };
  
  this.comments.push(comment);
  this.commentCount += 1;
  return await this.save();
};

// Method to add reply
discussionSchema.methods.addReply = async function(commentId, userId, content) {
  const comment = this.comments.id(commentId);
  if (!comment) {
    throw new Error('Comment not found');
  }

  comment.replies.push({
    author: userId,
    content,
    createdAt: new Date()
  });

  return await this.save();
};

// Method to like discussion
discussionSchema.methods.likeTopic = async function(userId) {
  if (!this.likes.includes(userId)) {
    this.likes.push(userId);
    this.likeCount += 1;
  }
  return await this.save();
};

// Method to unlike discussion
discussionSchema.methods.unlikeTopic = async function(userId) {
  this.likes = this.likes.filter(id => !id.equals(userId));
  this.likeCount = Math.max(0, this.likeCount - 1);
  return await this.save();
};

// Indexes
discussionSchema.index({ author: 1 });
discussionSchema.index({ category: 1 });
discussionSchema.index({ createdAt: -1 });
discussionSchema.index({ isPinned: -1, createdAt: -1 });
discussionSchema.index({ tags: 1 });
discussionSchema.index({ 'comments.author': 1 });

module.exports = mongoose.model('Discussion', discussionSchema);
