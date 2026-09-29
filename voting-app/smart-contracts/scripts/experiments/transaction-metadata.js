const orderByTransaction = (publicRecords) => {
  const hasCompleteOrder = publicRecords.every(({ blockNumber, transactionIndex }) => (
    blockNumber !== null &&
    blockNumber !== undefined &&
    transactionIndex !== null &&
    transactionIndex !== undefined &&
    Number.isInteger(Number(blockNumber)) &&
    Number(blockNumber) >= 0 &&
    Number.isInteger(Number(transactionIndex)) &&
    Number(transactionIndex) >= 0
  ));
  if (!hasCompleteOrder) return [...publicRecords];

  return publicRecords.map((record, index) => ({ record, index }))
    .sort((left, right) => (
      Number(left.record.blockNumber) - Number(right.record.blockNumber) ||
      Number(left.record.transactionIndex) - Number(right.record.transactionIndex) ||
      left.index - right.index
    ))
    .map(({ record }) => record);
};

const cumulativeSenderCounts = (publicRecords, runId) => {
  const countsByHash = new Map();
  const countsBySender = new Map();
  for (const record of orderByTransaction(publicRecords)) {
    if (typeof record.transactionHash !== 'string' ||
        !/^0x[0-9a-f]{64}$/i.test(record.transactionHash)) {
      throw new Error(`Run ${runId} has an invalid public-record transaction hash`);
    }
    if (typeof record.submitter !== 'string' || !record.submitter) {
      throw new Error(`Run ${runId} has an invalid public-record submitter`);
    }
    const sender = record.submitter.toLowerCase();
    const count = (countsBySender.get(sender) || 0) + 1;
    countsBySender.set(sender, count);
    countsByHash.set(record.transactionHash.toLowerCase(), count);
  }
  return countsByHash;
};

module.exports = { orderByTransaction, cumulativeSenderCounts };
