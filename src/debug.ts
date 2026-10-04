import { Recorder } from "./audio/recorder";
import { bytesToDataUri } from "./core/base64";
import { diffDictation } from "./core/diff";
import { encodeWav } from "./core/wav";
import { scoreAttempt } from "./scoring/attempt";
import { DEFAULT_ASR_MODEL, DEFAULT_BASE_URL, transcribeAudio } from "./speech/client";

/**
 * 临时调试入口，仅用于 Plan 2 Task 9 的真实接口验收。
 * 验收通过后连同 main.ts 里的调用一起删除 —— 不要留在发布版本里。
 */
let current: Recorder | undefined;

export function installDebugHook(): void {
  (window as unknown as Record<string, unknown>).echoReadDebug = {
    async start(): Promise<string> {
      current = new Recorder();
      await current.start();
      return "录音中……现在说一句英文，然后调用 stopAndTranscribe(key)";
    },

    async stopAndTranscribe(
      apiKey: string,
      expected?: string,
      baseUrl: string = DEFAULT_BASE_URL,
      model: string = DEFAULT_ASR_MODEL,
    ): Promise<Record<string, unknown>> {
      if (!current) throw new Error("请先调用 start()");
      const recorder = current;
      current = undefined;

      const recording = await recorder.stop();
      const wav = encodeWav(recording.samples, recording.sampleRate);
      const dataUri = bytesToDataUri(new Uint8Array(wav), "audio/wav");

      const startedAt = Date.now();
      const text = await transcribeAudio({ baseUrl, apiKey, model }, dataUri);

      const result: Record<string, unknown> = {
        seconds: Math.round(recording.durationMs / 100) / 10,
        payloadKB: Math.round(dataUri.length / 1024),
        elapsedMs: Date.now() - startedAt,
        text,
      };

      if (expected) {
        const stats = diffDictation(expected, text).stats;
        result.diff = stats;
        result.score = scoreAttempt(expected, stats, recording.durationMs);
      }
      return result;
    },
  };
}
