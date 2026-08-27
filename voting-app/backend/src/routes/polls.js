const express = require('express');
const PollController = require('../controllers/pollController');
const { verifyToken, verifyAadhar } = require('../middleware/auth');

const router = express.Router();

// Public routes
router.get('/', PollController.getAllPolls);
router.get('/:id', PollController.getPoll);
router.get('/:id/results', PollController.getPollResults);

// Protected routes (require authentication and Aadhar verification)
router.post('/', verifyToken, verifyAadhar, PollController.createPoll);
router.post('/:pollId/vote', verifyToken, verifyAadhar, PollController.vote);
router.put('/:id/close', verifyToken, verifyAadhar, PollController.closePoll);
router.delete('/:id', verifyToken, verifyAadhar, PollController.deletePoll);

module.exports = router;
