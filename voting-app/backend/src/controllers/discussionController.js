const Discussion = require('../models/Discussion');
const mongoose = require('mongoose');

class DiscussionController {
  /**
   * Get all discussions
   */
  static async getAllDiscussions(req, res) {
    try {
      const { page = 1, limit = 10, category, search } = req.query;
      const skip = (page - 1) * limit;

      let query = { isArchived: false };
      
      if (category) query.category = category;
      
      if (search) {
        query.$or = [
          { title: { $regex: search, $options: 'i' } },
          { description: { $regex: search, $options: 'i' } }
        ];
      }

      const discussions = await Discussion.find(query)
        .populate('author', 'firstName lastName profileImage')
        .sort({ isPinned: -1, createdAt: -1 })
        .limit(parseInt(limit))
        .skip(skip);

      const total = await Discussion.countDocuments(query);

      res.status(200).json({
        success: true,
        discussions,
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
   * Get single discussion
   */
  static async getDiscussion(req, res) {
    try {
      const { id } = req.params;

      if (!mongoose.Types.ObjectId.isValid(id)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid discussion ID'
        });
      }

      const discussion = await Discussion.findByIdAndUpdate(
        id,
        { $inc: { viewCount: 1 } },
        { new: true }
      )
        .populate('author', 'firstName lastName email profileImage')
        .populate('likes', 'firstName lastName')
        .populate('comments.author', 'firstName lastName profileImage')
        .populate('comments.replies.author', 'firstName lastName profileImage');

      if (!discussion) {
        return res.status(404).json({
          success: false,
          message: 'Discussion not found'
        });
      }

      res.status(200).json({
        success: true,
        discussion
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: error.message
      });
    }
  }

  /**
   * Create discussion
   */
  static async createDiscussion(req, res) {
    try {
      const { title, description, category, tags } = req.body;
      const userId = req.userId;

      if (!title || !description) {
        return res.status(400).json({
          success: false,
          message: 'Title and description are required'
        });
      }

      if (title.length > 200) {
        return res.status(400).json({
          success: false,
          message: 'Title must not exceed 200 characters'
        });
      }

      if (description.length > 5000) {
        return res.status(400).json({
          success: false,
          message: 'Description must not exceed 5000 characters'
        });
      }

      const discussion = new Discussion({
        title,
        description,
        author: userId,
        category: category || 'other',
        tags: tags || []
      });

      await discussion.save();
      await discussion.populate('author', 'firstName lastName profileImage');

      res.status(201).json({
        success: true,
        message: 'Discussion created successfully',
        discussion
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: error.message
      });
    }
  }

  /**
   * Add comment to discussion
   */
  static async addComment(req, res) {
    try {
      const { id } = req.params;
      const { content } = req.body;
      const userId = req.userId;

      if (!mongoose.Types.ObjectId.isValid(id)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid discussion ID'
        });
      }

      if (!content || content.trim().length === 0) {
        return res.status(400).json({
          success: false,
          message: 'Comment content is required'
        });
      }

      if (content.length > 2000) {
        return res.status(400).json({
          success: false,
          message: 'Comment must not exceed 2000 characters'
        });
      }

      const discussion = await Discussion.findById(id);

      if (!discussion) {
        return res.status(404).json({
          success: false,
          message: 'Discussion not found'
        });
      }

      const comment = {
        _id: new mongoose.Types.ObjectId(),
        author: userId,
        content: content.trim(),
        createdAt: new Date()
      };

      discussion.comments.push(comment);
      discussion.commentCount += 1;

      await discussion.save();
      await discussion.populate('comments.author', 'firstName lastName profileImage');

      res.status(201).json({
        success: true,
        message: 'Comment added successfully',
        comment: discussion.comments[discussion.comments.length - 1]
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: error.message
      });
    }
  }

  /**
   * Add reply to comment
   */
  static async addReply(req, res) {
    try {
      const { id, commentId } = req.params;
      const { content } = req.body;
      const userId = req.userId;

      if (!mongoose.Types.ObjectId.isValid(id) || !mongoose.Types.ObjectId.isValid(commentId)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid discussion or comment ID'
        });
      }

      if (!content || content.trim().length === 0) {
        return res.status(400).json({
          success: false,
          message: 'Reply content is required'
        });
      }

      if (content.length > 1000) {
        return res.status(400).json({
          success: false,
          message: 'Reply must not exceed 1000 characters'
        });
      }

      const discussion = await Discussion.findById(id);

      if (!discussion) {
        return res.status(404).json({
          success: false,
          message: 'Discussion not found'
        });
      }

      const comment = discussion.comments.id(commentId);
      if (!comment) {
        return res.status(404).json({
          success: false,
          message: 'Comment not found'
        });
      }

      comment.replies.push({
        author: userId,
        content: content.trim(),
        createdAt: new Date()
      });

      await discussion.save();
      await discussion.populate('comments.replies.author', 'firstName lastName profileImage');

      res.status(201).json({
        success: true,
        message: 'Reply added successfully',
        reply: comment.replies[comment.replies.length - 1]
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: error.message
      });
    }
  }

  /**
   * Like discussion
   */
  static async likeDiscussion(req, res) {
    try {
      const { id } = req.params;
      const userId = req.userId;

      if (!mongoose.Types.ObjectId.isValid(id)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid discussion ID'
        });
      }

      const discussion = await Discussion.findById(id);

      if (!discussion) {
        return res.status(404).json({
          success: false,
          message: 'Discussion not found'
        });
      }

      // Check if already liked
      if (discussion.likes.includes(userId)) {
        return res.status(400).json({
          success: false,
          message: 'You have already liked this discussion'
        });
      }

      await discussion.likeTopic(userId);

      res.status(200).json({
        success: true,
        message: 'Discussion liked',
        likeCount: discussion.likeCount
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: error.message
      });
    }
  }

  /**
   * Unlike discussion
   */
  static async unlikeDiscussion(req, res) {
    try {
      const { id } = req.params;
      const userId = req.userId;

      if (!mongoose.Types.ObjectId.isValid(id)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid discussion ID'
        });
      }

      const discussion = await Discussion.findById(id);

      if (!discussion) {
        return res.status(404).json({
          success: false,
          message: 'Discussion not found'
        });
      }

      // Check if liked
      if (!discussion.likes.includes(userId)) {
        return res.status(400).json({
          success: false,
          message: 'You have not liked this discussion'
        });
      }

      await discussion.unlikeTopic(userId);

      res.status(200).json({
        success: true,
        message: 'Like removed',
        likeCount: discussion.likeCount
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: error.message
      });
    }
  }

  /**
   * Delete discussion
   */
  static async deleteDiscussion(req, res) {
    try {
      const { id } = req.params;
      const userId = req.userId;

      if (!mongoose.Types.ObjectId.isValid(id)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid discussion ID'
        });
      }

      const discussion = await Discussion.findById(id);

      if (!discussion) {
        return res.status(404).json({
          success: false,
          message: 'Discussion not found'
        });
      }

      // Check if user is the author
      if (discussion.author.toString() !== userId) {
        return res.status(403).json({
          success: false,
          message: 'Only author can delete the discussion'
        });
      }

      // Archive instead of delete
      discussion.isArchived = true;
      await discussion.save();

      res.status(200).json({
        success: true,
        message: 'Discussion deleted'
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: error.message
      });
    }
  }
}

module.exports = DiscussionController;
