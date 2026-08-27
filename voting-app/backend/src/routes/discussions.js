const express = require('express');
const DiscussionController = require('../controllers/discussionController');
const { verifyToken, verifyAadhar } = require('../middleware/auth');

const router = express.Router();

// Public routes
router.get('/', DiscussionController.getAllDiscussions);
router.get('/:id', DiscussionController.getDiscussion);

// Protected routes
router.post('/', verifyToken, verifyAadhar, DiscussionController.createDiscussion);
router.post('/:id/comments', verifyToken, verifyAadhar, DiscussionController.addComment);
router.post('/:id/comments/:commentId/replies', verifyToken, verifyAadhar, DiscussionController.addReply);
router.post('/:id/like', verifyToken, verifyAadhar, DiscussionController.likeDiscussion);
router.post('/:id/unlike', verifyToken, verifyAadhar, DiscussionController.unlikeDiscussion);
router.delete('/:id', verifyToken, verifyAadhar, DiscussionController.deleteDiscussion);

module.exports = router;
