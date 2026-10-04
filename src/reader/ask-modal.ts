import { App, Modal, Notice } from "obsidian";
import {
  analyzeEtymology,
  askAboutSelection,
  type LlmClientOptions,
} from "../llm/client";
import { addTermCard } from "../review/store";
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
  /** 选中内容所在的完整句子，加闪卡时作为语境。 */
  private readonly sentence: string;

  private inputEl: HTMLInputElement | null = null;
  private askButton: HTMLButtonElement | null = null;
  private answerEl: HTMLElement | null = null;
  private statusEl: HTMLElement | null = null;

  constructor(
    app: App,
    plugin: EchoReadPlugin,
    context: { selection: string; sentence: string },
  ) {
    super(app);
    this.plugin = plugin;
    this.selection = context.selection;
    this.sentence = context.sentence;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.addClass("echo-read-ask");
    contentEl.createEl("h3", { text: "问 AI", cls: "echo-read-ask-title" });

    const quote = contentEl.createDiv({ cls: "echo-read-ask-quote" });
    quote.setText(this.selection);

    // 快捷操作：这两件事有固定流程，与下面的自由提问区分开 ——
    // 混进问题列表会让人以为它们也只是随口问一句。
    contentEl.createDiv({ cls: "echo-read-ask-label", text: "快捷操作" });
    const actions = contentEl.createDiv({ cls: "echo-read-ask-actions" });

    const etymology = actions.createEl("button", {
      cls: "echo-read-ask-primary",
      text: "词源解析",
    });
    etymology.addEventListener("click", () => void this.runEtymology());

    const addCard = actions.createEl("button", {
      cls: "echo-read-ask-secondary",
      text: "加入闪卡",
    });
    addCard.addEventListener("click", () => void this.addToCards());

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

  /**
   * 把选中的词做成一张复习卡片。
   *
   * 只接受词或短语：卡片的正面是"挖空所在句"，如果选中的是整句，
   * 挖空之后就等于把整句抹掉，那张卡没有意义。
   * 整句练习走「跟读打分 → 讲解」，模型挑出的词会自动进卡片。
   */
  private async addToCards(): Promise<void> {
    const term = this.selection.trim();
    const words = term.split(/\s+/).filter(Boolean);

    if (words.length === 0) {
      new Notice("没有可添加的词。");
      return;
    }
    if (words.length > MAX_TERM_WORDS) {
      this.setStatus("只能添加词或短语");
      this.setAnswer(
        `「加入闪卡」需要选中一个词或短语（最多 ${MAX_TERM_WORDS} 个词）。\n\n` +
          "整句练习走「跟读打分 → 讲解」，模型挑出的词会自动变成卡片。",
      );
      return;
    }

    const source = this.sourceLink();
    if (source === "") {
      new Notice("无法确定来源笔记。");
      return;
    }

    this.setStatus("加入中…");
    try {
      const result = await addTermCard(this.app, term, this.sentence, source, new Date());
      if (!result.ok) {
        this.setStatus("未加入");
        this.setAnswer(result.reason ?? "未加入。");
        return;
      }
      this.setStatus("已加入闪卡");
      this.setAnswer(
        [
          `词：${term}`,
          `语境：${this.sentence || term}`,
          `来源：${source}`,
          "",
          "打开 _lingo/cards.md 可以查看，或点左侧边栏的图层图标开始复习。",
        ].join("\n"),
      );
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

  private sourceLink(): string {
    const file = this.app.workspace.getActiveFile();
    return file ? `[[${file.basename}]]` : "";
  }
}

/** 超过这个词数就不当作"词或短语"了。 */
const MAX_TERM_WORDS = 4;
