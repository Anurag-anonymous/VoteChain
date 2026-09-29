const fs = require('fs');
const path = require('path');
const Web3 = require('web3');
const { verifyPublicLedger } = require('./auditor');

const [, , runDirectory, rpcUrl = process.env.ANVIL_RPC_URL || 'http://127.0.0.1:8545'] = process.argv;

const main = async () => {
  if (!runDirectory) {
    throw new Error('Usage: node scripts/experiments/audit-run.js <run-directory> [rpc-url]');
  }
  const resolvedRunDirectory = path.resolve(runDirectory);
  const manifest = JSON.parse(fs.readFileSync(
    path.join(resolvedRunDirectory, 'manifest.json'),
    'utf8'
  ));
  const artifact = JSON.parse(fs.readFileSync(
    path.join(__dirname, '../../build/contracts/ResearchElection.json'),
    'utf8'
  ));
  const web3 = new Web3(rpcUrl);
  try {
    if (manifest.network.chainId !== await web3.eth.getChainId()) {
      throw new Error('RPC chain ID does not match the run manifest');
    }
    const contract = new web3.eth.Contract(artifact.abi, manifest.provenance.contractAddress);
    const audit = await verifyPublicLedger({
      web3,
      contract,
      fromBlock: manifest.provenance.startBlock,
      toBlock: manifest.provenance.endBlock
    });
    const outputPath = path.join(resolvedRunDirectory, 'independent-audit.json');
    fs.writeFileSync(outputPath, `${JSON.stringify(audit, null, 2)}\n`, { flag: 'wx' });
    console.log(JSON.stringify({ outputPath, ...audit }, null, 2));
  } finally {
    if (web3.currentProvider && typeof web3.currentProvider.disconnect === 'function') {
      await web3.currentProvider.disconnect();
    }
  }
};

if (require.main === module) {
  main().catch((error) => {
    console.error(`Independent audit failed: ${error.message}`);
    process.exitCode = 1;
  });
}
