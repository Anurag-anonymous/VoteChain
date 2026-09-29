const { provider, getSigner, getSignerFromPrivateKey, getContractAddress, network, rpcUrl } = require('../config/blockchain');
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

const ENCRYPTED_BALLOT_REGISTRY_ABI = [
  'function submitEncryptedBallotReceipt(bytes32 pollId, bytes32 ballotId, bytes32 nullifierHash, bytes32 ballotCiphertextHash) external',
  'function usedNullifiers(bytes32 pollId, bytes32 nullifierHash) public view returns (bool)',
  'function getReceiptCount(bytes32 pollId) external view returns (uint256)',
  'event EncryptedBallotSubmitted(bytes32 indexed pollId, bytes32 indexed nullifierHash, bytes32 indexed ballotId, bytes32 ballotCiphertextHash, address submitter, uint256 timestamp)'
];

const toBytes32Hash = (value) => ethers.sha256(ethers.toUtf8Bytes(String(value)));

class BlockchainService {
  constructor() {
    this.localReceiptNullifiers = new Set();
  }

  isBlockchainEnabled() {
    return process.env.BLOCKCHAIN_ENABLED !== 'false';
  }

  isC1ReceiptAnchoringEnabled() {
    return process.env.C1_CHAIN_RECEIPTS_ENABLED === 'true';
  }

  async assertRpcAvailable() {
    try {
      await provider.getBlockNumber();
    } catch (error) {
      if (error.code === 'ECONNREFUSED' || error.message.includes('ECONNREFUSED')) {
        throw new Error(
          `Blockchain RPC is not running at ${rpcUrl}. ` +
          'Start Anvil with "anvil --host 127.0.0.1 --port 8545 --chain-id 31337" ' +
          'or run "npm run setup:local" from the project root.'
        );
      }

      throw error;
    }
  }

  async assertContractDeployed() {
    await this.assertRpcAvailable();
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

  getEncryptedBallotRegistryAddress() {
    return process.env.C1_ENCRYPTED_BALLOT_REGISTRY_ADDRESS || '';
  }

  getEncryptedBallotRegistry(walletPrivateKey) {
    return new ethers.Contract(
      this.getEncryptedBallotRegistryAddress(),
      ENCRYPTED_BALLOT_REGISTRY_ABI,
      this.getSigner(walletPrivateKey)
    );
  }

  async assertEncryptedBallotRegistryDeployed() {
    await this.assertRpcAvailable();
    const contractAddress = this.getEncryptedBallotRegistryAddress();

    if (!ethers.isAddress(contractAddress)) {
      throw new Error('C1_ENCRYPTED_BALLOT_REGISTRY_ADDRESS must be a deployed contract address');
    }

    const code = await provider.getCode(contractAddress);

    if (!code || code === '0x') {
      throw new Error(`No EncryptedBallotRegistry contract is deployed at ${contractAddress} on ${network}`);
    }

    return contractAddress;
  }

  buildEncryptedBallotReceipt({ pollId, ballot }) {
    if (!pollId || !ballot || !ballot.ballotId || !ballot.eligibilityProof?.nullifier) {
      throw new Error('pollId and a complete encrypted ballot are required for C1 receipt anchoring');
    }

    const ciphertextMaterial = [
      ballot.encryptedCandidate,
      typeof ballot.proof === 'string' ? ballot.proof : JSON.stringify(ballot.proof || {}),
      ballot.randomnessCommitment
    ].join(':');

    return {
      pollIdHash: toBytes32Hash(pollId),
      ballotIdHash: toBytes32Hash(ballot.ballotId),
      nullifierHash: toBytes32Hash(`${ballot.eligibilityProof.nullifier}:${ballot.ballotId}`),
      ballotCiphertextHash: toBytes32Hash(ciphertextMaterial)
    };
  }

  rememberEncryptedBallotReceipt({ pollId, nullifierHash }) {
    const key = `${pollId}:${nullifierHash}`;

    if (this.localReceiptNullifiers.has(key)) {
      throw new Error('C1 receipt nullifier already anchored for this poll');
    }

    this.localReceiptNullifiers.add(key);
    return true;
  }

  resetLocalReceiptCache() {
    this.localReceiptNullifiers.clear();
  }

  async fundWalletIfNeeded(walletAddress) {
    if (!this.isBlockchainEnabled() || !['anvil', 'local'].includes(network) || !walletAddress) {
      return;
    }

    const balance = await provider.getBalance(walletAddress);
    const minimumBalance = ethers.parseEther(process.env.LOCAL_WALLET_MIN_BALANCE || '0.1');

    if (balance >= minimumBalance) {
      return;
    }

    const amount = ethers.parseEther(process.env.LOCAL_WALLET_FUND_AMOUNT || '1');
    const configuredFunder = getSigner();
    const configuredFunderAddress = await configuredFunder.getAddress();
    const feeData = await provider.getFeeData();
    const gasPrice = feeData.maxFeePerGas ?? feeData.gasPrice ?? 0n;
    const requiredFunderBalance = amount + gasPrice * 21_000n;
    let funder = configuredFunder;

    if ((await provider.getBalance(configuredFunderAddress)) < requiredFunderBalance) {
      let rpcFunderAddress;
      for (const rpcFunder of await provider.listAccounts()) {
        const address = await rpcFunder.getAddress();
        if (address.toLowerCase() === walletAddress.toLowerCase()) continue;
        if ((await provider.getBalance(address)) >= requiredFunderBalance) {
          funder = rpcFunder;
          rpcFunderAddress = address;
          break;
        }
      }

      if (!rpcFunderAddress) {
        throw new Error(
          `Configured local funding account ${configuredFunderAddress} and unlocked RPC accounts ` +
          `do not have enough funds to send ${ethers.formatEther(amount)} ETH. ` +
          'Start a funded local Anvil or Ganache node, then retry.'
        );
      }

      console.info(`Using funded local RPC account ${rpcFunderAddress} for wallet funding`);
    }

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
      await this.assertRpcAvailable();
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
      await this.assertRpcAvailable();
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

  async anchorEncryptedBallotReceipt({ pollId, ballot, walletPrivateKey }) {
    if (!this.isC1ReceiptAnchoringEnabled()) {
      return {
        enabled: false,
        transactionHash: null,
        blockNumber: null,
        from: null,
        to: null,
        hashes: null
      };
    }

    try {
      const hashes = this.buildEncryptedBallotReceipt({ pollId, ballot });

      const signer = this.getSigner(walletPrivateKey);
      await this.assertEncryptedBallotRegistryDeployed();
      await this.fundWalletIfNeeded(await signer.getAddress());

      const registry = this.getEncryptedBallotRegistry(walletPrivateKey);
      const alreadyUsed = await registry.usedNullifiers(hashes.pollIdHash, hashes.nullifierHash);

      if (alreadyUsed) {
        throw new Error('C1 receipt nullifier already anchored for this poll');
      }

      const tx = await registry.submitEncryptedBallotReceipt(
        hashes.pollIdHash,
        hashes.ballotIdHash,
        hashes.nullifierHash,
        hashes.ballotCiphertextHash
      );
      const receipt = await tx.wait();
      const block = await provider.getBlock(receipt.blockNumber);
      this.rememberEncryptedBallotReceipt({ pollId, nullifierHash: hashes.nullifierHash });

      return {
        enabled: true,
        transactionHash: receipt.hash,
        blockNumber: receipt.blockNumber,
        timestamp: block ? new Date(Number(block.timestamp) * 1000).toISOString() : new Date().toISOString(),
        calldataBytes: (tx.data.length - 2) / 2,
        from: await signer.getAddress(),
        to: this.getEncryptedBallotRegistryAddress(),
        gasUsed: receipt.gasUsed.toString(),
        hashes
      };
    } catch (error) {
      console.error('Error anchoring encrypted ballot receipt:', error);
      throw new Error(`Failed to anchor encrypted ballot receipt: ${error.message}`);
    }
  }

  async anchorDummyEncryptedBallotReceipt({ pollId, walletPrivateKey }) {
    if (!this.isC1ReceiptAnchoringEnabled()) {
      throw new Error('Padded protocols require C1_CHAIN_RECEIPTS_ENABLED=true');
    }

    try {
      const signer = this.getSigner(walletPrivateKey);
      await this.assertEncryptedBallotRegistryDeployed();
      await this.fundWalletIfNeeded(await signer.getAddress());
      const registry = this.getEncryptedBallotRegistry(walletPrivateKey);
      const pollIdHash = toBytes32Hash(pollId);
      const ballotIdHash = ethers.hexlify(ethers.randomBytes(32));
      const nullifierHash = ethers.hexlify(ethers.randomBytes(32));
      const ballotCiphertextHash = ethers.hexlify(ethers.randomBytes(32));
      const tx = await registry.submitEncryptedBallotReceipt(
        pollIdHash,
        ballotIdHash,
        nullifierHash,
        ballotCiphertextHash
      );
      const receipt = await tx.wait();
      const block = await provider.getBlock(receipt.blockNumber);

      return {
        transactionHash: receipt.hash,
        blockNumber: receipt.blockNumber,
        timestamp: block ? new Date(Number(block.timestamp) * 1000).toISOString() : new Date().toISOString(),
        gasUsed: receipt.gasUsed.toString(),
        calldataBytes: (tx.data.length - 2) / 2,
        from: await signer.getAddress()
      };
    } catch (error) {
      console.error('Error anchoring padding receipt:', error);
      throw new Error(`Failed to anchor padding receipt: ${error.message}`);
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
