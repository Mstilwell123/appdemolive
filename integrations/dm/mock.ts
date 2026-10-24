import type { DmProvider } from "./types";

/** Mock: no messages are sent or received. */
export const mockDmProvider: DmProvider = {
  name: "mock",
  async createKeywordAutomation(input) {
    return { providerAutomationId: `mock-auto-${input.ctaCampaignId}`, manual: false };
  },
  async pauseAutomation() {},
  async getEvents() {
    return [];
  },
};
