const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');
const Web3 = require('web3');
const {
  createCampaignPlan,
  createRunManifest
} = require('../../../backend/src/config/researchStudy');
const { createScenario } = require('./scenario');
const { verifyPublicLedger } = require('./auditor');

const COMMIT_GAS = 250000;
const REVEAL_GAS = 150000;
const ADMIN_GAS = 500000;
const DEPLOY_GAS = 8000000;
const SECP256K1_ORDER = BigInt('0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141');

const parseArguments = (argv) => {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!argument.startsWith('--')) throw new Error(`Unexpected argument: ${argument}`);
    const separator = argument.indexOf('=');
    const name = argument.slice(2, separator < 0 ? undefined : separator);
    const inlineValue = separator < 0 ? undefined : argument.slice(separator + 1);
    if (name === 'confirm-public-chain') {
      result[name] = inlineValue === undefined
        ? true
        : inlineValue.toLowerCase() === 'true';
    } else if (inlineValue !== undefined) {
      result[name] = inlineValue;
    } else if (argv[index + 1] && !argv[index + 1].startsWith('--')) {
      result[name] = argv[++index];
    } else {
      throw new Error(`Option --${name} requires a value`);
    }
  }
  return result;
};

const validateArgumentNames = (argumentsByName) => {
  const allowed = new Set([
    'network',
    'seed',
    'revote-rate',
    'revote-rates',
    'panic-rate',
    'panic-rates',
    'commit-duration',
    'reveal-duration',
    'configuration',
    'padding-rate',
    'padding-rates',
    'selection-strategy',
    'timing-distribution',
    'timing-window-seconds',
    'dummy-transactions-per-ballot',
    'election-population',
    'repetitions',
    'population',
    'configurations',
    'populations',
    'limit',
    'confirm-public-chain',
    'rpc-url',
    'admin-key-env',
    'concurrency',
    'output',
    'actor-keys-file'
  ]);
  const unknown = Object.keys(argumentsByName).filter((name) => !allowed.has(name));
  if (unknown.length) throw new Error(`Unknown option(s): ${unknown.map((name) => `--${name}`).join(', ')}`);
};

const parseRate = (value, fallback) => {
  if (value === undefined) return fallback;
  const rate = Number(value);
  if (!Number.isFinite(rate) || rate < 0 || rate > 100) {
    throw new Error('Action rates must be numbers between 0 and 100');
  }
  return rate;
};

const atomicWriteJson = (filePath, value) => {
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' });
  fs.renameSync(temporaryPath, filePath);
};

const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');

const privateKeyFromSeed = (seed, index) => {
  const candidate = BigInt(`0x${sha256(`${seed}:actor:${index}`)}`);
  const key = (candidate % (SECP256K1_ORDER - 1n)) + 1n;
  return `0x${key.toString(16).padStart(64, '0')}`;
};

const advancePastDeadline = async ({ web3, network, startTime, durationSeconds }) => {
  const deadline = Number(startTime) + Number(durationSeconds);
  const latestBlock = await web3.eth.getBlock('latest');
  const remaining = Math.max(0, deadline - Number(latestBlock.timestamp));
  if (!remaining) return;
  if (network === 'anvil') {
    await jsonRpc(web3.currentProvider, 'evm_increaseTime', [remaining + 1]);
    await jsonRpc(web3.currentProvider, 'evm_mine', []);
    return;
  }
  await new Promise((resolve) => setTimeout(resolve, remaining * 1000));
};

const waitUntil = async (deadlineMilliseconds) => {
  const remaining = deadlineMilliseconds - Date.now();
  if (remaining > 0) await new Promise((resolve) => setTimeout(resolve, remaining));
};

const jsonRpc = async (provider, method, params) => {
  if (typeof provider.request === 'function') {
    return provider.request({ method, params });
  }
  return new Promise((resolve, reject) => {
    provider.send({ jsonrpc: '2.0', method, params, id: Date.now() }, (error, response) => {
      if (error) reject(error);
      else if (response && response.error) reject(new Error(response.error.message));
      else resolve(response.result);
    });
  });
};

const assertAnvilRpc = async (web3) => {
  const chainId = await web3.eth.getChainId();
  if (chainId !== 31337) {
    throw new Error(`Refusing Anvil run: expected chain 31337, received ${chainId}`);
  }
  try {
    const nodeInfo = await jsonRpc(web3.currentProvider, 'anvil_nodeInfo', []);
    if (!nodeInfo || typeof nodeInfo !== 'object') {
      throw new Error('Anvil returned an invalid node-info response');
    }
  } catch (error) {
    throw new Error(
      'The RPC on chain 31337 is not Foundry Anvil (anvil_nodeInfo is unavailable). ' +
      'Stop Ganache or the other EVM node on this port and start Foundry Anvil before running this campaign.',
      { cause: error }
    );
  }
};

const workerPool = async (items, concurrency, worker) => {
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      await worker(items[index], index);
    }
  });
  await Promise.all(workers);
};

const acquireChainLock = (network, chainId) => {
  const lockPath = path.join(os.tmpdir(), `votechain-study-${network}-${chainId}.lock`);
  const token = crypto.randomUUID();
  let descriptor;
  try {
    descriptor = fs.openSync(lockPath, 'wx');
  } catch (error) {
    if (error.code === 'EEXIST') {
      throw new Error(
        `Another study runner holds the ${network} chain lock (${lockPath}); ` +
        'do not run overlapping campaigns against one RPC endpoint'
      );
    }
    throw error;
  }
  fs.writeFileSync(descriptor, JSON.stringify({ pid: process.pid, token }));
  return () => {
    try {
      const current = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
      if (current.token === token) fs.unlinkSync(lockPath);
    } finally {
      fs.closeSync(descriptor);
    }
  };
};

const normalizePrivateKey = (value) => {
  const key = String(value).trim().replace(/^0x/i, '');
  if (!/^[0-9a-fA-F]{64}$/.test(key)) throw new Error('Actor key file contains an invalid private key');
  return `0x${key.toLowerCase()}`;
};

const loadPublicActorKeys = ({ web3, actorKeyFile, plans, administratorAddress }) => {
  if (!actorKeyFile) {
    throw new Error('Polygon Amoy runs require --actor-keys-file with funded private keys');
  }
  const parsed = JSON.parse(fs.readFileSync(path.resolve(actorKeyFile), 'utf8'));
  const runKeys = parsed && !Array.isArray(parsed) ? parsed.runs : null;
  const flatKeys = Array.isArray(parsed)
    ? parsed
    : parsed && Array.isArray(parsed.accounts)
      ? parsed.accounts
      : null;
  const actorKeysByRun = new Map();
  let offset = 0;
  const allAddresses = new Set();
  for (const manifest of plans) {
    const supplied = runKeys
      ? runKeys[manifest.runId]
      : flatKeys && flatKeys.slice(offset, offset + manifest.population);
    if (!Array.isArray(supplied) || supplied.length < manifest.population) {
      throw new Error(
        `Funded actor key file does not contain ${manifest.population} fresh keys for ${manifest.runId}`
      );
    }
    const keys = supplied.slice(0, manifest.population).map(normalizePrivateKey);
    for (const privateKey of keys) {
      const address = web3.eth.accounts.privateKeyToAccount(privateKey).address.toLowerCase();
      if (administratorAddress && address === administratorAddress.toLowerCase()) {
        throw new Error('Administrator key must not appear in the public actor key file');
      }
      if (allAddresses.has(address)) {
        throw new Error('Public campaign actor accounts must be unique across all planned runs');
      }
      allAddresses.add(address);
    }
    actorKeysByRun.set(manifest.runId, keys);
    if (!runKeys) offset += manifest.population;
  }
  return actorKeysByRun;
};

const invoke = async ({
  web3,
  method,
  from,
  privateKey,
  to,
  gas,
  gasPrice
}) => {
  const transaction = {
    from,
    data: method.encodeABI(),
    gas,
    gasPrice
  };
  if (to) transaction.to = to;
  if (!privateKey) return web3.eth.sendTransaction(transaction);

  const nonce = await web3.eth.getTransactionCount(from, 'pending');
  const signed = await web3.eth.accounts.signTransaction({
    ...transaction,
    nonce,
    chainId: await web3.eth.getChainId()
  }, privateKey);
  if (!signed.rawTransaction) throw new Error(`Signing failed for ${from}`);
  return web3.eth.sendSignedTransaction(signed.rawTransaction);
};

const sendAction = async ({
  web3,
  contract,
  actor,
  ballot,
  privateKey,
  gasPrice,
  operation,
  labels,
  operations,
  commitWallClockStart,
  fromAddress
}) => {
  const method = operation === 'commit'
    ? contract.methods.commit(ballot.ballotId, ballot.nullifier, ballot.commitment, ballot.sequence)
    : contract.methods.reveal(ballot.ballotId, ballot.choice, ballot.salt);
  if (operation === 'commit' && ballot.delayMs > 0) {
    await waitUntil(commitWallClockStart + ballot.delayMs);
  }
  const receipt = await invoke({
    web3,
    method,
    from: fromAddress || web3.eth.accounts.privateKeyToAccount(privateKey).address,
    privateKey,
    to: contract.options.address,
    gas: operation === 'commit' ? COMMIT_GAS : REVEAL_GAS,
    gasPrice
  });
  const activity = ballot.activity;
  labels.set(receipt.transactionHash.toLowerCase(), {
    activity,
    sensitiveActivity: ['revote', 'panic', 'decoy'].includes(activity),
    revote: activity === 'revote',
    panic: activity === 'panic',
    decoy: activity === 'decoy',
    padding: activity === 'padding'
  });
  operations.push({
    operation,
    transactionHash: receipt.transactionHash,
    from: receipt.from,
    blockNumber: Number(receipt.blockNumber),
    gasUsed: String(receipt.gasUsed),
    calldataBytes: (method.encodeABI().length - 2) / 2
  });
  return receipt;
};

const retrieveLedger = async ({ web3, contract, fromBlock, toBlock, labels, operations }) => {
  const events = await contract.getPastEvents('allEvents', { fromBlock, toBlock });
  const byTransaction = new Map();
  for (const event of events) {
    const hash = event.transactionHash.toLowerCase();
    if (!byTransaction.has(hash)) byTransaction.set(hash, []);
    byTransaction.get(hash).push(event.event);
  }
  const publicRecords = [];
  const orderedHashes = [...new Set(operations.map(({ transactionHash }) => (
    transactionHash.toLowerCase()
  )))];
  for (const transactionHash of orderedHashes) {
    const [transaction, receipt] = await Promise.all([
      web3.eth.getTransaction(transactionHash),
      web3.eth.getTransactionReceipt(transactionHash)
    ]);
    const block = await web3.eth.getBlock(transaction.blockNumber);
    publicRecords.push({
      transactionHash,
      submitter: transaction.from,
      recipient: transaction.to || receipt.contractAddress,
      blockNumber: Number(transaction.blockNumber),
      transactionIndex: Number(transaction.transactionIndex),
      timestamp: Number(block.timestamp),
      gasUsed: String(receipt.gasUsed),
      calldataBytes: (transaction.input.length - 2) / 2,
      methodId: transaction.input.slice(0, 10),
      eventNames: [...new Set(byTransaction.get(transactionHash) || [])].sort()
    });
  }
  publicRecords.sort((left, right) => (
    left.blockNumber - right.blockNumber ||
    left.transactionIndex - right.transactionIndex
  ));
  const senderCounts = new Map();
  publicRecords.forEach(({ submitter }) => {
    senderCounts.set(submitter, (senderCounts.get(submitter) || 0) + 1);
  });
  for (let index = 0; index < publicRecords.length; index += 1) {
    const current = publicRecords[index];
    const previous = publicRecords[index - 1];
    current.interTransactionSeconds = previous
      ? Math.max(0, current.timestamp - previous.timestamp)
      : 0;
    current.blockInterval = previous
      ? Math.max(0, current.blockNumber - previous.blockNumber)
      : 0;
    current.senderTransactionCount = senderCounts.get(current.submitter);
  }
  const privateLabels = publicRecords.map(({ transactionHash }) => ({
    transactionHash,
    ...(labels.get(transactionHash.toLowerCase()) || {
      activity: 'control',
      sensitiveActivity: false,
      revote: false,
      panic: false,
      decoy: false,
      padding: false
    })
  }));
  return { events, publicRecords, privateLabels };
};

const getRepositoryMetadata = () => {
  const repositoryRoot = path.resolve(__dirname, '../../..');
  let commit = null;
  let dirty = null;
  try {
    commit = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: repositoryRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    }).trim();
    dirty = Boolean(execFileSync('git', ['status', '--porcelain'], {
      cwd: repositoryRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    }).trim());
  } catch (error) {
    throw new Error(`Unable to capture git provenance: ${error.message}`);
  }
  return { commit, dirty };
};

const runOne = async ({
  web3,
  artifact,
  manifest,
  network,
  outputRoot,
  actorKeys,
  adminPrivateKey,
  concurrency
}) => {
  const runDirectory = path.join(outputRoot, manifest.runId);
  const resultPath = path.join(runDirectory, 'result.json');
  if (fs.existsSync(resultPath)) {
    const existing = JSON.parse(fs.readFileSync(resultPath, 'utf8'));
    if (existing.status === 'complete' && existing.seed === manifest.seed) {
      return existing;
    }
    throw new Error(`Run directory already exists but is not complete: ${runDirectory}`);
  }
  fs.mkdirSync(runDirectory, { recursive: false });
  atomicWriteJson(resultPath, {
    status: 'running',
    runId: manifest.runId,
    seed: manifest.seed,
    startedAt: new Date().toISOString()
  });

  const operations = [];
  const labels = new Map();
  let deploymentRecord = null;
  try {
    const networkInfo = await web3.eth.getChainId();
    if (networkInfo !== manifest.network.chainId) {
      throw new Error(`Expected chain ID ${manifest.network.chainId}, received ${networkInfo}`);
    }
    const repository = getRepositoryMetadata();
    const keys = actorKeys || Array.from({ length: manifest.population }, (_, index) => (
      privateKeyFromSeed(manifest.seed, index)
    ));
    const actors = keys.map((privateKey) => web3.eth.accounts.privateKeyToAccount(privateKey));
    if (new Set(actors.map(({ address }) => address.toLowerCase())).size !== actors.length) {
      throw new Error('Actor private keys must resolve to unique addresses');
    }
    const adminAccount = adminPrivateKey
      ? web3.eth.accounts.privateKeyToAccount(normalizePrivateKey(adminPrivateKey))
      : null;
    const adminAddress = adminAccount
      ? adminAccount.address
      : (await web3.eth.getAccounts())[0];
    if (!adminAddress) throw new Error('RPC returned no administrator account');
    if (actors.some(({ address }) => address.toLowerCase() === adminAddress.toLowerCase())) {
      throw new Error('Administrator key must not be reused as a voter actor key');
    }
    const scenario = createScenario(manifest, web3);
    const gasPrice = await web3.eth.getGasPrice();
    if (network === 'anvil') {
      const initialBalance = BigInt(web3.utils.toWei('100', 'ether')).toString(16);
      await workerPool(actors, concurrency, async ({ address }) => {
        try {
          await jsonRpc(web3.currentProvider, 'anvil_setBalance', [
            address,
            `0x${initialBalance}`
          ]);
        } catch (anvilError) {
          try {
            await jsonRpc(web3.currentProvider, 'evm_setAccountBalance', [
              address,
              `0x${initialBalance}`
            ]);
          } catch (fallbackError) {
            throw new Error(
              `Local RPC cannot fund deterministic research actor ${address}: ` +
              `${fallbackError.message || anvilError.message}`
            );
          }
        }
      });
    } else {
      const registrarGas = DEPLOY_GAS + (4 * ADMIN_GAS) +
        scenario.registrarActions.length * COMMIT_GAS;
      const administratorBalance = BigInt(await web3.eth.getBalance(adminAddress));
      if (administratorBalance < BigInt(gasPrice) * BigInt(registrarGas)) {
        throw new Error('Administrator account lacks funds for deployment, controls, and registrar actions');
      }
      const perActorGas = scenario.actorPlans.map((actorPlan) => (
        actorPlan.commits.length * COMMIT_GAS + actorPlan.reveals.length * REVEAL_GAS
      ));
      const insufficient = [];
      for (let index = 0; index < actors.length; index += 1) {
        const balance = BigInt(await web3.eth.getBalance(actors[index].address));
        const required = BigInt(gasPrice) * BigInt(perActorGas[index]);
        if (balance < required) insufficient.push(actors[index].address);
      }
      if (insufficient.length > 0) {
        throw new Error(
          `${insufficient.length} actor accounts lack funds for planned transactions; ` +
          'fund them before retrying. No actor key or balance is written to the run.'
        );
      }
    }

    const deploy = new web3.eth.Contract(artifact.abi).deploy({
      data: artifact.bytecode,
      arguments: [
        manifest.electionId,
        manifest.configuration.revoting,
        manifest.commitDurationSeconds,
        manifest.revealDurationSeconds
      ]
    });
    const deploymentData = deploy.encodeABI();
    const deployment = await invoke({
      web3,
      method: { encodeABI: () => deploymentData },
      from: adminAddress,
      privateKey: adminAccount && adminAccount.privateKey,
      to: undefined,
      gas: DEPLOY_GAS,
      gasPrice
    });
    deploymentRecord = {
      contractAddress: deployment.contractAddress,
      deploymentTransaction: deployment.transactionHash,
      deploymentBlock: Number(deployment.blockNumber)
    };
    const contract = new web3.eth.Contract(artifact.abi, deployment.contractAddress);
    operations.push({
      operation: 'deployment',
      transactionHash: deployment.transactionHash,
      from: deployment.from,
      blockNumber: Number(deployment.blockNumber),
      gasUsed: String(deployment.gasUsed),
      calldataBytes: (deploymentData.length - 2) / 2
    });
    const sendAdmin = async (name, method) => {
      const data = method.encodeABI();
      const receipt = await invoke({
        web3,
        method,
        from: adminAddress,
        privateKey: adminAccount && adminAccount.privateKey,
        to: contract.options.address,
        gas: ADMIN_GAS,
        gasPrice
      });
      operations.push({
        operation: name,
        transactionHash: receipt.transactionHash,
        from: receipt.from,
        blockNumber: Number(receipt.blockNumber),
        gasUsed: String(receipt.gasUsed),
        calldataBytes: (data.length - 2) / 2
      });
      return receipt;
    };

    await sendAdmin('start-commit', contract.methods.startCommit());
    const commitStartedAt = await contract.methods.commitStartedAt().call();
    const commitWallClockStart = Date.now();
    await workerPool(scenario.actorPlans, concurrency, async (actorPlan) => {
      for (const ballot of actorPlan.commits) {
        await sendAction({
          web3,
          contract,
          actor: actorPlan.actor,
          ballot,
          privateKey: keys[actorPlan.actor],
          gasPrice,
          operation: 'commit',
          labels,
          operations,
          commitWallClockStart
        });
      }
    });
    for (const ballot of scenario.registrarActions) {
      if (ballot.delayMs > 0) {
        await waitUntil(commitWallClockStart + ballot.delayMs);
      }
      await sendAction({
        web3,
        contract,
        actor: ballot.actor,
        ballot,
        privateKey: adminAccount && adminAccount.privateKey,
        fromAddress: adminAddress,
        gasPrice,
        operation: 'commit',
        labels,
        operations,
        commitWallClockStart
      });
    }
    await advancePastDeadline({
      web3,
      network,
      startTime: commitStartedAt,
      durationSeconds: manifest.commitDurationSeconds
    });
    await sendAdmin('end-commit', contract.methods.endCommit());
    const revealStartedAt = await contract.methods.revealStartedAt().call();
    await workerPool(scenario.actorPlans, concurrency, async (actorPlan) => {
      for (const ballot of actorPlan.reveals) {
        await sendAction({
          web3,
          contract,
          actor: actorPlan.actor,
          ballot,
          privateKey: keys[actorPlan.actor],
          gasPrice,
          operation: 'reveal',
          labels,
          operations
        });
      }
    });
    await advancePastDeadline({
      web3,
      network,
      startTime: revealStartedAt,
      durationSeconds: manifest.revealDurationSeconds
    });
    await sendAdmin('finalize', contract.methods.finalize());

    const finalBlock = await web3.eth.getBlockNumber();
    const ledger = await retrieveLedger({
      web3,
      contract,
      fromBlock: Number(deployment.blockNumber),
      toBlock: finalBlock,
      labels,
      operations
    });
    const audit = await verifyPublicLedger({
      web3,
      contract,
      fromBlock: Number(deployment.blockNumber),
      toBlock: finalBlock
    });
    const runManifest = {
      ...manifest,
      provenance: {
        ...repository,
        nodeVersion: process.version,
        solcVersion: artifact.compiler && artifact.compiler.version,
        chainId: networkInfo,
        contractAddress: contract.options.address,
        deploymentTransaction: deployment.transactionHash,
        startBlock: Number(deployment.blockNumber),
        endBlock: finalBlock,
        startedAt: new Date().toISOString(),
        actorPrivateKeysPersisted: false
      }
    };
    const totalGas = operations.reduce((sum, operation) => sum + BigInt(operation.gasUsed), 0n);
    const completed = {
      status: 'complete',
      runId: manifest.runId,
      seed: manifest.seed,
      configuration: manifest.configuration.label,
      population: manifest.population,
      contractAddress: contract.options.address,
      totalGas: totalGas.toString(),
      contractTransactionCount: ledger.publicRecords.length,
      auditVerified: audit.verified,
      startedAt: JSON.parse(fs.readFileSync(resultPath, 'utf8')).startedAt,
      completedAt: new Date().toISOString()
    };
    atomicWriteJson(path.join(runDirectory, 'manifest.json'), runManifest);
    atomicWriteJson(path.join(runDirectory, 'operations.json'), operations);
    atomicWriteJson(path.join(runDirectory, 'public-records.json'), ledger.publicRecords);
    atomicWriteJson(path.join(runDirectory, 'private-labels.json'), ledger.privateLabels);
    atomicWriteJson(path.join(runDirectory, 'private-scenario.json'), scenario.counts);
    atomicWriteJson(path.join(runDirectory, 'auditor.json'), audit);
    atomicWriteJson(resultPath, completed);
    return completed;
  } catch (error) {
    if (operations.length) {
      atomicWriteJson(path.join(runDirectory, 'partial-operations.json'), operations);
    }
    if (deploymentRecord) {
      atomicWriteJson(path.join(runDirectory, 'partial-contract.json'), deploymentRecord);
    }
    if (labels.size) {
      atomicWriteJson(path.join(runDirectory, 'partial-private-labels.json'), [
        ...labels.entries()
      ].map(([transactionHash, label]) => ({ transactionHash, ...label })));
    }
    const failure = {
      status: 'failed',
      runId: manifest.runId,
      seed: manifest.seed,
      failedAt: new Date().toISOString(),
      confirmedOperationCount: operations.length,
      contractAddress: deploymentRecord && deploymentRecord.contractAddress,
      error: {
        name: error.name,
        message: error.message.replace(/0x[0-9a-fA-F]{64}/g, '[redacted-hex-value]')
      }
    };
    atomicWriteJson(resultPath, failure);
    throw error;
  }
};

const campaignFromArguments = (argumentsByName) => {
  const network = argumentsByName.network || 'anvil';
  const seed = argumentsByName.seed || `votechain-${Date.now()}`;
  const revoteRatePercent = parseRate(argumentsByName['revote-rate'], 20);
  const panicRatePercent = parseRate(argumentsByName['panic-rate'], 10);
  const commitDurationSeconds = Number(argumentsByName['commit-duration'] || 1800);
  const revealDurationSeconds = Number(argumentsByName['reveal-duration'] || 1800);
  if (!Number.isInteger(commitDurationSeconds) || commitDurationSeconds < 1 ||
      !Number.isInteger(revealDurationSeconds) || revealDurationSeconds < 1) {
    throw new Error('Commit and reveal durations must be positive integers');
  }
  let plans;
  if (argumentsByName.configuration) {
    const paddingConfig = argumentsByName.configuration.endsWith('p')
      ? {
        paddingRatePercent: argumentsByName['padding-rate'],
        selectionStrategy: argumentsByName['selection-strategy'],
        timingDistribution: argumentsByName['timing-distribution'],
        timingWindowSeconds: argumentsByName['timing-window-seconds'],
        dummyTransactionsPerBallot: argumentsByName['dummy-transactions-per-ballot'],
        electionPopulation: argumentsByName['election-population']
      }
      : null;
    const repetitions = Number(argumentsByName.repetitions || 1);
    if (!Number.isInteger(repetitions) || repetitions < 1 || repetitions > 100) {
      throw new Error('--repetitions must be an integer between 1 and 100');
    }
    plans = Array.from({ length: repetitions }, (_, index) => {
      const repetition = index + 1;
      const manifest = createRunManifest({
        configuration: argumentsByName.configuration,
        network,
        population: argumentsByName.population || 10,
        repetitions: 1,
        seed: `${seed}-${argumentsByName.configuration}-${argumentsByName.population || 10}-r${repetition}`,
        paddingConfig,
        commitDurationSeconds,
        revealDurationSeconds,
        revoteRatePercent,
        panicRatePercent
      });
      return { ...manifest, runId: manifest.seed, repetition };
    });
  } else {
    const hasPaddingParameters = [
      'padding-rate',
      'selection-strategy',
      'timing-distribution',
      'timing-window-seconds',
      'dummy-transactions-per-ballot',
      'election-population'
    ].every((name) => argumentsByName[name] !== undefined);
    const paddingConfig = hasPaddingParameters
      ? {
        paddingRatePercent: argumentsByName['padding-rate'],
        selectionStrategy: argumentsByName['selection-strategy'],
        timingDistribution: argumentsByName['timing-distribution'],
        timingWindowSeconds: argumentsByName['timing-window-seconds'],
        dummyTransactionsPerBallot: argumentsByName['dummy-transactions-per-ballot'],
        electionPopulation: argumentsByName['election-population']
      }
      : undefined;
    const configurations = argumentsByName.configurations
      ? String(argumentsByName.configurations).split(',').map((item) => item.trim())
      : undefined;
    const populations = argumentsByName.populations
      ? String(argumentsByName.populations).split(',').map(Number)
      : undefined;
    const revoteRates = argumentsByName['revote-rates'];
    const panicRates = argumentsByName['panic-rates'];
    if (revoteRates !== undefined || panicRates !== undefined) {
      if (revoteRates !== undefined && panicRates !== undefined) {
        throw new Error('Use either --revote-rates or --panic-rates, not both');
      }
      if (argumentsByName.configuration ||
          argumentsByName.configurations === undefined ||
          argumentsByName.populations === undefined) {
        throw new Error('Activity-rate sweeps require matrix filters --configurations and --populations');
      }
      if (argumentsByName['padding-rates'] !== undefined ||
          argumentsByName['padding-rate'] !== undefined) {
        throw new Error('Activity-rate sweeps cannot be combined with padding-rate sweeps');
      }
      const rateName = revoteRates !== undefined ? 'revote' : 'panic';
      const rates = String(revoteRates !== undefined ? revoteRates : panicRates)
        .split(',')
        .map(Number);
      if (!rates.length || rates.some((rate) => (
        !Number.isFinite(rate) || rate < 0 || rate > 100
      )) || new Set(rates).size !== rates.length) {
        throw new Error(`--${rateName}-rates must be unique percentages between 0 and 100`);
      }
      const selectedConfigurations = configurations || [];
      const mechanismEnabled = (configuration) => {
        if (!['C0', 'C1', 'C2', 'C3'].includes(configuration)) {
          throw new Error(`--${rateName}-rates does not support configuration ${configuration}`);
        }
        const enabled = rateName === 'revote'
          ? ['C1', 'C3'].includes(configuration)
          : ['C2', 'C3'].includes(configuration);
        if (!enabled) {
          throw new Error(
            `--${rateName}-rates requires a configuration with ${rateName} enabled`
          );
        }
      };
      selectedConfigurations.forEach(mechanismEnabled);
      plans = [];
      for (const rate of rates) {
        plans.push(...createCampaignPlan({
          network,
          seed: `${seed}-${rateName}-${rate}`,
          paddingConfig: null,
          revoteRatePercent: rateName === 'revote' ? rate : revoteRatePercent,
          panicRatePercent: rateName === 'panic' ? rate : panicRatePercent,
          commitDurationSeconds,
          revealDurationSeconds,
          configurations: selectedConfigurations,
          populations
        }));
      }
    } else if (argumentsByName['padding-rates'] !== undefined) {
      if (argumentsByName['padding-rate'] !== undefined) {
        throw new Error('Use either --padding-rate or --padding-rates, not both');
      }
      if (argumentsByName.configuration ||
          argumentsByName.configurations === undefined ||
          argumentsByName.populations === undefined) {
        throw new Error('--padding-rates requires matrix filters --configurations and --populations');
      }
      const selectedConfigurations = configurations || [
        'C0', 'C1', 'C2', 'C3', 'C1p', 'C2p'
      ];
      const paddedConfigurations = selectedConfigurations.filter((configuration) => (
        configuration.endsWith('p')
      ));
      const ordinaryConfigurations = selectedConfigurations.filter((configuration) => (
        !configuration.endsWith('p')
      ));
      if (!paddedConfigurations.length) {
        throw new Error('--padding-rates requires at least one padded condition such as C1p or C2p');
      }
      const requiredPaddingArguments = [
        'selection-strategy',
        'timing-distribution',
        'timing-window-seconds',
        'dummy-transactions-per-ballot',
        'election-population'
      ];
      const missingPaddingArguments = requiredPaddingArguments.filter(
        (name) => argumentsByName[name] === undefined
      );
      if (missingPaddingArguments.length) {
        throw new Error(
          `--padding-rates requires ${missingPaddingArguments.map((name) => `--${name}`).join(', ')}`
        );
      }
      const rates = String(argumentsByName['padding-rates']).split(',').map(Number);
      if (!rates.length || rates.some((rate) => (
        !Number.isFinite(rate) || rate < 0 || rate > 100
      )) || new Set(rates).size !== rates.length) {
        throw new Error('--padding-rates must be unique percentages between 0 and 100');
      }
      plans = ordinaryConfigurations.length
        ? createCampaignPlan({
          network,
          seed,
          paddingConfig: null,
          revoteRatePercent,
          panicRatePercent,
          commitDurationSeconds,
          revealDurationSeconds,
          configurations: ordinaryConfigurations,
          populations
        })
        : [];
      for (const rate of rates) {
        const ratePaddingConfig = {
          paddingRatePercent: rate,
          selectionStrategy: argumentsByName['selection-strategy'],
          timingDistribution: argumentsByName['timing-distribution'],
          timingWindowSeconds: argumentsByName['timing-window-seconds'],
          dummyTransactionsPerBallot: argumentsByName['dummy-transactions-per-ballot'],
          electionPopulation: argumentsByName['election-population']
        };
        plans.push(...createCampaignPlan({
          network,
          seed: `${seed}-pad-${rate}`,
          paddingConfig: ratePaddingConfig,
          revoteRatePercent,
          panicRatePercent,
          commitDurationSeconds,
          revealDurationSeconds,
          configurations: paddedConfigurations,
          populations
        }));
      }
    } else {
      plans = createCampaignPlan({
        network,
        seed,
        paddingConfig,
        revoteRatePercent,
        panicRatePercent,
        commitDurationSeconds,
        revealDurationSeconds,
        configurations,
        populations
      });
    }
    if (argumentsByName.limit !== undefined) {
      const limit = Number(argumentsByName.limit);
      if (!Number.isInteger(limit) || limit < 1) throw new Error('--limit must be a positive integer');
      plans = plans.slice(0, limit);
    }
  }
  return { network, seed, plans };
};

const main = async () => {
  const args = parseArguments(process.argv.slice(2));
  validateArgumentNames(args);
  const { network, seed, plans } = campaignFromArguments(args);
  if (!plans.length) throw new Error('Campaign contains no runs');
  if (network === 'polygon-amoy' && args['confirm-public-chain'] !== true) {
    throw new Error('Polygon Amoy requires the explicit --confirm-public-chain flag');
  }
  if (!['anvil', 'polygon-amoy'].includes(network)) throw new Error(`Unsupported network: ${network}`);
  const rpcUrl = args['rpc-url'] || (
    network === 'polygon-amoy'
      ? process.env.POLYGON_RPC_URL
      : process.env.ANVIL_RPC_URL || 'http://127.0.0.1:8545'
  );
  if (!rpcUrl) throw new Error('Set POLYGON_RPC_URL or pass --rpc-url');
  const adminPrivateKey = args['admin-key-env']
    ? process.env[args['admin-key-env']]
    : (network === 'polygon-amoy'
      ? process.env.RESEARCH_ADMIN_PRIVATE_KEY || process.env.POLYGON_DEPLOYER_PRIVATE_KEY
      : undefined);
  if (network === 'polygon-amoy' && !adminPrivateKey) {
    throw new Error('Set RESEARCH_ADMIN_PRIVATE_KEY for Polygon Amoy');
  }
  const concurrency = Number(args.concurrency || 8);
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 50) {
    throw new Error('--concurrency must be an integer between 1 and 50');
  }
  const outputRoot = path.resolve(args.output || path.join(
    process.cwd(),
    'research-runs',
    network,
    seed
  ));
  fs.mkdirSync(outputRoot, { recursive: true });
  const web3 = new Web3(rpcUrl);
  const administratorAddress = network === 'polygon-amoy'
    ? web3.eth.accounts.privateKeyToAccount(normalizePrivateKey(adminPrivateKey)).address
    : null;
  const publicActorKeysByRun = network === 'polygon-amoy'
    ? loadPublicActorKeys({
      web3,
      actorKeyFile: args['actor-keys-file'],
      plans,
      administratorAddress
    })
    : null;
  const artifactPath = path.join(__dirname, '../../build/contracts/ResearchElection.json');
  const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
  if (!artifact.bytecode || artifact.bytecode === '0x') {
    throw new Error('ResearchElection artifact is missing bytecode; compile smart contracts first');
  }
  const chainId = await web3.eth.getChainId();
  const expectedChainId = network === 'anvil' ? 31337 : 80002;
  if (chainId !== expectedChainId) {
    throw new Error(`Refusing network: expected chain ${expectedChainId}, received ${chainId}`);
  }
  if (network === 'anvil') await assertAnvilRpc(web3);
  const releaseChainLock = acquireChainLock(network, chainId);
  const results = [];
  const campaignPath = path.join(outputRoot, 'campaign.json');
  try {
    atomicWriteJson(campaignPath, {
      status: 'running',
      network,
      chainId,
      seed,
      expectedRuns: plans.length,
      startedAt: new Date().toISOString()
    });
    for (const manifest of plans) {
      console.log(`Running ${manifest.runId} (${manifest.population} participants)`);
      const result = await runOne({
        web3,
        artifact,
        manifest,
        network,
        outputRoot,
        actorKeys: publicActorKeysByRun && publicActorKeysByRun.get(manifest.runId),
        adminPrivateKey,
        concurrency
      });
      results.push(result);
      console.log(`${result.status}: ${result.runId}`);
    }
    const campaignResult = {
      status: 'complete',
      network,
      chainId,
      seed,
      expectedRuns: plans.length,
      completedRuns: results.length,
      results,
      completedAt: new Date().toISOString()
    };
    atomicWriteJson(campaignPath, campaignResult);
    console.log(JSON.stringify({
      status: campaignResult.status,
      network,
      completedRuns: results.length,
      output: outputRoot
    }, null, 2));
  } catch (error) {
    atomicWriteJson(campaignPath, {
      status: 'failed',
      network,
      chainId,
      seed,
      expectedRuns: plans.length,
      completedRuns: results.length,
      results,
      failedAt: new Date().toISOString(),
      error: { name: error.name, message: error.message }
    });
    throw error;
  } finally {
    releaseChainLock();
    if (web3.currentProvider && typeof web3.currentProvider.disconnect === 'function') {
      await web3.currentProvider.disconnect();
    }
  }
};

if (require.main === module) {
  main().catch((error) => {
    console.error(`Experiment campaign failed: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  campaignFromArguments,
  createScenario,
  privateKeyFromSeed,
  runOne,
  assertAnvilRpc,
  verifyPublicLedger
};
