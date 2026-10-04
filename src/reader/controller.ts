import { App, Notice } from "obsidian";
import { playAudioBytes, stopPlayback } from "../audio/playback";
import { Recorder } from "../audio/recorder";
import { bytesToDataUri } from "../core/base64";
import { diffDictation } from "../core/diff";
import { encodeWav } from "../core/wav";
import type EchoReadPlugin from "../main";
import { scoreAttempt } from "../scoring/attempt";
import { requestPracticeFeedback } from "../llm/client";
import type { PracticeContext } from "../llm/prompt";
import { AskModal } from "./ask-modal";
import { transcribeAudio } from "../speech/client";
import { stopSpeaking } from "../speech/tts-system";
import { speakSentence } from "./actions";
import {
  CURRENT_CLASS,
  CACHED_CLASS,
  PARAGRAPH_ATTR,
  SENTENCE_ATTR,
  decorateParagraph,
} from "./decorate";
import { audioCachePath, listAudioFilePaths } from "../store/audio-cache";
import { voiceSignature } from "../speech/tts-request";
import { toTtsVoice } from "../settings/types";
import { createCard, makeCardId } from "../review/cards";
import { addCards, readCards } from "../review/store";

/**
 * 阅读视图交互。
 *
 * 操作逻辑围绕"少一步"设计：
 * - **点一句就直接朗读**，不需要先选中再点按钮（可在设置里关掉）
 * - 拖选任意文字也能作为操作对象，覆盖生词、短语、标题、表格等场景
 * - 点空白处收回，不设独立的「关闭」按钮
 *
 * 跟读闭环：录音 → 发给识别模型 → 拿回文本 → 与原文比对评分 →
 * **保留音频以便回放**（听自己的和听原句，是发音练习里最关键的一步对比）。
 *
 * 操作条是全项目唯一自建 DOM（设计文档 4.7），只用原生 button 与 CSS 变量。
 */
export class ReadingController {
  private currentGroup: HTMLElement[] = [];
  /** 拖选出来的目标。用克隆的 Range 而不是缓存矩形，滚动后重新取仍然准确。 */
  private currentRange: Range | null = null;
  private currentText = "";

  private bar: HTMLElement | null = null;
  private statusEl: HTMLElement | null = null;
  private resultEl: HTMLElement | null = null;
  private shadowButton: HTMLButtonElement | null = null;
  private playbackButton: HTMLButtonElement | null = null;
  private explainButton: HTMLButtonElement | null = null;
  private continuousButton: HTMLButtonElement | null = null;

  private recorder?: Recorder;
  /** 最近一次录到的音频（16-bit WAV），只放内存，换目标就丢。 */
  private myRecording: ArrayBuffer | null = null;
  /** 最近一次跟读的完整结果，作为讲解的输入。 */
  private lastPractice: PracticeContext | null = null;
  private continuous = false;
  private repositionQueued = false;
  /** 已有的缓存文件路径。null 表示还没加载好。 */
  private cachedPaths: Set<string> | null = null;

  constructor(
    private readonly app: App,
    private readonly plugin: EchoReadPlugin,
  ) {}

  register(): void {
    this.plugin.registerMarkdownPostProcessor((element) => {
      element.querySelectorAll("p").forEach((paragraph) => decorateParagraph(paragraph));
      void this.markCached(element);
    });

    this.plugin.registerDomEvent(document, "click", (event) => this.onClick(event));
    // 拖选或键盘选择结束后，看是否有文本被选中
    this.plugin.registerDomEvent(document, "mouseup", () => this.scheduleSelectionCheck());
    this.plugin.registerDomEvent(document, "keyup", () => this.scheduleSelectionCheck());
    this.plugin.registerDomEvent(document, "dblclick", (event) => this.onDoubleClick(event));
    // 滚动或改变窗口大小时让操作条跟着目标走（iPad 分屏会改变视口宽度）
    this.plugin.registerDomEvent(window, "scroll", () => this.scheduleReposition(), true);
    this.plugin.registerDomEvent(window, "resize", () => this.scheduleReposition());
    this.plugin.register(() => this.dispose());
    void this.refreshCachedPaths().then(() => this.markCached(document));
  }

  /**
   * 加载已有的缓存文件路径。
   *
   * 用**文件路径**而不是索引来判断：文件名就是内容哈希，
   * 所以连旧版本留下的缓存也算得进来；索引里的 signature 是后来才加的字段，
   * 靠它反而会漏掉历史记录。
   */
  private async refreshCachedPaths(): Promise<void> {
    try {
      this.cachedPaths = await listAudioFilePaths(this.app);
    } catch {
      this.cachedPaths = null;
    }
  }

  /**
   * 给"已经有本地音频"的句子加标记。
   *
   * 判断的是**当前音色配置下**的缓存键，所以它表达的是
   * "这一句现在能立刻播放、不产生费用"，而不是"历史上曾经合成过"。
   * 换了音色之后标记会消失 —— 这是诚实的：旧音频确实用不上了。
   */
  private async markCached(root: ParentNode): Promise<void> {
    const paths = this.cachedPaths;
    if (!paths || paths.size === 0) return;

    const voice = toTtsVoice(this.plugin.settings);
    const signature = voiceSignature(voice);

    for (const group of collectSentenceGroups(root)) {
      const text = this.textOf(group);
      if (text.trim() === "") continue;
      const cached = paths.has(await audioCachePath(signature, text, voice.format));
      for (const span of group) span.classList.toggle(CACHED_CLASS, cached);
    }
  }

  // ---------------- 选择目标 ----------------

  private onClick(event: MouseEvent): void {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;

    // 操作条自己的点击不参与选句判定，否则点「听原句」会先把操作条关掉
    if (this.bar && this.bar.contains(target)) return;

    // 有文本被选中时，选中的内容优先 —— 单击不应该把它覆盖成整句
    if (this.hasLiveSelection()) return;

    // 链接优先：点在链接上应正常跳转，不抢它的行为
    if (target.closest("a")) return;

    const span = target.closest(`[${SENTENCE_ATTR}]`);
    if (!(span instanceof HTMLElement)) {
      this.clearSelection();
      return;
    }

    const index = Number(span.getAttribute(SENTENCE_ATTR));
    if (!Number.isFinite(index)) return;

    this.prepareForNewTarget();
    this.selectSentence(index, span);

    // 一步到位：选中的同时就读出来
    if (this.plugin.settings.speakOnClick) void this.speak();
  }

  /**
   * 双击一个单词直接听发音。
   *
   * 与"拖选后手动点"的区别在于**意图**：双击是一个明确的手势 ——
   * "我想知道这个词怎么读"。而拖选经常只是为了复制，所以那里不自动发声。
   *
   * 双击时浏览器会先选中该词，mouseup 处理器已经把操作对象设好了；
   * 这里只负责补上"发声"这一步。
   */
  private onDoubleClick(event: MouseEvent): void {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    if (this.bar && this.bar.contains(target)) return;
    if (target.closest("a")) return;
    if (!this.plugin.settings.speakOnDoubleClick) return;

    // 让 mouseup 里排队的选区处理先跑完，否则可能读的是上一个对象
    window.setTimeout(() => {
      if (this.currentText.trim() === "") return;
      void this.speak();
    }, 0);
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
    this.currentRange = null;
    this.showBar();
  }

  private highlightGroup(group: HTMLElement[]): void {
    this.clearHighlight();
    for (const element of group) element.classList.add(CURRENT_CLASS);
    this.currentGroup = group;
    this.currentText = this.textOf(group);
  }

  private textOf(group: HTMLElement[]): string {
    return group.map((element) => element.textContent ?? "").join("");
  }

  /**
   * 选中内容所在的完整句子。
   *
   * 加闪卡需要它：只给一个词、不给语境句，卡片背面就没有回忆线索
   * （设计文档 9.2）。所以拖选一个词时要往上找到它所属的那句话。
   */
  private enclosingSentence(): string {
    if (this.currentGroup.length > 0) return this.currentText;

    const node = this.currentRange?.commonAncestorContainer;
    const element = node instanceof HTMLElement ? node : (node?.parentElement ?? null);
    const span = element ? element.closest(`[${SENTENCE_ATTR}]`) : null;
    if (!(span instanceof HTMLElement)) return this.currentText;

    const scope = span.closest(`[${PARAGRAPH_ATTR}]`) ?? document;
    const index = span.getAttribute(SENTENCE_ATTR);
    const group = Array.from(
      scope.querySelectorAll<HTMLElement>(`[${SENTENCE_ATTR}="${index}"]`),
    );
    return group.length > 0 ? this.textOf(group) : this.currentText;
  }

  private clearHighlight(): void {
    for (const element of this.currentGroup) element.classList.remove(CURRENT_CLASS);
    this.currentGroup = [];
  }

  private clearSelection(): void {
    this.stopContinuous();
    this.cancelRecording();
    this.clearHighlight();
    this.currentRange = null;
    this.currentText = "";
    this.forgetRecording();
    stopSpeaking();
    stopPlayback();
    if (this.bar) this.bar.style.display = "none";
  }

  /** 换一个操作对象时，上一段录音就没有意义了，丢掉以免误播。 */
  private prepareForNewTarget(): void {
    this.stopContinuous();
    this.cancelRecording();
    this.clearHighlight();
    this.forgetRecording();
  }

  private forgetRecording(): void {
    this.myRecording = null;
    this.lastPractice = null;
    if (this.playbackButton) this.playbackButton.style.display = "none";
    if (this.explainButton) this.explainButton.style.display = "none";
  }

  // ---------------- 拖选文本 ----------------

  private scheduleSelectionCheck(): void {
    // 等浏览器先把 selection 更新完，再读它
    window.setTimeout(() => this.handleSelection(), 0);
  }

  /**
   * 把任意选中的文本作为朗读 / 跟读对象。
   *
   * 这条路径补上了「点整句」覆盖不到的场景：只练一个短语或生词，
   * 以及标题、列表、表格这类不会被装饰成句子 span 的地方。
   */
  private handleSelection(): void {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) return;

    const text = selection.toString().trim();
    if (!text) return;

    const range = selection.getRangeAt(0);
    if (this.isInsideBar(range)) return;
    if (!this.isInsideNote(range.commonAncestorContainer)) return;

    this.prepareForNewTarget();
    this.currentRange = range.cloneRange();
    this.currentText = text;
    this.showBar();
  }

  private hasLiveSelection(): boolean {
    const selection = window.getSelection();
    return selection !== null && !selection.isCollapsed && selection.toString().trim() !== "";
  }

  private isInsideBar(range: Range): boolean {
    if (!this.bar) return false;
    const element = asElement(range.commonAncestorContainer);
    return element !== null && this.bar.contains(element);
  }

  /** 只处理笔记正文里的选择，避开设置面板、模态框等其它界面。 */
  private isInsideNote(node: Node): boolean {
    const element = asElement(node);
    if (!element) return false;
    if (element.closest(".modal-container, .vertical-tab-content")) return false;
    return element.closest(".markdown-preview-view, .markdown-source-view, .cm-editor") !== null;
  }

  // ---------------- 操作条 ----------------

  private showBar(): void {
    const bar = this.ensureBar();
    bar.style.display = "flex";
    // 先藏起来，避免它闪现在上一个目标的位置
    bar.style.visibility = "hidden";
    this.setStatus("");
    this.setResult("");
    this.positionPopover();
  }

  private ensureBar(): HTMLElement {
    if (this.bar) return this.bar;

    const bar = document.body.createDiv({ cls: "echo-read-bar" });

    bar.createEl("button", { text: "听原句" }).addEventListener("click", () => void this.speak());

    bar.createEl("button", { text: "提问" }).addEventListener("click", () => {
      if (this.currentText.trim() === "") return;
      new AskModal(this.app, this.plugin, {
        selection: this.currentText,
        sentence: this.enclosingSentence(),
      }).open();
    });

    this.shadowButton = bar.createEl("button", { text: "跟读打分" });
    this.shadowButton.addEventListener("click", () => void this.toggleShadowing());

    // 只在录过音之后出现 —— 听自己的和听原句，是发音练习里最关键的对比
    this.playbackButton = bar.createEl("button", { text: "听我的" });
    this.playbackButton.style.display = "none";
    this.playbackButton.addEventListener("click", () => void this.playMyRecording());

    // 同样在练习之后才出现：它的输入就是刚才那次跟读的结果
    this.explainButton = bar.createEl("button", { text: "讲解" });
    this.explainButton.style.display = "none";
    this.explainButton.addEventListener("click", () => void this.explainPractice());

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

  /**
   * 把操作条锚定在目标的边缘 —— 操作就在你读的那段文字旁边。
   *
   * 目标可能跨多行，所以要取所有 span / Range 的并集包围盒；
   * 下方放不下时翻到上方，左右也会夹在视口内避免溢出。
   */
  private positionPopover(): void {
    const bar = this.bar;
    if (!bar || bar.style.display === "none") return;

    const rects = this.targetRects();
    if (!rects) {
      bar.style.display = "none";
      return;
    }

    const top = Math.min(...rects.map((rect) => rect.top));
    const bottom = Math.max(...rects.map((rect) => rect.bottom));
    const left = Math.min(...rects.map((rect) => rect.left));
    const right = Math.max(...rects.map((rect) => rect.right));

    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    // 目标滚出了视野就藏起来，免得操作条"钉"在空白处
    if (bottom < 0 || top > viewportHeight) {
      bar.style.visibility = "hidden";
      return;
    }

    const height = bar.offsetHeight;
    const width = bar.offsetWidth;

    let y = bottom + 8;
    if (y + height > viewportHeight - 8) {
      const above = top - height - 8;
      y = above >= 8 ? above : Math.max(8, viewportHeight - height - 8);
    }

    let x = Math.min(left, right - width);
    x = Math.max(8, Math.min(x, viewportWidth - width - 8));

    bar.style.top = `${Math.round(y)}px`;
    bar.style.left = `${Math.round(x)}px`;
    bar.style.visibility = "visible";
  }

  /**
   * 目标可能是「整句」（多个 span），也可能是「拖选的一段文字」（一个 Range）。
   * Range 是实时求值的，所以滚动后位置依然准确 —— 缓存矩形做不到这一点。
   */
  private targetRects(): DOMRect[] | null {
    if (this.currentGroup.length > 0) {
      return this.currentGroup.map((element) => element.getBoundingClientRect());
    }
    if (this.currentRange) return [this.currentRange.getBoundingClientRect()];
    return null;
  }

  private scheduleReposition(): void {
    if (this.repositionQueued) return;
    this.repositionQueued = true;
    window.requestAnimationFrame(() => {
      this.repositionQueued = false;
      this.positionPopover();
    });
  }

  // ---------------- 听原句（把文本发给模型，拿回语音） ----------------

  private async speak(): Promise<void> {
    if (!this.currentText.trim()) return;
    this.setResult("");
    this.setStatus("合成中…");
    try {
      const source = await speakSentence(this.app, this.plugin, this.currentText);
      this.setStatus(
        source === "cache"
          ? "已播放（命中缓存，未计费）"
          : source === "cloud"
            ? "已播放（模型返回的语音，已缓存）"
            : "已播放（系统语音）",
      );

      // 刚合成完的句子要立刻带上标记，否则要等下次打开笔记才看得到
      if (source === "cloud") {
        await this.refreshCachedPaths();
        void this.markCached(document);
      }
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

  // ---------------- 跟读打分 ----------------

  /** 第一次点开始录音，第二次点结束并评分。 */
  private async toggleShadowing(): Promise<void> {
    if (this.recorder) {
      await this.finishShadowing();
      return;
    }
    if (!this.currentText.trim()) return;

    this.stopContinuous();
    this.forgetRecording();

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

      // 先留住音频：即使识别失败，你也应该能回放自己刚才读的
      this.myRecording = wav;
      if (this.playbackButton) this.playbackButton.style.display = "";

      const settings = this.plugin.settings;
      const apiKey = this.plugin.apiKeys[settings.asrKeyId];
      if (!settings.asrKeyId || !apiKey) {
        this.setStatus("录音已保留，但识别未配置");
        this.setResult("语音识别尚未绑定 Key 或 Key 为空，请到插件设置里处理。");
        return;
      }

      const dataUri = bytesToDataUri(new Uint8Array(wav), "audio/wav");
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

      // 记下完整结果，作为「讲解」的输入
      this.lastPractice = {
        text: this.currentText,
        recognized: text,
        accuracy: score.accuracy,
        completeness: score.completeness,
        fluency: score.fluency,
        missing: stats.missing,
        extra: stats.extra,
        wrong: stats.wrong,
      };
      if (this.explainButton) this.explainButton.style.display = "";

      this.setStatus(
        `准确度 ${score.accuracy}　完整度 ${score.completeness}　流利度 ${score.fluency}　总分 ${score.overall}`,
      );
      this.setResult(
        [
          `识别：${text || "（空）"}`,
          `漏 ${stats.missing}　多 ${stats.extra}　错 ${stats.wrong}　用时 ${(
            recording.durationMs / 1000
          ).toFixed(1)} 秒`,
          "点「听我的」可以回放刚才的录音，和「听原句」对比。",
        ].join("\n"),
      );

      if (this.plugin.settings.llmAutoExplain) void this.explainPractice();
    } catch (error) {
      this.reportFailure("跟读评分", error);
    }
  }

  /**
   * 请文本模型解读这次练习。
   *
   * 提示词里有两条硬规则（设计文档 13.2 / 13.3）：只解释不翻译整句、
   * 没有值得练的词就返回空结果。所以这里的输出是"一段说明 + 最多两张卡片建议"。
   */
  private async explainPractice(): Promise<void> {
    const context = this.lastPractice;
    if (!context) return;

    const settings = this.plugin.settings;
    const apiKey = this.plugin.apiKeys[settings.llmKeyId];
    if (!settings.llmKeyId || !apiKey) {
      this.reportFailure("讲解", new Error("尚未绑定文本模型的 Key，请到插件设置里处理。"));
      return;
    }

    this.setStatus("模型分析中…");
    try {
      const feedback = await requestPracticeFeedback(
        this.app,
        {
          baseUrl: settings.llmBaseUrl,
          apiKey,
          model: settings.llmModel,
          transport: settings.llmTransport,
        },
        context,
      );

      const lines: string[] = [];
      if (feedback.explain) lines.push(`讲解：${feedback.explain}`);
      for (const card of feedback.cards) {
        lines.push(`卡片建议：${card.term} → ${card.cloze}`);
      }

      // 把模型建议的词直接变成复习卡片 —— 这是"学过就忘"那个洞的入口
      const added = await this.saveSuggestedCards(feedback.cards.map((card) => card.term));
      if (added > 0) lines.push(`已加入复习卡片：${added} 张（见 _lingo/cards.md）`);

      this.appendResult(lines.length > 0 ? lines.join("\n") : "模型没有给出额外说明。");
      this.setStatus("讲解完成");
    } catch (error) {
      this.reportFailure("讲解", error);
    }
  }

  // 把建议的词做成卡片并写进 cards.md。返回实际新增数量（重复的会被跳过）。
  private async saveSuggestedCards(terms: string[]): Promise<number> {
    const source = this.sourceLink();
    if (source === "" || this.currentText.trim() === "" || terms.length === 0) return 0;

    const existing = await readCards(this.app);
    const ids = existing.map((card) => card.id);
    const today = new Date();

    const drafts = terms
      .filter((term) => term.trim() !== "")
      .map((term) => {
        const id = makeCardId(ids, term);
        ids.push(id);
        return createCard(id, term, this.currentText, source, today);
      });

    return addCards(this.app, drafts);
  }

  /** 当前笔记的 wikilink —— 卡片靠它产生反向链接。 */
  private sourceLink(): string {
    const file = this.app.workspace.getActiveFile();
    return file ? `[[${file.basename}]]` : "";
  }

  private async playMyRecording(): Promise<void> {
    if (!this.myRecording) return;
    this.setStatus("播放我的录音…");
    try {
      await playAudioBytes(this.myRecording, "audio/wav");
      this.setStatus("已播放我的录音");
    } catch (error) {
      this.reportFailure("回放录音", error);
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
    this.scheduleReposition();
  }

  private setResult(text: string): void {
    this.resultEl?.setText(text);
    this.scheduleReposition();
  }

  /** 追加而不是覆盖：讲解要跟分数一起看，不能被冲掉。 */
  private appendResult(text: string): void {
    const current = this.resultEl?.textContent ?? "";
    this.setResult(current.trim() === "" ? text : `${current}\n${text}`);
  }

  private dispose(): void {
    this.stopContinuous();
    this.cancelRecording();
    this.forgetRecording();
    this.bar?.remove();
    this.bar = null;
    this.statusEl = null;
    this.resultEl = null;
    this.shadowButton = null;
    this.playbackButton = null;
    this.explainButton = null;
    this.continuousButton = null;
  }
}

function asElement(node: Node): Element | null {
  return node instanceof HTMLElement ? node : node.parentElement;
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
