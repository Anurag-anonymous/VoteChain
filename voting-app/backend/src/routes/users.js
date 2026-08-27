const express = require('express');
const UserController = require('../controllers/userController');
const { verifyToken, verifyAadhar } = require('../middleware/auth');

const router = express.Router();

// Protected routes
router.get('/profile', verifyToken, UserController.getProfile);
router.put('/profile', verifyToken, UserController.updateProfile);
router.post('/change-password', verifyToken, UserController.changePassword);
router.get('/stats', verifyToken, UserController.getUserStats);
router.post('/link-wallet', verifyToken, verifyAadhar, UserController.linkWallet);

// Public routes
router.get('/:userId/public', UserController.getPublicProfile);

module.exports = router;
