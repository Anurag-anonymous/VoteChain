const Web3 = require('web3');
const ethers = require('ethers');
const { getNetworkConfig: getRegisteredNetworkConfig } = require('./networks');

const networkConfig = getRegisteredNetworkConfig();
const rpcUrl = networkConfig.rpcUrl;
const network = networkConfig.key;
const privateKey = process.env.PRIVATE_KEY || process.env.ANVIL_PRIVATE_KEY;
const contractAddress = networkConfig.key === 'anvil'
  ? process.env.ANVIL_VOTING_CONTRACT_ADDRESS || process.env.VOTING_CONTRACT_ADDRESS
  : process.env.VOTING_CONTRACT_ADDRESS;

if (!rpcUrl) {
  throw new Error(`${networkConfig.rpcUrlEnv} must be configured for ${networkConfig.key}`);
}

// Initialize providers without requiring wallet credentials at app startup.
// Supplying the expected network prevents ethers from repeatedly probing an
// offline local RPC node just to discover the chain ID.
const web3 = new Web3(rpcUrl);
const provider = new ethers.JsonRpcProvider(
  rpcUrl,
  {
    chainId: networkConfig.chainId,
    name: networkConfig.name
  },
  {
    staticNetwork: true
  }
);

const getSigner = () => {
  if (!networkConfig.allowLocalPrivateKeySigning) {
    throw new Error(`Backend private-key signing is disabled for ${networkConfig.name}; use an external wallet or relayer`);
  }
  if (!privateKey) {
    throw new Error('Missing PRIVATE_KEY or ANVIL_PRIVATE_KEY environment variable');
  }

  try {
    return new ethers.Wallet(privateKey, provider);
  } catch (error) {
    throw new Error(`Invalid wallet private key: ${error.message}`);
  }
};

const getSignerFromPrivateKey = (walletPrivateKey) => {
  if (!networkConfig.allowLocalPrivateKeySigning) {
    throw new Error(`User private-key signing is disabled for ${networkConfig.name}; use an external wallet or relayer`);
  }
  if (!walletPrivateKey) {
    throw new Error('User wallet private key is not available for signing');
  }

  try {
    return new ethers.Wallet(walletPrivateKey, provider);
  } catch (error) {
    throw new Error(`Invalid user wallet private key: ${error.message}`);
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
  getSignerFromPrivateKey,
  getContractAddress,
  verifyBlockchainConnection,
  chainId: networkConfig.chainId,
  rpcUrl,
  networkName: networkConfig.name,
  network
};
