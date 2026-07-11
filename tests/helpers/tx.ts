import * as anchor from "@coral-xyz/anchor";

export type TxRetryOpts = {
  commitment?: anchor.web3.Commitment; // NOT Finality
  maxSupportedTransactionVersion?: number;
  tries?: number;
  delayMs?: number;
  requireLogs?: boolean;
};

export async function getTxWithRetry(
  conn: anchor.web3.Connection,
  sig: string,
  opts: TxRetryOpts = {}
) {
  const commitment = opts.commitment ?? "confirmed";
  const maxSupportedTransactionVersion = opts.maxSupportedTransactionVersion ?? 0;
  const tries = opts.tries ?? 12;
  const delayMs = opts.delayMs ?? 150;
  const requireLogs = opts.requireLogs ?? false;

  for (let i = 0; i < tries; i++) {
    const tx = await conn.getTransaction(sig, {
      commitment,
      maxSupportedTransactionVersion,
    } as any);

    if (tx) {
      if (!requireLogs) return tx;
      if (tx.meta?.logMessages?.length) return tx;
    }

    await new Promise((r) => setTimeout(r, delayMs));
  }

  return await conn.getTransaction(sig, {
    commitment,
    maxSupportedTransactionVersion,
  } as any);
}

