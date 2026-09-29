const express = require('express');
const EligibilityAuthorityController = require('../controllers/eligibilityAuthorityController');
const { verifyToken } = require('../middleware/auth');

const router = express.Router();

router.post('/decision', EligibilityAuthorityController.receiveDecision);
router.post('/submit', verifyToken, EligibilityAuthorityController.submitApplicant);
router.get('/credential', verifyToken, EligibilityAuthorityController.getCredential);

module.exports = router;
