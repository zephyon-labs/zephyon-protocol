import * as anchor from "@coral-xyz/anchor";

/**
 * Fetch a transaction with retry logic to handle local validator timing quirks.
 * Returns once logs are available, or after final attempt.
 */
export async function getTxWithRetry(
  conn: anchor.web3.Connection,
  sig: string,
  tries = 12,
  delayMs = 150,
  commitment: anchor.web3.Finality = "confirmed"
) {
  for (let i = 0; i < tries; i++) {
    const tx = await conn.getTransaction(sig, {
      commitment,
      maxSupportedTransactionVersion: 0,
    });

    if (tx?.meta?.logMessages?.length) return tx;

    await new Promise((r) => setTimeout(r, delayMs));
  }

  // Final attempt (return whatever we get)
  return await conn.getTransaction(sig, {
    commitment,
    maxSupportedTransactionVersion: 0,
  });
}
