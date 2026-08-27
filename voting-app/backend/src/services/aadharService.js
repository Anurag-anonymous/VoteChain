const axios = require('axios');

/**
 * Aadhar Verification Service
 * This service handles verification with third-party Aadhar API providers
 * 
 * Supported providers:
 * - Shunyam (Affordable)
 * - IDfy
 * - DigiLocker
 * - Signzy
 */

class AadharService {
  constructor() {
    this.apiKey = process.env.AADHAR_API_KEY;
    this.apiUrl = process.env.AADHAR_API_URL;
    this.timeout = 30000; // 30 seconds
  }

  hasProviderConfig() {
    return !!(this.apiKey && this.apiUrl);
  }

  /**
   * Verify Aadhar number and initiate OTP
   * @param {string} aadharNumber - 12 digit Aadhar number
   * @param {string} phoneNumber - Registered phone number
   * @returns {Promise<Object>} - Response with OTP request ID
   */
  async initiateAadharOTP(aadharNumber, phoneNumber) {
    try {
      // Validate Aadhar format
      if (!/^\d{12}$/.test(aadharNumber)) {
        throw new Error('Invalid Aadhar number format');
      }

      if (!this.hasProviderConfig()) {
        const otp = this.generateOTP();
        const requestId = `dev-${Date.now()}`;
        console.log(`Development Aadhaar OTP for ${aadharNumber} / ${phoneNumber}: ${otp}`);

        return {
          success: true,
          requestId,
          otp,
          development: true,
          message: 'Development Aadhaar OTP generated'
        };
      }

      const response = await axios.post(
        `${this.apiUrl}/v2/aadhaar/aadhaar-otp`,
        {
          aadhaar: aadharNumber,
          phone_number: phoneNumber,
          consent: 'Y'
        },
        {
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json'
          },
          timeout: this.timeout
        }
      );

      if (response.data.success) {
        return {
          success: true,
          requestId: response.data.request_id,
          message: 'OTP sent to registered phone'
        };
      } else {
        throw new Error(response.data.message || 'Aadhar verification failed');
      }
    } catch (error) {
      console.error('Aadhar OTP initiation error:', error.message);
      throw new Error(`Aadhar verification service error: ${error.message}`);
    }
  }

  /**
   * Verify OTP and get Aadhar details
   * @param {string} requestId - Request ID from OTP initiation
   * @param {string} otp - OTP entered by user
   * @param {string} aadharNumber - Aadhar number for verification
   * @returns {Promise<Object>} - Aadhar details if verification successful
   */
  async verifyAadharOTP(requestId, otp, aadharNumber) {
    try {
      if (!otp || otp.length !== 6) {
        throw new Error('Invalid OTP format');
      }

      if (!this.hasProviderConfig()) {
        return {
          success: true,
          aadharNumber,
          verified: true,
          development: true
        };
      }

      const response = await axios.post(
        `${this.apiUrl}/v2/aadhaar/aadhaar-otp/submit-otp`,
        {
          request_id: requestId,
          otp: otp,
          aadhaar: aadharNumber
        },
        {
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json'
          },
          timeout: this.timeout
        }
      );

      if (response.data.success) {
        return {
          success: true,
          aadharNumber: response.data.aadhaar_number,
          name: response.data.name,
          dateOfBirth: response.data.dob,
          gender: response.data.gender,
          address: response.data.address,
          photoBase64: response.data.photo
        };
      } else {
        throw new Error(response.data.message || 'OTP verification failed');
      }
    } catch (error) {
      console.error('Aadhar OTP verification error:', error.message);
      throw new Error(`OTP verification failed: ${error.message}`);
    }
  }

  /**
   * Mock verification for testing/development
   * @param {string} aadharNumber - Aadhar number
   * @returns {Promise<Object>} - Mock Aadhar details
   */
  async getMockAadharData(aadharNumber) {
    // Simulate API delay
    await new Promise(resolve => setTimeout(resolve, 500));

    // Generate mock data based on Aadhar last 4 digits
    const seed = parseInt(aadharNumber.slice(-4));
    const names = ['Rajesh Kumar', 'Priya Singh', 'Amit Patel', 'Deepa Sharma', 'Vikram Reddy'];
    const addresses = [
      '123 Main St, Delhi',
      '456 Park Rd, Mumbai',
      '789 City St, Bangalore',
      '321 Colony Rd, Hyderabad',
      '654 Street Rd, Chennai'
    ];

    return {
      success: true,
      aadharNumber: aadharNumber,
      name: names[seed % names.length],
      dateOfBirth: '1990-01-15',
      gender: seed % 2 === 0 ? 'M' : 'F',
      address: addresses[seed % addresses.length],
      verified: true
    };
  }

  /**
   * Check if Aadhar is already registered
   * @param {string} aadharNumber - Aadhar number to check
   * @returns {Promise<Boolean>}
   */
  async isAadharRegistered(aadharNumber) {
    const User = require('../models/User');
    const user = await User.findOne({ aadharNumber });
    return !!user;
  }

  /**
   * Generate and return OTP for development
   * @returns {string} - 6 digit OTP
   */
  generateOTP() {
    return Math.floor(100000 + Math.random() * 900000).toString();
  }

  /**
   * Validate Aadhar format
   * @param {string} aadharNumber - Aadhar number to validate
   * @returns {Boolean}
   */
  validateAadharFormat(aadharNumber) {
    return /^\d{12}$/.test(aadharNumber);
  }
}

module.exports = new AadharService();
