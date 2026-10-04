import { Plugin } from "obsidian";
import { RecorderModal } from "./recorder-modal";
import { ReadingController } from "./reader/controller";
import { loadKeyValues } from "./settings/store";
import { pruneAudioCache } from "./store/audio-cache";
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
    this.addSettingTab(new EchoReadSettingTab(this.app, this));
    this.addRibbonIcon("mic", "Echo Read：录音工作台", () => this.openRecorder());
    this.addCommand({
      id: "open-recorder",
      name: "打开录音工作台",
      callback: () => this.openRecorder(),
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

  async updateSettings(patch: Partial<EchoReadSettings>): Promise<void> {
    this.settings = mergeSettings({ ...this.settings, ...patch });
    await this.saveData(this.settings);
  }
}
