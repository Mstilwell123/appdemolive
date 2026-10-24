/** DM provider contract (PRD §63). Interface-first: the provider is chosen in Phase 4. */
export interface KeywordAutomationInput {
  launchId: string;
  ctaCampaignId: string;
  keyword: string;
  responseTemplate: string;
  trackedLinkUrl: string;
}
export interface DmEvent {
  providerEventId: string;
  keyword: string;
  channel: "instagram" | "facebook" | "other";
  receivedAt: string;
  responseSent: boolean;
}

export interface DmProvider {
  readonly name: string;
  /** Some providers can't create automations by API; those implementations return manual: true. */
  createKeywordAutomation(input: KeywordAutomationInput): Promise<{ providerAutomationId: string; manual: boolean }>;
  pauseAutomation(providerAutomationId: string): Promise<void>;
  getEvents(providerAutomationId: string, since?: string): Promise<DmEvent[]>;
}
