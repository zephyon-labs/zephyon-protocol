import { initializeExample } from "../ts/client";

(async () => {
  console.log("🚀 Starting Zephyon SDK → initialize() test...");
  try {
    await initializeExample();
    console.log("✅ initialize() call completed successfully!");
  } catch (err) {
    console.error("❌ Error during initialize():", err);
  }
})();
