import { describe, expect, it, vi } from "vitest";
import { canMoveRecording, captureAllowed, parseVtt, recordingComplete, recordingGuidance, safeObjectName, uploadInterrupted, validateUpload } from "@/domain/recording";
import { OPENAI_TRANSCRIBE_MAX_BYTES, transcribeWithOpenAI } from "@/integrations/transcription/openai";

const base = { storage_path: "o/l/x.mp4", transcript: [{ startMs: 0, endMs: 1000, text: "hi" }], updated_at: new Date().toISOString() };

describe("recording state", () => {
  it("is complete only when ready with a stored file and a transcript", () => {
    expect(recordingComplete({ ...base, status: "ready" })).toBe(true);
    expect(recordingComplete({ ...base, status: "ready", transcript: [] })).toBe(false);
    expect(recordingComplete({ ...base, status: "ready", storage_path: null })).toBe(false);
    expect(recordingComplete({ ...base, status: "uploaded" })).toBe(false);
  });
  it("never jumps from uploading straight to ready, and failures are retryable", () => {
    expect(canMoveRecording("uploading", "ready")).toBe(false);
    expect(canMoveRecording("ready", "failed")).toBe(false);
    expect(canMoveRecording("failed", "transcribing")).toBe(true);
    expect(canMoveRecording("failed", "uploading")).toBe(true);
  });
  it("detects interrupted uploads and offers recovery", () => {
    const old = { ...base, status: "uploading" as const, storage_path: null, transcript: null, updated_at: new Date(Date.now() - 31 * 60 * 1000).toISOString() };
    expect(uploadInterrupted(old)).toBe(true);
    expect(recordingGuidance(old).label).toBe("Upload interrupted");
    const g = recordingGuidance({ ...base, status: "failed", failure_code: "transcription_unavailable" });
    expect(g.recovery.map((r) => r.who)).toEqual(["operator", "founder"]);
  });
});

describe("capture rules", () => {
  it("requires consent items before capture", () => {
    expect(captureAllowed(["walkthrough"])).toBe(false);
    expect(captureAllowed(["clean_account", "screen_permission"])).toBe(true);
  });
  it("validates uploads and sanitizes names", () => {
    expect(validateUpload({ name: "a.mp4", type: "video/mp4", size: 10 })).toBeNull();
    expect(validateUpload({ name: "a.exe", type: "application/x-msdownload", size: 10 })).toMatch(/Upload/);
    expect(validateUpload({ name: "a.mp4", type: "video/mp4", size: 3 * 1024 ** 3 })).toMatch(/2 GB/);
    expect(safeObjectName("../My Demo (final).mp4")).toBe("My-Demo-final-.mp4");
  });
  it("parses WebVTT and ignores junk", () => {
    const segs = parseVtt("WEBVTT\n\n1\n00:00:01.000 --> 00:00:04.500\nHello <b>there</b>\n\n00:05.000 --> 00:07.000\nSecond\n\nbad --> cue\nx");
    expect(segs).toEqual([{ startMs: 1000, endMs: 4500, text: "Hello there" }, { startMs: 5000, endMs: 7000, text: "Second" }]);
    expect(parseVtt("nothing here")).toEqual([]);
  });
});

describe("OpenAI transcription adapter", () => {
  const blob = new Blob(["x"], { type: "audio/mpeg" });
  it("reports unavailable without a key, and too large over 25 MB, without calling out", async () => {
    const f = vi.fn();
    expect(await transcribeWithOpenAI(blob, { apiKey: "", filename: "a.mp3", fetchImpl: f })).toMatchObject({ ok: false, code: "transcription_unavailable" });
    const big = { size: OPENAI_TRANSCRIBE_MAX_BYTES + 1 } as Blob;
    expect(await transcribeWithOpenAI(big, { apiKey: "k", filename: "a.mp3", fetchImpl: f })).toMatchObject({ ok: false, code: "too_large_for_transcription" });
    expect(f).not.toHaveBeenCalled();
  });
  it("maps segments, and turns HTTP errors and exceptions into recoverable failures", async () => {
    const ok = vi.fn(async () => new Response(JSON.stringify({ duration: 3.2, segments: [{ start: 0, end: 1.5, text: " Hi " }, { start: 2, end: 2, text: "skip" }] })));
    expect(await transcribeWithOpenAI(blob, { apiKey: "k", filename: "a.mp3", fetchImpl: ok as unknown as typeof fetch })).toEqual({ ok: true, segments: [{ startMs: 0, endMs: 1500, text: "Hi" }], durationMs: 3200 });
    const bad = vi.fn(async () => new Response("no", { status: 500 }));
    expect(await transcribeWithOpenAI(blob, { apiKey: "k", filename: "a.mp3", fetchImpl: bad as unknown as typeof fetch })).toMatchObject({ ok: false, code: "transcription_failed" });
    const boom = vi.fn(async () => { throw new Error("network"); });
    expect(await transcribeWithOpenAI(blob, { apiKey: "k", filename: "a.mp3", fetchImpl: boom as unknown as typeof fetch })).toMatchObject({ ok: false, code: "transcription_failed" });
  });
});
