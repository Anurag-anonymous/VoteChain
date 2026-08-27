const { provider, getSigner, getContractAddress } = require('../config/blockchain');
const ethers = require('ethers');

// ABI for the Voting contract (simplified)
const VOTING_CONTRACT_ABI = [
  'function createPoll(string memory title, string[] memory options, uint256 endTime) public returns (uint256)',
  'function vote(uint256 pollId, uint256 optionIndex) public',
  'function getPoll(uint256 pollId) public view returns (tuple(uint256 id, address creator, string title, string[] options, uint256[] votes, uint256 endTime, bool active))',
  'function getPollResults(uint256 pollId) public view returns (uint256[])',
  'function hasVoted(uint256 pollId, address voter) public view returns (bool)',
  'event PollCreated(uint256 indexed pollId, address indexed creator, string title)',
  'event VoteCasted(uint256 indexed pollId, address indexed voter, uint256 indexed optionIndex)'
];

class BlockchainService {
  getContract() {
    return new ethers.Contract(getContractAddress(), VOTING_CONTRACT_ABI, getSigner());
  }

  /**
   * Create a new poll on blockchain
   */
  async createPoll(pollId, title, options, endTime) {
    try {
      const tx = await this.getContract().createPoll(
        title,
        options,
        Math.floor(endTime.getTime() / 1000)
      );

      const receipt = await tx.wait();

      return {
        success: true,
        transactionHash: receipt.hash,
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
  async castVote(pollId, optionIndex) {
    try {
      const tx = await this.getContract().vote(pollId, optionIndex);
      const receipt = await tx.wait();

      return {
        success: true,
        transactionHash: receipt.hash,
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
      const poll = await this.getContract().getPoll(pollId);
      return {
        success: true,
        id: poll.id.toString(),
        creator: poll.creator,
        title: poll.title,
        options: poll.options,
        votes: poll.votes.map(v => v.toString()),
        endTime: new Date(poll.endTime.toNumber() * 1000),
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
      const gasPrice = await provider.getGasPrice();

      return {
        success: true,
        chainId: network.chainId,
        name: network.name,
        blockNumber,
        gasPrice: ethers.formatUnits(gasPrice, 'gwei')
      };
    } catch (error) {
      console.error('Error getting network info:', error);
      throw new Error(`Failed to get network info: ${error.message}`);
    }
  }
}

module.exports = new BlockchainService();
