import "dotenv/config";
import cors from "cors";
import express from "express";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const app = express();

const PORT = Number(process.env.PORT || 4000);

const PROTOCOL_DIR =
  process.env.PROTOCOL_DIR || "/home/zeranova/dev/zephyon/zephyon-protocol";

const MINT =
  process.env.ZEPHIPAY_MINT || "2w2nqMemQzjwKMk3jEmtXnBqGBXGJLs8FNfb5Khb8E7J";

const ALLOWED_ORIGIN =
  process.env.ALLOWED_ORIGIN || "https://beta.zephipay.com";

app.use(
  cors({
    origin: ALLOWED_ORIGIN,
  })
);

app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    service: "zephipay-devnet-backend",
  });
});

app.post("/send", async (req, res) => {
  const { recipient, amount } = req.body || {};

  if (!recipient || !amount) {
    return res.status(400).json({
      success: false,
      error: "Recipient and amount are required.",
    });
  }

  try {
    const { stdout, stderr } = await execFileAsync(
      "npx",
      [
        "ts-node-esm",
        "scripts/pay_devnet.ts",
        MINT,
        String(recipient),
        String(amount),
      ],
      {
        cwd: PROTOCOL_DIR,
        timeout: 120000,
      }
    );

    if (stderr) {
      console.warn(stderr);
    }

    const marker = "--- JSON_RESULT ---";
    const jsonText = stdout.split(marker)[1]?.trim();

    if (!jsonText) {
      throw new Error("No JSON_RESULT found in protocol script output.");
    }

    const result = JSON.parse(jsonText);

    return res.json({
      success: true,
      signature: result.tx,
      receiptId: result.receiptPda,
      treasury: result.treasury,
      mint: result.mint,
      recipient: result.recipient,
      amountRaw: result.amountRaw,
      payCountBefore: result.payCountBefore,
      payCountAfter: result.payCountAfter,
    });
  } catch (error) {
    console.error("Devnet backend send failed:", error);

    return res.status(500).json({
      success: false,
      error: "Devnet backend send failed.",
    });
  }
});

app.listen(PORT, () => {
  console.log(`ZephiPay devnet backend listening on port ${PORT}`);
});