/** 用 Blob URL 播放一段音频，播完自动释放。 */
export async function playAudioBytes(bytes: ArrayBuffer, mimeType: string): Promise<void> {
  const url = URL.createObjectURL(new Blob([bytes], { type: mimeType }));
  const audio = new Audio(url);
  audio.addEventListener("ended", () => URL.revokeObjectURL(url));
  try {
    await audio.play();
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }
}
