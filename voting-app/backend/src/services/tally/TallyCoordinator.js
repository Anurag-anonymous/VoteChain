class TallyCoordinator {
  registerTrustee() {
    throw new Error('registerTrustee must be implemented by a tally coordinator');
  }

  submitShare() {
    throw new Error('submitShare must be implemented by a tally coordinator');
  }

  canFinalize() {
    throw new Error('canFinalize must be implemented by a tally coordinator');
  }

  finalizeTally() {
    throw new Error('finalizeTally must be implemented by a tally coordinator');
  }
}

module.exports = TallyCoordinator;
