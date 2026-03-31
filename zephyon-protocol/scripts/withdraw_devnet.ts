import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import {
getAccount,
getAssociatedTokenAddressSync,
TOKEN_PROGRAM_ID,
ASSOCIATED_TOKEN_PROGRAM_ID
} from "@solana/spl-token";
import idl from "../target/idl/protocol.json";

const PROGRAM_ID = new PublicKey(
"BtP7rVw9sqN4pW5RuzZJ2c4576R5pJU9yRtjrRJ7b5bM"
);

const TREASURY_PDA = new PublicKey(
"CuqGCfnkHN5APYdL2UkCMYbVxXxqKrwrmWXw24WeQDbE"
);

const MINT = new PublicKey(
"87NiRNWGUibVigSNfg9A5FuRftDNVCTacyDLJTUwMn4f"
);

const USER_ATA = new PublicKey(
"3oppu6U3nt5aaT8xRWdkZqss8ZN6fQPAYRfj3vwVKgT5"
);

const AMOUNT = 1_000_000;

async function main() {

const provider = anchor.AnchorProvider.env();
anchor.setProvider(provider);

const ctorArity = (Program as any).length;
let program: any;

if (ctorArity >= 3) {
program = new (Program as any)(idl, PROGRAM_ID, provider);
} else {
const idlWithMetadata = {
...(idl as any),
metadata: {
...((idl as any).metadata ?? {}),
address: PROGRAM_ID.toBase58(),
},
};
program = new (Program as any)(idlWithMetadata, provider);
}

const treasuryAta = getAssociatedTokenAddressSync(
MINT,
TREASURY_PDA,
true,
TOKEN_PROGRAM_ID,
ASSOCIATED_TOKEN_PROGRAM_ID
);

console.log("Treasury ATA:", treasuryAta.toBase58());
console.log("User ATA:", USER_ATA.toBase58());

const treasuryBefore = await getAccount(provider.connection, treasuryAta);
const userBefore = await getAccount(provider.connection, USER_ATA);

console.log("Treasury before:", treasuryBefore.amount.toString());
console.log("User before:", userBefore.amount.toString());

const tx = await program.methods
.splWithdraw(new anchor.BN(AMOUNT))
.accounts({
treasuryAuthority: provider.wallet.publicKey,
user: provider.wallet.publicKey,
treasury: TREASURY_PDA,
mint: MINT,
userAta: USER_ATA,
treasuryAta: treasuryAta,
tokenProgram: TOKEN_PROGRAM_ID,
associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
systemProgram: anchor.web3.SystemProgram.programId,
rent: anchor.web3.SYSVAR_RENT_PUBKEY,
})
.rpc();

console.log("Withdraw TX:", tx);

const treasuryAfter = await getAccount(provider.connection, treasuryAta);
const userAfter = await getAccount(provider.connection, USER_ATA);

console.log("Treasury after:", treasuryAfter.amount.toString());
console.log("User after:", userAfter.amount.toString());
}

main().catch((err) => {
console.error("withdraw_devnet failed:");
console.error(err);
process.exit(1);
});
