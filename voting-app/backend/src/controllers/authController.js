const jwt = require('jsonwebtoken');
const User = require('../models/User');
const aadharService = require('../services/aadharService');
const emailService = require('../services/emailService');
const smsService = require('../services/smsService');
const { validateEmail } = require('../utils/validators');

const getOtpMaxAttempts = () => {
  const attempts = Number.parseInt(process.env.OTP_MAX_ATTEMPTS || '5', 10);
  return Number.isFinite(attempts) && attempts > 0 ? attempts : 5;
};

const getJwtSecret = () => process.env.JWT_SECRET || 'development-jwt-secret-change-me';
const getRefreshTokenSecret = () => process.env.REFRESH_TOKEN_SECRET || 'development-refresh-secret-change-me';

const getVerificationStatus = (user) => ({
  emailVerified: user.emailVerified,
  phoneVerified: user.phoneVerified
});

const isFullyVerified = (user) => user.emailVerified && user.phoneVerified;

class AuthController {
  /**
   * Register user with Aadhar
   */
  static async register(req, res) {
    try {
      const { firstName, lastName, email, phoneNumber, password, walletAddress } = req.body;

      // Validation
      if (!firstName || !lastName || !email || !phoneNumber || !password) {
        return res.status(400).json({
          success: false,
          message: 'All fields are required'
        });
      }

      if (!validateEmail(email)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid email format'
        });
      }

      if (walletAddress && !/^0x[a-fA-F0-9]{40}$/.test(walletAddress)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid wallet address format'
        });
      }

      if (walletAddress) {
        const existingWalletUser = await User.findOne({
          walletAddress: walletAddress.toLowerCase()
        });

        if (existingWalletUser) {
          return res.status(400).json({
            success: false,
            message: 'Wallet address is already linked to another account'
          });
        }
      }

      if (password.length < 8) {
        return res.status(400).json({
          success: false,
          message: 'Password must be at least 8 characters'
        });
      }

      // Check if email exists
      const emailExists = await User.findOne({ email });
      if (emailExists) {
        return res.status(400).json({
          success: false,
          message: 'Email already registered'
        });
      }

      // Check if phone exists
      const phoneExists = await User.findOne({ phoneNumber });
      if (phoneExists) {
        return res.status(400).json({
          success: false,
          message: 'Phone number already registered'
        });
      }

      const emailOtp = aadharService.generateOTP();
      const phoneOtp = aadharService.generateOTP();

      // Create new user
      const user = new User({
        firstName,
        lastName,
        email,
        phoneNumber,
        password,
        walletAddress: walletAddress ? walletAddress.toLowerCase() : undefined,
        walletVerified: !!walletAddress,
        walletAddressChanged: false
      });

      user.setChannelOTP('email', emailOtp);
      user.setChannelOTP('phone', phoneOtp);
      user.otpAttempts = 0;
      user.otpLastSent = Date.now();

      await user.save();

      try {
        await emailService.sendOTP(email, emailOtp, `${firstName} ${lastName}`);
      } catch (emailError) {
        console.warn('Email OTP delivery skipped:', emailError.message);
      }

      try {
        await smsService.sendOTP(phoneNumber, phoneOtp);
      } catch (smsError) {
        console.warn('Phone OTP delivery skipped:', smsError.message);
      }

      const responseBody = {
        success: true,
        message: 'Registration successful. OTPs sent for email and phone.',
        userId: user._id,
        email: user.email,
        verificationStatus: {
          emailVerified: false,
          phoneVerified: false
        }
      };

      if (process.env.NODE_ENV !== 'production') {
        responseBody.devOtps = {
          email: emailOtp,
          phone: phoneOtp
        };
      }

      res.status(201).json(responseBody);
    } catch (error) {
      console.error('Registration error:', error);
      res.status(500).json({
        success: false,
        message: error.message
      });
    }
  }

  static async verifyEmailOTP(req, res) {
    try {
      const { userId, otp } = req.body;
      if (!userId || !otp) {
        return res.status(400).json({
          success: false,
          message: 'User ID and email OTP are required'
        });
      }

      const user = await User.findById(userId).select('+emailOtp +emailOtpExpiry');
      if (!user) {
        return res.status(404).json({ success: false, message: 'User not found' });
      }

      if (!user.verifyChannelOTP('email', otp)) {
        return res.status(400).json({ success: false, message: 'Invalid or expired email OTP' });
      }

      user.emailVerified = true;
      user.clearChannelOTP('email');
      await user.save();

      return res.status(200).json({
        success: true,
        message: 'Email verified successfully',
        verificationStatus: getVerificationStatus(user),
        fullyVerified: isFullyVerified(user)
      });
    } catch (error) {
      console.error('Email OTP verification error:', error);
      return res.status(500).json({ success: false, message: error.message });
    }
  }

  static async verifyPhoneOTP(req, res) {
    try {
      const { userId, otp } = req.body;
      if (!userId || !otp) {
        return res.status(400).json({
          success: false,
          message: 'User ID and phone OTP are required'
        });
      }

      const user = await User.findById(userId).select('+phoneOtp +phoneOtpExpiry');
      if (!user) {
        return res.status(404).json({ success: false, message: 'User not found' });
      }

      if (!user.verifyChannelOTP('phone', otp)) {
        return res.status(400).json({ success: false, message: 'Invalid or expired phone OTP' });
      }

      user.phoneVerified = true;
      user.clearChannelOTP('phone');
      await user.save();

      return res.status(200).json({
        success: true,
        message: 'Phone number verified successfully',
        verificationStatus: getVerificationStatus(user),
        fullyVerified: isFullyVerified(user)
      });
    } catch (error) {
      console.error('Phone OTP verification error:', error);
      return res.status(500).json({ success: false, message: error.message });
    }
  }

  /**
   * Verify Aadhaar OTP
   */
  static async verifyAadhaarOTP(req, res) {
    try {
      const { userId, otp } = req.body;

      if (!userId || !otp) {
        return res.status(400).json({
          success: false,
          message: 'User ID and Aadhaar OTP are required'
        });
      }

      const user = await User.findById(userId).select('+aadharOtp +aadharOtpExpiry +otpAttempts +aadharOtpRequestId');
      if (!user) {
        return res.status(404).json({ success: false, message: 'User not found' });
      }

      let otpVerified = false;

      if (aadharService.hasProviderConfig()) {
        await aadharService.verifyAadharOTP(user.aadharOtpRequestId, otp, user.aadharNumber);
        otpVerified = true;
      } else {
        otpVerified = user.verifyChannelOTP('aadhar', otp);
      }

      if (!otpVerified) {
        user.otpAttempts = (user.otpAttempts || 0) + 1;
        await user.save();

        const maxAttempts = getOtpMaxAttempts();
        if (user.otpAttempts >= maxAttempts) {
          return res.status(429).json({
            success: false,
            message: 'Maximum Aadhaar OTP attempts exceeded. Please request a new OTP.'
          });
        }

        return res.status(400).json({
          success: false,
          message: 'Invalid or expired Aadhaar OTP',
          attemptsRemaining: maxAttempts - user.otpAttempts
        });
      }

      user.aadharVerified = true;
      user.aadharVerificationDate = new Date();
      user.otpVerified = true;
      user.clearChannelOTP('aadhar');
      user.aadharOtpRequestId = undefined;
      user.otpAttempts = 0;

      await user.save();

      if (isFullyVerified(user)) {
        try {
          await emailService.sendWelcomeEmail(user.email, user.firstName);
        } catch (emailError) {
          console.warn('Welcome email skipped:', emailError.message);
        }
      }

      res.status(200).json({
        success: true,
        message: 'Aadhaar OTP verified successfully.',
        userId: user._id,
        verificationStatus: getVerificationStatus(user),
        fullyVerified: isFullyVerified(user)
      });
    } catch (error) {
      console.error('Aadhaar OTP verification error:', error);
      res.status(500).json({
        success: false,
        message: error.message
      });
    }
  }

  static async verifyOTP(req, res) {
    return res.status(400).json({
      success: false,
      message: 'Use /auth/verify-email-otp or /auth/verify-phone-otp to verify OTPs.'
    });
  }

  /**
   * Resend OTP
   */
  static async resendOTP(req, res) {
    try {
      const { userId } = req.body;

      if (!userId) {
        return res.status(400).json({
          success: false,
          message: 'User ID is required'
        });
      }

      const user = await User.findById(userId).select('+otpLastSent +aadharOtpRequestId');
      
      if (!user) {
        return res.status(404).json({
          success: false,
          message: 'User not found'
        });
      }

      // Check rate limiting
      const lastOtpTime = user.otpLastSent ? new Date(user.otpLastSent) : null;
      if (lastOtpTime && Date.now() - lastOtpTime < 60000) {
        return res.status(429).json({
          success: false,
          message: 'Please wait before requesting a new OTP'
        });
      }

      const emailOtp = aadharService.generateOTP();
      const phoneOtp = aadharService.generateOTP();

      user.setChannelOTP('email', emailOtp);
      user.setChannelOTP('phone', phoneOtp);
      user.otpAttempts = 0;
      await user.save();

      try {
        await emailService.sendOTP(user.email, emailOtp, `${user.firstName} ${user.lastName}`);
      } catch (emailError) {
        console.warn('Email OTP resend skipped:', emailError.message);
      }

      try {
        await smsService.sendOTP(user.phoneNumber, phoneOtp);
      } catch (smsError) {
        console.warn('Phone OTP resend skipped:', smsError.message);
      }

      const responseBody = {
        success: true,
        message: 'New OTPs sent to your email and phone.',
        devOtps: {
          email: emailOtp,
          phone: phoneOtp
        }
      };

      res.status(200).json(responseBody);
    } catch (error) {
      console.error('Resend OTP error:', error);
      res.status(500).json({
        success: false,
        message: error.message
      });
    }
  }

  /**
   * Login user
   */
  static async login(req, res) {
    try {
      const { email, password } = req.body;

      if (!email || !password) {
        return res.status(400).json({
          success: false,
          message: 'Email and password are required'
        });
      }

      const user = await User.findOne({ email }).select('+password +loginAttempts +accountLocked +lockExpiry');

      if (!user) {
        return res.status(401).json({
          success: false,
          message: 'Invalid email or password'
        });
      }

      // Check if account is locked
      if (user.accountLocked) {
        if (user.lockExpiry > new Date()) {
          return res.status(403).json({
            success: false,
            message: 'Account is locked. Please try again later.'
          });
        } else {
          user.accountLocked = false;
          user.lockExpiry = null;
          user.loginAttempts = 0;
        }
      }

      // Check password
      const passwordMatch = await user.comparePassword(password);
      if (!passwordMatch) {
        await user.incrementLoginAttempts();
        return res.status(401).json({
          success: false,
          message: 'Invalid email or password'
        });
      }

      // Check identity verification
      if (!isFullyVerified(user)) {
        return res.status(403).json({
          success: false,
          message: 'Email and phone verification required'
        });
      }

      // Reset login attempts and update last login
      await user.resetLoginAttempts();

      // Generate JWT tokens
      const token = jwt.sign(
        {
          id: user._id,
          email: user.email
        },
        getJwtSecret(),
        { expiresIn: process.env.JWT_EXPIRE || '7d' }
      );

      const refreshToken = jwt.sign(
        { id: user._id },
        getRefreshTokenSecret(),
        { expiresIn: process.env.REFRESH_TOKEN_EXPIRE || '30d' }
      );

      res.status(200).json({
        success: true,
        message: 'Login successful',
        token,
        refreshToken,
        user: {
          id: user._id,
          firstName: user.firstName,
          lastName: user.lastName,
          email: user.email,
          walletAddress: user.walletAddress || null,
          walletVerified: !!user.walletVerified
        }
      });
    } catch (error) {
      console.error('Login error:', error);
      res.status(500).json({
        success: false,
        message: error.message
      });
    }
  }

  /**
   * Reset password via OTP
   */
  static async resetPasswordRequest(req, res) {
    try {
      const { email } = req.body;

      if (!email) {
        return res.status(400).json({
          success: false,
          message: 'Email is required'
        });
      }

      const user = await User.findOne({ email });
      
      if (!user) {
        return res.status(404).json({
          success: false,
          message: 'User not found'
        });
      }

      // Generate OTP
      const otp = aadharService.generateOTP();
      await user.setOTP(otp);

      // Send OTP
      await emailService.sendOTP(email, otp, user.firstName);

      res.status(200).json({
        success: true,
        message: 'OTP sent to your email for password reset',
        userId: user._id
      });
    } catch (error) {
      console.error('Password reset request error:', error);
      res.status(500).json({
        success: false,
        message: error.message
      });
    }
  }

  /**
   * Verify OTP and reset password
   */
  static async resetPasswordWithOTP(req, res) {
    try {
      const { userId, otp, newPassword } = req.body;

      if (!userId || !otp || !newPassword) {
        return res.status(400).json({
          success: false,
          message: 'User ID, OTP, and new password are required'
        });
      }

      if (newPassword.length < 8) {
        return res.status(400).json({
          success: false,
          message: 'Password must be at least 8 characters'
        });
      }

      const user = await User.findById(userId).select('+otp +otpExpiry');
      
      if (!user) {
        return res.status(404).json({
          success: false,
          message: 'User not found'
        });
      }

      if (!user.verifyOTP(otp)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid or expired OTP'
        });
      }

      // Update password
      user.password = newPassword;
      user.otp = undefined;
      user.otpExpiry = undefined;

      await user.save();

      res.status(200).json({
        success: true,
        message: 'Password reset successfully'
      });
    } catch (error) {
      console.error('Password reset error:', error);
      res.status(500).json({
        success: false,
        message: error.message
      });
    }
  }

  /**
   * Refresh token
   */
  static async refreshToken(req, res) {
    try {
      const { refreshToken } = req.body;

      if (!refreshToken) {
        return res.status(400).json({
          success: false,
          message: 'Refresh token is required'
        });
      }

      const decoded = jwt.verify(refreshToken, getRefreshTokenSecret());
      const user = await User.findById(decoded.id);

      if (!user) {
        return res.status(404).json({
          success: false,
          message: 'User not found'
        });
      }

      // Generate new token
      const newToken = jwt.sign(
        {
          id: user._id,
          email: user.email
        },
        getJwtSecret(),
        { expiresIn: process.env.JWT_EXPIRE || '7d' }
      );

      res.status(200).json({
        success: true,
        token: newToken
      });
    } catch (error) {
      console.error('Refresh token error:', error);
      res.status(401).json({
        success: false,
        message: 'Invalid refresh token'
      });
    }
  }

  /**
   * Logout
   */
  static async logout(req, res) {
    res.status(200).json({
      success: true,
      message: 'Logout successful'
    });
  }
}

module.exports = AuthController;
