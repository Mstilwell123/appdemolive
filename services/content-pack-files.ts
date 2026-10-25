import "server-only";
import { toVtt } from "@/domain/content-pack";
import { AppError } from "@/domain/errors";
import { authorizeLaunch } from "@/services/session";
import { readyRecording } from "@/services/content-pack";

export async function getTranscriptVtt(launchId: string) {
  const { db } = await authorizeLaunch(launchId);
  const rec = await readyRecording(db, launchId);
  if (!rec) throw new AppError("NOT_FOUND", "There's no transcript yet");
  return toVtt(rec.transcript);
}
