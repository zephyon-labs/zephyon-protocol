import { createParticipant, activateParticipant } from "./participant";
import {
  OnboardingRequest,
  OnboardingResult,
} from "./types";
import { ParticipantRegistry } from "./registry";

export function onboardParticipant(
  registry: ParticipantRegistry,
  request: OnboardingRequest
): OnboardingResult {
  const participant = activateParticipant(
    createParticipant({
      id: crypto.randomUUID(),
      displayName: request.displayName,
      subjectType: request.subjectType,
      email: request.email,
      phone: request.phone,
    })
  );

  registry.register(participant);

  return {
    participant,
    message: "Welcome to ZephiPay.",
  };
}