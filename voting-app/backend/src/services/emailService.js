const nodemailer = require('nodemailer');

class EmailService {
  constructor() {
    this.transporter = null;
  }

  getTransporter() {
    if (this.transporter) {
      return this.transporter;
    }

    const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS } = process.env;
    if (!SMTP_HOST || !SMTP_PORT || !SMTP_USER || !SMTP_PASS) {
      if (process.env.NODE_ENV !== 'production') {
        return null;
      }
      throw new Error('SMTP_HOST, SMTP_PORT, SMTP_USER, and SMTP_PASS must be configured before sending email');
    }

    this.transporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port: Number(SMTP_PORT),
      secure: Number(SMTP_PORT) === 465,
      auth: {
        user: SMTP_USER,
        pass: SMTP_PASS
      }
    });

    return this.transporter;
  }

  /**
   * Send OTP via email
   */
  async sendOTP(email, otp, userName) {
    const transporter = this.getTransporter();
    if (!transporter) {
      console.log(`Development OTP for ${email} (${userName}): ${otp}`);
      return { accepted: [email], development: true };
    }

    const mailOptions = {
      from: process.env.SMTP_FROM_EMAIL,
      to: email,
      subject: 'Your Voting Platform OTP',
      html: this.getOTPTemplate(otp, userName)
    };

    return transporter.sendMail(mailOptions);
  }

  /**
   * Send welcome email
   */
  async sendWelcomeEmail(email, userName) {
    const transporter = this.getTransporter();
    if (!transporter) {
      console.log(`Development welcome email skipped for ${email} (${userName})`);
      return { accepted: [email], development: true };
    }

    const mailOptions = {
      from: process.env.SMTP_FROM_EMAIL,
      to: email,
      subject: 'Welcome to Voting Platform',
      html: this.getWelcomeTemplate(userName)
    };

    return transporter.sendMail(mailOptions);
  }

  /**
   * Send password reset email
   */
  async sendPasswordResetEmail(email, resetToken, userName) {
    const transporter = this.getTransporter();
    if (!transporter) {
      console.log(`Development password reset for ${email} (${userName}): ${resetToken}`);
      return { accepted: [email], development: true };
    }

    const resetLink = `${process.env.FRONTEND_URL}/reset-password?token=${resetToken}`;
    const mailOptions = {
      from: process.env.SMTP_FROM_EMAIL,
      to: email,
      subject: 'Password Reset Request',
      html: this.getPasswordResetTemplate(resetLink, userName)
    };

    return transporter.sendMail(mailOptions);
  }

  /**
   * Send poll notification
   */
  async sendPollNotification(email, pollTitle, pollUrl, userName) {
    const transporter = this.getTransporter();
    if (!transporter) {
      console.log(`Development poll notification skipped for ${email} (${userName}): ${pollTitle} - ${pollUrl}`);
      return { accepted: [email], development: true };
    }

    const mailOptions = {
      from: process.env.SMTP_FROM_EMAIL,
      to: email,
      subject: `New Poll: ${pollTitle}`,
      html: this.getPollNotificationTemplate(pollTitle, pollUrl, userName)
    };

    return transporter.sendMail(mailOptions);
  }

  // Email templates
  getOTPTemplate(otp, userName) {
    return `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2>Verify Your Identity</h2>
        <p>Hello ${userName},</p>
        <p>Your One-Time Password (OTP) is:</p>
        <div style="background-color: #f0f0f0; padding: 20px; text-align: center; font-size: 24px; font-weight: bold; letter-spacing: 2px;">
          ${otp}
        </div>
        <p>This OTP will expire in ${process.env.OTP_EXPIRE_TIME} minutes.</p>
        <p>If you didn't request this OTP, please ignore this email.</p>
        <hr>
        <p style="color: #999; font-size: 12px;">Voting Platform - Secure & Transparent</p>
      </div>
    `;
  }

  getWelcomeTemplate(userName) {
    return `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2>Welcome to Voting Platform!</h2>
        <p>Hello ${userName},</p>
        <p>Your account has been successfully verified. You can now:</p>
        <ul>
          <li>Create voting polls</li>
          <li>Vote on existing polls</li>
          <li>View real-time results</li>
          <li>Participate in discussions</li>
        </ul>
        <p>Start voting and make your voice heard!</p>
        <p>
          <a href="${process.env.FRONTEND_URL}" style="background-color: #007bff; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px;">
            Go to Platform
          </a>
        </p>
        <hr>
        <p style="color: #999; font-size: 12px;">Voting Platform - Secure & Transparent</p>
      </div>
    `;
  }

  getPasswordResetTemplate(resetLink, userName) {
    return `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2>Password Reset Request</h2>
        <p>Hello ${userName},</p>
        <p>Click the link below to reset your password:</p>
        <p>
          <a href="${resetLink}" style="background-color: #007bff; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px;">
            Reset Password
          </a>
        </p>
        <p>This link will expire in 1 hour.</p>
        <p>If you didn't request a password reset, please ignore this email.</p>
        <hr>
        <p style="color: #999; font-size: 12px;">Voting Platform - Secure & Transparent</p>
      </div>
    `;
  }

  getPollNotificationTemplate(pollTitle, pollUrl, userName) {
    return `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2>New Poll Available</h2>
        <p>Hello ${userName},</p>
        <p>A new poll has been created:</p>
        <h3>${pollTitle}</h3>
        <p>
          <a href="${pollUrl}" style="background-color: #28a745; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px;">
            Vote Now
          </a>
        </p>
        <hr>
        <p style="color: #999; font-size: 12px;">Voting Platform - Secure & Transparent</p>
      </div>
    `;
  }
}

module.exports = new EmailService();
