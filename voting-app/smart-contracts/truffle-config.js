require('dotenv').config();
const HDWalletProvider = require('@truffle/hdwallet-provider');

const getDeployerKey = () => {
  const key = process.env.DEPLOYER_PRIVATE_KEY || process.env.POLYGON_DEPLOYER_PRIVATE_KEY;
  if (!key) {
    throw new Error('DEPLOYER_PRIVATE_KEY must be configured for Polygon Amoy deployment');
  }
  return key;
};

const anvilHost = process.env.ANVIL_HOST || '127.0.0.1';
const anvilPort = Number(process.env.ANVIL_PORT || 8545);

module.exports = {
  networks: {
    'polygon-amoy': {
      provider: () => {
        if (!process.env.POLYGON_RPC_URL) {
          throw new Error('POLYGON_RPC_URL must be configured for Polygon Amoy deployment');
        }
        return new HDWalletProvider(getDeployerKey(), process.env.POLYGON_RPC_URL);
      },
      network_id: 80002,
      confirmations: Number(process.env.POLYGON_CONFIRMATIONS || 2),
      timeoutBlocks: 200,
      skipDryRun: true,
      chainId: 80002,
      gasPrice: process.env.POLYGON_GAS_PRICE
        ? Number(process.env.POLYGON_GAS_PRICE)
        : undefined,
      networkCheckTimeout: 600000
    },
    anvil: {
      host: anvilHost,
      port: anvilPort,
      network_id: 31337,
      chainId: 31337,
      skipDryRun: true
    },
    development: {
      host: anvilHost,
      port: anvilPort,
      network_id: 31337,
      chainId: 31337,
      skipDryRun: true
    },
    test: {
      host: anvilHost,
      port: anvilPort,
      network_id: 31337,
      chainId: 31337,
      skipDryRun: true
    }
  },
  db: {
    enabled: false
  },
  compilers: {
    solc: {
      version: '0.8.20',
      settings: {
        optimizer: {
          enabled: true,
          runs: 200
        }
      }
    }
  }
};
