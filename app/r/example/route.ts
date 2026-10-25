import { handleExampleClick } from "@/lib/example-cta";

export const dynamic = "force-dynamic";

/** Tracked CTA used by the public example campaign. Example clicks are never conversions. */
export function GET(request: Request) {
  return handleExampleClick(request);
}
