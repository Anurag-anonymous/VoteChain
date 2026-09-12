const { provider, getSigner, getSignerFromPrivateKey, getContractAddress, network } = require('../config/blockchain');
const ethers = require('ethers');

// ABI for the Voting contract (simplified)
const VOTING_CONTRACT_ABI = [
  'function createPoll(string memory title, string[] memory options, uint256 endTime) public returns (uint256)',
  'function vote(uint256 pollId, uint256 optionIndex) public',
  'function pollCount() public view returns (uint256)',
  'function getPoll(uint256 pollId) public view returns (tuple(uint256 id, address creator, string title, string[] options, uint256[] votes, uint256 endTime, bool active))',
  'function getPollResults(uint256 pollId) public view returns (uint256[])',
  'function hasVoted(uint256 pollId, address voter) public view returns (bool)',
  'event PollCreated(uint256 indexed pollId, address indexed creator, string title)',
  'event VoteCasted(uint256 indexed pollId, address indexed voter, uint256 indexed optionIndex)'
];

class BlockchainService {
  isBlockchainEnabled() {
    return process.env.BLOCKCHAIN_ENABLED !== 'false';
  }

  async assertContractDeployed() {
    const contractAddress = getContractAddress();
    const code = await provider.getCode(contractAddress);

    if (!code || code === '0x') {
      throw new Error(
        `No VotingPoll contract is deployed at ${contractAddress} on the configured ${network} chain. ` +
        'Run "npm run setup:local" from the project root, or redeploy with ' +
        '"cd smart-contracts && npx truffle migrate --network anvil --reset", then restart the backend.'
      );
    }

    return contractAddress;
  }

  getSigner(walletPrivateKey) {
    return walletPrivateKey ? getSignerFromPrivateKey(walletPrivateKey) : getSigner();
  }

  getContract(walletPrivateKey) {
    return new ethers.Contract(getContractAddress(), VOTING_CONTRACT_ABI, this.getSigner(walletPrivateKey));
  }

  async fundWalletIfNeeded(walletAddress) {
    if (!['anvil', 'local'].includes(network) || !walletAddress) {
      return;
    }

    const balance = await provider.getBalance(walletAddress);
    const minimumBalance = ethers.parseEther(process.env.LOCAL_WALLET_MIN_BALANCE || '0.1');

    if (balance >= minimumBalance) {
      return;
    }

    const amount = ethers.parseEther(process.env.LOCAL_WALLET_FUND_AMOUNT || '1');
    const funder = getSigner();
    const tx = await funder.sendTransaction({ to: walletAddress, value: amount });
    await tx.wait();
  }

  /**
   * Create a new poll on blockchain
   */
  async createPoll(title, options, endTime, walletPrivateKey) {
    try {
      if (!this.isBlockchainEnabled()) {
        return {
          success: true,
          pollId: 0,
          transactionHash: 'BLOCKCHAIN_DISABLED',
          blockNumber: null,
          blockTimestamp: new Date(),
          gasUsed: '0'
        };
      }

      const signer = this.getSigner(walletPrivateKey);
      await this.fundWalletIfNeeded(await signer.getAddress());
      await this.assertContractDeployed();

      const contract = this.getContract(walletPrivateKey);
      const pollCountBefore = Number(await contract.pollCount());

      const tx = await contract.createPoll(
        title,
        options,
        Math.floor(endTime.getTime() / 1000)
      );

      const receipt = await tx.wait();

      return {
        success: true,
        pollId: pollCountBefore,
        transactionHash: receipt.hash,
        from: await signer.getAddress(),
        blockNumber: receipt.blockNumber,
        blockTimestamp: new Date(),
        gasUsed: receipt.gasUsed.toString()
      };
    } catch (error) {
      console.error('Error creating poll on blockchain:', error);
      throw new Error(`Failed to create poll on blockchain: ${error.message}`);
    }
  }

  /**
   * Cast vote on blockchain
   */
  async castVote(pollId, optionIndex, walletPrivateKey) {
    try {
      if (!this.isBlockchainEnabled()) {
        return {
          success: true,
          transactionHash: 'BLOCKCHAIN_DISABLED',
          blockNumber: null,
          gasUsed: '0'
        };
      }

      const numericPollId = Number(pollId);
      const numericOptionIndex = Number(optionIndex);

      if (!Number.isInteger(numericPollId) || numericPollId < 0) {
        throw new Error(`Invalid poll ID for blockchain vote: ${pollId}`);
      }

      if (!Number.isInteger(numericOptionIndex) || numericOptionIndex < 0) {
        throw new Error(`Invalid option index for blockchain vote: ${optionIndex}`);
      }

      const signer = this.getSigner(walletPrivateKey);
      await this.fundWalletIfNeeded(await signer.getAddress());
      await this.assertContractDeployed();

      const tx = await this.getContract(walletPrivateKey).vote(numericPollId, numericOptionIndex);
      const receipt = await tx.wait();

      return {
        success: true,
        transactionHash: receipt.hash,
        from: await signer.getAddress(),
        blockNumber: receipt.blockNumber,
        gasUsed: receipt.gasUsed.toString()
      };
    } catch (error) {
      console.error('Error casting vote on blockchain:', error);
      throw new Error(`Failed to cast vote: ${error.message}`);
    }
  }

  /**
   * Get poll details from blockchain
   */
  async getPoll(pollId) {
    try {
      await this.assertContractDeployed();
      const poll = await this.getContract().getPoll(pollId);
      return {
        success: true,
        id: poll.id.toString(),
        creator: poll.creator,
        title: poll.title,
        options: poll.options,
        votes: poll.votes.map(v => v.toString()),
        endTime: new Date(Number(poll.endTime) * 1000),
        active: poll.active
      };
    } catch (error) {
      console.error('Error getting poll from blockchain:', error);
      throw new Error(`Failed to get poll: ${error.message}`);
    }
  }

  /**
   * Get poll results from blockchain
   */
  async getPollResults(pollId) {
    try {
      await this.assertContractDeployed();
      const results = await this.getContract().getPollResults(pollId);
      return {
        success: true,
        votes: results.map(v => v.toString())
      };
    } catch (error) {
      console.error('Error getting poll results:', error);
      throw new Error(`Failed to get poll results: ${error.message}`);
    }
  }

  /**
   * Check if user has voted
   */
  async hasVoted(pollId, walletAddress) {
    try {
      await this.assertContractDeployed();
      const voted = await this.getContract().hasVoted(pollId, walletAddress);
      return voted;
    } catch (error) {
      console.error('Error checking vote status:', error);
      return false;
    }
  }

  /**
   * Get wallet balance
   */
  async getWalletBalance(walletAddress) {
    try {
      const balance = await provider.getBalance(walletAddress);
      return ethers.formatEther(balance);
    } catch (error) {
      console.error('Error getting wallet balance:', error);
      throw new Error(`Failed to get wallet balance: ${error.message}`);
    }
  }

  /**
   * Verify transaction
   */
  async verifyTransaction(transactionHash) {
    try {
      const receipt = await provider.getTransactionReceipt(transactionHash);
      
      if (!receipt) {
        return {
          success: false,
          message: 'Transaction not found'
        };
      }

      return {
        success: receipt.status === 1,
        transactionHash: receipt.hash,
        blockNumber: receipt.blockNumber,
        gasUsed: receipt.gasUsed.toString(),
        status: receipt.status === 1 ? 'success' : 'failed'
      };
    } catch (error) {
      console.error('Error verifying transaction:', error);
      throw new Error(`Failed to verify transaction: ${error.message}`);
    }
  }

  /**
   * Get transaction details
   */
  async getTransactionDetails(transactionHash) {
    try {
      const tx = await provider.getTransaction(transactionHash);
      const receipt = await provider.getTransactionReceipt(transactionHash);

      return {
        success: true,
        hash: tx.hash,
        from: tx.from,
        to: tx.to,
        value: ethers.formatEther(tx.value),
        gasPrice: ethers.formatUnits(tx.gasPrice, 'gwei'),
        gasLimit: tx.gasLimit.toString(),
        nonce: tx.nonce,
        blockNumber: receipt.blockNumber,
        status: receipt.status === 1 ? 'success' : 'failed',
        confirmations: receipt.confirmations
      };
    } catch (error) {
      console.error('Error getting transaction details:', error);
      throw new Error(`Failed to get transaction details: ${error.message}`);
    }
  }

  /**
   * Get network info
   */
  async getNetworkInfo() {
    try {
      const network = await provider.getNetwork();
      const blockNumber = await provider.getBlockNumber();
      const feeData = await provider.getFeeData();

      return {
        success: true,
        chainId: network.chainId,
        name: network.name,
        blockNumber,
        gasPrice: ethers.formatUnits(feeData.gasPrice || 0n, 'gwei')
      };
    } catch (error) {
      console.error('Error getting network info:', error);
      throw new Error(`Failed to get network info: ${error.message}`);
    }
  }
}

module.exports = new BlockchainService();
