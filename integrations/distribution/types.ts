/** DistributionProvider contract (PRD §76). Founder-owned auto-publishing is not in V1. */
export interface PublishInput {
  idempotencyKey: string;
  contentVariantId: string;
  destination: string;
  mediaUrl: string;
  caption: string;
  scheduledAt?: string;
}
export type PublicationStatus = "queued" | "published" | "failed" | "cancelled";

export interface DistributionProvider {
  readonly name: string;
  publish(input: PublishInput): Promise<{ providerPublicationId: string; status: PublicationStatus }>;
  getStatus(providerPublicationId: string): Promise<{ status: PublicationStatus; publishedAt?: string; error?: string }>;
  getMetrics(providerPublicationId: string): Promise<{ impressions?: number; views?: number; clicks?: number }>;
  cancel?(providerPublicationId: string): Promise<void>;
}
