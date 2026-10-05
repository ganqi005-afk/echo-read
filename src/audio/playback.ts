interface Playing {
  audio: HTMLAudioElement;
  url: string;
  /** 用它解除调用方的等待，避免被打断时 Promise 永远挂着。 */
  resolve: () => void;
}

let playing: Playing | null = null;

export function isAudioPlaying(): boolean {
  return playing !== null;
}

// 停止当前播放，并**让等待它的调用方继续往下走**。
//
// 这一步不能省：playAudioBytes 的 Promise 是在 ended 事件里 resolve 的，
// 而暂停的音频永远不会触发 ended。不主动 resolve 的话，
// 被打断的那次调用会永远挂住 —— 连续朗读会卡死在第一句。
export function stopAudioPlayback(): void {
  const current = playing;
  playing = null;
  if (!current) return;

  current.audio.pause();
  URL.revokeObjectURL(current.url);
  current.resolve();
}

// 播放一段音频，**等它真正放完才返回**。
//
// 两点关键：
// 1. 开头先停掉正在播的那一段 —— 这就是互斥。否则连着点两句会叠在一起响。
// 2. 等 ended 而不是等 play()：play() 的 Promise 在声音"开始"时就 resolve 了，
//    那样连续朗读会把所有句子同时播出去。
export async function playAudioBytes(bytes: ArrayBuffer, mimeType: string): Promise<void> {
  stopAudioPlayback();

  const url = URL.createObjectURL(new Blob([bytes], { type: mimeType }));
  const audio = new Audio(url);

  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const settle = (error?: Error) => {
      if (settled) return;
      settled = true;
      if (playing?.audio === audio) playing = null;
      URL.revokeObjectURL(url);
      if (error) reject(error);
      else resolve();
    };

    // 被打断时由 stopAudioPlayback 调用 resolve，从这里解除等待
    playing = { audio, url, resolve: () => settle() };

    audio.addEventListener("ended", () => settle());
    audio.addEventListener("error", () => settle(new Error("音频播放失败。")));
    audio.play().catch((error) => settle(error instanceof Error ? error : new Error(String(error))));
  });
}
