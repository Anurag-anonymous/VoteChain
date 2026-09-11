const Web3 = require('web3');
const ethers = require('ethers');

const DEFAULT_RPC_URL = 'http://127.0.0.1:8545';
const DEFAULT_CHAIN_ID = 31337;

const getNetworkConfig = () => {
  const network = (process.env.BLOCKCHAIN_NETWORK || 'amoy').toLowerCase();

  if (network === 'anvil' || network === 'local') {
    return {
      rpcUrl: process.env.ANVIL_RPC_URL || DEFAULT_RPC_URL,
      chainId: parseInt(process.env.ANVIL_CHAIN_ID || String(DEFAULT_CHAIN_ID), 10),
      contractAddress: process.env.ANVIL_VOTING_CONTRACT_ADDRESS || process.env.VOTING_CONTRACT_ADDRESS,
      networkName: process.env.ANVIL_NETWORK_NAME || 'Anvil'
    };
  }

  return {
    rpcUrl: process.env.POLYGON_RPC_URL || DEFAULT_RPC_URL,
    chainId: parseInt(process.env.POLYGON_CHAIN_ID || '80002', 10),
    contractAddress: process.env.VOTING_CONTRACT_ADDRESS,
    networkName: process.env.POLYGON_NETWORK_NAME || 'Polygon Amoy'
  };
};

const networkConfig = getNetworkConfig();
const rpcUrl = networkConfig.rpcUrl;
const privateKey = process.env.POLYGON_WALLET_PRIVATE_KEY || process.env.PRIVATE_KEY;
const contractAddress = networkConfig.contractAddress;

// Initialize providers without requiring wallet credentials at app startup.
const web3 = new Web3(rpcUrl);
const provider = new ethers.JsonRpcProvider(rpcUrl);

const getSigner = () => {
  if (!privateKey) {
    throw new Error('Missing POLYGON_WALLET_PRIVATE_KEY or PRIVATE_KEY environment variable');
  }

  try {
    return new ethers.Wallet(privateKey, provider);
  } catch (error) {
    throw new Error(`Invalid wallet private key: ${error.message}`);
  }
};

const getContractAddress = () => {
  if (!contractAddress || !ethers.isAddress(contractAddress)) {
    throw new Error('Missing or invalid VOTING_CONTRACT_ADDRESS environment variable');
  }

  return contractAddress;
};

// Verify connection
const verifyBlockchainConnection = async () => {
  try {
    const blockNumber = await web3.eth.getBlockNumber();
    const networkId = await web3.eth.net.getId();
    console.log(`✓ Blockchain connected - Block: ${blockNumber}, Network ID: ${networkId}`);
    return true;
  } catch (error) {
    console.error('Blockchain connection error:', error);
    return false;
  }
};

module.exports = {
  web3,
  provider,
  getSigner,
  getContractAddress,
  verifyBlockchainConnection,
  chainId: networkConfig.chainId,
  rpcUrl,
  networkName: networkConfig.networkName,
  network: (process.env.BLOCKCHAIN_NETWORK || 'amoy').toLowerCase()
};
