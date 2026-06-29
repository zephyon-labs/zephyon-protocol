import { randomUUID } from "crypto";
import { createParticipant, activateParticipant } from "./participant";
import { OnboardingRequest, OnboardingResult } from "./types";
import { ParticipantRegistry } from "./registry";

export function onboardParticipant(
  registry: ParticipantRegistry,
  request: OnboardingRequest
): OnboardingResult {
  const participant = activateParticipant(
    createParticipant({
      id: randomUUID(),
      displayName: request.displayName,
      type: request.participantType,
      email: request.email,
      phone: request.phone,
    })
  );

  registry.register(participant);

  return {
    participant,
    message: "Participant onboarded successfully.",
  };
}