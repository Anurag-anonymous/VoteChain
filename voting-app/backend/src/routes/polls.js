const express = require('express');
const PollController = require('../controllers/pollController');
const ResearchProtocolController = require('../controllers/researchProtocolController');
const { verifyToken, verifyAadhar } = require('../middleware/auth');

const router = express.Router();

// Public routes
router.get('/', PollController.getAllPolls);
router.get('/mine', verifyToken, PollController.getMyPolls);
router.get('/:id', PollController.getPoll);
router.get('/:id/results', PollController.getPollResults);
router.get('/:id/observer-dataset', verifyToken, PollController.getObserverDataset);

// Protected routes (require authentication and Aadhar verification)
router.post('/', verifyToken, verifyAadhar, PollController.createPoll);
router.post('/:pollId/vote', verifyToken, verifyAadhar, PollController.vote);
router.post('/:pollId/ballot', verifyToken, verifyAadhar, ResearchProtocolController.castEncryptedBallot);
router.post('/:id/finalize', verifyToken, verifyAadhar, ResearchProtocolController.finalizeTally);
router.put('/:id/close', verifyToken, verifyAadhar, PollController.closePoll);
router.delete('/:id', verifyToken, verifyAadhar, PollController.deletePoll);

module.exports = router;
