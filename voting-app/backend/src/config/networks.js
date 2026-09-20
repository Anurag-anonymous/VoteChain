const fs = require('fs');
const path = require('path');

/**
 * Phase 2 network registry.
 *
 * This is the single source of truth for chain IDs, RPC environment variable
 * names, explorer URLs, signing policy, and deployment manifest locations.
 * `src/config/blockchain.js` keeps its own legacy branch for backwards
 * compatibility with older env files; new code should read the registry.
 */
const DEFAULT_NETWORK_KEY = 'anvil';
const DEFAULT_CHAIN_ID = 31337;

const NETWORK_ALIASES = {
  local: 'anvil',
  localhost: 'anvil',
  amoy: 'polygon-amoy',
  mumbai: 'polygon-amoy'
};

const NETWORKS = {
  anvil: {
    key: 'anvil',
    chainId: 31337,
    name: 'Anvil',
    rpcUrlEnv: 'ANVIL_RPC_URL',
    defaultRpcUrl: 'http://127.0.0.1:8545',
    explorerUrl: null,
    allowLocalPrivateKeySigning: true,
    metamaskSwitchingEnabled: true,
    deploymentDir: path.resolve(__dirname, '../../../deployments/anvil')
  },
  'polygon-amoy': {
    key: 'polygon-amoy',
    chainId: 80002,
    name: 'Polygon Amoy',
    rpcUrlEnv: 'POLYGON_RPC_URL',
    defaultRpcUrl: '',
    explorerUrl: 'https://amoy.polygonscan.com',
    allowLocalPrivateKeySigning: false,
    metamaskSwitchingEnabled: true,
    deploymentDir: path.resolve(__dirname, '../../../deployments/polygon-amoy')
  }
};

const normalizeNetworkKey = (value) => {
  const key = String(
    value || process.env.NETWORK || process.env.BLOCKCHAIN_NETWORK || DEFAULT_NETWORK_KEY
  ).toLowerCase();

  return NETWORK_ALIASES[key] || key;
};

const getNetworkConfig = (networkKey) => {
  const key = normalizeNetworkKey(networkKey);
  const config = NETWORKS[key];

  if (!config) {
    throw new Error(`Unsupported blockchain network: ${key}`);
  }

  return {
    ...config,
    rpcUrl: process.env[config.rpcUrlEnv] || config.defaultRpcUrl
  };
};

const listNetworks = () => Object.values(NETWORKS).map((network) => ({ ...network }));

const canSignLocally = (networkKey) => getNetworkConfig(networkKey).allowLocalPrivateKeySigning;

const loadDeployment = (contractName, networkKey) => {
  if (!contractName) {
    throw new Error('contractName is required to load a deployment manifest');
  }

  const config = getNetworkConfig(networkKey);
  const manifestPath = path.join(config.deploymentDir, `${contractName}.json`);

  if (!fs.existsSync(manifestPath)) {
    return null;
  }

  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

  if (manifest.contractName && manifest.contractName !== contractName) {
    throw new Error(
      `Deployment manifest ${manifestPath} declares contractName ${manifest.contractName}, expected ${contractName}`
    );
  }

  if (manifest.chainId && manifest.chainId !== config.chainId) {
    throw new Error(
      `Deployment manifest ${manifestPath} declares chainId ${manifest.chainId}, expected ${config.chainId} for ${config.key}`
    );
  }

  return manifest;
};

module.exports = {
  DEFAULT_NETWORK_KEY,
  DEFAULT_CHAIN_ID,
  NETWORK_ALIASES,
  NETWORKS,
  normalizeNetworkKey,
  getNetworkConfig,
  listNetworks,
  canSignLocally,
  loadDeployment
};
