import { App, Modal, Notice } from "obsidian";
import { askAboutSelection } from "../llm/client";
import type EchoReadPlugin from "../main";

/**
 * 常见问题的快捷按钮。
 *
 * 在 iPad 上打字很别扭，所以把最常问的几种做成一点即问 ——
 * 这是这个弹窗里最实用的一部分，而不是装饰。
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
 * 用独立的弹窗而不是阅读页里的浮层，是因为**回答可能较长**，
 * 需要一个能安静读它的地方；浮层贴在句子旁边会被正文挤得很难受。
 */
export class AskModal extends Modal {
  private readonly plugin: EchoReadPlugin;
  private readonly selection: string;

  private inputEl: HTMLInputElement | null = null;
  private askButton: HTMLButtonElement | null = null;
  private answerEl: HTMLElement | null = null;

  constructor(app: App, plugin: EchoReadPlugin, selection: string) {
    super(app);
    this.plugin = plugin;
    this.selection = selection;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.createEl("h2", { text: "问 AI" });

    contentEl.createEl("p", { cls: "setting-item-description", text: "选中的文本：" });
    const quote = contentEl.createEl("blockquote", { text: this.selection });
    quote.style.margin = "0 0 16px 0";
    quote.style.userSelect = "text";

    contentEl.createEl("p", {
      cls: "setting-item-description",
      text: "常见问题（点一下直接问）：",
    });
    const quick = contentEl.createDiv();
    quick.style.display = "flex";
    quick.style.flexWrap = "wrap";
    quick.style.gap = "8px";
    quick.style.marginBottom = "16px";
    for (const question of QUICK_QUESTIONS) {
      const button = quick.createEl("button", { text: question });
      button.style.minHeight = "36px";
      button.addEventListener("click", () => void this.ask(question));
    }

    const row = contentEl.createDiv();
    row.style.display = "flex";
    row.style.gap = "8px";
    row.style.marginBottom = "12px";

    this.inputEl = row.createEl("input", {
      type: "text",
      placeholder: "也可以自己输入问题",
    });
    this.inputEl.style.flex = "1";
    this.inputEl.addEventListener("keydown", (event) => {
      if (event.key === "Enter") void this.ask(this.inputEl?.value ?? "");
    });

    this.askButton = row.createEl("button", { text: "提问" });
    this.askButton.addEventListener("click", () => void this.ask(this.inputEl?.value ?? ""));

    this.answerEl = contentEl.createEl("pre");
    this.answerEl.style.whiteSpace = "pre-wrap";
    this.answerEl.style.userSelect = "text";
    this.answerEl.style.maxHeight = "40vh";
    this.answerEl.style.overflow = "auto";
    this.answerEl.style.fontSize = "var(--font-ui-small)";
    this.answerEl.style.lineHeight = "1.6";
  }

  onClose(): void {
    this.contentEl.empty();
  }

  private async ask(question: string): Promise<void> {
    const trimmed = question.trim();
    if (trimmed === "") {
      new Notice("请先输入问题。");
      return;
    }

    const settings = this.plugin.settings;
    const apiKey = this.plugin.apiKeys[settings.llmKeyId];
    if (!settings.llmKeyId || !apiKey) {
      this.setAnswer("尚未绑定文本模型的 Key，请到「设置 → 文本能力」里绑定。");
      return;
    }

    this.setAnswer(`思考中…\n\n${trimmed}`);
    if (this.askButton) this.askButton.disabled = true;

    try {
      const answer = await askAboutSelection(
        this.app,
        {
          baseUrl: settings.llmBaseUrl,
          apiKey,
          model: settings.llmModel,
          transport: settings.llmTransport,
        },
        { text: this.selection, question: trimmed },
      );
      this.setAnswer(answer.trim() === "" ? "（模型没有返回内容）" : answer.trim());
    } catch (error) {
      this.setAnswer(`失败：${messageOf(error)}`);
    } finally {
      if (this.askButton) this.askButton.disabled = false;
    }
  }

  private setAnswer(text: string): void {
    this.answerEl?.setText(text);
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
