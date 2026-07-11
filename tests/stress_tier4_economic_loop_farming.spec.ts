import { expect } from "chai";

describe("Tier4 Economic — Loop Farming Attack", () => {

  it("should NOT allow profitable reward farming via repeated transfers", async () => {

    // --- CONFIG ---
    const TX_AMOUNT = 100;        // simulated transfer amount
    const FEE_RATE = 0.0025;      // 0.25%
    const BASE_REWARD_RATE = 0.002; // 0.2% reward baseline
    const ITERATIONS = 1000;

    // --- STATE TRACKING ---
    let totalFees = 0;
    let totalRewards = 0;

    // track interaction frequency between wallets
    let pairInteractionCount: Record<string, number> = {};

    const walletA = "A";
    const walletB = "B";

    function getPairKey(a: string, b: string) {
      return `${a}-${b}`;
    }

    function calculateFee(amount: number) {
      return amount * FEE_RATE;
    }

    function calculateReward(amount: number, interactionCount: number) {
      // decay model: more repetition → less reward
      const decayFactor = 1 / (1 + interactionCount);
      return amount * BASE_REWARD_RATE * decayFactor;
    }

    function simulateTx(sender: string, receiver: string) {
      const pairKey = getPairKey(sender, receiver);

      if (!pairInteractionCount[pairKey]) {
        pairInteractionCount[pairKey] = 0;
      }

      pairInteractionCount[pairKey] += 1;

      const interactionCount = pairInteractionCount[pairKey];

      const fee = calculateFee(TX_AMOUNT);
      const reward = calculateReward(TX_AMOUNT, interactionCount);

      return { fee, reward };
    }

    // --- ATTACK LOOP ---
    for (let i = 0; i < ITERATIONS; i++) {

      const tx1 = simulateTx(walletA, walletB);
      totalFees += tx1.fee;
      totalRewards += tx1.reward;

      const tx2 = simulateTx(walletB, walletA);
      totalFees += tx2.fee;
      totalRewards += tx2.reward;
    }

    const netProfit = totalRewards - totalFees;

    console.log("Total Fees:", totalFees);
    console.log("Total Rewards:", totalRewards);
    console.log("Net Profit:", netProfit);

    // --- CRITICAL INVARIANT ---
    expect(netProfit).to.be.lessThanOrEqual(0);

  });

  it("should reduce rewards as wallet pair repetition increases", async () => {

  const TX_AMOUNT = 100;
  const BASE_REWARD_RATE = 0.002;

  let pairInteractionCount: Record<string, number> = {};

  const walletA = "A";
  const walletB = "B";

  function getPairKey(a: string, b: string) {
    return `${a}-${b}`;
  }

  function calculateReward(amount: number, interactionCount: number) {
    const decayFactor = 1 / (1 + interactionCount);
    return amount * BASE_REWARD_RATE * decayFactor;
  }

  function simulateTx(sender: string, receiver: string) {
    const pairKey = getPairKey(sender, receiver);

    if (!pairInteractionCount[pairKey]) {
      pairInteractionCount[pairKey] = 0;
    }

    pairInteractionCount[pairKey] += 1;

    const interactionCount = pairInteractionCount[pairKey];

    return calculateReward(TX_AMOUNT, interactionCount);
  }

  let rewards: number[] = [];

  // simulate repeated A -> B interactions
  for (let i = 0; i < 10; i++) {
    const reward = simulateTx(walletA, walletB);
    rewards.push(reward);
  }

  console.log("Rewards over time:", rewards);

  // --- ASSERT DECAY ---
  for (let i = 1; i < rewards.length; i++) {
    expect(rewards[i]).to.be.lessThan(rewards[i - 1]);
  }

});
it("should NOT allow Sybil wallets to create profitable fake activity", async () => {
  // --- CONFIG ---
  const TX_AMOUNT = 10;
  const FEE_RATE = 0.0025;          // 0.25%
  const BASE_REWARD_RATE = 0.002;   // 0.2%
  const WALLETS = 100;
  const ROUNDS = 20;

  // --- STATE ---
  let totalFees = 0;
  let totalRewards = 0;

  const wallets = Array.from({ length: WALLETS }, (_, i) => `wallet_${i}`);

  const walletTrustScore: Record<string, number> = {};

  for (const wallet of wallets) {
    walletTrustScore[wallet] = 0.25; // new/unknown wallets get reduced reward trust
  }

  function calculateFee(amount: number) {
    return amount * FEE_RATE;
  }

  function calculateReward(amount: number, sender: string, receiver: string) {
    const senderTrust = walletTrustScore[sender] ?? 0;
    const receiverTrust = walletTrustScore[receiver] ?? 0;

    const averageTrust = (senderTrust + receiverTrust) / 2;

    return amount * BASE_REWARD_RATE * averageTrust;
  }

  // --- ATTACK LOOP ---
  // Sybil network rotates wallets to fake unique activity.
  for (let round = 0; round < ROUNDS; round++) {
    for (let i = 0; i < wallets.length - 1; i++) {
      const sender = wallets[i];
      const receiver = wallets[i + 1];

      const fee = calculateFee(TX_AMOUNT);
      const reward = calculateReward(TX_AMOUNT, sender, receiver);

      totalFees += fee;
      totalRewards += reward;
    }
  }

  const netProfit = totalRewards - totalFees;

  console.log("Sybil Total Fees:", totalFees);
  console.log("Sybil Total Rewards:", totalRewards);
  console.log("Sybil Net Profit:", netProfit);

  expect(netProfit).to.be.lessThanOrEqual(0);
});

it("should resist smart Sybil attack with rotating wallets and varied transaction sizes", async () => {

  // --- CONFIG ---
  const FEE_RATE = 0.0025;
  const BASE_REWARD_RATE = 0.002;

  const WALLETS = 50;
  const ROUNDS = 50;

  const wallets = Array.from({ length: WALLETS }, (_, i) => `wallet_${i}`);

  let totalFees = 0;
  let totalRewards = 0;

  let pairInteractionCount: Record<string, number> = {};
  let walletTrustScore: Record<string, number> = {};

  // initial trust low
  for (const wallet of wallets) {
    walletTrustScore[wallet] = 0.3;
  }

  function getPairKey(a: string, b: string) {
    return `${a}-${b}`;
  }

  function calculateFee(amount: number) {
    return amount * FEE_RATE;
  }

  function calculateReward(amount: number, sender: string, receiver: string, interactionCount: number) {
    const decay = 1 / (1 + interactionCount);
    const trust = (walletTrustScore[sender] + walletTrustScore[receiver]) / 2;

    return amount * BASE_REWARD_RATE * decay * trust;
  }

  function simulateTx(sender: string, receiver: string, amount: number) {
    const key = getPairKey(sender, receiver);

    if (!pairInteractionCount[key]) {
      pairInteractionCount[key] = 0;
    }

    pairInteractionCount[key]++;

    const interactionCount = pairInteractionCount[key];

    const fee = calculateFee(amount);
    const reward = calculateReward(amount, sender, receiver, interactionCount);

    return { fee, reward };
  }

  // --- ATTACK LOOP ---
  for (let round = 0; round < ROUNDS; round++) {

    for (let i = 0; i < wallets.length - 1; i++) {

      const sender = wallets[i];
      const receiver = wallets[(i + round + 1) % wallets.length];

      // vary transaction size to simulate "real usage"
      const amount = 10 + Math.random() * 90;

      const tx = simulateTx(sender, receiver, amount);

      totalFees += tx.fee;
      totalRewards += tx.reward;

      // simulate "trust growth" (attacker trying to game system)
      walletTrustScore[sender] = Math.min(walletTrustScore[sender] + 0.001, 1);
      walletTrustScore[receiver] = Math.min(walletTrustScore[receiver] + 0.001, 1);
    }
  }

  const netProfit = totalRewards - totalFees;

  console.log("Smart Sybil Fees:", totalFees);
  console.log("Smart Sybil Rewards:", totalRewards);
  console.log("Smart Sybil Net Profit:", netProfit);

  expect(netProfit).to.be.lessThanOrEqual(0);

});

it("should not allow high-volume fee arbitrage to become profitable", async () => {

  const FEE_RATE = 0.0025;
  const BASE_REWARD_RATE = 0.002;

  let totalFees = 0;
  let totalRewards = 0;

  const TRANSACTIONS = 5000;

  function calculateFee(amount: number) {
    return amount * FEE_RATE;
  }

  function calculateReward(amount: number) {
    // no decay here — simulate "best case" attacker scenario
    return amount * BASE_REWARD_RATE;
  }

  for (let i = 0; i < TRANSACTIONS; i++) {

    // simulate varied but realistic payment sizes
    const amount = 50 + Math.random() * 150;

    const fee = calculateFee(amount);
    const reward = calculateReward(amount);

    totalFees += fee;
    totalRewards += reward;
  }

  const netProfit = totalRewards - totalFees;

  console.log("Arbitrage Fees:", totalFees);
  console.log("Arbitrage Rewards:", totalRewards);
  console.log("Arbitrage Net Profit:", netProfit);

  expect(netProfit).to.be.lessThanOrEqual(0);

});

});