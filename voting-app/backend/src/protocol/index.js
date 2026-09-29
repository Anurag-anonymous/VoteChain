const { EligibilityAuthority } = require('../services/eligibility-authority');
const {
  ElectionCredentialProvider,
  JcjCivitasCredentialProvider
} = require('../services/credentials');
const { EncryptedBallotService } = require('../services/ballots');
const {
  DevelopmentTallyCoordinator,
  ThresholdTallyCoordinator,
  SingleTrusteeTallyCoordinator
} = require('../services/tally');
const PrivateCredentialRegistry = require('../services/credentials/PrivateCredentialRegistry');

/**
 * Protocol versions persisted on `Poll.protocolVersion`.
 *
 * - LEGACY_PLAINTEXT keeps the original prototype flow.
 * - C0_ENCRYPTED enables the C0 baseline with election-scoped credentials and
 *   randomized AES-256-GCM ballot encryption. The tally coordinator remains a
 *   single-process development coordinator until trustee infrastructure lands.
 */
const PROTOCOL_VERSIONS = Object.freeze({
  LEGACY_PLAINTEXT: 'legacy-plaintext',
  C0_ENCRYPTED: 'c0-encrypted',
  C1P_PADDED: 'c1p-revoting-padding',
  C2_ENCRYPTED: 'c2-private-decoy',
  C2P_PADDED: 'c2p-private-decoy-padding',
  C3_ENCRYPTED: 'c3-revoting-decoy',
  C0_MOCK_ENCRYPTED: 'c0-mock-encrypted'
});

const CANONICAL_ENCRYPTED_PROTOCOL = PROTOCOL_VERSIONS.C0_ENCRYPTED;
const DEFAULT_TALLY_THRESHOLD = 1;
const RUNTIME_TRUSTEE_ID = 'backend-development-trustee';

const createC0Protocol = ({
  tallyThreshold = DEFAULT_TALLY_THRESHOLD,
} = {}) => ({
  eligibilityAuthority: new EligibilityAuthority(),
  credentialProvider: process.env.NODE_ENV === 'production'
    ? new JcjCivitasCredentialProvider()
    : new ElectionCredentialProvider(),
  privateCredentialRegistry: new PrivateCredentialRegistry(),
  ballotService: new EncryptedBallotService(),
  tallyCoordinator: process.env.RESEARCH_TALLY_MODE === 'threshold-3-of-5'
    ? new ThresholdTallyCoordinator()
    : (process.env.NODE_ENV === 'production'
      ? new SingleTrusteeTallyCoordinator()
      : new DevelopmentTallyCoordinator({ threshold: tallyThreshold }))
});

const createPhaseTwoProtocol = createC0Protocol;

const getTallyThreshold = () => {
  const parsed = Number.parseInt(process.env.RESEARCH_TALLY_THRESHOLD || '', 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : DEFAULT_TALLY_THRESHOLD;
};

let runtimeProtocol = null;

/**
 * Process-wide C0 protocol used by the encrypted ballot API path.
 *
 * The service objects keep revocation/trustee state in memory, so a single instance has to be
 * reused for credential, ballot, and tally calls to line up. Per-process state
 * is acceptable for the current single-backend development deployment.
 */
const getC0Protocol = () => {
  if (!runtimeProtocol) {
    runtimeProtocol = createC0Protocol({ tallyThreshold: getTallyThreshold() });
  }
  return runtimeProtocol;
};

const resetC0Protocol = () => {
  runtimeProtocol = null;
  return getC0Protocol();
};

const isC0ProtocolEnabled = () => {
  const configuredValue = process.env.C0_PROTOCOL_ENABLED ?? process.env.RESEARCH_PROTOCOL_ENABLED ?? 'true';
  return configuredValue.toLowerCase() !== 'false';
};

const getPhaseTwoProtocol = getC0Protocol;
const resetPhaseTwoProtocol = resetC0Protocol;
const isResearchProtocolEnabled = isC0ProtocolEnabled;

const isEncryptedProtocolVersion = (protocolVersion) => (
  protocolVersion === PROTOCOL_VERSIONS.C0_ENCRYPTED ||
  protocolVersion === PROTOCOL_VERSIONS.C1P_PADDED ||
  protocolVersion === PROTOCOL_VERSIONS.C2_ENCRYPTED ||
  protocolVersion === PROTOCOL_VERSIONS.C2P_PADDED ||
  protocolVersion === PROTOCOL_VERSIONS.C3_ENCRYPTED ||
  protocolVersion === PROTOCOL_VERSIONS.C0_MOCK_ENCRYPTED
);

const isProductionProtocolVersion = (protocolVersion) => (
  protocolVersion === PROTOCOL_VERSIONS.C0_ENCRYPTED ||
  protocolVersion === PROTOCOL_VERSIONS.C1P_PADDED ||
  protocolVersion === PROTOCOL_VERSIONS.C2_ENCRYPTED ||
  protocolVersion === PROTOCOL_VERSIONS.C2P_PADDED ||
  protocolVersion === PROTOCOL_VERSIONS.C3_ENCRYPTED
);

const usesPanicCredentials = (protocolVersion) => (
  protocolVersion === PROTOCOL_VERSIONS.C2_ENCRYPTED ||
  protocolVersion === PROTOCOL_VERSIONS.C2P_PADDED ||
  protocolVersion === PROTOCOL_VERSIONS.C3_ENCRYPTED
);

const usesPaddedActivity = (protocolVersion) => (
  protocolVersion === PROTOCOL_VERSIONS.C1P_PADDED ||
  protocolVersion === PROTOCOL_VERSIONS.C2P_PADDED
);

const usesC1Revoting = (protocolVersion) => (
  protocolVersion === PROTOCOL_VERSIONS.C1P_PADDED ||
  protocolVersion === PROTOCOL_VERSIONS.C3_ENCRYPTED ||
  (
    protocolVersion === PROTOCOL_VERSIONS.C0_ENCRYPTED &&
    process.env.C1_REVOTING_ENABLED === 'true'
  )
);

const isJcjC2Enabled = () => process.env.JCJ_CREDENTIALS_ENABLED === 'true';

const isProductionPaddingEnabled = () => (
  process.env.C3_PADDING_ENABLED === 'true' &&
  isJcjC2Enabled() &&
  process.env.SEMAPHORE_VERIFIER_ADDRESS
);

module.exports = {
  PROTOCOL_VERSIONS,
  CANONICAL_ENCRYPTED_PROTOCOL,
  DEFAULT_TALLY_THRESHOLD,
  RUNTIME_TRUSTEE_ID,
  createC0Protocol,
  createPhaseTwoProtocol,
  getC0Protocol,
  getPhaseTwoProtocol,
  resetC0Protocol,
  resetPhaseTwoProtocol,
  isC0ProtocolEnabled,
  isResearchProtocolEnabled,
  isEncryptedProtocolVersion,
  isProductionProtocolVersion,
  usesPanicCredentials,
  usesPaddedActivity,
  usesC1Revoting,
  isJcjC2Enabled,
  isProductionPaddingEnabled
};
