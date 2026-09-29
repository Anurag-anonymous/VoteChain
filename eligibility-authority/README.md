# VoteChain Eligibility Authority

This is a separately deployable human-review service. It has its own reviewer
UI, process, encrypted case store, credentials, and environment configuration;
it does not connect to VoteChain's MongoDB. The VoteChain backend sends a
minimum set of applicant details over a timestamped HMAC-authenticated
integration request. A reviewer checks those details against the identity
evidence and trusted sources required by the applicable election, then records
an eligibility decision. The app does not currently upload identity documents,
so seeing verified email/phone/Aadhaar OTP flags alone is not proof of legal
identity or voting eligibility.

On approval, this service generates a random credential secret, stores it in
its encrypted case store, and sends it with the signed decision over the
authenticated callback. VoteChain validates the commitment and stores the
credential encrypted at rest; the authenticated applicant can retrieve it from
Profile. For ballot submission, the browser proves knowledge of the secret
with an election-scoped Chaum-Pedersen proof instead of putting the secret in
the ballot request. This is a prototype proof-of-possession flow, not a fully
anonymous voting protocol: VoteChain can still associate a submission with the
authenticated account and observe request and transaction metadata.

## Run

1. Run `npm run setup` once. It creates a private `.env` with random secrets
   and prints the one-time reviewer password; save that password securely.
   If an existing `.env` is missing the credential-encryption key, setup adds
   one without rotating the other secrets. The server fails closed if required
   secrets are missing or too short; it never generates replacement
   credentials during startup.
2. Copy the printed enrollment, callback, and credential-encryption keys into
   the matching VoteChain backend `.env` variables.
3. Run `npm start` and open `http://127.0.0.1:5100/` from the reviewer machine.

The matching VoteChain variables are:

| Authority service | VoteChain backend |
| --- | --- |
| `VOTECHAIN_ENROLLMENT_HMAC_SECRET` | `ELIGIBILITY_AUTHORITY_ENROLLMENT_SECRET` |
| `VOTECHAIN_CALLBACK_HMAC_SECRET` | `ELIGIBILITY_AUTHORITY_CALLBACK_SECRET` |
| `.env` and printed `ELIGIBILITY_AUTHORITY_CREDENTIAL_KEY` | `ELIGIBILITY_AUTHORITY_CREDENTIAL_KEY` |

Bind to localhost or place the service behind HTTPS and an access-controlled
network. Do not expose it directly to the public internet. The reviewer session
is an HttpOnly SameSite cookie and expires on service restart. The encrypted
case file is written under `data/cases.enc`; back it up securely.
The generated credential storage key is also required in VoteChain backend
configuration as `ELIGIBILITY_AUTHORITY_CREDENTIAL_KEY`; preserve it across
restarts, since losing it will make already-issued credentials unavailable.
Signed enrollment and callback requests are timestamp-bounded and
single-use; replayed signed requests are rejected.

The service intentionally has no default reviewer password, no public case
listing, and no document-upload endpoint. An administrator must independently
confirm the applicant using appropriate evidence before approving a case.

## Decision states

- `pending`: awaiting human review;
- `needs_info`: reviewer requires follow-up;
- `rejected`: reviewer determined the applicant is not eligible;
- `eligible`: reviewer approved; the opaque subject and credential commitment
  and the user's anonymous bearer credential are synchronized to VoteChain.

Decisions and reviewer notes are kept private in the encrypted store and are
never included in the public ballot or chain record.
