import { App, Notice, PluginSettingTab, Setting } from "obsidian";
import { bytesToDataUri } from "../core/base64";
import { encodeWav } from "../core/wav";
import {
  buildEndpoint,
  listModels,
  previewRequestBody,
  probeApiKey,
  transcribeAudio,
  type Transport,
} from "../speech/client";
import { describeProbeOutcome } from "../speech/key-probe";
import { loadVoices } from "../speech/tts-system";
import { guessMimeType, synthesizeSpeech } from "../speech/tts-client";
import type EchoReadPlugin from "../main";
import { audioCachePath, readCachedAudio, writeCachedAudio } from "../store/audio-cache";
import { deleteTestSample, hasTestSample, loadTestSample } from "../store/sample";
import {
  classifyApiKey,
  describeApiKeyKind,
  describeKeyEndpointMismatch,
} from "./key-format";
import { deleteSecret, hasSecret, loadSecret, saveSecret } from "./store";
import {
  PROVIDER_PRESETS,
  SECRET_KEY_NAME,
  findPreset,
  type ProviderPresetId,
  type TtsMode,
} from "./types";

const TRANSPORT_LABELS: Record<Transport, string> = {
  "dashscope-native": "DashScope 原生",
  "openai-compatible": "OpenAI 兼容",
};

export class EchoReadSettingTab extends PluginSettingTab {
  private readonly plugin: EchoReadPlugin;
  private passphrase = "";
  private keyDraft = "";
  private diagnosticEl: HTMLElement | null = null;
  private diagnosticLines: string[] = [];

  constructor(app: App, plugin: EchoReadPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "Echo Read 设置" });

    this.renderProvider();
    this.renderModels();
    this.renderCredentials();
    this.renderSpeech();
    this.renderDiagnostics();
  }

  // ---------- 接入渠道 ----------

  private renderProvider(): void {
    const { containerEl } = this;
    containerEl.createEl("h3", { text: "接入渠道" });

    new Setting(containerEl)
      .setName("服务商")
      .setDesc("切换渠道会同时更新协议与接入地址，二者仍可手动改。")
      .addDropdown((dropdown) => {
        for (const preset of PROVIDER_PRESETS) {
          dropdown.addOption(preset.id, preset.name);
        }
        dropdown.setValue(this.plugin.settings.presetId).onChange(async (value) => {
          const preset = findPreset(value as ProviderPresetId);
          await this.plugin.updateSettings({
            presetId: preset.id,
            transport: preset.transport,
            baseUrl: preset.baseUrl,
          });
          this.display();
        });
      });

    const preset = findPreset(this.plugin.settings.presetId);
    containerEl.createEl("p", { text: preset.note, cls: "setting-item-description" });

    new Setting(containerEl)
      .setName("协议")
      .setDesc("DashScope 原生走 multimodal-generation 接口；OpenAI 兼容走 chat/completions。")
      .addDropdown((dropdown) => {
        dropdown.addOption("dashscope-native", TRANSPORT_LABELS["dashscope-native"]);
        dropdown.addOption("openai-compatible", TRANSPORT_LABELS["openai-compatible"]);
        dropdown.setValue(this.plugin.settings.transport).onChange(async (value) => {
          await this.plugin.updateSettings({ transport: value as Transport });
        });
      });

    new Setting(containerEl)
      .setName("接入地址（Base URL）")
      .setDesc("不包含具体路径，插件会按协议自行拼接。")
      .addText((text) =>
        text
          .setPlaceholder("https://dashscope.aliyuncs.com")
          .setValue(this.plugin.settings.baseUrl)
          .onChange(async (value) => {
            await this.plugin.updateSettings({ baseUrl: value.trim() });
          }),
      );
  }

  // ---------- 模型 ----------

  private renderModels(): void {
    const { containerEl } = this;
    containerEl.createEl("h3", { text: "模型" });

    new Setting(containerEl)
      .setName("语音识别模型")
      .setDesc("默认 qwen-audio-3.0-asr-flash（0.00022 元/秒）。")
      .addText((text) =>
        text.setValue(this.plugin.settings.asrModel).onChange(async (value) => {
          await this.plugin.updateSettings({ asrModel: value.trim() });
        }),
      );

  }

  // ---------- 凭据 ----------

  private renderCredentials(): void {
    const { containerEl } = this;
    containerEl.createEl("h3", { text: "凭据" });

    const preset = findPreset(this.plugin.settings.presetId);
    const status = containerEl.createEl("p", { cls: "setting-item-description" });
    void this.renderCredentialStatus(status, preset.keyPrefixHint);

    new Setting(containerEl)
      .setName("API Key")
      .setDesc(`该渠道的 Key 以 ${preset.keyPrefixHint} 开头。Key 会用下面的口令加密后存入 vault。`)
      .addText((text) => {
        text.inputEl.type = "password";
        text.setPlaceholder("sk-…").onChange((value) => {
          this.keyDraft = value;
        });
      });

    new Setting(containerEl)
      .setName("加密口令")
      .setDesc("口令本身不会被保存，忘记口令只能重新填写一次 API Key。")
      .addText((text) => {
        text.inputEl.type = "password";
        text.setPlaceholder("本设备口令").onChange((value) => {
          this.passphrase = value;
        });
      });

    new Setting(containerEl)
      .setName("保存并解锁")
      .setDesc("加密写入 _lingo/secrets.json，并把明文只留在内存中。")
      .addButton((button) =>
        button.setButtonText("保存 Key").setCta().onClick(async () => {
          if (!this.passphrase) {
            new Notice("请先填写加密口令。");
            return;
          }
          if (!this.keyDraft) {
            new Notice("请先填写 API Key。");
            return;
          }
          try {
            await saveSecret(this.app, SECRET_KEY_NAME, this.keyDraft, this.passphrase);
            this.plugin.unlockedApiKey = this.keyDraft;
            this.keyDraft = "";
            new Notice("已加密保存并解锁。");
            this.display();
          } catch (error) {
            new Notice(`保存失败：${messageOf(error)}`);
          }
        }),
      )
      .addButton((button) =>
        button.setButtonText("仅解锁").onClick(async () => {
          if (!this.passphrase) {
            new Notice("请先填写加密口令。");
            return;
          }
          try {
            this.plugin.unlockedApiKey = await loadSecret(
              this.app,
              SECRET_KEY_NAME,
              this.passphrase,
            );
            new Notice("已解锁。");
            this.display();
          } catch {
            new Notice("解锁失败：口令不正确，或尚未保存过 Key。");
          }
        }),
      )
      .addButton((button) =>
        button.setButtonText("清除").setWarning().onClick(async () => {
          await deleteSecret(this.app, SECRET_KEY_NAME);
          this.plugin.unlockedApiKey = undefined;
          new Notice("已清除保存的 Key。");
          this.display();
        }),
      );
  }

  private async renderCredentialStatus(
    element: HTMLElement,
    keyPrefixHint: string,
  ): Promise<void> {
    const saved = await hasSecret(this.app, SECRET_KEY_NAME);
    const unlocked = this.plugin.unlockedApiKey !== undefined;
    element.setText(
      saved
        ? unlocked
          ? "状态：已保存，且当前已解锁。"
          : "状态：已保存，但未解锁 —— 请填写口令后点「仅解锁」。"
        : `状态：尚未保存。该渠道的 Key 以 ${keyPrefixHint} 开头。`,
    );

    const key = this.plugin.unlockedApiKey;
    if (!key) return;

    element.setText(
      `${element.getText()} 当前 Key 类型：${describeApiKeyKind(classifyApiKey(key))}。`,
    );

    const mismatch = describeKeyEndpointMismatch(key, this.plugin.settings.baseUrl);
    if (mismatch) {
      element.createEl("br");
      element.createEl("strong", { text: `⚠ ${mismatch}` });
    }
  }

  // ---------- 朗读 ----------

  private renderSpeech(): void {
    const { containerEl } = this;
    containerEl.createEl("h3", { text: "朗读" });

    new Setting(containerEl)
      .setName("语速")
      .setDesc("系统语音的朗读速度。")
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
      .setName("系统音色")
      .setDesc("留空则使用系统默认英语音色。列表由系统提供，加载可能需要一点时间。")
      .addDropdown((dropdown) => {
        dropdown.addOption("", "系统默认");
        void loadVoices().then((voices) => {
          const english = voices.filter((voice) => voice.lang.toLowerCase().startsWith("en"));
          for (const voice of english) {
            dropdown.addOption(voice.voiceURI, `${voice.name} (${voice.lang})`);
          }
          dropdown.setValue(this.plugin.settings.voiceURI);
        });
        dropdown.onChange(async (value) => {
          await this.plugin.updateSettings({ voiceURI: value });
        });
      });

    containerEl.createEl("h3", { text: "云端合成（可选）" });
    containerEl.createEl("p", {
      cls: "setting-item-description",
      text:
        "用百炼/千问AI平台的语音合成接口生成示范音，音色比系统语音好。" +
        "合成结果会按「模型 + 音色 + 格式 + 文本」缓存，同一句只付一次费用。",
    });

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

    new Setting(containerEl)
      .setName("合成地址")
      .setDesc("走 HTTP 接口。注意这与识别通道是独立的，可以填不同域名。")
      .addText((text) =>
        text
          .setPlaceholder("https://maas.qianwenaiapi.com")
          .setValue(this.plugin.settings.ttsBaseUrl)
          .onChange(async (value) => {
            await this.plugin.updateSettings({ ttsBaseUrl: value.trim() });
          }),
      );

    new Setting(containerEl)
      .setName("合成模型")
      .setDesc("默认 qwen-audio-3.0-tts-flash；音色更丰富的可换 qwen-audio-3.0-tts-plus。")
      .addText((text) =>
        text.setValue(this.plugin.settings.ttsModel).onChange(async (value) => {
          await this.plugin.updateSettings({ ttsModel: value.trim() });
        }),
      );

    new Setting(containerEl)
      .setName("音色")
      .setDesc("合成接口的 voice 是必填项，没有默认值。文档示例：longanhuan_v3.6 / longxiaochun。")
      .addText((text) =>
        text.setValue(this.plugin.settings.ttsVoice).onChange(async (value) => {
          await this.plugin.updateSettings({ ttsVoice: value.trim() });
        }),
      );

    new Setting(containerEl)
      .setName("试听云端音色")
      .setDesc("合成一句固定的英文并播放，用来确认地址、模型、音色、Key 是否都对。")
      .addButton((button) =>
        button.setButtonText("试听").onClick(async () => {
          button.setDisabled(true);
          button.setButtonText("合成中…");
          try {
            const note = await this.auditionCloudVoice();
            new Notice(`试听成功（${note}）。`);
          } catch (error) {
            new Notice(`试听失败：${messageOf(error)}`, 12000);
          } finally {
            button.setDisabled(false);
            button.setButtonText("试听");
          }
        }),
      );
  }

  private async auditionCloudVoice(): Promise<string> {
    const apiKey = this.plugin.unlockedApiKey;
    if (!apiKey) throw new Error("尚未解锁 API Key。");

    const { ttsBaseUrl, ttsModel, ttsVoice } = this.plugin.settings;
    if (!ttsBaseUrl) throw new Error("尚未填写合成地址。");
    if (!ttsVoice) throw new Error("尚未填写音色 —— 合成接口的 voice 是必填项。");

    const format = "mp3";
    const text = "The plan is ready.";
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

    await this.playAudioBytes(bytes, guessMimeType(format));
    return cached ? "命中缓存，未产生费用" : `已缓存到 ${path}`;
  }

  private async playAudioBytes(bytes: ArrayBuffer, mimeType: string): Promise<void> {
    const url = URL.createObjectURL(new Blob([bytes], { type: mimeType }));
    const audio = new Audio(url);
    audio.addEventListener("ended", () => URL.revokeObjectURL(url));
    await audio.play();
  }

  // ---------- 诊断 ----------

  private renderDiagnostics(): void {
    const { containerEl } = this;
    containerEl.createEl("h3", { text: "诊断" });

    const endpoint = this.plugin.settings.baseUrl
      ? buildEndpoint(this.plugin.settings.baseUrl, this.plugin.settings.transport)
      : "（尚未填写接入地址）";
    containerEl.createEl("p", {
      text: `实际请求地址：${endpoint}`,
      cls: "setting-item-description",
    });

    new Setting(containerEl)
      .setName("测试连接")
      .setDesc(
        "发送一段音频做一次真实识别请求。默认用静音，但静音可能被判为「没有语音」，" +
          "那种失败与配置无关 —— 建议先在录音工作台录一句英文并存为测试音频。",
      )
      .addButton((button) =>
        button.setButtonText("开始测试").onClick(async () => {
          button.setDisabled(true);
          button.setButtonText("测试中…");
          await this.runWithDiagnostics(button, "开始测试", "测试中…", () =>
            this.runConnectionTest(),
          );
        }),
      );

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
      .setName("列出可用模型")
      .setDesc(
        "调用该渠道的 GET /models，确认某个模型 ID 在本渠道是否真的存在。" +
          "完整列表会打印到控制台（Ctrl+Shift+I）。",
      )
      .addButton((button) =>
        button.setButtonText("获取列表").onClick(async () => {
          button.setDisabled(true);
          button.setButtonText("获取中…");
          await this.runWithDiagnostics(button, "获取列表", "获取中…", async () => {
            const ids = await this.runModelList();
            return `共 ${ids.length} 个模型：\n${ids.join("\n")}`;
          });
        }),
      );

    new Setting(containerEl)
      .setName("只测 Key（不发音频）")
      .setDesc(
        "故意发一个参数不完整的请求：Key 无效会在鉴权阶段被拒（401），" +
          "Key 有效则会走到参数校验并报参数错误。用来把「鉴权问题」和「音频问题」分开。",
      )
      .addButton((button) =>
        button.setButtonText("检测 Key").onClick(async () => {
          button.setDisabled(true);
          button.setButtonText("检测中…");
          await this.runWithDiagnostics(button, "检测 Key", "检测中…", async () => {
            const result = await this.runKeyProbe();
            return [
              describeProbeOutcome(result),
              `服务端原文：${result.detail || "（空）"}`,
            ].join("\n");
          });
        }),
      );

    this.diagnosticEl = containerEl.createEl("pre", { cls: "echo-read-diagnostic" });
    this.diagnosticEl.style.whiteSpace = "pre-wrap";
    this.diagnosticEl.style.userSelect = "text";
    this.diagnosticEl.style.maxHeight = "320px";
    this.diagnosticEl.style.overflow = "auto";
    this.diagnosticEl.style.fontSize = "12px";
    this.diagnosticEl.style.lineHeight = "1.5";
    this.diagnosticEl.setText(this.diagnosticLines.join("\n"));

    new Setting(containerEl)
      .setName("复制诊断信息")
      .setDesc("把上面的内容复制到剪贴板，便于排查。")
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

  private async runWithDiagnostics(
    button: { setDisabled(value: boolean): unknown; setButtonText(value: string): unknown },
    idleLabel: string,
    busyLabel: string,
    action: () => Promise<string>,
  ): Promise<void> {
    this.diagnosticLines = [];
    this.appendDiagnostic(`构建时间：${__BUILD_TIME__}`);
    this.appendDiagnostic(`时间：${new Date().toLocaleString()}`);
    this.appendDiagnostic(`协议：${this.plugin.settings.transport}`);
    this.appendDiagnostic(`模型：${this.plugin.settings.asrModel}`);
    this.appendDiagnostic(
      `Key：${this.plugin.unlockedApiKey ? "已解锁" : "未解锁（请先点「仅解锁」）"}`,
    );

    const key = this.plugin.unlockedApiKey;
    if (key) {
      this.appendDiagnostic(`Key 类型：${describeApiKeyKind(classifyApiKey(key))}`);
      const mismatch = describeKeyEndpointMismatch(key, this.plugin.settings.baseUrl);
      if (mismatch) this.appendDiagnostic(`⚠ ${mismatch}`);
    }

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

  private async refreshSampleDescription(setting: { setDesc(value: string): unknown }): Promise<void> {
    const exists = await hasTestSample(this.app);
    setting.setDesc(
      exists
        ? "已保存一段真实录音，「测试连接」会用它而不是静音。"
        : "尚未保存。在录音工作台录一句英文并点「存为测试音频」，测试结果才有参考价值。",
    );
  }

  private async runConnectionTest(): Promise<string> {
    const apiKey = this.plugin.unlockedApiKey;
    if (!apiKey) throw new Error("尚未解锁 API Key。");
    if (!this.plugin.settings.baseUrl) throw new Error("尚未填写接入地址。");

    const saved = await loadTestSample(this.app);
    const wav = saved ?? encodeWav(new Float32Array(16000 * 1.5), 16000);
    const dataUri = bytesToDataUri(new Uint8Array(wav), "audio/wav");

    this.appendDiagnostic(`请求地址：${buildEndpoint(this.plugin.settings.baseUrl, this.plugin.settings.transport)}`);
    this.appendDiagnostic(
      saved
        ? `音频：已保存的真实录音，base64 后 ${Math.round(dataUri.length / 1024)} KB`
        : `音频：1.5 秒静音（可能被判为「没有语音」，建议改为真实录音），base64 后 ${Math.round(dataUri.length / 1024)} KB`,
    );
    this.appendDiagnostic(
      `请求体预览：\n${previewRequestBody(
        {
          transport: this.plugin.settings.transport,
          model: this.plugin.settings.asrModel,
        },
        dataUri,
      )}`,
    );

    return transcribeAudio(
      {
        baseUrl: this.plugin.settings.baseUrl,
        apiKey,
        model: this.plugin.settings.asrModel,
        transport: this.plugin.settings.transport,
      },
      dataUri,
    );
  }

  private async runModelList(): Promise<string[]> {
    const apiKey = this.plugin.unlockedApiKey;
    if (!apiKey) throw new Error("尚未解锁 API Key。");
    if (!this.plugin.settings.baseUrl) throw new Error("尚未填写接入地址。");
    return listModels({ baseUrl: this.plugin.settings.baseUrl, apiKey });
  }

  private async runKeyProbe() {
    const apiKey = this.plugin.unlockedApiKey;
    if (!apiKey) throw new Error("尚未解锁 API Key。");
    if (!this.plugin.settings.baseUrl) throw new Error("尚未填写接入地址。");
    return probeApiKey({
      baseUrl: this.plugin.settings.baseUrl,
      apiKey,
      model: this.plugin.settings.asrModel,
      transport: this.plugin.settings.transport,
    });
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
