import { App, Notice } from "obsidian";
import { playAudioBytes, stopPlayback } from "../audio/playback";
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
 * 阅读视图交互。
 *
 * 操作逻辑围绕"少一步"设计：
 * - **点一句就直接朗读**，不需要先选中再点按钮（可在设置里关掉）
 * - 操作条只留三个按钮：跟读打分 / 连续朗读 / 停止
 * - 点空白处收回，不设独立的「关闭」按钮
 *
 * 操作条是全项目唯一自建 DOM（设计文档 4.7），只用原生 button 与 CSS 变量。
 */
export class ReadingController {
  private currentGroup: HTMLElement[] = [];
  private currentText = "";

  private bar: HTMLElement | null = null;
  private statusEl: HTMLElement | null = null;
  private resultEl: HTMLElement | null = null;
  private shadowButton: HTMLButtonElement | null = null;
  private continuousButton: HTMLButtonElement | null = null;

  private recorder?: Recorder;
  private continuous = false;

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

    // 操作条自己的点击不参与选句判定，否则点「朗读」会把操作条先关掉
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

    this.stopContinuous();
    this.cancelRecording();
    this.selectSentence(index, span);

    // 一步到位：选中的同时就读出来
    if (this.plugin.settings.speakOnClick) void this.speak();
  }

  private selectSentence(index: number, span: HTMLElement): void {
    // 句子索引是段落内编号，必须限定在同一个段落里查找，
    // 否则会选中别的段落中同号的句子
    const scope = span.closest(`[${PARAGRAPH_ATTR}]`) ?? document;
    const group = Array.from(
      scope.querySelectorAll<HTMLElement>(`[${SENTENCE_ATTR}="${index}"]`),
    );
    if (group.length === 0) return;
    this.highlightGroup(group);
    this.showBar();
  }

  private highlightGroup(group: HTMLElement[]): void {
    this.clearHighlight();
    for (const element of group) element.classList.add(CURRENT_CLASS);
    this.currentGroup = group;
    this.currentText = group.map((element) => element.textContent ?? "").join("");
  }

  private clearHighlight(): void {
    for (const element of this.currentGroup) element.classList.remove(CURRENT_CLASS);
    this.currentGroup = [];
  }

  private clearSelection(): void {
    this.stopContinuous();
    this.cancelRecording();
    this.clearHighlight();
    this.currentText = "";
    stopSpeaking();
    stopPlayback();
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

    this.shadowButton = bar.createEl("button", { text: "跟读打分" });
    this.shadowButton.addEventListener("click", () => void this.toggleShadowing());

    this.continuousButton = bar.createEl("button", { text: "连续朗读" });
    this.continuousButton.addEventListener("click", () => void this.toggleContinuous());

    bar.createEl("button", { text: "停止" }).addEventListener("click", () => {
      this.stopContinuous();
      this.cancelRecording();
      stopSpeaking();
      stopPlayback();
      this.setStatus("已停止");
    });

    this.statusEl = bar.createDiv({ cls: "echo-read-bar-status" });
    this.resultEl = bar.createDiv({ cls: "echo-read-bar-result" });

    this.bar = bar;
    return bar;
  }

  // ---------------- 朗读 ----------------

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

  // ---------------- 连续朗读 ----------------

  private async toggleContinuous(): Promise<void> {
    if (this.continuous) {
      this.stopContinuous();
      return;
    }
    if (this.currentGroup.length === 0) return;

    this.continuous = true;
    this.updateContinuousButton();
    this.setResult("");

    const groups = collectSentenceGroups(document);
    const anchor = this.currentGroup[0];
    let start = groups.findIndex((group) => group.includes(anchor));
    if (start < 0) start = 0;
    const total = groups.length - start;

    try {
      for (let i = start; i < groups.length; i++) {
        if (!this.continuous) break;
        const group = groups[i];

        this.highlightGroup(group);
        group[0].scrollIntoView({ block: "center", behavior: "smooth" });
        this.setStatus(`连续朗读 ${i - start + 1} / ${total}`);

        await speakSentence(this.app, this.plugin, this.textOf(group));
      }
      if (this.continuous) this.setStatus("连续朗读结束");
    } catch (error) {
      this.reportFailure("连续朗读", error);
    } finally {
      this.continuous = false;
      this.updateContinuousButton();
    }
  }

  private stopContinuous(): void {
    if (!this.continuous) return;
    this.continuous = false;
    stopSpeaking();
    stopPlayback();
    this.updateContinuousButton();
  }

  private updateContinuousButton(): void {
    this.continuousButton?.setText(this.continuous ? "停止连读" : "连续朗读");
  }

  private textOf(group: HTMLElement[]): string {
    return group.map((element) => element.textContent ?? "").join("");
  }

  // ---------------- 跟读打分 ----------------

  /** 第一次点开始录音，第二次点结束并评分。 */
  private async toggleShadowing(): Promise<void> {
    if (this.recorder) {
      await this.finishShadowing();
      return;
    }
    if (!this.currentText.trim()) return;

    this.stopContinuous();

    try {
      this.recorder = new Recorder();
      await this.recorder.start();
      this.setResult("");
      this.setStatus("● 录音中… 读完后再点一次「跟读打分」");
      this.shadowButton?.setText("结束并评分");
    } catch (error) {
      this.recorder = undefined;
      this.reportFailure("录音", error);
    }
  }

  private async finishShadowing(): Promise<void> {
    const recorder = this.recorder;
    if (!recorder) return;
    this.recorder = undefined;
    this.shadowButton?.setText("跟读打分");
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
          `漏 ${stats.missing}　多 ${stats.extra}　错 ${stats.wrong}　用时 ${(
            recording.durationMs / 1000
          ).toFixed(1)} 秒`,
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
    this.shadowButton?.setText("跟读打分");
    void recorder.stop().catch(() => undefined);
  }

  // ---------------- 杂项 ----------------

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
    this.stopContinuous();
    this.cancelRecording();
    this.bar?.remove();
    this.bar = null;
    this.statusEl = null;
    this.resultEl = null;
    this.shadowButton = null;
    this.continuousButton = null;
  }
}

/**
 * 按**文档顺序**把句子 span 归组。
 *
 * 连续朗读必须按文章顺序走，而句子索引只是段落内编号，
 * 因此不能按索引排序 —— 只能扫描 DOM 的实际顺序，
 * 再按「同一段落 + 同一索引」相邻合并成一组。
 */
export function collectSentenceGroups(root: ParentNode): HTMLElement[][] {
  const spans = Array.from(root.querySelectorAll<HTMLElement>(`[${SENTENCE_ATTR}]`));
  const groups: HTMLElement[][] = [];

  let bucket: HTMLElement[] = [];
  let lastParagraph: Element | null = null;
  let lastIndex = -1;

  for (const span of spans) {
    const paragraph = span.closest(`[${PARAGRAPH_ATTR}]`);
    const index = Number(span.getAttribute(SENTENCE_ATTR));

    if (paragraph !== lastParagraph || index !== lastIndex) {
      if (bucket.length > 0) groups.push(bucket);
      bucket = [];
      lastParagraph = paragraph;
      lastIndex = index;
    }
    bucket.push(span);
  }

  if (bucket.length > 0) groups.push(bucket);
  return groups;
}
