import { AppError } from "@/domain/errors";
import type { BillingService, LaunchPrice } from "./types";

/** Launch prices from the PRD (§12). Configurable later via a launch_prices table. */
export const DEFAULT_LAUNCH_PRICES: LaunchPrice[] = [
  { launchType: "founder_demo", amount: 49900, currency: "usd", label: "Founder Demo" },
  { launchType: "cohosted_launch", amount: 79900, currency: "usd", label: "Co-Hosted Launch Show" },
];

/** Mock: shows prices, never takes money, and rejects every webhook. */
export const mockBillingService: BillingService = {
  name: "mock",
  async getLaunchPrices() {
    return DEFAULT_LAUNCH_PRICES;
  },
  async createLaunchCheckout() {
    throw new AppError("PROVIDER_UNAVAILABLE", "Payments are not connected yet");
  },
  async verifyWebhook() {
    throw new AppError("PROVIDER_UNAVAILABLE", "Payments are not connected yet");
  },
};
