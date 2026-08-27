import Web3 from 'web3';

// Initialize Web3
const RPC_URL = process.env.REACT_APP_POLYGON_RPC;
const web3 = new Web3(RPC_URL);

// Connect wallet
export const connectWallet = async () => {
  try {
    if (!window.ethereum) {
      throw new Error('MetaMask is not installed');
    }

    const accounts = await window.ethereum.request({
      method: 'eth_requestAccounts'
    });

    const chainId = await window.ethereum.request({
      method: 'eth_chainId'
    });

    // Check if connected to Polygon Mumbai testnet (chain ID: 80001)
    const expectedChainId = parseInt(process.env.REACT_APP_CHAIN_ID);
    if (parseInt(chainId) !== expectedChainId) {
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
    await window.ethereum.request({
      method: 'wallet_addEthereumChain',
      params: [{
        chainId: '0x13881',
        chainName: 'Polygon Mumbai Testnet',
        rpcUrls: ['https://rpc-mumbai.maticvigil.com/'],
        nativeCurrency: {
          name: 'MATIC',
          symbol: 'MATIC',
          decimals: 18
        },
        blockExplorerUrls: ['https://mumbai.polygonscan.com/']
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
