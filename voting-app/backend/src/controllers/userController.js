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
      const { firstName, lastName, email, phoneNumber, bio, profileImage, walletAddress } = req.body;

      const currentUser = await User.findById(userId);

      if (!currentUser) {
        return res.status(404).json({
          success: false,
          message: 'User not found'
        });
      }

      const allowedFields = { firstName, lastName, email, phoneNumber, bio, profileImage };

      Object.keys(allowedFields).forEach((key) => {
        if (allowedFields[key] === undefined) delete allowedFields[key];
      });

      if (email) {
        const existingEmailUser = await User.findOne({ email: email.toLowerCase(), _id: { $ne: userId } });
        if (existingEmailUser) {
          return res.status(400).json({
            success: false,
            message: 'Email is already registered to another account'
          });
        }
        allowedFields.email = email.toLowerCase();
      }

      if (phoneNumber) {
        const existingPhoneUser = await User.findOne({ phoneNumber, _id: { $ne: userId } });
        if (existingPhoneUser) {
          return res.status(400).json({
            success: false,
            message: 'Phone number is already registered to another account'
          });
        }
      }

      if (walletAddress !== undefined) {
        const trimmedWalletAddress = walletAddress.trim();

        if (trimmedWalletAddress) {
          const normalizedWallet = trimmedWalletAddress.toLowerCase();

          if (!/^0x[a-fA-F0-9]{40}$/.test(normalizedWallet)) {
            return res.status(400).json({
              success: false,
              message: 'Invalid wallet address format'
            });
          }

          const existingWalletUser = await User.findOne({
            walletAddress: normalizedWallet,
            _id: { $ne: userId }
          });

          if (existingWalletUser) {
            return res.status(400).json({
              success: false,
              message: 'Wallet address is already linked to another account'
            });
          }

          const oldWallet = currentUser.walletAddress;

          if (oldWallet && oldWallet !== normalizedWallet) {
            allowedFields.walletAddressHistory = [
              ...(currentUser.walletAddressHistory || []),
              {
                previousWalletAddress: oldWallet,
                newWalletAddress: normalizedWallet,
                changedAt: new Date()
              }
            ];
            allowedFields.walletAddressChanged = true;
          }

          allowedFields.walletAddress = normalizedWallet;
          allowedFields.walletVerified = true;
        }
      }

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

      const userData = await User.findById(userId);
      const normalizedWalletAddress = walletAddress.toLowerCase();
      const updatePayload = {
        walletAddress: normalizedWalletAddress,
        walletVerified: true
      };

      if (userData.walletAddress && userData.walletAddress !== normalizedWalletAddress) {
        updatePayload.walletAddressHistory = [
          ...(userData.walletAddressHistory || []),
          {
            previousWalletAddress: userData.walletAddress,
            newWalletAddress: normalizedWalletAddress,
            changedAt: new Date()
          }
        ];
        updatePayload.walletAddressChanged = true;
      }

      const user = await User.findByIdAndUpdate(
        userId,
        updatePayload,
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
