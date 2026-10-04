import { Plugin } from "obsidian";
import { installDebugHook } from "./debug";
import { EchoReadSettingTab } from "./settings/tab";
import { DEFAULT_SETTINGS, mergeSettings, type EchoReadSettings } from "./settings/types";

export default class EchoReadPlugin extends Plugin {
  settings: EchoReadSettings = DEFAULT_SETTINGS;

  /** 解密后的 API Key，只存在内存中（设计文档 15.3）。 */
  unlockedApiKey: string | undefined;

  async onload(): Promise<void> {
    this.settings = mergeSettings(
      (await this.loadData()) as Partial<EchoReadSettings> | null,
    );
    this.addSettingTab(new EchoReadSettingTab(this.app, this));
    installDebugHook(); // 临时：Plan 2 Task 9 验收用，验收后删除
    console.log("Echo Read loaded");
  }

  async updateSettings(patch: Partial<EchoReadSettings>): Promise<void> {
    this.settings = mergeSettings({ ...this.settings, ...patch });
    await this.saveData(this.settings);
  }
}
