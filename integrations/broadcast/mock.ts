import type { BroadcastProvider } from "./types";

/** In-memory mock. Nothing is streamed. */
export const mockBroadcastProvider: BroadcastProvider = {
  name: "mock",
  async createEvent(input) {
    return { providerEventId: `mock-event-${input.launchId}` };
  },
  async updateEvent() {},
  async addDestination(_id, d) {
    return { providerDestinationId: `mock-dest-${d.channelType}` };
  },
  async getStatus() {
    return { status: "scheduled" };
  },
  async getRecording() {
    return { available: false };
  },
  async cancelEvent() {},
};
