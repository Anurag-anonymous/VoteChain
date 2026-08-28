const axios = require('axios');

class SmsService {
  hasProviderConfig() {
    return !!(process.env.SMS_API_URL && process.env.SMS_API_KEY);
  }

  async sendOTP(phoneNumber, otp) {
    if (!this.hasProviderConfig()) {
      console.log(`Development phone OTP for ${phoneNumber}: ${otp}`);
      return { accepted: [phoneNumber], development: true };
    }

    await axios.post(
      process.env.SMS_API_URL,
      {
        to: phoneNumber,
        message: `Your VoteChain verification OTP is ${otp}`
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.SMS_API_KEY}`,
          'Content-Type': 'application/json'
        },
        timeout: 15000
      }
    );

    return { accepted: [phoneNumber] };
  }
}

module.exports = new SmsService();
