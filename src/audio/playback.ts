let current: HTMLAudioElement | null = null;

/**
 * 播放一段音频，**等它真正放完才返回**。
 *
 * 这一点对连续朗读是必须的：如果只等 `play()` 的 Promise，
 * 那个 Promise 在声音"开始"时就 resolve 了，连续朗读会把所有句子
 * 同时播出去，听起来是一片噪音。
 */
export async function playAudioBytes(bytes: ArrayBuffer, mimeType: string): Promise<void> {
  const url = URL.createObjectURL(new Blob([bytes], { type: mimeType }));
  const audio = new Audio(url);
  current = audio;

  try {
    await new Promise<void>((resolve, reject) => {
      const cleanup = () => {
        URL.revokeObjectURL(url);
        if (current === audio) current = null;
      };
      audio.addEventListener("ended", () => {
        cleanup();
        resolve();
      });
      audio.addEventListener("error", () => {
        cleanup();
        reject(new Error("音频播放失败。"));
      });
      audio.play().catch((error) => {
        cleanup();
        reject(error);
      });
    });
  } catch (error) {
    if (current === audio) current = null;
    throw error;
  }
}

/** 立即停止正在播放的音频（连续朗读的「停止」要用）。 */
export function stopPlayback(): void {
  if (!current) return;
  current.pause();
  current = null;
}
