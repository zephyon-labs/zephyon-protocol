import { rawInitializeCall } from "../ts/raw_initialize";

(async () => {
  console.log("🚀 Zephyon RAW initialize() test starting...");
  try {
    await rawInitializeCall();
    console.log("✅ raw initialize() transaction submitted!");
  } catch (err) {
    console.error("❌ raw initialize() failed:", err);
  }
})();
