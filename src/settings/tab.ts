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
import { chatCompletion } from "../llm/client";
import {
  guessMimeType,
  previewTtsBody,
  resolveTtsEndpoint,
  synthesizeSpeech,
} from "../speech/tts-client";
import {
  detectTtsFamily,
  ttsFamilySpec,
  voiceSignature,
} from "../speech/tts-request";
import { loadVoices } from "../speech/tts-system";
import {
  audioCachePath,
  cacheSynthesizedAudio,
  clearAudioCache,
  formatBytes,
  listAudioCache,
  pruneAudioCache,
  readAudioIndex,
  readCachedAudio,
  recentIndexEntries,
  summarizeCache,
} from "../store/audio-cache";
import { deleteTestSample, hasTestSample, loadTestSample } from "../store/sample";
import {
  describeApiKeyKind,
  describeKeyEndpointMismatch,
} from "./key-format";
import {
  deleteKey,
  listKeys,
  loadKeyValues,
  makeKeyId,
  saveKey,
  type KeySummary,
} from "./store";
import {
  SPEECH_PRESETS,
  TEXT_PRESETS,
  findPreset,
  toTtsVoice,
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
    this.renderCache();
    this.renderDiagnostics();
  }

  // ---------------- 密钥 ----------------

  private renderKeys(): void {
    const { containerEl } = this;
    containerEl.createEl("h3", { text: "密钥" });
    containerEl.createEl("p", {
      cls: "setting-item-description",
      text:
        "Key 明文保存在 _lingo/keys.json，会随 vault 一起同步到云端。" +
        "不同能力可以绑定不同的 Key —— 例如语音用普通 Key、文本用 Token Plan 的 Key。",
    });

    if (this.keys.length === 0) {
      containerEl.createEl("p", {
        text: "还没有保存任何 Key。",
        cls: "setting-item-description",
      });
    }

    for (const key of this.keys) {
      new Setting(containerEl)
        .setName(key.label)
        .setDesc(
          key.hasValue
            ? describeApiKeyKind(key.kind)
            : `${describeApiKeyKind(key.kind)}　·　⚠ 值为空，需要重新填写`,
        )
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
          if (!this.newKeyLabel.trim() || !this.newKeyValue.trim()) {
            new Notice("名称和 Key 都要填。");
            return;
          }
          const id = makeKeyId(
            this.keys.map((item) => item.id),
            this.newKeyLabel,
          );
          try {
            await saveKey(this.app, id, this.newKeyLabel.trim(), this.newKeyValue.trim());
            this.plugin.apiKeys = await loadKeyValues(this.app);
            this.newKeyLabel = "";
            this.newKeyValue = "";
            new Notice("已保存。");
            this.display();
          } catch (error) {
            new Notice(`保存失败：${messageOf(error)}`);
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
          this.display();
        }),
      );

    this.renderTtsFamilyNote(containerEl);

    new Setting(containerEl)
      .setName("音色")
      .setDesc("必填，接口没有默认值。文档示例：longanhuan_v3.6 / longxiaochun。")
      .addText((text) =>
        text.setValue(this.plugin.settings.ttsVoice).onChange(async (value) => {
          await this.plugin.updateSettings({ ttsVoice: value.trim() });
        }),
      );

    containerEl.createEl("p", {
      cls: "setting-item-description",
      text:
        "⚠ 改动下面任何一项，缓存键都会变化 —— 同一句话会重新合成一次并重新计费。" +
        "全部保持默认时，缓存键与旧版本一致，已有缓存不受影响。",
    });

    new Setting(containerEl)
      .setName("语速")
      .setDesc("取值范围 0.5–2.0，默认 1。放慢能帮助听清连读。")
      .addSlider((slider) =>
        slider
          .setLimits(0.5, 2, 0.05)
          .setValue(this.plugin.settings.ttsRate)
          .setDynamicTooltip()
          .onChange(async (value) => {
            await this.plugin.updateSettings({ ttsRate: value });
          }),
      );

    new Setting(containerEl)
      .setName("音量")
      .setDesc("取值范围 0–100，默认 50。")
      .addSlider((slider) =>
        slider
          .setLimits(0, 100, 5)
          .setValue(this.plugin.settings.ttsVolume)
          .setDynamicTooltip()
          .onChange(async (value) => {
            await this.plugin.updateSettings({ ttsVolume: value });
          }),
      );

    new Setting(containerEl)
      .setName("音调")
      .setDesc("取值范围 0.5–2.0，默认 1。")
      .addSlider((slider) =>
        slider
          .setLimits(0.5, 2, 0.05)
          .setValue(this.plugin.settings.ttsPitch)
          .setDynamicTooltip()
          .onChange(async (value) => {
            await this.plugin.updateSettings({ ttsPitch: value });
          }),
      );

    new Setting(containerEl)
      .setName("音频格式")
      .setDesc("默认 mp3。wav 无损但体积大，opus 体积最小。")
      .addDropdown((dropdown) => {
        for (const format of ["mp3", "wav", "opus", "pcm"]) {
          dropdown.addOption(format, format);
        }
        dropdown.setValue(this.plugin.settings.ttsFormat).onChange(async (value) => {
          await this.plugin.updateSettings({ ttsFormat: value });
        });
      });

    new Setting(containerEl)
      .setName("采样率")
      .setDesc("常用 16000 / 24000 / 48000。改这个也会产生新的缓存。")
      .addText((text) =>
        text.setValue(String(this.plugin.settings.ttsSampleRate)).onChange(async (value) => {
          const rate = Number(value);
          if (!Number.isFinite(rate) || rate <= 0) return;
          await this.plugin.updateSettings({ ttsSampleRate: Math.round(rate) });
        }),
      );

    new Setting(containerEl)
      .setName("语种提示")
      .setDesc("如 en。留空则不传，由模型自行判断。")
      .addText((text) =>
        text.setPlaceholder("en").setValue(this.plugin.settings.ttsLanguage).onChange(async (value) => {
          await this.plugin.updateSettings({ ttsLanguage: value.trim() });
        }),
      );

    new Setting(containerEl)
      .setName("指令控制")
      .setDesc(
        "用自然语言描述方言、情感或角色，例如「用缓慢、清晰的教学语气朗读」。留空则不传。" +
          "并非所有模型都支持。",
      )
      .addText((text) =>
        text
          .setPlaceholder("例如：用缓慢清晰的语气朗读")
          .setValue(this.plugin.settings.ttsInstruction)
          .onChange(async (value) => {
            await this.plugin.updateSettings({ ttsInstruction: value });
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

  /**
   * 显示由模型名推断出的系列与实际请求地址。
   *
   * 这一条是必须的：官方明确"端点不可混用"，而端点是由模型系列决定的，
   * 把它显示出来，用户换模型时才能立刻看出端点跟着变了。
   */
  private renderTtsFamilyNote(containerEl: HTMLElement): void {
    const { ttsModel, ttsBaseUrl } = this.plugin.settings;
    const family = ttsFamilySpec(detectTtsFamily(ttsModel));

    containerEl.createEl("p", {
      cls: "setting-item-description",
      text: `识别为「${family.name}」系列 —— ${family.note}`,
    });
    containerEl.createEl("p", {
      cls: "setting-item-description",
      text: ttsBaseUrl
        ? `实际请求地址：${resolveTtsEndpoint(ttsBaseUrl, ttsModel)}`
        : "尚未填写接入地址。",
    });
    containerEl.createEl("p", {
      cls: "setting-item-description",
      text: `该系列的音色示例：${family.voiceExample}`,
    });
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

    new Setting(containerEl)
      .setName("跟读后自动讲解")
      .setDesc("开启后，每次跟读评分都会自动请模型解读。会产生调用费用，按需开启。")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.llmAutoExplain).onChange(async (value) => {
          await this.plugin.updateSettings({ llmAutoExplain: value });
        }),
      );

    new Setting(containerEl)
      .setName("测试文本模型")
      .setDesc("发一个极短的请求，确认地址、模型、Key 是否可用。")
      .addButton((button) =>
        button.setButtonText("测试").onClick(async () => {
          button.setDisabled(true);
          button.setButtonText("请求中…");
          await this.runWithDiagnostics(button, "测试", "请求中…", this.llmContext(), () =>
            this.testLlm(),
          );
        }),
      );
  }

  // ---------------- 朗读 ----------------

  private renderReading(): void {
    const { containerEl } = this;
    containerEl.createEl("h3", { text: "朗读与交互" });

    new Setting(containerEl)
      .setName("点句即朗读")
      .setDesc(
        "点任意一句就直接读出来，省掉「先选中再点按钮」那一步。" +
          "关掉后点句只选中、不发声。",
      )
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.speakOnClick).onChange(async (value) => {
          await this.plugin.updateSettings({ speakOnClick: value });
        }),
      );

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

  // ---------------- 缓存 ----------------

  private renderCache(): void {
    const { containerEl } = this;
    containerEl.createEl("h3", { text: "示范音缓存" });
    containerEl.createEl("p", {
      cls: "setting-item-description",
      text:
        "合成过的句子按「模型 + 音色 + 格式 + 文本」缓存在 _lingo/audio/。" +
        "同一句第二次朗读不再产生费用 —— 这是这个项目最有效的省钱手段。",
    });

    const stats = new Setting(containerEl).setName("当前占用").setDesc("统计中…");
    void this.refreshCacheStats(stats);
    void this.renderCachedSamples(containerEl);

    containerEl.createEl("p", {
      cls: "setting-item-description",
      text: "已有缓存的句子在阅读视图里会带一条虚线标记 —— 点它一定瞬间出声、不产生费用。",
    });

    new Setting(containerEl)
      .setName("自动清理天数")
      .setDesc("超过这个天数的缓存会在插件启动时删除。填 0 表示不按天数清理。")
      .addText((text) =>
        text.setValue(String(this.plugin.settings.audioCacheMaxAgeDays)).onChange(async (value) => {
          const days = Number(value);
          if (!Number.isFinite(days) || days < 0) return;
          await this.plugin.updateSettings({ audioCacheMaxAgeDays: Math.floor(days) });
        }),
      );

    new Setting(containerEl)
      .setName("体积上限（MB）")
      .setDesc("超出后从**最旧的**开始删，最近用过的句子优先留下。填 0 表示不限制。")
      .addText((text) =>
        text.setValue(String(Math.round(this.plugin.settings.audioCacheMaxBytes / 1024 / 1024)))
          .onChange(async (value) => {
            const mb = Number(value);
            if (!Number.isFinite(mb) || mb < 0) return;
            await this.plugin.updateSettings({ audioCacheMaxBytes: Math.round(mb * 1024 * 1024) });
          }),
      );

    new Setting(containerEl)
      .setName("立即清理")
      .setDesc("按上面的规则淘汰一次。")
      .addButton((button) =>
        button.setButtonText("执行清理").onClick(async () => {
          const removed = await pruneAudioCache(this.app, {
            maxAgeDays: this.plugin.settings.audioCacheMaxAgeDays,
            maxBytes: this.plugin.settings.audioCacheMaxBytes,
          });
          new Notice(removed > 0 ? `已清理 ${removed} 个缓存文件。` : "没有需要清理的缓存。");
          this.display();
        }),
      );

    new Setting(containerEl)
      .setName("清空缓存")
      .setDesc(
        "删除全部缓存。删掉**只是下次重新生成**，不会丢失任何笔记内容 —— " +
          "代价是那些句子要重新付一次合成费。",
      )
      .addButton((button) =>
        button.setButtonText("全部清空").setWarning().onClick(async () => {
          const removed = await clearAudioCache(this.app);
          new Notice(`已清空 ${removed} 个缓存文件。`);
          this.display();
        }),
      );
  }

  private async refreshCacheStats(setting: { setDesc(value: string): unknown }): Promise<void> {
    const stats = summarizeCache(await listAudioCache(this.app));
    setting.setDesc(
      stats.count === 0
        ? "还没有缓存。朗读过的句子会自动存到这里。"
        : `已缓存 ${stats.count} 句，占用 ${formatBytes(stats.bytes)}。这些句子重读不再计费。`,
    );
  }

  /**
   * 把缓存里的句子原文列出来。文件名是内容哈希，人看不懂 ——
   * 没有这一步，缓存就只是个数字，你无法核对到底存了什么。
   */
  private async renderCachedSamples(containerEl: HTMLElement): Promise<void> {
    const recent = recentIndexEntries(await readAudioIndex(this.app), 10);
    if (recent.length === 0) return;

    containerEl.createEl("p", {
      cls: "setting-item-description",
      text: "最近缓存的句子（重读不再计费）：",
    });

    const list = containerEl.createEl("ul");
    for (const entry of recent) {
      const preview = entry.text.length > 60 ? `${entry.text.slice(0, 60)}…` : entry.text;
      const item = list.createEl("li", { text: `${preview}　—　${entry.voice} · ${entry.model}` });
      item.style.fontSize = "var(--font-ui-smaller)";
      item.style.color = "var(--text-muted)";
    }
  }

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

  private llmContext(): string[] {
    return [
      "用途：文本模型",
      `接入地址：${buildEndpoint(this.plugin.settings.llmBaseUrl, this.plugin.settings.llmTransport)}`,
      `模型：${this.plugin.settings.llmModel}`,
      `绑定 Key：${this.describeBoundKey(this.plugin.settings.llmKeyId)}`,
    ];
  }

  private async testLlm(): Promise<string> {
    const apiKey = this.requireKey(this.plugin.settings.llmKeyId, "文本能力");
    const reply = await chatCompletion(
      {
        baseUrl: this.plugin.settings.llmBaseUrl,
        apiKey,
        model: this.plugin.settings.llmModel,
        transport: this.plugin.settings.llmTransport,
      },
      "你是一个连通性测试助手。只回复两个字：可用。",
      "请回复。",
      32,
    );
    return `模型回复：${reply}`;
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
    const value = this.plugin.apiKeys[keyId];
    if (!value) {
      throw new Error(`「${this.describeBoundKey(keyId)}」的值是空的，请到「密钥」里重新填写。`);
    }
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

    const { ttsBaseUrl } = this.plugin.settings;
    if (!ttsBaseUrl) throw new Error("尚未填写接入地址。");
    if (!this.plugin.settings.ttsVoice) {
      throw new Error("尚未填写音色 —— 合成接口的 voice 是必填项。");
    }

    const mismatch = describeKeyEndpointMismatch(apiKey, ttsBaseUrl);
    if (mismatch) this.appendDiagnostic(`⚠ ${mismatch}`);

    const text = "The plan is ready.";
    const voice = toTtsVoice(this.plugin.settings);
    const signature = voiceSignature(voice);

    this.appendDiagnostic(`合成地址：${resolveTtsEndpoint(ttsBaseUrl, voice.model)}`);
    this.appendDiagnostic(`模型系列：${ttsFamilySpec(detectTtsFamily(voice.model)).name}`);
    this.appendDiagnostic(`请求体预览：\n${previewTtsBody(voice, text)}`);

    const path = await audioCachePath(signature, text, voice.format);
    let bytes = await readCachedAudio(this.app, path);
    const cached = bytes !== undefined;
    if (!bytes) {
      const result = await synthesizeSpeech({ baseUrl: ttsBaseUrl, apiKey, voice }, text);
      bytes = result.bytes;
      await cacheSynthesizedAudio(
        this.app,
        signature,
        { text, format: voice.format, voice: voice.voice, model: voice.model },
        bytes,
      );
    }

    await playAudioBytes(bytes, guessMimeType(voice.format));
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
