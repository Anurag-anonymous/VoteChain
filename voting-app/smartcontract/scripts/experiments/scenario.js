const crypto = require('crypto');

const digest = (value) => crypto.createHash('sha256').update(value).digest('hex');

const makeDeterministicSelector = (seed, namespace) => {
  let counter = 0;
  return () => {
    const value = Number.parseInt(digest(`${seed}:${namespace}:${counter}`).slice(0, 12), 16);
    counter += 1;
    return value / 0x1000000000000;
  };
};

const selectActors = (count, population, seed, namespace, strategy) => {
  const random = makeDeterministicSelector(seed, namespace);
  const selected = [];
  for (let actor = 0; actor < population; actor += 1) {
    if (strategy === 'population-sample') {
      selected.push({ actor, rank: random() });
    } else if (random() < count / population) {
      selected.push({ actor, rank: random() });
    }
  }
  if (strategy === 'population-sample') {
    return selected
      .sort((left, right) => left.rank - right.rank)
      .slice(0, count)
      .map(({ actor }) => actor);
  }
  return selected.map(({ actor }) => actor);
};

const selectFromCandidates = (count, candidates, seed, namespace) => {
  const random = makeDeterministicSelector(seed, namespace);
  return candidates.map((actor) => ({ actor, rank: random() }))
    .sort((left, right) => left.rank - right.rank)
    .slice(0, Math.min(count, candidates.length))
    .map(({ actor }) => actor);
};

const createScenario = (manifest, web3) => {
  const { configuration, population, seed, paddingConfig } = manifest;
  const label = configuration.label;
  const randomChoice = makeDeterministicSelector(seed, 'choice');
  const panicActors = configuration.panicCredentials
    ? new Set(selectActors(
      Math.round(population * manifest.panicRatePercent / 100),
      population,
      seed,
      'panic',
      'population-sample'
    ))
    : new Set();
  const revoteActors = configuration.revoting
    ? new Set(selectFromCandidates(
      Math.round(population * manifest.revoteRatePercent / 100),
      Array.from({ length: population }, (_, actor) => actor)
        .filter((actor) => !panicActors.has(actor)),
      seed,
      'revote'
    ))
    : new Set();
  const actorPlans = Array.from({ length: population }, (_, actor) => ({
    actor,
    commits: [],
    reveals: []
  }));
  const ballots = new Map();
  const registrarActions = [];
  let paddingOrdinal = 0;
  const paddingActions = configuration.padding
    ? Math.max(1, Math.round(
      population * paddingConfig.paddingRatePercent / 100
    ) * paddingConfig.dummyTransactionsPerBallot *
      (label === 'C1p' ? 2 : 1))
    : 1;
  const paddingRandom = makeDeterministicSelector(seed, 'padding-timing');
  const schedulePaddingAction = () => {
    const ordinal = paddingOrdinal;
    paddingOrdinal += 1;
    const windowMilliseconds = paddingConfig.timingWindowSeconds * 1000;
    if (paddingConfig.timingDistribution === 'immediate' || windowMilliseconds === 0) return 0;
    if (paddingConfig.timingDistribution === 'fixed') {
      return Math.floor(windowMilliseconds * ordinal / Math.max(1, paddingActions - 1));
    }
    const sample = paddingRandom();
    if (paddingConfig.timingDistribution === 'exponential') {
      return Math.min(windowMilliseconds, Math.floor(-Math.log(1 - sample) * windowMilliseconds / 5));
    }
    return Math.floor(sample * windowMilliseconds);
  };

  const addBallot = ({
    actor,
    credential,
    sequence,
    activity,
    reveal,
    dummy = false,
    delayMs = 0,
    registrarGenerated = false
  }) => {
    const nullifier = `0x${digest(`${seed}:${label}:${actor}:${credential}:nullifier`)}`;
    const ballotId = `0x${digest(`${seed}:${label}:${actor}:${credential}:${sequence}:ballot`)}`;
    const salt = `0x${digest(`${seed}:${label}:${actor}:${credential}:${sequence}:salt`)}`;
    const choice = Math.floor(randomChoice() * 2);
    const commitment = web3.utils.keccak256(web3.eth.abi.encodeParameters(
      ['bytes32', 'bytes32', 'uint32', 'bytes32'],
      [manifest.electionId, nullifier, choice, salt]
    ));
    const ballot = {
      actor,
      ballotId,
      nullifier,
      sequence,
      salt,
      choice,
      commitment,
      activity,
      reveal,
      dummy,
      delayMs
    };
    if (registrarGenerated) registrarActions.push(ballot);
    else actorPlans[actor].commits.push(ballot);
    if (reveal) actorPlans[actor].reveals.push(ballot);
    ballots.set(ballotId, ballot);
    return ballot;
  };

  for (let actor = 0; actor < population; actor += 1) {
    if (panicActors.has(actor)) {
      addBallot({
        actor,
        credential: 'panic',
        sequence: 1,
        activity: 'panic',
        reveal: false
      });
      continue;
    }

    const initial = addBallot({
      actor,
      credential: 'real',
      sequence: 1,
      activity: 'ordinary',
      reveal: false
    });
    let finalBallot = initial;
    if (revoteActors.has(actor)) {
      finalBallot = addBallot({
        actor,
        credential: 'real',
        sequence: 2,
        activity: 'revote',
        reveal: false
      });
    }
    finalBallot.reveal = true;
    actorPlans[actor].reveals.push(finalBallot);
  }

  let paddingActors = [];
  if (configuration.padding) {
    const targetCount = Math.round(
      population * paddingConfig.paddingRatePercent / 100
    );
    paddingActors = selectActors(
      targetCount,
      population,
      seed,
      'padding',
      paddingConfig.selectionStrategy
    );
    paddingActors.forEach((actor, selectedIndex) => {
      for (let copy = 0; copy < paddingConfig.dummyTransactionsPerBallot; copy += 1) {
        const credential = `padding-${selectedIndex}-${copy}`;
        if (label === 'C1p') {
          addBallot({
            actor,
            credential,
            sequence: 1,
            activity: 'padding',
            reveal: false,
              dummy: true,
              delayMs: schedulePaddingAction()
            });
          const finalBallot = addBallot({
            actor,
            credential,
            sequence: 2,
            activity: 'padding',
            reveal: false,
            dummy: true,
            delayMs: schedulePaddingAction()
          });
          finalBallot.reveal = true;
          actorPlans[actor].reveals.push(finalBallot);
        } else {
          addBallot({
            actor,
            credential: `decoy-${selectedIndex}-${copy}`,
            sequence: 1,
            activity: 'decoy',
            reveal: false,
            dummy: true,
            delayMs: schedulePaddingAction(),
            registrarGenerated: true
          });
        }
      }
    });
  }

  return {
    actorPlans,
    registrarActions,
    ballots,
    counts: {
      ordinaryVoters: population - panicActors.size,
      panicVoters: panicActors.size,
      revotingVoters: revoteActors.size,
      paddingActors: paddingActors.length,
      committedBallots: Array.from(ballots.values()).length
    }
  };
};

module.exports = { createScenario, selectActors };
