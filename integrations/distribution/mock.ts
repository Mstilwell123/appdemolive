import type { DistributionProvider } from "./types";

/** Mock: nothing is posted anywhere. */
export const mockDistributionProvider: DistributionProvider = {
  name: "mock",
  async publish(input) {
    return { providerPublicationId: `mock-pub-${input.idempotencyKey}`, status: "queued" };
  },
  async getStatus() {
    return { status: "queued" };
  },
  async getMetrics() {
    return {};
  },
  async cancel() {},
};
