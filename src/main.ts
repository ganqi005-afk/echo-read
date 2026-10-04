import { Notice, Plugin } from "obsidian";
import { RecorderModal } from "./recorder-modal";
import { ReadingController } from "./reader/controller";
import { loadKeyValues } from "./settings/store";
import { pruneAudioCache } from "./store/audio-cache";
import { ensurePracticePromptFile } from "./llm/client";
import { generateReviewQueue } from "./review/store";
import { EchoReadSettingTab } from "./settings/tab";
import { DEFAULT_SETTINGS, mergeSettings, type EchoReadSettings } from "./settings/types";

export default class EchoReadPlugin extends Plugin {
  settings: EchoReadSettings = DEFAULT_SETTINGS;

  /** 已保存的 Key，按 Key ID 索引。明文存储，见 design 15.3 的修订说明。 */
  apiKeys: Record<string, string> = {};

  async onload(): Promise<void> {
    this.settings = mergeSettings(
      (await this.loadData()) as Partial<EchoReadSettings> | null,
    );
    this.apiKeys = await loadKeyValues(this.app);
    // 把默认提示词写到 vault 里，用户才能直接编辑它
    void ensurePracticePromptFile(this.app).catch(() => undefined);
    this.addSettingTab(new EchoReadSettingTab(this.app, this));
    this.addRibbonIcon("mic", "Echo Read：录音工作台", () => this.openRecorder());
    this.addCommand({
      id: "open-recorder",
      name: "打开录音工作台",
      callback: () => this.openRecorder(),
    });
    this.addCommand({
      id: "build-review-queue",
      name: "生成今日复习队列",
      callback: () => void this.buildReviewQueue(),
    });
    // 阅读视图交互：点句聚焦 + 底部操作条
    new ReadingController(this.app, this).register();

    // 启动时按设置淘汰过期或超量的示范音缓存，避免无限增长
    void pruneAudioCache(this.app, {
      maxAgeDays: this.settings.audioCacheMaxAgeDays,
      maxBytes: this.settings.audioCacheMaxBytes,
    })
      .then((removed) => {
        if (removed > 0) console.log(`[Echo Read] 已清理 ${removed} 个缓存音频`);
      })
      .catch((error) => console.error("[Echo Read] 清理缓存失败", error));

    console.log("Echo Read loaded");
  }

  openRecorder(): void {
    new RecorderModal(this.app, this).open();
  }

  /**
   * 生成今日复习队列到 _lingo/review.md。
   *
   * 会先消化上一份队列里的勾选结果，再投影出今天的清单 ——
   * 所以「记得」是推进到下一档的信号，而不是一个装饰性的对勾。
   */
  async buildReviewQueue(notify = true): Promise<void> {
    try {
      const result = await generateReviewQueue(this.app, new Date());
      if (notify) {
        new Notice(
          `今日复习：${result.queued} 张` +
            (result.advanced > 0 ? `，上次勾选的 ${result.advanced} 张已推进到下一档` : ""),
        );
      }
    } catch (error) {
      if (notify) new Notice(`生成复习队列失败：${messageOf(error)}`);
    }
  }

  async updateSettings(patch: Partial<EchoReadSettings>): Promise<void> {
    this.settings = mergeSettings({ ...this.settings, ...patch });
    await this.saveData(this.settings);
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
