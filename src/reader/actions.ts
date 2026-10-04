import { App } from "obsidian";
import type EchoReadPlugin from "../main";
import { playAudioBytes } from "../audio/playback";
import { toTtsVoice } from "../settings/types";
import { guessMimeType, synthesizeSpeech } from "../speech/tts-client";
import { voiceSignature } from "../speech/tts-request";
import { speak } from "../speech/tts-system";
import {
  audioCachePath,
  cacheSynthesizedAudio,
  currentAudioRoot,
  readCachedAudio,
} from "../store/audio-cache";

export type SpeakSource = "system" | "cache" | "cloud";

/**
 * 朗读一句。顺序是：系统语音 → 缓存 → 云端合成。
 *
 * 缓存优先是成本控制的核心（设计文档 8）：同一句第二次朗读不产生任何费用。
 * 缓存键包含模型、音色、格式与文本四要素，任何一项变了都会重新合成。
 */
export async function speakSentence(
  app: App,
  plugin: EchoReadPlugin,
  text: string,
): Promise<SpeakSource> {
  const settings = plugin.settings;

  if (settings.ttsMode === "system") {
    await speak(text, { voiceURI: settings.voiceURI, rate: settings.speechRate });
    return "system";
  }

  const voice = toTtsVoice(settings);
  const signature = voiceSignature(voice);
  const root = currentAudioRoot(app);
  const path = await audioCachePath(root, signature, text, voice.format);

  const cached = await readCachedAudio(app, path);
  if (cached) {
    await playAudioBytes(cached, guessMimeType(voice.format));
    return "cache";
  }

  const apiKey = plugin.apiKeys[settings.ttsKeyId];
  if (!settings.ttsKeyId || !apiKey) {
    throw new Error("云端合成尚未绑定 Key 或 Key 为空，请到插件设置里处理。");
  }
  if (!voice.voice) {
    throw new Error("云端合成缺少音色，请到插件设置里填写。");
  }

  const result = await synthesizeSpeech({ baseUrl: settings.ttsBaseUrl, apiKey, voice }, text);

  await cacheSynthesizedAudio(
    app,
    root,
    signature,
    { text, format: voice.format, voice: voice.voice, model: voice.model },
    result.bytes,
  );
  await playAudioBytes(result.bytes, result.mimeType);
  return "cloud";
}
