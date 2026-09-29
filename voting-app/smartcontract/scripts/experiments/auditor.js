const ZERO_BYTES32 = `0x${'0'.repeat(64)}`;

const verifyPublicLedger = async ({ web3, contract, fromBlock, toBlock }) => {
  const startedAt = process.hrtime.bigint();
  const events = await contract.getPastEvents('allEvents', { fromBlock, toBlock });
  const phaseEventNames = [
    'CommitPhaseStarted',
    'CommitPhaseEnded',
    'RevealPhaseStarted',
    'ElectionFinalized'
  ];
  const ballotEvents = events
    .filter(({ event }) => [
      'BallotCommitted',
      'BallotSuperseded',
      'BallotRevealed',
      ...phaseEventNames
    ].includes(event))
    .sort((left, right) => (
      Number(left.blockNumber) - Number(right.blockNumber) ||
      Number(left.transactionIndex) - Number(right.transactionIndex) ||
      Number(left.logIndex) - Number(right.logIndex)
    ));
  const ballots = new Map();
  const latestByNullifier = new Map();
  const tally = new Map();
  const transactionData = new Map();
  const phaseTransitions = [];
  const electionId = await contract.methods.electionId().call();
  let finalization = null;
  let tallyCommitment = ZERO_BYTES32;
  let bytesProcessed = 0;

  for (const item of ballotEvents) {
    bytesProcessed += Buffer.byteLength(JSON.stringify(item));
    if (!transactionData.has(item.transactionHash)) {
      const transaction = await web3.eth.getTransaction(item.transactionHash);
      const receipt = await web3.eth.getTransactionReceipt(item.transactionHash);
      const block = await web3.eth.getBlock(transaction.blockNumber);
      transactionData.set(item.transactionHash, { transaction, receipt, block });
      bytesProcessed += Buffer.byteLength(JSON.stringify({ transaction, receipt, block }));
    }

    if (phaseEventNames.includes(item.event)) phaseTransitions.push(item.event);
    if (item.event === 'BallotCommitted') {
      const { ballotId, nullifier, commitment, sequence } = item.returnValues;
      const previous = latestByNullifier.get(nullifier);
      const expectedSequence = previous ? previous.sequence + 1 : 1;
      if (Number(sequence) !== expectedSequence) {
        throw new Error(`Invalid sequence for ballot ${ballotId}`);
      }
      ballots.set(ballotId, {
        ballotId,
        nullifier,
        commitment,
        sequence: Number(sequence),
        superseded: false,
        revealed: false
      });
      latestByNullifier.set(nullifier, { ballotId, sequence: Number(sequence) });
    } else if (item.event === 'BallotSuperseded') {
      const prior = ballots.get(item.returnValues.ballotId);
      if (!prior || prior.superseded || prior.revealed) {
        throw new Error(`Invalid supersession event for ballot ${item.returnValues.ballotId}`);
      }
      prior.superseded = true;
    } else if (item.event === 'BallotRevealed') {
      const { ballotId, choice } = item.returnValues;
      const ballot = ballots.get(ballotId);
      if (!ballot || ballot.superseded || ballot.revealed) {
        throw new Error(`Reveal references an invalid ballot: ${ballotId}`);
      }
      const latest = latestByNullifier.get(ballot.nullifier);
      if (!latest || latest.ballotId !== ballotId) {
        throw new Error(`Reveal is not the latest ballot for ${ballot.nullifier}`);
      }
      const { transaction } = transactionData.get(item.transactionHash);
      const decoded = web3.eth.abi.decodeParameters(
        ['bytes32', 'uint32', 'bytes32'],
        transaction.input.slice(10)
      );
      if (decoded[0].toLowerCase() !== ballotId.toLowerCase() ||
          decoded[1] !== String(choice)) {
        throw new Error(`Reveal calldata does not match its event for ${ballotId}`);
      }
      const encoding = web3.eth.abi.encodeParameters(
        ['bytes32', 'bytes32', 'uint32', 'bytes32'],
        [electionId, ballot.nullifier, choice, decoded[2]]
      );
      if (web3.utils.keccak256(encoding).toLowerCase() !== ballot.commitment.toLowerCase()) {
        throw new Error(`Commitment verification failed for ballot ${ballotId}`);
      }
      ballot.revealed = true;
      ballot.choice = Number(choice);
      tally.set(Number(choice), (tally.get(Number(choice)) || 0) + 1);
      tallyCommitment = web3.utils.keccak256(web3.eth.abi.encodeParameters(
        ['bytes32', 'bytes32', 'uint32'],
        [tallyCommitment, ballotId, choice]
      ));
    } else if (item.event === 'ElectionFinalized') {
      finalization = item.returnValues;
    }
  }

  if (phaseTransitions.join(',') !== phaseEventNames.join(',')) {
    throw new Error('Election phase transition events are missing or out of order');
  }
  if (!finalization) throw new Error('Election finalization event is missing');
  const eventByName = new Map(ballotEvents
    .filter(({ event }) => phaseEventNames.includes(event))
    .map((item) => [item.event, item]));
  const commitDeadline = Number(
    eventByName.get('CommitPhaseStarted').returnValues.closesAt
  );
  const revealDeadline = Number(
    eventByName.get('RevealPhaseStarted').returnValues.closesAt
  );
  const commitEndTimestamp = Number(transactionData.get(
    eventByName.get('CommitPhaseEnded').transactionHash
  ).block.timestamp);
  const finalizeTimestamp = Number(transactionData.get(
    eventByName.get('ElectionFinalized').transactionHash
  ).block.timestamp);
  if (commitEndTimestamp < commitDeadline || finalizeTimestamp < revealDeadline) {
    throw new Error('Election phases ended before their contract-enforced deadlines');
  }
  for (const item of ballotEvents) {
    const blockTimestamp = Number(transactionData.get(item.transactionHash).block.timestamp);
    if (item.event === 'BallotCommitted' && blockTimestamp >= commitDeadline) {
      throw new Error('A ballot was committed after the commit deadline');
    }
    if (item.event === 'BallotRevealed' &&
        (blockTimestamp < Number(eventByName.get('RevealPhaseStarted').returnValues.startedAt) ||
          blockTimestamp >= revealDeadline)) {
      throw new Error('A ballot was revealed outside the reveal phase');
    }
  }
  const revealed = Array.from(ballots.values()).filter((ballot) => ballot.revealed);
  const unrevealedActive = Array.from(ballots.values()).filter(
    (ballot) => !ballot.revealed && !ballot.superseded
  );
  const activeNullifiers = new Set(Array.from(ballots.values(), ({ nullifier }) => nullifier));
  const storageGrowthWords = 4 + Number(revealed.length > 0) + (4 * ballots.size) +
    (2 * activeNullifiers.size) + tally.size;
  if (Number(finalization.committedBallotCount) !== ballots.size ||
      Number(finalization.revealedBallotCount) !== revealed.length ||
      finalization.tallyCommitment.toLowerCase() !== tallyCommitment.toLowerCase()) {
    throw new Error('Finalization totals or tally commitment do not match the public ledger');
  }

  for (const [choice, count] of tally) {
    const onChainCount = Number(await contract.methods.tally(choice).call());
    if (onChainCount !== count) {
      throw new Error(`On-chain tally differs for choice ${choice}`);
    }
  }

  return {
    verified: true,
    tallyVerified: true,
    proofType: 'event-reconstruction-and-commitment-check (not a zero-knowledge proof)',
    committedBallots: ballots.size,
    revealedBallots: revealed.length,
    supersededBallots: Array.from(ballots.values()).filter((ballot) => ballot.superseded).length,
    unrevealedActiveBallots: unrevealedActive.length,
    exceptionalRecords: unrevealedActive.length,
    storageGrowthWords,
    storageGrowthBytes: storageGrowthWords * 32,
    storageMeasurement: 'modeled non-zero contract storage words from the declared Solidity layout; excludes transaction trie/state-tree overhead',
    commitPhaseDurationSeconds: commitDeadline -
      Number(eventByName.get('CommitPhaseStarted').returnValues.startedAt),
    revealPhaseDurationSeconds: revealDeadline -
      Number(eventByName.get('RevealPhaseStarted').returnValues.startedAt),
    tally: Object.fromEntries([...tally.entries()].sort(([left], [right]) => left - right)),
    transactionsProcessed: transactionData.size,
    bytesProcessed,
    verificationTimeMs: Number(process.hrtime.bigint() - startedAt) / 1e6
  };
};

module.exports = { verifyPublicLedger };
