const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const getOtpExpireMinutes = () => {
  const minutes = Number.parseInt(process.env.OTP_EXPIRE_TIME || '10', 10);
  return Number.isFinite(minutes) && minutes > 0 ? minutes : 10;
};

const userSchema = new mongoose.Schema({
  // Basic Info
  firstName: {
    type: String,
    required: true,
    trim: true
  },
  lastName: {
    type: String,
    required: true,
    trim: true
  },
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    match: /^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/
  },
  phoneNumber: {
    type: String,
    required: true,
    unique: true
  },

  // Aadhar Information
  aadharNumber: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    length: 12
  },
  aadharVerified: {
    type: Boolean,
    default: false
  },
  aadharVerificationDate: Date,
  aadharOtpRequestId: {
    type: String,
    select: false
  },
  emailVerified: {
    type: Boolean,
    default: false
  },
  phoneVerified: {
    type: Boolean,
    default: false
  },
  emailOtp: {
    type: String,
    select: false
  },
  emailOtpExpiry: {
    type: Date,
    select: false
  },
  phoneOtp: {
    type: String,
    select: false
  },
  phoneOtpExpiry: {
    type: Date,
    select: false
  },
  aadharOtp: {
    type: String,
    select: false
  },
  aadharOtpExpiry: {
    type: Date,
    select: false
  },

  // Authentication
  password: {
    type: String,
    required: true,
    minlength: 8,
    select: false // Don't return password by default
  },
  
  // OTP
  otp: {
    type: String,
    select: false
  },
  otpExpiry: {
    type: Date,
    select: false
  },
  otpAttempts: {
    type: Number,
    default: 0,
    select: false
  },
  otpLastSent: {
    type: Date,
    select: false
  },
  otpVerified: {
    type: Boolean,
    default: false
  },

  // Blockchain
  walletAddress: {
    type: String,
    unique: true,
    sparse: true,
    lowercase: true
  },
  walletPrivateKey: {
    type: String,
    select: false
  },
  walletAddressHistory: [{
    previousWalletAddress: String,
    newWalletAddress: String,
    changedAt: {
      type: Date,
      default: Date.now
    }
  }],
  walletAddressChanged: {
    type: Boolean,
    default: false
  },
  walletVerified: {
    type: Boolean,
    default: false
  },

  // Status
  isActive: {
    type: Boolean,
    default: true
  },
  accountLocked: {
    type: Boolean,
    default: false
  },
  lockExpiry: Date,
  loginAttempts: {
    type: Number,
    default: 0
  },

  // Voting Info
  votesCount: {
    type: Number,
    default: 0
  },
  pollsCreated: {
    type: Number,
    default: 0
  },
  votedPolls: [{
    pollId: mongoose.Schema.Types.ObjectId,
    transactionHash: String,
    votedAt: Date
  }],

  // Profile
  profileImage: String,
  bio: String,

  // Timestamps
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  },
  lastLoginAt: Date,
  lastPasswordChange: Date

}, { timestamps: true });

// Hash password before saving
userSchema.pre('save', async function(next) {
  if (!this.isModified('password')) return next();

  try {
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
    this.lastPasswordChange = Date.now();
    next();
  } catch (error) {
    next(error);
  }
});

// Method to compare passwords
userSchema.methods.comparePassword = async function(candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};

// Method to verify OTP
userSchema.methods.verifyOTP = function(providedOTP) {
  if (!this.otpExpiry || this.otpExpiry.getTime() < Date.now()) {
    return false; // OTP expired
  }
  return this.otp === providedOTP;
};

userSchema.methods.setChannelOTP = function(channel, otp) {
  const expiry = new Date(Date.now() + getOtpExpireMinutes() * 60 * 1000);
  this[`${channel}Otp`] = otp;
  this[`${channel}OtpExpiry`] = expiry;
  this.otpLastSent = Date.now();
};

userSchema.methods.verifyChannelOTP = function(channel, providedOTP) {
  const otp = this[`${channel}Otp`];
  const expiry = this[`${channel}OtpExpiry`];

  if (!otp || !expiry || expiry.getTime() < Date.now()) {
    return false;
  }

  return otp === providedOTP;
};

userSchema.methods.clearChannelOTP = function(channel) {
  this[`${channel}Otp`] = undefined;
  this[`${channel}OtpExpiry`] = undefined;
};

// Method to increment login attempts
userSchema.methods.incrementLoginAttempts = function() {
  this.loginAttempts += 1;
  if (this.loginAttempts >= 5) {
    this.accountLocked = true;
    this.lockExpiry = new Date(Date.now() + 30 * 60 * 1000); // 30 minutes
  }
  return this.save();
};

// Method to reset login attempts
userSchema.methods.resetLoginAttempts = function() {
  this.loginAttempts = 0;
  this.accountLocked = false;
  this.lockExpiry = null;
  this.lastLoginAt = Date.now();
  return this.save();
};

// Method to set OTP
userSchema.methods.setOTP = function(otp) {
  this.otp = otp;
  this.otpExpiry = new Date(Date.now() + getOtpExpireMinutes() * 60 * 1000);
  this.aadharOtp = otp;
  this.aadharOtpExpiry = this.otpExpiry;
  this.otpAttempts = 0;
  this.otpLastSent = Date.now();
  return this.save();
};

// Create indexes
userSchema.index({ aadharNumber: 1 }, { unique: true });
userSchema.index({ email: 1 }, { unique: true });
userSchema.index({ phoneNumber: 1 }, { unique: true });
userSchema.index({ walletAddress: 1 }, { sparse: true });
userSchema.index({ createdAt: -1 });

module.exports = mongoose.model('User', userSchema);
