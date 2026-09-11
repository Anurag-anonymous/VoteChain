import Web3 from 'web3';

const DEFAULT_CHAIN_ID = 31337;

const getExpectedChainId = () => {
  const configuredChainId = Number.parseInt(process.env.REACT_APP_CHAIN_ID || '', 10);
  return Number.isInteger(configuredChainId) && configuredChainId > 0
    ? configuredChainId
    : DEFAULT_CHAIN_ID;
};

const getNetworkConfig = () => {
  const chainId = getExpectedChainId();

  if (chainId === 31337 || (process.env.REACT_APP_BLOCKCHAIN_NETWORK || '').toLowerCase() === 'anvil') {
    return {
      rpcUrl: process.env.REACT_APP_POLYGON_RPC || 'http://127.0.0.1:8545',
      chainName: process.env.REACT_APP_NETWORK_NAME || 'Anvil',
      nativeCurrency: {
        name: process.env.REACT_APP_NATIVE_CURRENCY_NAME || 'ETH',
        symbol: process.env.REACT_APP_NATIVE_CURRENCY_SYMBOL || 'ETH',
        decimals: 18
      },
      blockExplorerUrls: process.env.REACT_APP_BLOCK_EXPLORER_URLS
        ? process.env.REACT_APP_BLOCK_EXPLORER_URLS.split(',')
        : []
    };
  }

  return {
    rpcUrl: process.env.REACT_APP_POLYGON_RPC || 'https://polygon-amoy.g.alchemy.com/v2/YOUR_ALCHEMY_KEY',
    chainName: process.env.REACT_APP_NETWORK_NAME || 'Polygon Amoy',
    nativeCurrency: {
      name: process.env.REACT_APP_NATIVE_CURRENCY_NAME || 'MATIC',
      symbol: process.env.REACT_APP_NATIVE_CURRENCY_SYMBOL || 'MATIC',
      decimals: 18
    },
    blockExplorerUrls: process.env.REACT_APP_BLOCK_EXPLORER_URLS
      ? process.env.REACT_APP_BLOCK_EXPLORER_URLS.split(',')
      : ['https://amoy.polygonscan.com/']
  };
};

// Initialize Web3
const RPC_URL = getNetworkConfig().rpcUrl;
const web3 = new Web3(RPC_URL);

// Check wallet availability
export const isMetaMaskAvailable = () => {
  return typeof window !== 'undefined' && !!window.ethereum;
};

// Connect wallet
export const connectWallet = async () => {
  try {
    if (!isMetaMaskAvailable()) {
      throw new Error('MetaMask is not installed. You can still paste a wallet address manually.');
    }

    const accounts = await window.ethereum.request({
      method: 'eth_requestAccounts'
    });

    const chainId = await window.ethereum.request({
      method: 'eth_chainId'
    });

    const expectedChainId = getExpectedChainId();
    const connectedChainId = Number.parseInt(chainId, 16);

    if (!Number.isInteger(connectedChainId) || connectedChainId !== expectedChainId) {
      await switchNetwork(expectedChainId);
    }

    return accounts[0];
  } catch (error) {
    console.error('Wallet connection error:', error);
    throw error;
  }
};

// Switch network
export const switchNetwork = async (chainId) => {
  try {
    await window.ethereum.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: '0x' + chainId.toString(16) }]
    });
  } catch (error) {
    if (error.code === 4902) {
      // Network not added, try adding it
      await addNetwork();
    } else {
      throw error;
    }
  }
};

// Add Polygon Mumbai testnet to wallet
export const addNetwork = async () => {
  try {
    const networkConfig = getNetworkConfig();

    await window.ethereum.request({
      method: 'wallet_addEthereumChain',
      params: [{
        chainId: '0x' + getExpectedChainId().toString(16),
        chainName: networkConfig.chainName,
        rpcUrls: [networkConfig.rpcUrl],
        nativeCurrency: networkConfig.nativeCurrency,
        blockExplorerUrls: networkConfig.blockExplorerUrls
      }]
    });
  } catch (error) {
    console.error('Error adding network:', error);
    throw error;
  }
};

// Get wallet balance
export const getWalletBalance = async (address) => {
  try {
    const balance = await web3.eth.getBalance(address);
    return web3.utils.fromWei(balance, 'ether');
  } catch (error) {
    console.error('Error getting wallet balance:', error);
    return '0';
  }
};

// Get wallet info
export const getWalletInfo = async (address) => {
  try {
    const balance = await getWalletBalance(address);
    const code = await web3.eth.getCode(address);
    
    return {
      address,
      balance,
      isContract: code !== '0x'
    };
  } catch (error) {
    console.error('Error getting wallet info:', error);
    throw error;
  }
};

// Listen for account changes
export const onAccountChanged = (callback) => {
  if (window.ethereum) {
    window.ethereum.on('accountsChanged', callback);
  }
};

// Listen for chain changes
export const onChainChanged = (callback) => {
  if (window.ethereum) {
    window.ethereum.on('chainChanged', callback);
  }
};

// Remove listeners
export const removeAccountChangeListener = (callback) => {
  if (window.ethereum) {
    window.ethereum.removeListener('accountsChanged', callback);
  }
};

export const removeChainChangeListener = (callback) => {
  if (window.ethereum) {
    window.ethereum.removeListener('chainChanged', callback);
  }
};

export { web3 };
