import { expect } from "chai";
import { createTransferCheckedInstruction, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import {
  CanonicalSolanaPaymentRailAdapter,
  ProviderIndependentSolanaDevnetTransport,
  RailProviderOperationError,
  ReferenceSolanaDevnetTransactionPreparer,
  authorizeCommittedDevnetSubmission,
  classifyDevnetBlockhash,
  signedTransactionDigest,
  type CanonicalSolanaPreparedSubmission,
  type SolanaDevnetPreparedTransaction,
} from "../src";
import { inspectSignedSolanaTransaction } from "../src/execution/devnetTransactionValidation";

const now = "2026-08-09T12:00:00.000Z";
const signer = Keypair.generate();
const recipient = Keypair.generate().publicKey.toBase58();
const mint = Keypair.generate().publicKey.toBase58();
const source = Keypair.generate().publicKey.toBase58();
const blockhash = Keypair.generate().publicKey.toBase58();
const command: any = {
  schemaVersion: 1, requestId: "request:test", correlationId: "correlation:test", executionId: "execution:test",
  paymentIntentId: "payment:test", transactionId: "transaction:test", requestedAt: now, actorId: "actor:test", recipientId: "recipient:test",
  amount: { asset: "USDC", units: "1", decimals: 6 }, destination: { type: "wallet", network: "solana-devnet", address: recipient },
  rail: "solana", providerIdempotencyKey: "provider:test",
};

function artifact(
  key = signer,
  override: Partial<SolanaDevnetPreparedTransaction> = {},
  instruction = createTransferCheckedInstruction(new PublicKey(source), new PublicKey(mint), new PublicKey(recipient), key.publicKey, 1n, 6),
  additionalSigners: Keypair[] = [],
): SolanaDevnetPreparedTransaction {
  const tx = new Transaction({ feePayer: key.publicKey, recentBlockhash: blockhash }).add(instruction);
  tx.sign(key, ...additionalSigners);
  const signedTransactionBase64 = tx.serialize().toString("base64");
  const inspected = inspectSignedSolanaTransaction(signedTransactionBase64);
  return Object.freeze({ signature: inspected.signature, signedTransactionBase64, signedTransactionDigest: inspected.signedTransactionDigest, cluster: "solana-devnet", mint, rawAmount: "1", destination: recipient, sourceTokenAccount: source, decimals: 6, recentBlockhash: blockhash, lastValidBlockHeight: "100", signerKeyId: "kms-key", signerKeyVersion: "1", signerPublicKey: key.publicKey.toBase58(), policyHash: "policy-hash", submissionProviderId: "submit-rpc", reconciliationProviderId: "reconcile-rpc", ...override });
}

function prepared(value = artifact()): CanonicalSolanaPreparedSubmission {
  return { schemaVersion: 1, contractVersion: 1, rail: "solana", executionId: "execution:test" as any, providerIdempotencyKey: "provider:test" as any, payload: { ...value } };
}

function committed(value = prepared()): CanonicalSolanaPreparedSubmission {
  return authorizeCommittedDevnetSubmission(value, { state: "SUBMISSION_COMMITTED_RECONCILE_ONLY", commitmentId: "commit:1", executionId: value.executionId, signature: value.payload.signature, signedTransactionDigest: value.payload.signedTransactionDigest!, committedAt: now });
}

function transport(submit: (bytes: Uint8Array) => Promise<any>, observe = async (_signature: string): Promise<any> => ({ status: "missing", observedAt: now }), preparedArtifact = artifact()) {
  return new ProviderIndependentSolanaDevnetTransport(
    { prepare: async () => preparedArtifact },
    { identity: { providerId: "submit-rpc", network: "devnet", role: "submission" }, submitExactSignedTransaction: submit },
    { identity: { providerId: "reconcile-rpc", network: "devnet", role: "reconciliation" }, observeSignature: observe },
  );
}

describe("provider-independent Solana Devnet transport", () => {
  it("rejects malformed/empty/non-transaction bytes as reconciliation-only after commitment", async () => {
    for (const signedTransactionBase64 of ["", "eA", "!!!!", Buffer.from("not-a-solana-transaction").toString("base64")]) {
      let error: unknown; try { await transport(async () => ({})).submitTransaction(committed(prepared(artifact(signer, { signedTransactionBase64 })))); } catch (caught) { error = caught; }
      expect(error).to.be.instanceOf(RailProviderOperationError); expect((error as RailProviderOperationError).providerContact).to.equal("may_have_occurred");
    }
    let error: unknown; try { await transport(async () => ({})).submitTransaction(prepared()); } catch (caught) { error = caught; }
    expect((error as Error).message).to.include("durable reconciliation-only commitment"); expect((error as RailProviderOperationError).providerContact).to.equal("not_started");
  });

  it("validates signature, signer metadata, digest, and provider identities before contact", async () => {
    for (const changed of [{ signature: "wrong" }, { signerPublicKey: Keypair.generate().publicKey.toBase58() }, { signedTransactionDigest: "0".repeat(64) }, { recentBlockhash: Keypair.generate().publicKey.toBase58() }, { submissionProviderId: "other" }]) {
      let calls = 0, error: unknown;
      const value = prepared(artifact(signer, changed));
      try { await transport(async () => { calls++; return {}; }).submitTransaction(committed(value)); } catch (caught) { error = caught; }
      expect(calls).to.equal(0); expect(error).to.be.instanceOf(RailProviderOperationError); expect((error as RailProviderOperationError).providerContact).to.equal("may_have_occurred");
    }
  });

  it("rejects signed transactions whose economic instruction differs from prepared metadata", async () => {
    const other = () => Keypair.generate().publicKey;
    const authority = Keypair.generate();
    const cases = [
      artifact(signer, {}, SystemProgram.transfer({ fromPubkey: signer.publicKey, toPubkey: new PublicKey(recipient), lamports: 1 })),
      artifact(signer, {}, createTransferCheckedInstruction(new PublicKey(source), other(), new PublicKey(recipient), signer.publicKey, 1n, 6)),
      artifact(signer, {}, createTransferCheckedInstruction(new PublicKey(source), new PublicKey(mint), other(), signer.publicKey, 1n, 6)),
      artifact(signer, {}, createTransferCheckedInstruction(other(), new PublicKey(mint), new PublicKey(recipient), signer.publicKey, 1n, 6)),
      artifact(signer, {}, createTransferCheckedInstruction(new PublicKey(source), new PublicKey(mint), new PublicKey(recipient), authority.publicKey, 1n, 6), [authority]),
      artifact(signer, {}, createTransferCheckedInstruction(new PublicKey(source), new PublicKey(mint), new PublicKey(recipient), signer.publicKey, 2n, 6)),
      artifact(signer, {}, createTransferCheckedInstruction(new PublicKey(source), new PublicKey(mint), new PublicKey(recipient), signer.publicKey, 1n, 5)),
      artifact(signer, {}, new TransactionInstruction({ ...createTransferCheckedInstruction(new PublicKey(source), new PublicKey(mint), new PublicKey(recipient), signer.publicKey, 1n, 6), programId: SystemProgram.programId })),
    ];
    const extra = createTransferCheckedInstruction(new PublicKey(source), new PublicKey(mint), new PublicKey(recipient), signer.publicKey, 1n, 6);
    const extraTx = new Transaction({ feePayer: signer.publicKey, recentBlockhash: blockhash }).add(extra, SystemProgram.transfer({ fromPubkey: signer.publicKey, toPubkey: other(), lamports: 1 }));
    extraTx.sign(signer);
    const extraBase64 = extraTx.serialize().toString("base64");
    const extraInspected = inspectSignedSolanaTransaction(extraBase64);
    cases.push(artifact(signer, { signedTransactionBase64: extraBase64, signature: extraInspected.signature, signedTransactionDigest: extraInspected.signedTransactionDigest }));
    for (const value of cases) {
      let rejected = false;
      try { await transport(async () => ({}), undefined, value).prepareTransaction(command); } catch { rejected = true; }
      expect(rejected).to.equal(true);
    }
  });

  it("cryptographically rejects tampered, invalid, and missing signatures", () => {
    const valid = artifact();
    expect(inspectSignedSolanaTransaction(valid.signedTransactionBase64).signature).to.equal(valid.signature);
    const tamperedMessage = Transaction.from(Buffer.from(valid.signedTransactionBase64, "base64"));
    tamperedMessage.recentBlockhash = Keypair.generate().publicKey.toBase58();
    const tamperedMessageBase64 = tamperedMessage.serialize({ requireAllSignatures: false, verifySignatures: false }).toString("base64");
    expect(() => inspectSignedSolanaTransaction(tamperedMessageBase64)).to.throw();
    const tamperedSignature = Buffer.from(valid.signedTransactionBase64, "base64");
    tamperedSignature[1] ^= 1;
    expect(() => inspectSignedSolanaTransaction(tamperedSignature.toString("base64"))).to.throw();
    const missing = Transaction.from(Buffer.from(valid.signedTransactionBase64, "base64"));
    missing.signatures[0].signature = Buffer.alloc(64);
    expect(() => inspectSignedSolanaTransaction(missing.serialize({ requireAllSignatures: false, verifySignatures: false }).toString("base64"))).to.throw();
  });

  it("cryptographically verifies required signatures on versioned envelopes", () => {
    const message = new TransactionMessage({ payerKey: signer.publicKey, recentBlockhash: blockhash, instructions: [SystemProgram.transfer({ fromPubkey: signer.publicKey, toPubkey: Keypair.generate().publicKey, lamports: 1 })] }).compileToV0Message();
    const transaction = new VersionedTransaction(message);
    transaction.sign([signer]);
    expect(inspectSignedSolanaTransaction(Buffer.from(transaction.serialize()).toString("base64")).signerPublicKey).to.equal(signer.publicKey.toBase58());
    transaction.signatures[0][0] ^= 1;
    expect(() => inspectSignedSolanaTransaction(Buffer.from(transaction.serialize()).toString("base64"))).to.throw();
  });

  it("submits the exact persisted bytes and emits required provider evidence", async () => {
    const value = artifact(); let actual: Uint8Array | undefined;
    const rail = transport(async (bytes) => { actual = bytes; return { signature: value.signature, acceptedAt: now }; }, async (signature) => { expect(signature).to.equal(value.signature); return { status: "settled", observedAt: now, settledAt: now, slot: "9", confirmationStatus: "confirmed" }; }, value);
    const adapter = new CanonicalSolanaPaymentRailAdapter(rail);
    const submission = await adapter.submit(committed(prepared(value)), { schemaVersion: 1, requestId: "request:test", correlationId: "correlation:test", attemptId: "attempt:test", executionId: "execution:test", providerIdempotencyKey: "provider:test", invokedAt: now } as any);
    expect(Buffer.from(actual!).equals(Buffer.from(value.signedTransactionBase64, "base64"))).to.equal(true);
    expect((submission as any).evidence.data.submissionProviderId).to.equal("submit-rpc");
    const reconciliation = await adapter.reconcile({ schemaVersion: 1, executionId: "execution:test", rail: "solana", providerIdempotencyKey: "provider:test", reconciliationReference: `solana:${value.signature}` } as any, {} as any);
    expect((reconciliation as any).evidence.data.reconciliationProviderId).to.equal("reconcile-rpc");
  });

  it("treats every exception after crossing the RPC boundary as ambiguous", async () => {
    for (const error of [new Error("response lost"), new RailProviderOperationError("provider claimed preflight", "not_started")]) {
      let caught: unknown; try { await transport(async () => { throw error; }).submitTransaction(committed()); } catch (value) { caught = value; }
      expect((caught as RailProviderOperationError).providerContact).to.equal("may_have_occurred");
    }
  });

  it("rejects provider-role aliasing and preserves independent reconciliation", () => {
    expect(() => new ProviderIndependentSolanaDevnetTransport({ prepare: async () => artifact() }, { identity: { providerId: "same", network: "devnet", role: "submission" }, submitExactSignedTransaction: async () => ({} as any) }, { identity: { providerId: "same", network: "devnet", role: "reconciliation" }, observeSignature: async () => ({} as any) })).to.throw("independent");
  });

  it("requires non-empty trimmed and distinct provider identities", () => {
    const make = (submissionId: unknown, reconciliationId: unknown) => new ProviderIndependentSolanaDevnetTransport(
      { prepare: async () => artifact() },
      { identity: { providerId: submissionId, network: "devnet", role: "submission" }, submitExactSignedTransaction: async () => ({} as any) } as any,
      { identity: { providerId: reconciliationId, network: "devnet", role: "reconciliation" }, observeSignature: async () => ({} as any) } as any,
    );
    for (const [submissionId, reconciliationId] of [["", "reconcile"], [" ", "reconcile"], ["submit", ""], ["submit", "\t"], ["same", "same"]]) expect(() => make(submissionId, reconciliationId)).to.throw();
    expect(() => make("submit", "reconcile")).not.to.throw();
  });

  it("defines blockhash expiry without regeneration or blind retry", async () => {
    expect(classifyDevnetBlockhash("PREPARED_NOT_CONTACTED", "100", "101")).to.equal("SAFE_TO_PREPARE_FRESH");
    expect(classifyDevnetBlockhash("SUBMISSION_COMMITTED_RECONCILE_ONLY", "100", "101")).to.equal("RECONCILIATION_REQUIRED");
    expect(classifyDevnetBlockhash("UNKNOWN_RECONCILIATION_REQUIRED", "100", "101")).to.equal("RECONCILIATION_REQUIRED");
    let preparations = 0;
    const value = artifact(); const rail = transport(async () => { throw new Error("ambiguous"); }, undefined, value);
    (rail as any).preparer = { prepare: async () => { preparations++; return value; } };
    try { await rail.submitTransaction(committed(prepared(value))); } catch { /* expected */ }
    expect(preparations).to.equal(0);
  });

  it("computes a deterministic digest over exact canonical bytes", () => {
    const value = artifact();
    expect(signedTransactionDigest(value.signedTransactionBase64)).to.equal(value.signedTransactionDigest);
    expect(signedTransactionDigest(value.signedTransactionBase64)).to.equal(signedTransactionDigest(value.signedTransactionBase64));
  });

  it("reference preparer composes and signs an exact SPL transaction without RPC submission", async () => {
    const referenceSource = Keypair.generate().publicKey.toBase58(); let signed = 0, blockhashCalls = 0;
    const referenceSigner = { keyId: "key", keyVersion: "v1", publicKey: signer.publicKey.toBase58(), signTransaction: async (bytes: Uint8Array) => { signed++; const tx = Transaction.from(bytes); tx.sign(signer); const base64 = tx.serialize().toString("base64"); return { signature: inspectSignedSolanaTransaction(base64).signature, signedTransactionBase64: base64 }; } };
    const preparer = new ReferenceSolanaDevnetTransactionPreparer({ cluster: "solana-devnet", asset: "USDC", mint, decimals: 6, sourceTokenAccount: referenceSource, policyHash: "policy", submissionProviderId: "submit-rpc", reconciliationProviderId: "reconcile-rpc" }, { getLatestDevnetBlockhash: async () => { blockhashCalls++; return { recentBlockhash: blockhash, lastValidBlockHeight: "100" }; } }, referenceSigner);
    const value = await preparer.prepare(command);
    expect(value.rawAmount).to.equal("1"); expect(value.destination).to.equal(recipient); expect(signed).to.equal(1); expect(blockhashCalls).to.equal(1);
  });

  it("reference preparer rejects ambiguous provider identities", () => {
    const signerAdapter = { keyId: "key", keyVersion: "v1", publicKey: signer.publicKey.toBase58(), signTransaction: async () => ({ signature: "unused", signedTransactionBase64: "unused" }) };
    const blockhashSource = { getLatestDevnetBlockhash: async () => ({ recentBlockhash: blockhash, lastValidBlockHeight: "100" }) };
    for (const [submissionProviderId, reconciliationProviderId] of [["", "reconcile"], [" submit", "reconcile"], ["submit", ""], ["submit", "reconcile "]]) {
      expect(() => new ReferenceSolanaDevnetTransactionPreparer({ cluster: "solana-devnet", asset: "USDC", mint, decimals: 6, sourceTokenAccount: source, policyHash: "policy", submissionProviderId, reconciliationProviderId }, blockhashSource, signerAdapter)).to.throw();
    }
  });
});
