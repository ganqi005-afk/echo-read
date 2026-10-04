import { Plugin } from "obsidian";
import { RecorderModal } from "./recorder-modal";
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
    this.addRibbonIcon("mic", "Echo Read：录音工作台", () => this.openRecorder());
    this.addCommand({
      id: "open-recorder",
      name: "打开录音工作台",
      callback: () => this.openRecorder(),
    });
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
