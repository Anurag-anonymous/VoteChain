const mongoose = require('mongoose');

const privateCredentialRecordSchema = new mongoose.Schema({
  electionId: {
    type: String,
    required: true
  },
  voterId: {
    type: String,
    required: true
  },
  credentialCommitment: {
    type: String,
    required: true
  },
  encryptedCredential: {
    type: String,
    required: true,
    select: false
  },
  issuedAt: {
    type: Date,
    required: true,
    default: Date.now
  }
}, { timestamps: true });

privateCredentialRecordSchema.index({ electionId: 1, voterId: 1 }, { unique: true });
privateCredentialRecordSchema.index({ electionId: 1, credentialCommitment: 1 });

module.exports = mongoose.model('PrivateCredentialRecord', privateCredentialRecordSchema);
