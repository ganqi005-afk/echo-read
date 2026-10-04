import { App, Notice, PluginSettingTab, Setting } from "obsidian";
import { bytesToDataUri } from "../core/base64";
import { encodeWav } from "../core/wav";
import { playAudioBytes } from "../audio/playback";
import type EchoReadPlugin from "../main";
import {
  buildEndpoint,
  listModels,
  previewRequestBody,
  probeApiKey,
  transcribeAudio,
  type Transport,
} from "../speech/client";
import { describeProbeOutcome } from "../speech/key-probe";
import { guessMimeType, previewTtsBody, synthesizeSpeech } from "../speech/tts-client";
import { loadVoices } from "../speech/tts-system";
import { audioCachePath, readCachedAudio, writeCachedAudio } from "../store/audio-cache";
import { deleteTestSample, hasTestSample, loadTestSample } from "../store/sample";
import {
  describeApiKeyKind,
  describeKeyEndpointMismatch,
} from "./key-format";
import {
  deleteKey,
  listKeys,
  makeKeyId,
  saveKey,
  unlockAllKeys,
  type KeySummary,
} from "./store";
import {
  SPEECH_PRESETS,
  TEXT_PRESETS,
  findPreset,
  type Preset,
  type TtsMode,
} from "./types";

const TRANSPORT_LABELS: Record<Transport, string> = {
  "dashscope-native": "DashScope 原生",
  "openai-compatible": "OpenAI 兼容",
};

export class EchoReadSettingTab extends PluginSettingTab {
  private readonly plugin: EchoReadPlugin;
  private keys: KeySummary[] = [];
  private passphrase = "";
  private newKeyLabel = "";
  private newKeyValue = "";
  private diagnosticEl: HTMLElement | null = null;
  private diagnosticLines: string[] = [];

  constructor(app: App, plugin: EchoReadPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    void this.render();
  }

  private async render(): Promise<void> {
    const { containerEl } = this;
    containerEl.empty();
    this.keys = await listKeys(this.app);

    containerEl.createEl("h2", { text: "Echo Read 设置" });

    this.renderKeys();
    this.renderAsr();
    this.renderTts();
    this.renderLlm();
    this.renderReading();
    this.renderDiagnostics();
  }

  // ---------------- 密钥 ----------------

  private renderKeys(): void {
    const { containerEl } = this;
    containerEl.createEl("h3", { text: "密钥" });
    containerEl.createEl("p", {
      cls: "setting-item-description",
      text:
        "所有 Key 用同一个口令加密保存到 _lingo/secrets.json，口令不落盘。" +
        "不同能力可以绑定不同的 Key —— 例如语音用普通 Key、文本用 Token Plan 的 Key。",
    });

    if (this.keys.length === 0) {
      containerEl.createEl("p", {
        text: "还没有保存任何 Key。",
        cls: "setting-item-description",
      });
    }

    for (const key of this.keys) {
      const unlocked = this.plugin.unlockedKeys[key.id] !== undefined;
      new Setting(containerEl)
        .setName(key.label)
        .setDesc(`${describeApiKeyKind(key.kind)}　·　${unlocked ? "已解锁" : "未解锁"}`)
        .addButton((button) =>
          button.setButtonText("删除").setWarning().onClick(async () => {
            await deleteKey(this.app, key.id);
            new Notice(`已删除「${key.label}」。`);
            this.display();
          }),
        );
    }

    new Setting(containerEl)
      .setName("新增 Key")
      .setDesc("名称只是给你自己看的标签，例如「语音」「Token Plan」。")
      .addText((text) =>
        text.setPlaceholder("名称").onChange((value) => {
          this.newKeyLabel = value;
        }),
      )
      .addText((text) => {
        text.inputEl.type = "password";
        text.setPlaceholder("API Key").onChange((value) => {
          this.newKeyValue = value;
        });
      })
      .addButton((button) =>
        button.setButtonText("保存").setCta().onClick(async () => {
          if (!this.passphrase) {
            new Notice("请先填写下方的加密口令。");
            return;
          }
          if (!this.newKeyLabel.trim() || !this.newKeyValue.trim()) {
            new Notice("名称和 Key 都要填。");
            return;
          }
          const id = makeKeyId(
            this.keys.map((item) => item.id),
            this.newKeyLabel,
          );
          try {
            await saveKey(this.app, id, this.newKeyLabel.trim(), this.newKeyValue.trim(), this.passphrase);
            this.plugin.unlockedKeys[id] = this.newKeyValue.trim();
            this.newKeyLabel = "";
            this.newKeyValue = "";
            new Notice("已加密保存并解锁。");
            this.display();
          } catch (error) {
            new Notice(`保存失败：${messageOf(error)}`);
          }
        }),
      );

    new Setting(containerEl)
      .setName("加密口令")
      .setDesc("同一个口令解锁全部 Key。忘记口令只能重新填写一次各个 Key，不会丢失其他数据。")
      .addText((text) => {
        text.inputEl.type = "password";
        text.setPlaceholder("本设备口令").onChange((value) => {
          this.passphrase = value;
        });
      })
      .addButton((button) =>
        button.setButtonText("解锁全部").onClick(async () => {
          if (!this.passphrase) {
            new Notice("请先填写加密口令。");
            return;
          }
          try {
            this.plugin.unlockedKeys = await unlockAllKeys(this.app, this.passphrase);
            new Notice(`已解锁 ${Object.keys(this.plugin.unlockedKeys).length} 把 Key。`);
            this.display();
          } catch {
            new Notice("解锁失败：口令不正确。");
          }
        }),
      );
  }

  // ---------------- 语音识别 ----------------

  private renderAsr(): void {
    const { containerEl } = this;
    containerEl.createEl("h3", { text: "语音识别" });

    this.addPresetSetting(containerEl, "平台预设", SPEECH_PRESETS, this.plugin.settings.asrPresetId, async (preset) => {
      await this.plugin.updateSettings({
        asrPresetId: preset.id,
        asrTransport: preset.transport,
        asrBaseUrl: preset.baseUrl,
      });
      this.display();
    });

    this.addKeyBinding(containerEl, "使用的 Key", this.plugin.settings.asrKeyId, async (keyId) => {
      await this.plugin.updateSettings({ asrKeyId: keyId });
    });

    new Setting(containerEl).setName("协议").addDropdown((dropdown) => {
      dropdown.addOption("dashscope-native", TRANSPORT_LABELS["dashscope-native"]);
      dropdown.addOption("openai-compatible", TRANSPORT_LABELS["openai-compatible"]);
      dropdown.setValue(this.plugin.settings.asrTransport).onChange(async (value) => {
        await this.plugin.updateSettings({ asrTransport: value as Transport });
      });
    });

    new Setting(containerEl)
      .setName("接入地址")
      .addText((text) =>
        text.setValue(this.plugin.settings.asrBaseUrl).onChange(async (value) => {
          await this.plugin.updateSettings({ asrBaseUrl: value.trim() });
        }),
      );

    new Setting(containerEl)
      .setName("识别模型")
      .addText((text) =>
        text.setValue(this.plugin.settings.asrModel).onChange(async (value) => {
          await this.plugin.updateSettings({ asrModel: value.trim() });
        }),
      );

    new Setting(containerEl)
      .setName("测试识别")
      .setDesc(
        "用已保存的测试音频（没有则用 1.5 秒静音）发一次真实识别请求。" +
          "静音可能被判为「没有语音」，建议先在录音工作台录一句并「存为测试音频」。",
      )
      .addButton((button) =>
        button.setButtonText("开始测试").onClick(async () => {
          button.setDisabled(true);
          button.setButtonText("测试中…");
          await this.runWithDiagnostics(button, "开始测试", "测试中…", this.asrContext(), () =>
            this.runConnectionTest(),
          );
        }),
      );
  }

  // ---------------- 语音合成 ----------------

  private renderTts(): void {
    const { containerEl } = this;
    containerEl.createEl("h3", { text: "语音合成" });

    new Setting(containerEl)
      .setName("朗读方式")
      .setDesc("系统语音免费且离线；云端合成按字符计费（约 0.8～1 元/万字符）。")
      .addDropdown((dropdown) => {
        dropdown.addOption("system", "系统语音（免费）");
        dropdown.addOption("cloud", "云端合成（按字符计费）");
        dropdown.setValue(this.plugin.settings.ttsMode).onChange(async (value) => {
          await this.plugin.updateSettings({ ttsMode: value as TtsMode });
        });
      });

    this.addPresetSetting(containerEl, "平台预设", SPEECH_PRESETS, this.plugin.settings.ttsPresetId, async (preset) => {
      await this.plugin.updateSettings({
        ttsPresetId: preset.id,
        ttsBaseUrl: preset.baseUrl,
      });
      this.display();
    });

    this.addKeyBinding(containerEl, "使用的 Key", this.plugin.settings.ttsKeyId, async (keyId) => {
      await this.plugin.updateSettings({ ttsKeyId: keyId });
    });

    new Setting(containerEl)
      .setName("接入地址")
      .setDesc("走 HTTP 接口，与识别通道彼此独立。")
      .addText((text) =>
        text.setValue(this.plugin.settings.ttsBaseUrl).onChange(async (value) => {
          await this.plugin.updateSettings({ ttsBaseUrl: value.trim() });
        }),
      );

    new Setting(containerEl)
      .setName("合成模型")
      .addText((text) =>
        text.setValue(this.plugin.settings.ttsModel).onChange(async (value) => {
          await this.plugin.updateSettings({ ttsModel: value.trim() });
        }),
      );

    new Setting(containerEl)
      .setName("音色")
      .setDesc("必填，接口没有默认值。文档示例：longanhuan_v3.6 / longxiaochun。")
      .addText((text) =>
        text.setValue(this.plugin.settings.ttsVoice).onChange(async (value) => {
          await this.plugin.updateSettings({ ttsVoice: value.trim() });
        }),
      );

    new Setting(containerEl)
      .setName("试听云端音色")
      .setDesc("合成一句固定的英文并播放，结果按「模型 + 音色 + 格式 + 文本」缓存。")
      .addButton((button) =>
        button.setButtonText("试听").onClick(async () => {
          button.setDisabled(true);
          button.setButtonText("合成中…");
          await this.runWithDiagnostics(
            button,
            "试听",
            "合成中…",
            [
              "用途：云端合成试听",
              `合成模型：${this.plugin.settings.ttsModel}`,
              `音色：${this.plugin.settings.ttsVoice}`,
              `绑定 Key：${this.describeBoundKey(this.plugin.settings.ttsKeyId)}`,
            ],
            () => this.auditionCloudVoice(),
          );
        }),
      );
  }

  // ---------------- 文本能力 ----------------

  private renderLlm(): void {
    const { containerEl } = this;
    containerEl.createEl("h3", { text: "文本能力（预留）" });
    containerEl.createEl("p", {
      cls: "setting-item-description",
      text:
        "用于弱项解释与卡片选词。Token Plan 的语音能力在插件内不可用，" +
        "但它的文本模型走 OpenAI 兼容协议，在这里可以正常使用。功能尚未接入。",
    });

    this.addPresetSetting(containerEl, "平台预设", TEXT_PRESETS, this.plugin.settings.llmPresetId, async (preset) => {
      await this.plugin.updateSettings({
        llmPresetId: preset.id,
        llmTransport: preset.transport,
        llmBaseUrl: preset.baseUrl,
      });
      this.display();
    });

    this.addKeyBinding(containerEl, "使用的 Key", this.plugin.settings.llmKeyId, async (keyId) => {
      await this.plugin.updateSettings({ llmKeyId: keyId });
    });

    new Setting(containerEl)
      .setName("接入地址")
      .addText((text) =>
        text.setValue(this.plugin.settings.llmBaseUrl).onChange(async (value) => {
          await this.plugin.updateSettings({ llmBaseUrl: value.trim() });
        }),
      );

    new Setting(containerEl)
      .setName("模型")
      .addText((text) =>
        text.setValue(this.plugin.settings.llmModel).onChange(async (value) => {
          await this.plugin.updateSettings({ llmModel: value.trim() });
        }),
      );
  }

  // ---------------- 朗读 ----------------

  private renderReading(): void {
    const { containerEl } = this;
    containerEl.createEl("h3", { text: "系统语音" });

    new Setting(containerEl)
      .setName("语速")
      .addSlider((slider) =>
        slider
          .setLimits(0.5, 1.5, 0.05)
          .setValue(this.plugin.settings.speechRate)
          .setDynamicTooltip()
          .onChange(async (value) => {
            await this.plugin.updateSettings({ speechRate: value });
          }),
      );

    new Setting(containerEl)
      .setName("音色")
      .setDesc("留空使用系统默认英语音色。")
      .addDropdown((dropdown) => {
        dropdown.addOption("", "系统默认");
        void loadVoices().then((voices) => {
          for (const voice of voices.filter((v) => v.lang.toLowerCase().startsWith("en"))) {
            dropdown.addOption(voice.voiceURI, `${voice.name} (${voice.lang})`);
          }
          dropdown.setValue(this.plugin.settings.voiceURI);
        });
        dropdown.onChange(async (value) => {
          await this.plugin.updateSettings({ voiceURI: value });
        });
      });
  }

  // ---------------- 诊断 ----------------

  private renderDiagnostics(): void {
    const { containerEl } = this;
    containerEl.createEl("h3", { text: "诊断" });

    const sampleSetting = new Setting(containerEl).setName("测试音频").setDesc("检查中…");
    void this.refreshSampleDescription(sampleSetting);
    sampleSetting.addButton((button) =>
      button.setButtonText("清除").onClick(async () => {
        await deleteTestSample(this.app);
        new Notice("已清除测试音频。");
        this.display();
      }),
    );

    new Setting(containerEl)
      .setName("只测 Key（不发音频）")
      .setDesc("发一个参数不完整的请求：Key 无效会在鉴权阶段被拒，Key 有效则会走到参数校验。")
      .addButton((button) =>
        button.setButtonText("检测 Key").onClick(async () => {
          button.setDisabled(true);
          button.setButtonText("检测中…");
          await this.runWithDiagnostics(button, "检测 Key", "检测中…", this.asrContext(), async () => {
            const result = await this.runKeyProbe();
            return [describeProbeOutcome(result), `服务端原文：${result.detail || "（空）"}`].join("\n");
          });
        }),
      );

    new Setting(containerEl)
      .setName("列出可用模型")
      .setDesc("调用该渠道的 GET /models，确认模型 ID 是否真的存在。")
      .addButton((button) =>
        button.setButtonText("获取列表").onClick(async () => {
          button.setDisabled(true);
          button.setButtonText("获取中…");
          await this.runWithDiagnostics(button, "获取列表", "获取中…", this.asrContext(), async () => {
            const ids = await this.runModelList();
            return `共 ${ids.length} 个模型：\n${ids.join("\n")}`;
          });
        }),
      );

    this.diagnosticEl = containerEl.createEl("pre");
    this.diagnosticEl.style.whiteSpace = "pre-wrap";
    this.diagnosticEl.style.userSelect = "text";
    this.diagnosticEl.style.maxHeight = "320px";
    this.diagnosticEl.style.overflow = "auto";
    this.diagnosticEl.style.fontSize = "12px";
    this.diagnosticEl.style.lineHeight = "1.5";

    new Setting(containerEl)
      .setName("复制诊断信息")
      .addButton((button) =>
        button.setButtonText("复制").onClick(async () => {
          try {
            await navigator.clipboard.writeText(this.diagnosticLines.join("\n"));
            new Notice("已复制。");
          } catch {
            new Notice("复制失败，请手动选中上面的文本。");
          }
        }),
      );
  }

  // ---------------- 共用小部件 ----------------

  private addPresetSetting(
    containerEl: HTMLElement,
    name: string,
    presets: readonly Preset[],
    currentId: string,
    onChange: (preset: Preset) => Promise<void>,
  ): void {
    new Setting(containerEl)
      .setName(name)
      .setDesc(findPreset(currentId)?.note ?? "")
      .addDropdown((dropdown) => {
        for (const preset of presets) dropdown.addOption(preset.id, preset.name);
        dropdown.setValue(currentId);
        dropdown.onChange(async (value) => {
          const preset = findPreset(value);
          if (preset) await onChange(preset);
        });
      });
  }

  private addKeyBinding(
    containerEl: HTMLElement,
    name: string,
    currentId: string,
    onChange: (keyId: string) => Promise<void>,
  ): void {
    new Setting(containerEl)
      .setName(name)
      .setDesc(
        this.keys.length === 0
          ? "尚未保存任何 Key，请先在上方「密钥」里添加。"
          : "选择这个能力使用哪把 Key。",
      )
      .addDropdown((dropdown) => {
        dropdown.addOption("", "（未绑定）");
        for (const key of this.keys) {
          dropdown.addOption(key.id, `${key.label} · ${describeApiKeyKind(key.kind)}`);
        }
        dropdown.setValue(currentId);
        dropdown.onChange(async (value) => {
          await onChange(value);
        });
      });
  }

  private describeBoundKey(keyId: string): string {
    if (!keyId) return "未绑定";
    const found = this.keys.find((key) => key.id === keyId);
    return found ? `${found.label}（${describeApiKeyKind(found.kind)}）` : keyId;
  }

  /** 说明当前识别通道的配置，供诊断头部使用。 */
  private asrContext(): string[] {
    return [
      "用途：语音识别",
      `协议：${this.plugin.settings.asrTransport}`,
      `识别模型：${this.plugin.settings.asrModel}`,
      `绑定 Key：${this.describeBoundKey(this.plugin.settings.asrKeyId)}`,
    ];
  }

  private async refreshSampleDescription(setting: { setDesc(value: string): unknown }): Promise<void> {
    const exists = await hasTestSample(this.app);
    setting.setDesc(
      exists
        ? "已保存一段真实录音，测试会用它而不是静音。"
        : "尚未保存。在录音工作台录一句英文并点「存为测试音频」，测试结果才有参考价值。",
    );
  }

  private async runWithDiagnostics(
    button: { setDisabled(value: boolean): unknown; setButtonText(value: string): unknown },
    idleLabel: string,
    busyLabel: string,
    context: string[],
    action: () => Promise<string>,
  ): Promise<void> {
    this.diagnosticLines = [];
    this.appendDiagnostic(`构建时间：${__BUILD_TIME__}`);
    this.appendDiagnostic(`时间：${new Date().toLocaleString()}`);
    for (const line of context) this.appendDiagnostic(line);

    try {
      const result = await action();
      this.appendDiagnostic("结果：成功");
      this.appendDiagnostic(result);
      new Notice("成功，详见下方诊断信息。", 8000);
    } catch (error) {
      this.appendDiagnostic("结果：失败");
      this.appendDiagnostic(messageOf(error));
      new Notice("失败，详见下方诊断信息。", 8000);
    } finally {
      button.setDisabled(false);
      button.setButtonText(idleLabel);
    }
  }

  private appendDiagnostic(line: string): void {
    this.diagnosticLines.push(line);
    this.diagnosticEl?.setText(this.diagnosticLines.join("\n"));
  }

  // ---------------- 各诊断动作 ----------------

  private requireKey(keyId: string, capability: string): string {
    if (!keyId) throw new Error(`尚未为「${capability}」绑定 Key。`);
    const value = this.plugin.unlockedKeys[keyId];
    if (!value) throw new Error(`「${this.describeBoundKey(keyId)}」尚未解锁，请先点「解锁全部」。`);
    return value;
  }

  private async runConnectionTest(): Promise<string> {
    const apiKey = this.requireKey(this.plugin.settings.asrKeyId, "语音识别");
    if (!this.plugin.settings.asrBaseUrl) throw new Error("尚未填写接入地址。");

    const mismatch = describeKeyEndpointMismatch(apiKey, this.plugin.settings.asrBaseUrl);
    if (mismatch) this.appendDiagnostic(`⚠ ${mismatch}`);

    const saved = await loadTestSample(this.app);
    const wav = saved ?? encodeWav(new Float32Array(16000 * 1.5), 16000);
    const dataUri = bytesToDataUri(new Uint8Array(wav), "audio/wav");

    this.appendDiagnostic(
      `请求地址：${buildEndpoint(this.plugin.settings.asrBaseUrl, this.plugin.settings.asrTransport)}`,
    );
    this.appendDiagnostic(
      saved
        ? `音频：已保存的真实录音，base64 后 ${Math.round(dataUri.length / 1024)} KB`
        : `音频：1.5 秒静音（可能被判为「没有语音」），base64 后 ${Math.round(dataUri.length / 1024)} KB`,
    );
    this.appendDiagnostic(
      `请求体预览：\n${previewRequestBody(
        {
          transport: this.plugin.settings.asrTransport,
          model: this.plugin.settings.asrModel,
        },
        dataUri,
      )}`,
    );

    const text = await transcribeAudio(
      {
        baseUrl: this.plugin.settings.asrBaseUrl,
        apiKey,
        model: this.plugin.settings.asrModel,
        transport: this.plugin.settings.asrTransport,
      },
      dataUri,
    );
    return `识别结果：${text || "（空）"}`;
  }

  private async runKeyProbe() {
    const apiKey = this.requireKey(this.plugin.settings.asrKeyId, "语音识别");
    return probeApiKey({
      baseUrl: this.plugin.settings.asrBaseUrl,
      apiKey,
      model: this.plugin.settings.asrModel,
      transport: this.plugin.settings.asrTransport,
    });
  }

  private async runModelList(): Promise<string[]> {
    const apiKey = this.requireKey(this.plugin.settings.asrKeyId, "语音识别");
    return listModels({ baseUrl: this.plugin.settings.asrBaseUrl, apiKey });
  }

  private async auditionCloudVoice(): Promise<string> {
    const apiKey = this.requireKey(this.plugin.settings.ttsKeyId, "语音合成");

    const { ttsBaseUrl, ttsModel, ttsVoice } = this.plugin.settings;
    if (!ttsBaseUrl) throw new Error("尚未填写接入地址。");
    if (!ttsVoice) throw new Error("尚未填写音色 —— 合成接口的 voice 是必填项。");

    const mismatch = describeKeyEndpointMismatch(apiKey, ttsBaseUrl);
    if (mismatch) this.appendDiagnostic(`⚠ ${mismatch}`);

    const format = "mp3";
    const text = "The plan is ready.";

    this.appendDiagnostic(`合成地址：${ttsBaseUrl}/api/v1/services/audio/tts/SpeechSynthesizer`);
    this.appendDiagnostic(
      `请求体预览：\n${previewTtsBody(
        { baseUrl: ttsBaseUrl, apiKey, model: ttsModel, voice: ttsVoice, format },
        text,
      )}`,
    );

    const path = await audioCachePath(text, ttsVoice, ttsModel, format);
    let bytes = await readCachedAudio(this.app, path);
    const cached = bytes !== undefined;
    if (!bytes) {
      const result = await synthesizeSpeech(
        { baseUrl: ttsBaseUrl, apiKey, model: ttsModel, voice: ttsVoice, format },
        text,
      );
      bytes = result.bytes;
      await writeCachedAudio(this.app, path, bytes);
    }

    await playAudioBytes(bytes, guessMimeType(format));
    return [
      `待合成文本：${text}`,
      `音频字节：${bytes.byteLength} B`,
      cached ? "命中缓存，未产生费用" : `已缓存到 ${path}`,
    ].join("\n");
  }

}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
