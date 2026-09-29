class PublicAuditor {
  constructor({ provider, deployments = {} } = {}) {
    this.provider = provider;
    this.deployments = deployments;
  }

  async getTransactionReceipt(transactionHash) {
    if (!this.provider) {
      throw new Error('A public RPC provider is required');
    }

    return this.provider.getTransactionReceipt(transactionHash);
  }

  verifyDeploymentRecord(record) {
    return !!record &&
      typeof record.address === 'string' &&
      Number.isInteger(record.chainId) &&
      typeof record.contractName === 'string';
  }

  summarizeReceipt(receipt) {
    if (!receipt) {
      return { found: false };
    }

    return {
      found: true,
      transactionHash: receipt.hash,
      from: receipt.from,
      to: receipt.to,
      blockNumber: receipt.blockNumber,
      status: receipt.status,
      logCount: receipt.logs ? receipt.logs.length : 0,
      gasUsed: receipt.gasUsed ? receipt.gasUsed.toString() : null
    };
  }
}

module.exports = {
  PublicAuditor
};
