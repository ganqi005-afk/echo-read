import { App, Notice } from "obsidian";
import { Recorder } from "../audio/recorder";
import { bytesToDataUri } from "../core/base64";
import { diffDictation } from "../core/diff";
import { encodeWav } from "../core/wav";
import type EchoReadPlugin from "../main";
import { scoreAttempt } from "../scoring/attempt";
import { transcribeAudio } from "../speech/client";
import { stopSpeaking } from "../speech/tts-system";
import { speakSentence } from "./actions";
import {
  CURRENT_CLASS,
  PARAGRAPH_ATTR,
  SENTENCE_ATTR,
  decorateParagraph,
} from "./decorate";

/**
 * 阅读视图交互：点句聚焦 + 底部操作条。
 *
 * 操作条是全项目唯一自建 DOM（设计文档 4.7）。它只做一件事 ——
 * 把动作排成一行，不含自己的视觉语言：按钮是原生 button，
 * 颜色尺寸全部走 Obsidian 的 CSS 变量（见 styles.css）。
 */
export class ReadingController {
  private currentText = "";
  private currentSpans: HTMLElement[] = [];
  private bar: HTMLElement | null = null;
  private statusEl: HTMLElement | null = null;
  private resultEl: HTMLElement | null = null;
  private shadowButton: HTMLButtonElement | null = null;
  private recorder?: Recorder;

  constructor(
    private readonly app: App,
    private readonly plugin: EchoReadPlugin,
  ) {}

  register(): void {
    this.plugin.registerMarkdownPostProcessor((element) => {
      element.querySelectorAll("p").forEach((paragraph) => decorateParagraph(paragraph));
    });

    this.plugin.registerDomEvent(document, "click", (event) => this.onClick(event));
    this.plugin.register(() => this.dispose());
  }

  private onClick(event: MouseEvent): void {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;

    // 操作条自己的点击不参与选句判定，否则点「朗读」会先把操作条关掉
    if (this.bar && this.bar.contains(target)) return;

    // 链接优先：点在链接上应正常跳转，不抢它的行为
    if (target.closest("a")) return;

    const span = target.closest(`[${SENTENCE_ATTR}]`);
    if (!(span instanceof HTMLElement)) {
      this.clearSelection();
      return;
    }

    const index = Number(span.getAttribute(SENTENCE_ATTR));
    if (!Number.isFinite(index)) return;
    this.selectSentence(index, span);
  }

  private selectSentence(index: number, span: HTMLElement): void {
    this.cancelRecording();
    this.clearHighlight();

    // 句子索引是段落内编号，必须限定在同一个段落里查找，
    // 否则会选中别的段落中同号的句子
    const scope = span.closest(`[${PARAGRAPH_ATTR}]`) ?? document;
    const spans = Array.from(
      scope.querySelectorAll<HTMLElement>(`[${SENTENCE_ATTR}="${index}"]`),
    );
    for (const element of spans) element.classList.add(CURRENT_CLASS);

    this.currentSpans = spans;
    this.currentText = spans.map((element) => element.textContent ?? "").join("");
    this.showBar();
  }

  private clearHighlight(): void {
    for (const element of this.currentSpans) element.classList.remove(CURRENT_CLASS);
    this.currentSpans = [];
  }

  private clearSelection(): void {
    this.cancelRecording();
    this.clearHighlight();
    this.currentText = "";
    stopSpeaking();
    if (this.bar) this.bar.style.display = "none";
  }

  private showBar(): void {
    const bar = this.ensureBar();
    bar.style.display = "flex";
    this.setStatus("");
    this.setResult("");
  }

  private ensureBar(): HTMLElement {
    if (this.bar) return this.bar;

    const bar = document.body.createDiv({ cls: "echo-read-bar" });
    bar.createEl("button", { text: "朗读" }).addEventListener("click", () => void this.speak());

    this.shadowButton = bar.createEl("button", { text: "跟读打分" });
    this.shadowButton.addEventListener("click", () => void this.toggleShadowing());

    bar.createEl("button", { text: "停止" }).addEventListener("click", () => {
      stopSpeaking();
      this.cancelRecording();
    });
    bar.createEl("button", { text: "关闭" }).addEventListener("click", () => this.clearSelection());

    this.statusEl = bar.createDiv({ cls: "echo-read-bar-status" });
    this.resultEl = bar.createDiv({ cls: "echo-read-bar-result" });

    this.bar = bar;
    return bar;
  }

  private async speak(): Promise<void> {
    if (!this.currentText.trim()) return;
    this.setResult("");
    this.setStatus("朗读中…");
    try {
      const source = await speakSentence(this.app, this.plugin, this.currentText);
      this.setStatus(
        source === "cache"
          ? "已朗读（命中缓存，未计费）"
          : source === "cloud"
            ? "已朗读（云端合成）"
            : "已朗读",
      );
    } catch (error) {
      this.reportFailure("朗读", error);
    }
  }

  /** 跟读：第一次点开始录音，第二次点结束并打分。 */
  private async toggleShadowing(): Promise<void> {
    if (this.recorder) {
      await this.finishShadowing();
      return;
    }
    if (!this.currentText.trim()) return;

    try {
      this.recorder = new Recorder();
      await this.recorder.start();
      this.setResult("");
      this.setStatus("● 录音中… 读完后再点一次「跟读打分」");
      if (this.shadowButton) this.shadowButton.setText("结束并评分");
    } catch (error) {
      this.recorder = undefined;
      this.reportFailure("录音", error);
    }
  }

  private async finishShadowing(): Promise<void> {
    const recorder = this.recorder;
    if (!recorder) return;
    this.recorder = undefined;
    if (this.shadowButton) this.shadowButton.setText("跟读打分");
    this.setStatus("识别中…");

    try {
      const recording = await recorder.stop();
      const wav = encodeWav(recording.samples, recording.sampleRate);
      const dataUri = bytesToDataUri(new Uint8Array(wav), "audio/wav");

      const settings = this.plugin.settings;
      const apiKey = this.plugin.unlockedKeys[settings.asrKeyId];
      if (!settings.asrKeyId || !apiKey) {
        throw new Error("语音识别尚未绑定或解锁 Key，请到插件设置里处理。");
      }

      const text = await transcribeAudio(
        {
          baseUrl: settings.asrBaseUrl,
          apiKey,
          model: settings.asrModel,
          transport: settings.asrTransport,
        },
        dataUri,
      );

      const stats = diffDictation(this.currentText, text).stats;
      const score = scoreAttempt(this.currentText, stats, recording.durationMs);

      this.setStatus(
        `准确度 ${score.accuracy}　完整度 ${score.completeness}　流利度 ${score.fluency}　总分 ${score.overall}`,
      );
      this.setResult(
        [
          `识别：${text || "（空）"}`,
          `漏 ${stats.missing}　多 ${stats.extra}　错 ${stats.wrong}　用时 ${(recording.durationMs / 1000).toFixed(1)} 秒`,
        ].join("\n"),
      );
    } catch (error) {
      this.reportFailure("跟读评分", error);
    }
  }

  private cancelRecording(): void {
    if (!this.recorder) return;
    const recorder = this.recorder;
    this.recorder = undefined;
    if (this.shadowButton) this.shadowButton.setText("跟读打分");
    void recorder.stop().catch(() => undefined);
  }

  private reportFailure(action: string, error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    this.setStatus(`${action}失败`);
    this.setResult(message);
    new Notice(`${action}失败：${message}`, 8000);
  }

  private setStatus(text: string): void {
    this.statusEl?.setText(text);
  }

  private setResult(text: string): void {
    this.resultEl?.setText(text);
  }

  private dispose(): void {
    this.cancelRecording();
    this.bar?.remove();
    this.bar = null;
    this.statusEl = null;
    this.resultEl = null;
    this.shadowButton = null;
  }
}
