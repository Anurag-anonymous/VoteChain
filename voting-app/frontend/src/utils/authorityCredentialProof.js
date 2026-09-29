/* global BigInt */

const P = BigInt('0xFFFFFFFFFFFFFFFFC90FDAA22168C234C4C6628B80DC1CD129024E088A67CC74020BBEA63B139B22514A08798E3404DDEF9519B3CD3A431B302B0A6DF25F14374FE1356D6D51C245E485B576625E7EC6F44C42E9A637ED6B0BFF5CB6F406B7EDEE386BFB5A899FA5AE9F24117C4B1FE649286651ECE45B3DC2007CB8A163BF0598DA48361C55D39A69163FA8FD24CF5F83655D23DCA3AD961C62F356208552BB9ED529077096966D670C354E4ABC9804F1746C08CA18217C32905E462E36CE3BE39E772C180E86039B2783A2EC07A28FB5C55DF06F4C52C9DE2BCBF6955817183995497CEA956AE515D2261898FA051015728E5A8AACAA68FFFFFFFFFFFFFFFF');
const Q = (P - 1n) / 2n;
const G = 2n;
const ENCODING_WIDTH = 512;

const modPow = (base, exponent, modulus) => {
  let result = 1n;
  let value = base % modulus;
  let power = exponent;
  while (power > 0n) {
    if (power & 1n) result = (result * value) % modulus;
    value = (value * value) % modulus;
    power >>= 1n;
  }
  return result;
};

const encode = (value) => value.toString(16).padStart(ENCODING_WIDTH, '0');
const sha256Hex = async (value) => {
  const digest = await window.crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
};
const hashScalar = async (label, value) => (
  BigInt(`0x${await sha256Hex(`${label}\0${value}`)}`) % Q
);

const hashToGroup = async (electionId) => {
  for (let counter = 0; counter < 256; counter += 1) {
    const digest = BigInt(`0x${await sha256Hex(
      `votechain-election-base-v1\0${electionId}\0${counter}`
    )}`);
    const candidate = digest % P;
    const element = (candidate * candidate) % P;
    if (element > 1n) return element;
  }
  throw new Error('Could not derive an election-specific proof base');
};

const nullifierFor = async (electionId, nullifierPoint) => (
  sha256Hex(`votechain-election-nullifier-v1\0${electionId}\0${encode(nullifierPoint)}`)
);

const getSecret = (credential) => {
  if (typeof credential !== 'string' || !/^[a-f\d]{1,512}$/i.test(credential)) {
    throw new Error('Anonymous credential is malformed');
  }
  const secret = BigInt(`0x${credential}`);
  if (secret <= 0n || secret >= Q) throw new Error('Anonymous credential is out of range');
  return secret;
};

const createAuthorityCredentialProof = async ({ credential, credentialCommitment, electionId }) => {
  if (!electionId) throw new Error('Election ID is required to prove credential eligibility');
  const secret = getSecret(credential);
  const commitment = BigInt(`0x${credentialCommitment}`);
  if (commitment <= 1n || commitment >= P || modPow(G, secret, P) !== commitment) {
    throw new Error('Anonymous credential does not match its registered commitment');
  }

  const randomBytes = new Uint8Array(32);
  window.crypto.getRandomValues(randomBytes);
  const randomHex = Array.from(randomBytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  const nonce = (BigInt(`0x${randomHex}`) % (Q - 1n)) + 1n;
  const electionBase = await hashToGroup(electionId);
  const nullifierPoint = modPow(electionBase, secret, P);
  const announcementG = modPow(G, nonce, P);
  const announcementElection = modPow(electionBase, nonce, P);
  const challenge = await hashScalar(
    'votechain-chaum-pedersen-challenge-v1',
    [
      electionId,
      encode(commitment),
      encode(electionBase),
      encode(nullifierPoint),
      encode(announcementG),
      encode(announcementElection)
    ].join('\0')
  );

  return {
    scheme: 'votechain-chaum-pedersen-v1',
    electionId,
    nullifier: await nullifierFor(electionId, nullifierPoint),
    nullifierPoint: encode(nullifierPoint),
    announcementG: encode(announcementG),
    announcementElection: encode(announcementElection),
    response: encode((nonce + challenge * secret) % Q)
  };
};

export default createAuthorityCredentialProof;
