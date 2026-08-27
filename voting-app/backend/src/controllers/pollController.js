const Poll = require('../models/Poll');
const User = require('../models/User');
const blockchainService = require('../services/blockchainService');
const mongoose = require('mongoose');

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
        polls,
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
        .populate('uniqueVoters', 'firstName lastName');

      if (!poll) {
        return res.status(404).json({
          success: false,
          message: 'Poll not found'
        });
      }

      res.status(200).json({
        success: true,
        poll
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
      const { title, description, options, endDate, category, tags, walletAddress } = req.body;
      const userId = req.userId;

      // Validation
      if (!title || !description || !options || !endDate || !walletAddress) {
        return res.status(400).json({
          success: false,
          message: 'All required fields must be provided'
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

      // Create poll options array
      const pollOptions = options.map(option => ({
        _id: new mongoose.Types.ObjectId(),
        optionText: option,
        votes: 0,
        voters: []
      }));

      // Create poll
      const poll = new Poll({
        title,
        description,
        options: pollOptions,
        creator: userId,
        creatorWallet: walletAddress,
        endDate: endDateTime,
        category: category || 'other',
        tags: tags || []
      });

      await poll.save();

      // Update user stats
      await User.findByIdAndUpdate(userId, { $inc: { pollsCreated: 1 } });

      res.status(201).json({
        success: true,
        message: 'Poll created successfully',
        poll
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
      const { optionId, walletAddress } = req.body;
      const userId = req.userId;

      if (!mongoose.Types.ObjectId.isValid(pollId)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid poll ID'
        });
      }

      if (!optionId || !walletAddress) {
        return res.status(400).json({
          success: false,
          message: 'Option ID and wallet address are required'
        });
      }

      const poll = await Poll.findById(pollId);

      if (!poll) {
        return res.status(404).json({
          success: false,
          message: 'Poll not found'
        });
      }

      // Check if poll is active
      if (!poll.isActive()) {
        return res.status(400).json({
          success: false,
          message: 'Poll is closed'
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
        // Cast vote on blockchain
        const blockchainResult = await blockchainService.castVote(
          pollId,
          poll.options.findIndex(opt => opt._id.toString() === optionId)
        );

        // Add vote to poll
        await poll.addVote(userId, walletAddress, optionId, blockchainResult.transactionHash);

        // Update user stats
        await User.findByIdAndUpdate(userId, { $inc: { votesCount: 1 } });

        res.status(200).json({
          success: true,
          message: 'Vote recorded successfully',
          transactionHash: blockchainResult.transactionHash,
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

      const poll = await Poll.findById(id);

      if (!poll) {
        return res.status(404).json({
          success: false,
          message: 'Poll not found'
        });
      }

      res.status(200).json({
        success: true,
        results: {
          pollId: poll._id,
          title: poll.title,
          totalVotes: poll.totalVotes,
          totalParticipants: poll.totalParticipants,
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
      if (poll.totalVotes > 0) {
        return res.status(400).json({
          success: false,
          message: 'Cannot delete poll with existing votes'
        });
      }

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
