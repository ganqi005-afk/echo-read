import { App, Notice } from "obsidian";
import type EchoReadPlugin from "../main";
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
    this.selectSentence(index, span);
  }

  private selectSentence(index: number, span: HTMLElement): void {
    this.clearHighlight();

    // 句子索引是段落内编号，因此必须在同一个段落里查找，
    // 否则会选中别的段落里同号的句子
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
    this.clearHighlight();
    this.currentText = "";
    stopSpeaking();
    if (this.bar) this.bar.style.display = "none";
  }

  private showBar(): void {
    const bar = this.ensureBar();
    bar.style.display = "flex";
    if (this.statusEl) this.statusEl.setText("");
  }

  private ensureBar(): HTMLElement {
    if (this.bar) return this.bar;

    const bar = document.body.createDiv({ cls: "echo-read-bar" });

    bar.createEl("button", { text: "朗读" }).addEventListener("click", () => {
      void this.speak();
    });
    bar.createEl("button", { text: "停止" }).addEventListener("click", () => {
      stopSpeaking();
    });
    bar.createEl("button", { text: "关闭" }).addEventListener("click", () => {
      this.clearSelection();
    });

    this.statusEl = bar.createDiv({ cls: "echo-read-bar-status" });
    this.bar = bar;
    return bar;
  }

  private async speak(): Promise<void> {
    if (!this.currentText.trim()) return;
    this.setStatus("朗读中…");
    try {
      const source = await speakSentence(this.app, this.plugin, this.currentText);
      this.setStatus(
        source === "cache" ? "已朗读（命中缓存）" : source === "cloud" ? "已朗读（云端合成）" : "已朗读",
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.setStatus(`失败：${message}`);
      new Notice(`朗读失败：${message}`, 8000);
    }
  }

  private setStatus(text: string): void {
    this.statusEl?.setText(text);
  }

  private dispose(): void {
    this.bar?.remove();
    this.bar = null;
    this.statusEl = null;
  }
}
