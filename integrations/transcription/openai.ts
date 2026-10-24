import type { TranscriptSegment } from "@/domain/recording";

/** OpenAI's audio transcription endpoint accepts files up to 25 MB. */
export const OPENAI_TRANSCRIBE_MAX_BYTES = 25 * 1024 * 1024;

export type TranscribeResult =
  | { ok: true; segments: TranscriptSegment[]; durationMs: number | null }
  | { ok: false; code: "transcription_unavailable" | "too_large_for_transcription" | "transcription_failed"; message: string };

/**
 * Transcribes a stored recording with OpenAI (whisper-1, verbose JSON with segment timings).
 * Never throws: every failure comes back as a recoverable result the caller records.
 */
export async function transcribeWithOpenAI(
  file: Blob,
  opts: { apiKey: string | null | undefined; filename: string; fetchImpl?: typeof fetch },
): Promise<TranscribeResult> {
  if (!opts.apiKey) return { ok: false, code: "transcription_unavailable", message: "Transcription isn't configured yet (no OpenAI key)." };
  if (file.size > OPENAI_TRANSCRIBE_MAX_BYTES) return { ok: false, code: "too_large_for_transcription", message: "The file is larger than the 25 MB transcription limit." };
  const body = new FormData();
  body.append("file", file, opts.filename);
  body.append("model", "whisper-1");
  body.append("response_format", "verbose_json");
  body.append("timestamp_granularities[]", "segment");
  try {
    const res = await (opts.fetchImpl ?? fetch)("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST", headers: { Authorization: `Bearer ${opts.apiKey}` }, body, signal: AbortSignal.timeout(10 * 60 * 1000),
    });
    if (!res.ok) return { ok: false, code: "transcription_failed", message: `Transcription service returned ${res.status}.` };
    const json = (await res.json()) as { duration?: number; segments?: Array<{ start: number; end: number; text: string }> };
    const segments = (json.segments ?? [])
      .map((s) => ({ startMs: Math.round(s.start * 1000), endMs: Math.round(s.end * 1000), text: String(s.text ?? "").trim() }))
      .filter((s) => s.text && s.endMs > s.startMs);
    if (!segments.length) return { ok: false, code: "transcription_failed", message: "The transcript came back empty." };
    return { ok: true, segments, durationMs: json.duration ? Math.round(json.duration * 1000) : null };
  } catch (e) {
    return { ok: false, code: "transcription_failed", message: e instanceof Error ? e.message.slice(0, 300) : "Transcription failed." };
  }
}
