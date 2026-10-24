import "server-only";
import { toVtt } from "@/domain/content-pack";
import { AppError } from "@/domain/errors";
import { recordingComplete, type RecordingLike, type TranscriptSegment } from "@/domain/recording";
import { authorizeLaunch } from "@/services/preparation";

export async function getTranscriptVtt(launchId: string) {
  const { service } = await authorizeLaunch(launchId);
  const { data } = await service.from("launch_recordings").select("status, storage_path, transcript, updated_at")
    .eq("launch_id", launchId).eq("status", "ready").order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (!data || !recordingComplete(data as RecordingLike)) throw new AppError("NOT_FOUND", "There's no transcript yet");
  return toVtt(data.transcript as TranscriptSegment[]);
}
