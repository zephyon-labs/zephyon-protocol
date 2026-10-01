import { createHash } from "node:crypto";
import bs58 from "bs58";
import { ed25519 } from "@noble/curves/ed25519";
import { ComputeBudgetProgram, PublicKey, Transaction, TransactionInstruction } from "@solana/web3.js";
import { createAssociatedTokenAccountIdempotentInstruction, createTransferCheckedInstruction, getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { EconomicIntentEnvelopeV1, authorizationBindingDigestV1, createEconomicIntentEnvelopeV1 } from "./economicIntent";
import { SignatureCompletenessV1 } from "./authority";
import { freeze, hex, key } from "./validation";
export const SPONSORED_CLASSIC_SPL_PROFILE_V1 = "zephyon.solana-sponsored-classic-spl/v1" as const;
const MEMO_PROGRAM = new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");
export function exactMessageDigestV1(message: Uint8Array): string {
    if (!(message instanceof Uint8Array) || message.length === 0 || message.length > 1232)
        throw new Error("Invalid exact-message bytes.");
    return createHash("sha256").update("zephyon:solana-message:v1\n", "utf8").update(message).digest("hex");
}
/** Offline profile oracle only. No account lookup, blockhash fetch, signing, or submission. */
export function offlineSponsoredMessageV1(envelope: EconomicIntentEnvelopeV1, recentBlockhash: string): Uint8Array {
    const e = createEconomicIntentEnvelopeV1(envelope, envelope.amount.asset), a = e.amount.asset;
    if (e.source.mode !== "external-wallet" || e.fee.mode !== "platform-sponsor" || a.kind !== "spl-token" || a.tokenProgram !== TOKEN_PROGRAM_ID.toBase58())
        throw new Error("Unsupported sponsored transaction profile.");
    const sponsor = new PublicKey(e.fee.signer), user = new PublicKey(e.source.signer), mint = new PublicKey(a.mint), destOwner = new PublicKey(e.recipient.wallet);
    const source = getAssociatedTokenAddressSync(mint, user), dest = getAssociatedTokenAddressSync(mint, destOwner);
    if (source.toBase58() !== e.source.account || dest.toBase58() !== e.recipient.account || sponsor.equals(source) || sponsor.equals(dest))
        throw new Error("Token account identity or authority alias conflict.");
    const tx = new Transaction({ feePayer: sponsor, recentBlockhash: key(recentBlockhash) });
    tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: e.fee.computeUnitLimit }), ComputeBudgetProgram.setComputeUnitPrice({ microLamports: BigInt(e.fee.microLamportsPerUnit) }));
    if (e.fee.createDestinationAta)
        tx.add(createAssociatedTokenAccountIdempotentInstruction(sponsor, dest, destOwner, mint));
    tx.add(new TransactionInstruction({ programId: MEMO_PROGRAM, keys: [], data: Buffer.from(authorizationBindingDigestV1(e, a), "ascii") }));
    tx.add(createTransferCheckedInstruction(source, mint, dest, user, BigInt(e.amount.atomicUnits), a.decimals, [], TOKEN_PROGRAM_ID));
    const message = tx.serializeMessage();
    if (tx.compileMessage().header.numRequiredSignatures !== 2)
        throw new Error("Unexpected signer count.");
    return Uint8Array.from(message);
}
export function assertSponsoredMessageProfileV1(actual: Uint8Array, envelope: EconomicIntentEnvelopeV1, recentBlockhash: string): string {
    const expected = offlineSponsoredMessageV1(envelope, recentBlockhash);
    if (!Buffer.from(actual).equals(Buffer.from(expected)))
        throw new Error("Exact transaction profile/message mismatch.");
    return exactMessageDigestV1(actual);
}
/** Inspects verified slots; never infers submission, policy approval or human consent. */
export function inspectSponsoredSignaturesV1(serialized: Uint8Array, expectedDigest: string, userSigner: string, sponsorSigner: string): SignatureCompletenessV1 {
    const tx = Transaction.from(serialized), message = tx.serializeMessage();
    if (exactMessageDigestV1(message) !== hex(expectedDigest) || tx.signatures.length !== 2 || tx.signatures[0].publicKey.toBase58() !== key(sponsorSigner) || tx.signatures[1].publicKey.toBase58() !== key(userSigner) || sponsorSigner === userSigner || tx.feePayer?.toBase58() !== sponsorSigner)
        throw new Error("Signer/message binding mismatch.");
    for (const slot of tx.signatures)
        if (slot.signature && !ed25519.verify(slot.signature, message, slot.publicKey.toBytes()))
            throw new Error("Invalid transaction signature.");
    const sponsor = tx.signatures[0].signature, user = tx.signatures[1].signature;
    if (sponsor && !user)
        throw new Error("Sponsor signature must not precede customer authorization.");
    if (!user)
        return freeze({ state: "CUSTOMER_ABSENT_SPONSOR_ABSENT" });
    const customerSignatureDigest = createHash("sha256").update(user).digest("hex");
    if (!sponsor)
        return freeze({ state: "CUSTOMER_VERIFIED_SPONSOR_ABSENT", customerSignatureDigest });
    return freeze({ state: "FULLY_SIGNED", customerSignatureDigest, finalTransactionId: bs58.encode(sponsor) });
}
