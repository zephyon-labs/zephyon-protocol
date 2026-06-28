import { Participant } from "./types";

export class ParticipantRegistry {
  private participants = new Map<string, Participant>();

  register(participant: Participant): void {
    this.participants.set(participant.id, participant);
  }

  getById(id: string): Participant | undefined {
    return this.participants.get(id);
  }

  exists(id: string): boolean {
    return this.participants.has(id);
  }

  update(participant: Participant): void {
    this.participants.set(participant.id, participant);
  }

  remove(id: string): boolean {
    return this.participants.delete(id);
  }

  list(): Participant[] {
    return [...this.participants.values()];
  }

  count(): number {
    return this.participants.size;
  }

  clear(): void {
    this.participants.clear();
  }
}