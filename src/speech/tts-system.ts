export interface SpeakOptions {
  voiceURI?: string;
  rate?: number;
}

/** iOS 的语音列表是异步填充的，首次调用可能为空，必须等 voiceschanged。 */
export function loadVoices(timeoutMs = 2000): Promise<SpeechSynthesisVoice[]> {
  return new Promise((resolve) => {
    const immediate = speechSynthesis.getVoices();
    if (immediate.length > 0) {
      resolve(immediate);
      return;
    }

    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      speechSynthesis.removeEventListener("voiceschanged", finish);
      resolve(speechSynthesis.getVoices());
    };

    speechSynthesis.addEventListener("voiceschanged", finish);
    window.setTimeout(finish, timeoutMs);
  });
}

export function speak(text: string, options: SpeakOptions = {}): Promise<void> {
  return new Promise((resolve, reject) => {
    if (typeof speechSynthesis === "undefined") {
      reject(new Error("当前环境不支持系统语音。"));
      return;
    }

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "en-US";
    utterance.rate = options.rate ?? 1;

    if (options.voiceURI) {
      const voice = speechSynthesis.getVoices().find((v) => v.voiceURI === options.voiceURI);
      if (voice) utterance.voice = voice;
    }

    utterance.onend = () => resolve();
    utterance.onerror = (event) => {
      // 被 cancel() 打断时浏览器报的是 interrupted / canceled。
      // 那是我们主动停的，当成成功结束处理 —— 否则每次切换句子都会弹一个假错误。
      const reason = (event as SpeechSynthesisErrorEvent).error;
      if (reason === "interrupted" || reason === "canceled") {
        resolve();
        return;
      }
      reject(new Error(`系统语音朗读失败（${reason}）。`));
    };

    speechSynthesis.cancel();
    speechSynthesis.speak(utterance);
  });
}

export function stopSpeaking(): void {
  if (typeof speechSynthesis !== "undefined") speechSynthesis.cancel();
}

export function isSpeaking(): boolean {
  return typeof speechSynthesis !== "undefined" && speechSynthesis.speaking;
}
