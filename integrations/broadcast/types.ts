/** BroadcastProvider contract (PRD §69). Provider IDs live in integration records, never on the Launch. */
export interface BroadcastEventInput {
  launchId: string;
  title: string;
  scheduledAt: string;
  durationMinutes: number;
}
export type BroadcastStatus = "scheduled" | "live" | "ended" | "cancelled" | "error";

export interface BroadcastProvider {
  readonly name: string;
  createEvent(input: BroadcastEventInput): Promise<{ providerEventId: string }>;
  updateEvent(providerEventId: string, input: Partial<BroadcastEventInput>): Promise<void>;
  addDestination(providerEventId: string, destination: { channelType: string; displayName: string }): Promise<{ providerDestinationId: string }>;
  getStatus(providerEventId: string): Promise<{ status: BroadcastStatus; startedAt?: string; endedAt?: string }>;
  getRecording(providerEventId: string): Promise<{ available: boolean; downloadUrl?: string; durationSeconds?: number }>;
  cancelEvent(providerEventId: string): Promise<void>;
}
