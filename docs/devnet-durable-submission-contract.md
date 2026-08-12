# Solana Devnet durable submission contract

This contract coordinates the Runtime, backend, signer, and independent RPC providers. Its safety invariant is: **once submission-provider contact could possibly occur, an execution is never submitted again.** Reconciliation remains enabled when new submission is disabled.

## States and monotonic contact certainty

| State | Provider-contact certainty | Permitted next work |
| --- | --- | --- |
| `PREPARING` | `NOT_STARTED` | Build and sign, without submission. |
| `PREPARED_NOT_CONTACTED` | `NOT_STARTED` | Persist the immutable artifact; replace it through a new preparation lifecycle if its blockhash expires. |
| `SUBMISSION_COMMITTED_RECONCILE_ONLY` | `MAY_HAVE_OCCURRED` | Contact the submission provider at most once, or reconcile by persisted signature. Never prepare replacement bytes for submission. |
| `ACCEPTED_PENDING` | `ACCEPTED` | Reconcile by persisted signature. |
| `SETTLED` | `ACCEPTED` | Terminal success. |
| `FAILED` | `NOT_STARTED` or authoritative chain failure | Terminal only when non-submission or chain failure is conclusive. |
| `UNKNOWN_RECONCILIATION_REQUIRED` | `MAY_HAVE_OCCURRED` | Reconcile by persisted signature; absence is not proof of non-submission. |

Contact certainty is monotonic: `NOT_STARTED -> MAY_HAVE_OCCURRED -> ACCEPTED`. Crossing the call boundary into a submission-provider implementation is `MAY_HAVE_OCCURRED`, even if it throws or the response is lost. Only validation or policy failure before that boundary may remain `NOT_STARTED`.

## Required sequence and persisted facts

1. The Runtime obtains blockhash metadata, constructs and signs exact transaction bytes, validates them, and returns a `PREPARED_NOT_CONTACTED` artifact. Preparation never submits.
2. The backend durably persists the entire immutable artifact: signature, canonical signed bytes, byte digest, cluster, mint, destination, raw amount, decimals, blockhash and expiry height, signer metadata, policy hash, execution/idempotency identity, and both provider identities.
3. In a separate durable transaction, the backend atomically commits `SUBMISSION_COMMITTED_RECONCILE_ONLY` and a commitment matching the artifact. The backend must arrange ownership so only that transition's one live caller can initiate the single submission call.
4. Only after that commit may the Runtime receive the commitment and cross the submission-provider boundary. The exact persisted bytes are sent without reconstruction.
5. From the commit onward, every crash location—including before, during, or after RPC, and before recording its response—recovers only through the persisted signature and reconciliation provider. The bytes are never submitted again.

The Runtime validates policy-owned metadata, exact bytes, commitment identity, and provider roles. The backend owns durable state, leases/ownership, atomic transitions, and at-most-one invocation. The signer owns key custody and returns a transaction signed by its declared public key; it never selects policy or providers. The submission provider accepts exact bytes and cannot authorize retries. The independently identified reconciliation provider observes only the persisted signature and supplies authoritative pending, settled, or failed evidence.

## Authority and expiry

Network (`solana-devnet`), mint, decimals, source account, policy hash, and provider identities are trusted server policy—not user input. Destination and exact raw amount originate in the validated execution command. Blockhash data originates at the configured blockhash infrastructure boundary. Signer identifiers originate at the custody boundary. These authorities are combined once in the prepared artifact and must agree with the signed transaction wherever the Runtime can inspect them.

If the blockhash expires while state is `PREPARING` or `PREPARED_NOT_CONTACTED`, non-submission is conclusive and the backend may abandon that artifact and begin a new preparation lifecycle. After the durable submission commitment, expiry never permits regeneration or resubmission. A missing signature after expiry remains reconciliation-required until backend policy obtains authoritative terminal evidence. `FAILED` is safe only before possible contact or after authoritative reconciliation reports chain failure; timeouts, transport exceptions, lost responses, and missing observations are ambiguous.
