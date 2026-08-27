/**
 * Email validation
 */
const validateEmail = (email) => {
  const regex = /^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/;
  return regex.test(email);
};

/**
 * Phone number validation (India)
 */
const validatePhoneNumber = (phone) => {
  const regex = /^[6-9]\d{9}$/;
  return regex.test(phone);
};

/**
 * Aadhar number validation
 */
const validateAadhar = (aadhar) => {
  const regex = /^\d{12}$/;
  return regex.test(aadhar);
};

/**
 * Password strength validation
 */
const validatePassword = (password) => {
  // Minimum 8 characters, at least one uppercase, one lowercase, one number, one special char
  const regex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/;
  return regex.test(password);
};

/**
 * Wallet address validation
 */
const validateWalletAddress = (address) => {
  const regex = /^0x[a-fA-F0-9]{40}$/;
  return regex.test(address);
};

module.exports = {
  validateEmail,
  validatePhoneNumber,
  validateAadhar,
  validatePassword,
  validateWalletAddress
};
