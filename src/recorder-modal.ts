import { App, Modal, Notice, Setting } from "obsidian";
import { MAX_RECORDING_MS, Recorder, type Recording } from "./audio/recorder";
import { bytesToDataUri } from "./core/base64";
import { diffDictation } from "./core/diff";
import { encodeWav } from "./core/wav";
import { scoreAttempt } from "./scoring/attempt";
import { transcribeAudio } from "./speech/client";
import type EchoReadPlugin from "./main";

/**
 * 录音工作台。当前阶段的定位是**验证工具**：
 * 在 Obsidian 里直接完成「录音 → 回放 → 转写 → 评分」，
 * 不需要打开开发者工具。等阅读视图的交互做出来后，它会退成调试入口。
 *
 * 界面只用 Obsidian 原生组件与最朴素的 DOM，不引入任何视觉语言。
 */
export class RecorderModal extends Modal {
  private readonly plugin: EchoReadPlugin;

  private recorder?: Recorder;
  private recording?: Recording;
  private wavBuffer?: ArrayBuffer;
  private timerId?: number;
  private startedAt = 0;

  private statusEl!: HTMLElement;
  private resultEl!: HTMLElement;
  private recordButton!: HTMLButtonElement;
  private playButton!: HTMLButtonElement;
  private transcribeButton!: HTMLButtonElement;
  private referenceInput!: HTMLInputElement;

  constructor(app: App, plugin: EchoReadPlugin) {
    super(app);
    this.plugin = plugin;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.createEl("h2", { text: "Echo Read 录音工作台" });
    contentEl.createEl("p", {
      cls: "setting-item-description",
      text: `录音最长 ${MAX_RECORDING_MS / 1000} 秒，采集后自动降采样到 16 kHz 单声道用于识别。`,
    });

    this.statusEl = contentEl.createDiv({ text: "未开始。" });
    this.statusEl.style.margin = "12px 0";

    const buttons = contentEl.createDiv();
    buttons.style.display = "flex";
    buttons.style.gap = "8px";
    buttons.style.flexWrap = "wrap";
    buttons.style.marginBottom = "12px";

    this.recordButton = buttons.createEl("button", { text: "开始录音" });
    this.playButton = buttons.createEl("button", { text: "播放录音" });
    this.transcribeButton = buttons.createEl("button", { text: "转写并评分" });
    this.playButton.disabled = true;
    this.transcribeButton.disabled = true;

    this.recordButton.addEventListener("click", () => void this.toggleRecording());
    this.playButton.addEventListener("click", () => void this.playback());
    this.transcribeButton.addEventListener("click", () => void this.transcribe());

    new Setting(contentEl)
      .setName("参考文本（可选）")
      .setDesc("填上原句，转写后会同时给出准确度、完整度、流利度与总分。")
      .addText((text) => {
        this.referenceInput = text.inputEl;
        text.setPlaceholder("The plan is ready.");
      });

    this.resultEl = contentEl.createEl("pre");
    this.resultEl.style.whiteSpace = "pre-wrap";
    this.resultEl.style.userSelect = "text";
    this.resultEl.style.maxHeight = "280px";
    this.resultEl.style.overflow = "auto";
    this.resultEl.style.fontSize = "12px";
    this.resultEl.style.lineHeight = "1.5";
  }

  onClose(): void {
    window.clearInterval(this.timerId);
    if (this.recorder) {
      void this.recorder.stop().catch(() => undefined);
      this.recorder = undefined;
    }
    this.contentEl.empty();
  }

  private async toggleRecording(): Promise<void> {
    if (this.recorder) {
      await this.stopRecording();
      return;
    }
    await this.startRecording();
  }

  private async startRecording(): Promise<void> {
    try {
      this.recorder = new Recorder();
      await this.recorder.start();
    } catch (error) {
      this.recorder = undefined;
      this.setStatus(`无法开始录音：${messageOf(error)}`);
      return;
    }

    this.startedAt = Date.now();
    this.wavBuffer = undefined;
    this.recording = undefined;
    this.recordButton.setText("停止录音");
    this.playButton.disabled = true;
    this.transcribeButton.disabled = true;
    this.setResult("");
    this.tick();
    this.timerId = window.setInterval(() => this.tick(), 200);
  }

  private tick(): void {
    const elapsed = Date.now() - this.startedAt;
    this.setStatus(`● 录音中… ${(elapsed / 1000).toFixed(1)} 秒（最长 ${MAX_RECORDING_MS / 1000} 秒）`);
    if (elapsed >= MAX_RECORDING_MS) void this.stopRecording();
  }

  private async stopRecording(): Promise<void> {
    const recorder = this.recorder;
    if (!recorder) return;

    window.clearInterval(this.timerId);
    this.recorder = undefined;

    try {
      const recording = await recorder.stop();
      this.recording = recording;
      this.wavBuffer = encodeWav(recording.samples, recording.sampleRate);
    } catch (error) {
      this.setStatus(`录音失败：${messageOf(error)}`);
      this.recordButton.setText("开始录音");
      return;
    }

    this.recordButton.setText("开始录音");
    this.playButton.disabled = false;
    this.transcribeButton.disabled = false;

    const seconds = ((this.recording?.durationMs ?? 0) / 1000).toFixed(1);
    const samples = this.recording?.samples.length ?? 0;
    const kb = Math.round((this.wavBuffer?.byteLength ?? 0) / 1024);
    this.setStatus(`录音完成：${seconds} 秒，${samples} 个采样，16-bit WAV 约 ${kb} KB。`);
  }

  private async playback(): Promise<void> {
    if (!this.wavBuffer) return;
    const url = URL.createObjectURL(new Blob([this.wavBuffer], { type: "audio/wav" }));
    const audio = new Audio(url);
    audio.addEventListener("ended", () => URL.revokeObjectURL(url));
    try {
      await audio.play();
    } catch (error) {
      URL.revokeObjectURL(url);
      new Notice(`播放失败：${messageOf(error)}`);
    }
  }

  private async transcribe(): Promise<void> {
    const apiKey = this.plugin.unlockedApiKey;
    if (!apiKey) {
      new Notice("尚未解锁 API Key，请先到插件设置里解锁。");
      return;
    }
    if (!this.wavBuffer) {
      new Notice("请先录一段音。");
      return;
    }

    this.transcribeButton.disabled = true;
    this.setResult("转写中…");

    const dataUri = bytesToDataUri(new Uint8Array(this.wavBuffer), "audio/wav");
    try {
      const text = await transcribeAudio(
        {
          baseUrl: this.plugin.settings.baseUrl,
          apiKey,
          model: this.plugin.settings.asrModel,
          transport: this.plugin.settings.transport,
        },
        dataUri,
      );
      this.renderTranscript(text);
    } catch (error) {
      this.setResult(`转写失败：${messageOf(error)}`);
    } finally {
      this.transcribeButton.disabled = false;
    }
  }

  private renderTranscript(text: string): void {
    const reference = this.referenceInput.value.trim();
    const lines: string[] = [`识别结果：${text || "（空）"}`];

    if (reference) {
      const stats = diffDictation(reference, text).stats;
      const score = scoreAttempt(reference, stats, this.recording?.durationMs ?? 0);
      lines.push("");
      lines.push(`准确度 ${score.accuracy}　完整度 ${score.completeness}　流利度 ${score.fluency}`);
      lines.push(`总分 ${score.overall}`);
      lines.push(
        `差异：漏 ${stats.missing}　多 ${stats.extra}　错 ${stats.wrong}`,
      );
    }

    this.setResult(lines.join("\n"));
  }

  private setStatus(text: string): void {
    this.statusEl.setText(text);
  }

  private setResult(text: string): void {
    this.resultEl.setText(text);
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
