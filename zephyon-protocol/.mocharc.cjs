// .mocharc.cjs
const path = require("path");

process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({
  module: "CommonJS",
  moduleResolution: "Node",
  target: "ES2020",
  esModuleInterop: true,
  resolveJsonModule: true,
  skipLibCheck: true,
  types: ["node", "mocha"],
});

module.exports = {
  require: [
    "dotenv/config",
    "ts-node/register",
    "source-map-support/register",
    path.resolve(__dirname, "tests/mocha.setup.cjs"),
  ],
  // IMPORTANT: do NOT glob .ts specs automatically right now
  spec: [],               // we'll pass the entry file via CLI
  extension: ["ts","cjs"],
  timeout: 1000000,
  color: true,
  parallel: false,
};





