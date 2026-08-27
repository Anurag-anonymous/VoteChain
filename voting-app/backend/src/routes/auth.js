const express = require('express');
const AuthController = require('../controllers/authController');
const { verifyToken } = require('../middleware/auth');

const router = express.Router();

// Public routes
router.post('/register', AuthController.register);
router.post('/verify-otp', AuthController.verifyOTP);
router.post('/resend-otp', AuthController.resendOTP);
router.post('/login', AuthController.login);
router.post('/reset-password-request', AuthController.resetPasswordRequest);
router.post('/reset-password', AuthController.resetPasswordWithOTP);

// Protected routes
router.post('/refresh-token', AuthController.refreshToken);
router.post('/logout', verifyToken, AuthController.logout);

module.exports = router;
