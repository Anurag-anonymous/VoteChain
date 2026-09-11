require('dotenv').config();
const HDWalletProvider = require('@truffle/hdwallet-provider');

module.exports = {
  networks: {



    // Amoy Polygon Testnet for current test from my wallet 
    amoy: {
  provider: () =>
    new HDWalletProvider(
      process.env.PRIVATE_KEY,
      process.env.POLYGON_RPC_URL
    ),
  network_id: 80002,
  confirmations: 2,
  timeoutBlocks: 200,
  skipDryRun: true,
  chainId: 80002,
  gasPrice: 25000000000,
  networkCheckTimeout: 600000,
},


    // Polygon Mumbai Testnet
    mumbai: {
      provider: () =>
        new HDWalletProvider(
          process.env.PRIVATE_KEY,
          process.env.POLYGON_RPC_URL
        ),
      network_id: 80001,
      confirmations: 2,
      timeoutBlocks: 200,
      skipDryRun: true,
      chainId: 80001,
    },

    // Local development network (Anvil / Ganache)
    anvil: {
      host: "127.0.0.1",
      port: 8545,
      network_id: "*",
      skipDryRun: true
    },

    development: {
      host: "127.0.0.1",
      port: 7545,
      network_id: "*",
      skipDryRun: true
    },

    // Polygon Mainnet (for production)
    polygon: {
      provider: () =>
        new HDWalletProvider(
          process.env.PRIVATE_KEY,
          process.env.POLYGON_RPC_URL
        ),
      network_id: 137,
      confirmations: 2,
      timeoutBlocks: 200,
      skipDryRun: true,
      chainId: 137,
    }
  },

  // Truffle DB is currently disabled by default; to enable it, change enabled: false to enabled: true
  // Note: if you migrated your contracts prior to enabling this field in your Truffle project and want
  // those previously migrated contracts available in the .db directory, you will need to run the following:
  // $ truffle migrate --reset --compile-all

  db: {
    enabled: false
  },

  compilers: {
    solc: {
      version: "0.8.20",
      settings: {
        optimizer: {
          enabled: true,
          runs: 200
        }
      }
    }
  }
};
