const User = require('../models/User');
const mongoose = require('mongoose');

class UserController {
  /**
   * Get user profile
   */
  static async getProfile(req, res) {
    try {
      const userId = req.userId;

      const user = await User.findById(userId).select('-password -otp -otpExpiry');

      if (!user) {
        return res.status(404).json({
          success: false,
          message: 'User not found'
        });
      }

      res.status(200).json({
        success: true,
        user
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: error.message
      });
    }
  }

  /**
   * Update user profile
   */
  static async updateProfile(req, res) {
    try {
      const userId = req.userId;
      const { firstName, lastName, bio, profileImage } = req.body;

      const allowedFields = { firstName, lastName, bio, profileImage };
      
      // Remove undefined fields
      Object.keys(allowedFields).forEach(key => 
        allowedFields[key] === undefined && delete allowedFields[key]
      );

      const user = await User.findByIdAndUpdate(
        userId,
        allowedFields,
        { new: true, runValidators: true }
      ).select('-password -otp -otpExpiry');

      res.status(200).json({
        success: true,
        message: 'Profile updated successfully',
        user
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: error.message
      });
    }
  }

  /**
   * Change password
   */
  static async changePassword(req, res) {
    try {
      const userId = req.userId;
      const { currentPassword, newPassword, confirmPassword } = req.body;

      if (!currentPassword || !newPassword || !confirmPassword) {
        return res.status(400).json({
          success: false,
          message: 'All password fields are required'
        });
      }

      if (newPassword !== confirmPassword) {
        return res.status(400).json({
          success: false,
          message: 'New passwords do not match'
        });
      }

      if (newPassword.length < 8) {
        return res.status(400).json({
          success: false,
          message: 'Password must be at least 8 characters'
        });
      }

      const user = await User.findById(userId).select('+password');

      if (!user) {
        return res.status(404).json({
          success: false,
          message: 'User not found'
        });
      }

      const passwordMatch = await user.comparePassword(currentPassword);

      if (!passwordMatch) {
        return res.status(401).json({
          success: false,
          message: 'Current password is incorrect'
        });
      }

      user.password = newPassword;
      await user.save();

      res.status(200).json({
        success: true,
        message: 'Password changed successfully'
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: error.message
      });
    }
  }

  /**
   * Get user statistics
   */
  static async getUserStats(req, res) {
    try {
      const userId = req.userId;

      const user = await User.findById(userId).select(
        'votesCount pollsCreated votedPolls'
      );

      if (!user) {
        return res.status(404).json({
          success: false,
          message: 'User not found'
        });
      }

      res.status(200).json({
        success: true,
        stats: {
          votesCount: user.votesCount,
          pollsCreated: user.pollsCreated,
          votedPolls: user.votedPolls.length,
          joinDate: user.createdAt
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
   * Link wallet to account
   */
  static async linkWallet(req, res) {
    try {
      const userId = req.userId;
      const { walletAddress } = req.body;

      if (!walletAddress) {
        return res.status(400).json({
          success: false,
          message: 'Wallet address is required'
        });
      }

      // Validate wallet address format
      if (!/^0x[a-fA-F0-9]{40}$/.test(walletAddress)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid wallet address format'
        });
      }

      // Check if wallet is already linked to another user
      const existingWallet = await User.findOne({ 
        walletAddress: walletAddress.toLowerCase(),
        _id: { $ne: userId }
      });

      if (existingWallet) {
        return res.status(400).json({
          success: false,
          message: 'Wallet is already linked to another account'
        });
      }

      const user = await User.findByIdAndUpdate(
        userId,
        { walletAddress: walletAddress.toLowerCase(), walletVerified: true },
        { new: true }
      ).select('-password -otp -otpExpiry');

      res.status(200).json({
        success: true,
        message: 'Wallet linked successfully',
        user
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: error.message
      });
    }
  }

  /**
   * Get public user profile
   */
  static async getPublicProfile(req, res) {
    try {
      const { userId } = req.params;

      if (!mongoose.Types.ObjectId.isValid(userId)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid user ID'
        });
      }

      const user = await User.findById(userId).select(
        'firstName lastName profileImage bio votesCount pollsCreated createdAt'
      );

      if (!user) {
        return res.status(404).json({
          success: false,
          message: 'User not found'
        });
      }

      res.status(200).json({
        success: true,
        user
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: error.message
      });
    }
  }
}

module.exports = UserController;
