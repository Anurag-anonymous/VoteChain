const jwt = require('jsonwebtoken');
const User = require('../models/User');
const aadharService = require('../services/aadharService');
const emailService = require('../services/emailService');
const { validateEmail } = require('../utils/validators');

const getOtpMaxAttempts = () => {
  const attempts = Number.parseInt(process.env.OTP_MAX_ATTEMPTS || '5', 10);
  return Number.isFinite(attempts) && attempts > 0 ? attempts : 5;
};

class AuthController {
  /**
   * Register user with Aadhar
   */
  static async register(req, res) {
    try {
      const { firstName, lastName, email, phoneNumber, aadharNumber, password } = req.body;

      // Validation
      if (!firstName || !lastName || !email || !phoneNumber || !aadharNumber || !password) {
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

      if (!aadharService.validateAadharFormat(aadharNumber)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid Aadhar number format (must be 12 digits)'
        });
      }

      if (password.length < 8) {
        return res.status(400).json({
          success: false,
          message: 'Password must be at least 8 characters'
        });
      }

      // Check if Aadhar already registered
      const existingUser = await User.findOne({ aadharNumber });
      if (existingUser) {
        return res.status(400).json({
          success: false,
          message: 'This Aadhar number is already registered'
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

      const aadharOtp = await aadharService.initiateAadharOTP(aadharNumber, phoneNumber);

      // Create new user
      const user = new User({
        firstName,
        lastName,
        email,
        phoneNumber,
        aadharNumber,
        password,
        aadharOtpRequestId: aadharOtp.requestId
      });

      if (aadharOtp.development) {
        await user.setOTP(aadharOtp.otp);
      }

      await user.save();

      try {
        await emailService.sendOTP(email, aadharOtp.development ? aadharOtp.otp : 'sent to Aadhaar-linked mobile', `${firstName} ${lastName}`);
      } catch (emailError) {
        console.warn('OTP email notification skipped:', emailError.message);
      }

      const responseBody = {
        success: true,
        message: aadharOtp.development
          ? 'Registration successful. Development Aadhaar OTP generated.'
          : 'Registration successful. Aadhaar OTP sent to registered mobile.',
        userId: user._id,
        email: user.email
      };

      if (aadharOtp.development) {
        responseBody.devOtp = aadharOtp.otp;
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

  /**
   * Verify OTP
   */
  static async verifyOTP(req, res) {
    try {
      const { userId, otp } = req.body;

      if (!userId || !otp) {
        return res.status(400).json({
          success: false,
          message: 'User ID and OTP are required'
        });
      }

      const user = await User.findById(userId).select('+otp +otpExpiry +otpAttempts +aadharOtpRequestId');
      
      if (!user) {
        return res.status(404).json({
          success: false,
          message: 'User not found'
        });
      }

      let otpVerified = false;

      if (aadharService.hasProviderConfig()) {
        await aadharService.verifyAadharOTP(user.aadharOtpRequestId, otp, user.aadharNumber);
        otpVerified = true;
      } else {
        otpVerified = user.verifyOTP(otp);
      }

      if (!otpVerified) {
        user.otpAttempts = (user.otpAttempts || 0) + 1;
        await user.save();

        const maxAttempts = getOtpMaxAttempts();
        if (user.otpAttempts >= maxAttempts) {
          return res.status(429).json({
            success: false,
            message: 'Maximum OTP attempts exceeded. Please request a new OTP.'
          });
        }

        return res.status(400).json({
          success: false,
          message: 'Invalid or expired OTP',
          attemptsRemaining: maxAttempts - user.otpAttempts
        });
      }

      // Mark as verified
      user.aadharVerified = true;
      user.aadharVerificationDate = new Date();
      user.otpVerified = true;
      user.otp = undefined;
      user.otpExpiry = undefined;
      user.aadharOtpRequestId = undefined;
      user.otpAttempts = 0;

      await user.save();

      // Send welcome email
      await emailService.sendWelcomeEmail(user.email, user.firstName);

      res.status(200).json({
        success: true,
        message: 'OTP verified successfully. Your account is now active.',
        userId: user._id
      });
    } catch (error) {
      console.error('OTP verification error:', error);
      res.status(500).json({
        success: false,
        message: error.message
      });
    }
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

      const user = await User.findById(userId).select('+otpLastSent');
      
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

      // Generate new OTP
      const otp = aadharService.generateOTP();
      await user.setOTP(otp);

      // Send OTP
      await emailService.sendOTP(user.email, otp, user.firstName);

      res.status(200).json({
        success: true,
        message: 'New OTP sent to your email'
      });
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

      // Check Aadhar verification
      if (!user.aadharVerified) {
        return res.status(403).json({
          success: false,
          message: 'Aadhar verification required'
        });
      }

      // Reset login attempts and update last login
      await user.resetLoginAttempts();

      // Generate JWT tokens
      const token = jwt.sign(
        {
          id: user._id,
          email: user.email,
          aadharVerified: user.aadharVerified
        },
        process.env.JWT_SECRET,
        { expiresIn: process.env.JWT_EXPIRE || '7d' }
      );

      const refreshToken = jwt.sign(
        { id: user._id },
        process.env.REFRESH_TOKEN_SECRET,
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
          aadharVerified: user.aadharVerified
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
      const { email, aadharNumber } = req.body;

      if (!email || !aadharNumber) {
        return res.status(400).json({
          success: false,
          message: 'Email and Aadhar number are required'
        });
      }

      const user = await User.findOne({ email, aadharNumber });
      
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

      const decoded = jwt.verify(refreshToken, process.env.REFRESH_TOKEN_SECRET);
      const user = await User.findById(decoded.id);

      if (!user) {
        return res.status(404).json({
          success: false,