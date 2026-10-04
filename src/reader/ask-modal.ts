import { App, Modal, Notice } from "obsidian";
import {
  analyzeEtymology,
  askAboutSelection,
  type LlmClientOptions,
} from "../llm/client";
import type EchoReadPlugin from "../main";

/**
 * 常见问题的快捷按钮。
 *
 * 在 iPad 上打字很别扭，把最常问的几种做成一点即问，实用性差别很大。
 */
const QUICK_QUESTIONS = [
  "这句话是什么意思？",
  "这个搭配怎么用？",
  "为什么用这个时态？",
  "还有更简单的说法吗？",
];

/**
 * 就选中的文本向模型提问。
 *
 * 用独立弹窗而不是阅读页里的浮层：回答可能较长，需要一个能安静读完的地方；
 * 浮层贴在句子旁边会被正文挤得很难受。
 *
 * 界面走"克制的 Apple 风"：大圆角、分组卡片、44px 以上的触控目标、
 * 主操作用一个实心强调色按钮。颜色仍全部取自 Obsidian 的 CSS 变量，
 * 因此跟随主题变化，不会在深色模式下变成一块突兀的白。
 */
export class AskModal extends Modal {
  private readonly plugin: EchoReadPlugin;
  private readonly selection: string;

  private inputEl: HTMLInputElement | null = null;
  private askButton: HTMLButtonElement | null = null;
  private answerEl: HTMLElement | null = null;
  private statusEl: HTMLElement | null = null;

  constructor(app: App, plugin: EchoReadPlugin, selection: string) {
    super(app);
    this.plugin = plugin;
    this.selection = selection;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.addClass("echo-read-ask");
    contentEl.createEl("h3", { text: "问 AI", cls: "echo-read-ask-title" });

    const quote = contentEl.createDiv({ cls: "echo-read-ask-quote" });
    quote.setText(this.selection);

    // 主操作：词源解析。用实心按钮与下面的问答区分开 ——
    // 它是一个"模式"，不是一个问题，混在问题列表里会让人以为只是普通提问。
    contentEl.createDiv({ cls: "echo-read-ask-label", text: "解析方式" });
    const primary = contentEl.createEl("button", {
      cls: "echo-read-ask-primary",
      text: "词源解析",
    });
    primary.addEventListener("click", () => void this.runEtymology());

    contentEl.createDiv({ cls: "echo-read-ask-label", text: "常见问题" });
    const chips = contentEl.createDiv({ cls: "echo-read-ask-chips" });
    for (const question of QUICK_QUESTIONS) {
      const chip = chips.createEl("button", { cls: "echo-read-ask-chip", text: question });
      chip.addEventListener("click", () => void this.ask(question));
    }

    contentEl.createDiv({ cls: "echo-read-ask-label", text: "自己提问" });
    const row = contentEl.createDiv({ cls: "echo-read-ask-row" });
    this.inputEl = row.createEl("input", {
      cls: "echo-read-ask-input",
      type: "text",
      placeholder: "输入你的问题…",
    });
    this.inputEl.addEventListener("keydown", (event) => {
      if (event.key === "Enter") void this.ask(this.inputEl?.value ?? "");
    });
    this.askButton = row.createEl("button", { cls: "echo-read-ask-submit", text: "提问" });
    this.askButton.addEventListener("click", () => void this.ask(this.inputEl?.value ?? ""));

    this.statusEl = contentEl.createDiv({ cls: "echo-read-ask-status" });
    this.answerEl = contentEl.createEl("pre", { cls: "echo-read-ask-answer" });
  }

  onClose(): void {
    this.contentEl.empty();
  }

  private async runEtymology(): Promise<void> {
    const options = this.resolveOptions();
    if (!options) return;

    this.begin("正在解析词源…");
    try {
      const answer = await analyzeEtymology(
        this.app,
        options,
        this.selection,
        this.plugin.settings.etymologyTurn,
      );
      // 解析成功才推进轮换，否则一次失败会白跳一组同义词
      await this.plugin.updateSettings({
        etymologyTurn: this.plugin.settings.etymologyTurn + 1,
      });
      this.finish(answer);
    } catch (error) {
      this.fail(error);
    }
  }

  private async ask(question: string): Promise<void> {
    const trimmed = question.trim();
    if (trimmed === "") {
      new Notice("请先输入问题。");
      return;
    }

    const options = this.resolveOptions();
    if (!options) return;

    this.begin(`正在思考…\n\n${trimmed}`);
    try {
      const answer = await askAboutSelection(this.app, options, {
        text: this.selection,
        question: trimmed,
      });
      this.finish(answer);
    } catch (error) {
      this.fail(error);
    }
  }

  private resolveOptions(): LlmClientOptions | null {
    const settings = this.plugin.settings;
    const apiKey = this.plugin.apiKeys[settings.llmKeyId];
    if (!settings.llmKeyId || !apiKey) {
      this.setStatus("尚未绑定文本模型的 Key");
      this.setAnswer("请到「设置 → 文本能力」里绑定一把 Key，并点「测试文本模型」确认可用。");
      return null;
    }
    return {
      baseUrl: settings.llmBaseUrl,
      apiKey,
      model: settings.llmModel,
      transport: settings.llmTransport,
    };
  }

  private begin(message: string): void {
    this.setStatus("请求中…");
    this.setAnswer(message);
    if (this.askButton) this.askButton.disabled = true;
  }

  private finish(answer: string): void {
    this.setStatus("");
    this.setAnswer(answer.trim() === "" ? "（模型没有返回内容）" : answer.trim());
    if (this.askButton) this.askButton.disabled = false;
  }

  private fail(error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    this.setStatus("失败");
    this.setAnswer(message);
    if (this.askButton) this.askButton.disabled = false;
  }

  private setStatus(text: string): void {
    this.statusEl?.setText(text);
  }

  private setAnswer(text: string): void {
    this.answerEl?.setText(text);
  }
}
