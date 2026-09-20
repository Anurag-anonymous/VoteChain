const { EligibilityAuthority } = require('../services/eligibility-authority');
const { MockCredentialProvider } = require('../services/credentials');
const { MockBallotService } = require('../services/ballots');
const { MockTallyCoordinator } = require('../services/tally');

/**
 * Protocol versions persisted on `Poll.protocolVersion`.
 *
 * - LEGACY_PLAINTEXT keeps the original prototype flow: one wallet, one vote,
 *   plaintext option stored in MongoDB. This is the default so existing API
 *   clients keep working unchanged.
 * - C0_MOCK_ENCRYPTED enables the Phase 2 research flow with the mock
 *   eligibility authority, mock credential provider, mock ballot service, and
 *   mock tally coordinator. It is a boundary, not real cryptography.
 */
const PROTOCOL_VERSIONS = Object.freeze({
  LEGACY_PLAINTEXT: 'legacy-plaintext',
  C0_MOCK_ENCRYPTED: 'c0-mock-encrypted'
});

const DEFAULT_TALLY_THRESHOLD = 1;
const RUNTIME_TRUSTEE_ID = 'backend-mock-trustee';

const createPhaseTwoProtocol = ({
  tallyThreshold = DEFAULT_TALLY_THRESHOLD,
  deterministicCredentialIds = true
} = {}) => ({
  eligibilityAuthority: new EligibilityAuthority(),
  credentialProvider: new MockCredentialProvider({ deterministicCredentialIds }),
  ballotService: new MockBallotService(),
  tallyCoordinator: new MockTallyCoordinator({ threshold: tallyThreshold })
});

const getTallyThreshold = () => {
  const parsed = Number.parseInt(process.env.RESEARCH_TALLY_THRESHOLD || '', 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : DEFAULT_TALLY_THRESHOLD;
};

let runtimeProtocol = null;

/**
 * Process-wide mock protocol used by the C0 research API path.
 *
 * The mock services keep their state in memory, so a single instance has to be
 * reused for credential, ballot, and tally calls to line up. Per-process state
 * is acceptable here because the whole path is a research boundary.
 */
const getPhaseTwoProtocol = () => {
  if (!runtimeProtocol) {
    runtimeProtocol = createPhaseTwoProtocol({ tallyThreshold: getTallyThreshold() });
  }
  return runtimeProtocol;
};

const resetPhaseTwoProtocol = () => {
  runtimeProtocol = null;
  return getPhaseTwoProtocol();
};

const isResearchProtocolEnabled = () => (
  (process.env.RESEARCH_PROTOCOL_ENABLED || 'true').toLowerCase() !== 'false'
);

const isEncryptedProtocolVersion = (protocolVersion) => (
  protocolVersion === PROTOCOL_VERSIONS.C0_MOCK_ENCRYPTED
);

module.exports = {
  PROTOCOL_VERSIONS,
  DEFAULT_TALLY_THRESHOLD,
  RUNTIME_TRUSTEE_ID,
  createPhaseTwoProtocol,
  getPhaseTwoProtocol,
  resetPhaseTwoProtocol,
  isResearchProtocolEnabled,
  isEncryptedProtocolVersion
};

