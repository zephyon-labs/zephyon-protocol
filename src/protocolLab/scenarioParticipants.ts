export type ScenarioParticipantRole =
  | "consumer"
  | "friend"
  | "creator"
  | "merchant"
  | "business"
  | "agent"
  | "service";

export type ScenarioParticipant = {
  id: string;
  name: string;
  role: ScenarioParticipantRole;
  wallet: string;
};

export const scenarioParticipants: ScenarioParticipant[] = [
  {
    id: "alice",
    name: "Alice",
    role: "consumer",
    wallet: "JAonavGn6k1esCQLYaQ2z11uzU2x4Yv7Wb7U5J95dvYb",
  },
  {
    id: "bob",
    name: "Bob",
    role: "friend",
    wallet: "8Pv9mfmGnLM5UPV7MSFzyuuKNBamcmBjCyqYgvUqgd2r",
  },
  {
    id: "luna",
    name: "Luna",
    role: "creator",
    wallet: "6q7W7EWGZs7J6nPDWrgdoRwsH9yx7efhDTwv8F7xHRhU",
  },
  {
    id: "pixel-pizza",
    name: "Pixel Pizza",
    role: "merchant",
    wallet: "HgKRi6BP9YxzTBLKCp6tBBA6Paec2xN9yeiGM5GPGwS9",
  },
  {
    id: "atlas-ai",
    name: "Atlas AI",
    role: "agent",
    wallet: "9sxVLucYywdGv4qqj4C4u9KcHo8kxtAQjq8vi2zSeNP5",
  },
];

export function getScenarioParticipant(
  id: string
): ScenarioParticipant {
  const participant = scenarioParticipants.find(
    (item) => item.id === id
  );

  if (!participant) {
    throw new Error(`Scenario participant not found: ${id}`);
  }

  return participant;
}