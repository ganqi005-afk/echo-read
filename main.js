"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/main.ts
var main_exports = {};
__export(main_exports, {
  default: () => EchoReadPlugin
});
module.exports = __toCommonJS(main_exports);
var import_obsidian6 = require("obsidian");

// src/recorder-modal.ts
var import_obsidian2 = require("obsidian");

// src/core/resample.ts
function downsample(input, inputRate, outputRate) {
  if (outputRate >= inputRate) return input.slice();
  if (input.length === 0) return new Float32Array(0);
  const ratio = inputRate / outputRate;
  const length = Math.floor(input.length / ratio);
  const out = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    const start = Math.floor(i * ratio);
    const end = Math.min(input.length, Math.floor((i + 1) * ratio));
    let sum = 0;
    for (let j = start; j < end; j++) sum += input[j];
    out[i] = end > start ? sum / (end - start) : 0;
  }
  return out;
}

// src/audio/recorder.ts
var TARGET_SAMPLE_RATE = 16e3;
var MAX_RECORDING_MS = 6e4;
var Recorder = class {
  stream;
  recorder;
  chunks = [];
  startedAt = 0;
  async start() {
    if (this.recorder) throw new Error("录音已在进行中。");
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true }
    });
    this.chunks = [];
    this.startedAt = Date.now();
    this.recorder = new MediaRecorder(this.stream);
    this.recorder.ondataavailable = (event) => {
      if (event.data.size > 0) this.chunks.push(event.data);
    };
    this.recorder.start();
  }
  async stop() {
    const recorder = this.recorder;
    const stream = this.stream;
    if (!recorder || !stream) throw new Error("当前没有进行中的录音。");
    const blob = await new Promise((resolve) => {
      recorder.onstop = () => resolve(new Blob(this.chunks, { type: recorder.mimeType }));
      recorder.stop();
    });
    stream.getTracks().forEach((track) => track.stop());
    this.recorder = void 0;
    this.stream = void 0;
    const durationMs = Date.now() - this.startedAt;
    return decodeToMono16k(blob, durationMs);
  }
  get isRecording() {
    return this.recorder !== void 0;
  }
};
async function decodeToMono16k(blob, durationMs) {
  const arrayBuffer = await blob.arrayBuffer();
  const AudioCtx = window.AudioContext ?? window.webkitAudioContext;
  const context = new AudioCtx();
  try {
    const decoded = await context.decodeAudioData(arrayBuffer.slice(0));
    const channel = decoded.getChannelData(0);
    const samples = downsample(channel, decoded.sampleRate, TARGET_SAMPLE_RATE);
    return { samples, sampleRate: TARGET_SAMPLE_RATE, durationMs };
  } finally {
    void context.close();
  }
}

// src/core/base64.ts
var CHUNK_SIZE = 32768;
function bytesToBase64(bytes) {
  let binary = "";
  for (let i = 0; i < bytes.length; i += CHUNK_SIZE) {
    const chunk = bytes.subarray(i, i + CHUNK_SIZE);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}
function bytesToDataUri(bytes, mimeType) {
  return `data:${mimeType};base64,${bytesToBase64(bytes)}`;
}

// src/core/diff.ts
var SPELLING_EQUIVALENTS = {
  colour: "color",
  colours: "colors",
  favour: "favor",
  honour: "honor",
  labour: "labor",
  neighbour: "neighbor",
  behaviour: "behavior",
  centre: "center",
  theatre: "theater",
  metre: "meter",
  organise: "organize",
  organised: "organized",
  realise: "realize",
  realised: "realized",
  recognise: "recognize",
  travelling: "traveling",
  cancelled: "canceled",
  programme: "program"
};
var NUMBER_WORDS = {
  zero: "0",
  one: "1",
  two: "2",
  three: "3",
  four: "4",
  five: "5",
  six: "6",
  seven: "7",
  eight: "8",
  nine: "9",
  ten: "10",
  eleven: "11",
  twelve: "12",
  thirteen: "13",
  fourteen: "14",
  fifteen: "15",
  sixteen: "16",
  seventeen: "17",
  eighteen: "18",
  nineteen: "19",
  twenty: "20",
  thirty: "30",
  forty: "40",
  fifty: "50",
  sixty: "60",
  seventy: "70",
  eighty: "80",
  ninety: "90",
  hundred: "100",
  thousand: "1000"
};
function tokenize(text) {
  const raw = text.toLowerCase().match(/[a-z0-9']+(?:-[a-z0-9']+)*/g) ?? [];
  return raw.map((t) => t.replace(/^'+|'+$/g, "")).filter(Boolean);
}
function canonicalize(word) {
  const withoutHyphen = word.replace(/-/g, "");
  const spelled = SPELLING_EQUIVALENTS[withoutHyphen] ?? withoutHyphen;
  return NUMBER_WORDS[spelled] ?? spelled;
}
function diffDictation(expected, actual) {
  const e = tokenize(expected);
  const a = tokenize(actual);
  const rows = e.length + 1;
  const cols = a.length + 1;
  const dp = Array.from({ length: rows }, () => new Array(cols).fill(0));
  for (let i2 = 0; i2 < rows; i2++) dp[i2][0] = i2;
  for (let j2 = 0; j2 < cols; j2++) dp[0][j2] = j2;
  for (let i2 = 1; i2 < rows; i2++) {
    for (let j2 = 1; j2 < cols; j2++) {
      const same = canonicalize(e[i2 - 1]) === canonicalize(a[j2 - 1]);
      dp[i2][j2] = same ? dp[i2 - 1][j2 - 1] : 1 + Math.min(dp[i2 - 1][j2 - 1], dp[i2 - 1][j2], dp[i2][j2 - 1]);
    }
  }
  const tokens = [];
  let i = e.length;
  let j = a.length;
  while (i > 0 || j > 0) {
    const same = i > 0 && j > 0 && canonicalize(e[i - 1]) === canonicalize(a[j - 1]);
    if (i > 0 && j > 0 && same && dp[i][j] === dp[i - 1][j - 1]) {
      tokens.push({ kind: "ok", expected: e[i - 1], actual: a[j - 1] });
      i--;
      j--;
    } else if (i > 0 && j > 0 && dp[i][j] === dp[i - 1][j - 1] + 1) {
      tokens.push({ kind: "wrong", expected: e[i - 1], actual: a[j - 1] });
      i--;
      j--;
    } else if (i > 0 && dp[i][j] === dp[i - 1][j] + 1) {
      tokens.push({ kind: "missing", expected: e[i - 1] });
      i--;
    } else {
      tokens.push({ kind: "extra", actual: a[j - 1] });
      j--;
    }
  }
  tokens.reverse();
  const stats = {
    total: e.length,
    correct: tokens.filter((t) => t.kind === "ok").length,
    missing: tokens.filter((t) => t.kind === "missing").length,
    extra: tokens.filter((t) => t.kind === "extra").length,
    wrong: tokens.filter((t) => t.kind === "wrong").length,
    accuracy: 0
  };
  stats.accuracy = e.length === 0 ? 0 : Math.round(stats.correct / e.length * 1e3) / 10;
  return { tokens, stats };
}

// src/core/wav.ts
function encodeWav(samples, sampleRate) {
  const bytesPerSample = 2;
  const dataSize = samples.length * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);
  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * bytesPerSample, true);
  view.setUint16(32, bytesPerSample, true);
  view.setUint16(34, 16, true);
  writeAscii(view, 36, "data");
  view.setUint32(40, dataSize, true);
  let offset = 44;
  for (let i = 0; i < samples.length; i++) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, Math.round(clamped < 0 ? clamped * 32768 : clamped * 32767), true);
    offset += bytesPerSample;
  }
  return buffer;
}
function writeAscii(view, offset, text) {
  for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
}

// src/core/chunk.ts
function countWords(text) {
  return (text.match(/[A-Za-z0-9'\u2019-]+/g) ?? []).length;
}

// src/scoring/attempt.ts
var WORDS_PER_SECOND = 2.5;
var FLUENCY_LOW = 0.85;
var FLUENCY_HIGH = 1.3;
var FLUENCY_MIN_RATIO = 0.4;
var FLUENCY_MAX_RATIO = 2.2;
function scoreAttempt(expected, diff, durationMs) {
  const words = countWords(expected);
  if (words === 0) {
    return { accuracy: 0, completeness: 0, fluency: 0, overall: 0 };
  }
  const accuracy = diff.accuracy;
  const completeness = clamp100((words - diff.missing) / words * 100);
  const fluency = fluencyFromDuration(words, durationMs);
  const overall = Math.round(accuracy * 0.5 + completeness * 0.3 + fluency * 0.2);
  return { accuracy, completeness, fluency, overall };
}
function fluencyFromDuration(words, durationMs) {
  if (durationMs <= 0) return 0;
  const expectedSeconds = words / WORDS_PER_SECOND;
  const ratio = durationMs / 1e3 / expectedSeconds;
  if (ratio >= FLUENCY_LOW && ratio <= FLUENCY_HIGH) return 100;
  if (ratio < FLUENCY_LOW) {
    const span2 = FLUENCY_LOW - FLUENCY_MIN_RATIO;
    return clamp100((ratio - FLUENCY_MIN_RATIO) / span2 * 100);
  }
  const span = FLUENCY_MAX_RATIO - FLUENCY_HIGH;
  return clamp100((FLUENCY_MAX_RATIO - ratio) / span * 100);
}
function clamp100(value) {
  return Math.max(0, Math.min(100, round1(value)));
}
function round1(value) {
  return Math.round(value * 10) / 10;
}

// src/speech/client.ts
var import_obsidian = require("obsidian");

// src/speech/asr-request.ts
function buildAsrBody(options) {
  return {
    model: options.model,
    input: {
      messages: [
        {
          role: "user",
          content: [
            { type: "input_audio", input_audio: { data: options.audioDataUri } }
          ]
        }
      ]
    },
    parameters: {
      format: options.format ?? "wav",
      // 官方示例里 sample_rate 是**字符串**（"16000"），不是数字。
      // 按文档逐字对齐，避免服务端因类型不符直接拒绝。
      sample_rate: String(options.sampleRate ?? 16e3)
    }
  };
}
function buildOpenAiCompatibleBody(options) {
  return {
    model: options.model,
    stream: false,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "input_audio",
            input_audio: {
              data: options.audioDataUri,
              format: options.format ?? "wav"
            }
          }
        ]
      }
    ]
  };
}
function extractTranscript(payload) {
  const text = tryExtract(payload);
  if (text !== void 0 && text.trim() !== "") return text.trim();
  throw new Error(`无法从响应中提取识别文本。原始响应：${safeStringify(payload)}`);
}
function tryExtract(payload) {
  if (!payload || typeof payload !== "object") return void 0;
  const root = payload;
  const direct = readChoices(root);
  if (direct !== void 0) return direct;
  const output = root.output;
  if (!output || typeof output !== "object") return void 0;
  const node = output;
  if (typeof node.text === "string") return node.text;
  const nested = readChoices(node);
  if (nested !== void 0) return nested;
  const results = node.results;
  if (Array.isArray(results) && results.length > 0) {
    const first = results[0];
    if (typeof first?.transcription === "string") return first.transcription;
    if (typeof first?.text === "string") return first.text;
  }
  return void 0;
}
function readChoices(node) {
  const choices = node.choices;
  if (!Array.isArray(choices) || choices.length === 0) return void 0;
  const message = choices[0]?.message;
  const content = message?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    const joined = content.map((part) => {
      const text = part?.text;
      return typeof text === "string" ? text : "";
    }).join("");
    if (joined.trim() !== "") return joined;
  }
  return void 0;
}
function safeStringify(value) {
  try {
    return JSON.stringify(value).slice(0, 800);
  } catch {
    return "[无法序列化的响应]";
  }
}

// src/speech/models.ts
function extractModelIds(payload) {
  if (!payload || typeof payload !== "object") {
    throw new Error(`无法解析模型列表响应：${safeStringify2(payload)}`);
  }
  const data = payload.data;
  if (!Array.isArray(data)) {
    throw new Error(`模型列表响应里没有 data 数组：${safeStringify2(payload)}`);
  }
  const ids = [];
  for (const entry of data) {
    if (entry && typeof entry === "object") {
      const id = entry.id;
      if (typeof id === "string" && id !== "") ids.push(id);
    } else if (typeof entry === "string" && entry !== "") {
      ids.push(entry);
    }
  }
  return ids;
}
function safeStringify2(value) {
  try {
    return JSON.stringify(value).slice(0, 500);
  } catch {
    return "[无法序列化的响应]";
  }
}

// src/speech/key-probe.ts
function buildProbeBody(model, transport) {
  if (transport === "openai-compatible") {
    return { model, messages: [] };
  }
  return {
    model,
    input: { messages: [] },
    parameters: { format: "wav", sample_rate: "16000" }
  };
}
function classifyKeyProbe(status, body) {
  if (status === 401 || status === 403) return "invalid";
  if (status >= 200 && status < 300) return "valid";
  if (looksLikeServiceError(body)) return "valid";
  return "unknown";
}
function looksLikeServiceError(body) {
  if (!body || typeof body !== "object") return false;
  const node = body;
  return typeof node.request_id === "string" || typeof node.code === "string";
}
function describeProbeOutcome(result) {
  switch (result.outcome) {
    case "valid":
      return `鉴权已通过（HTTP ${result.status}）。服务端返回的是业务层或上游的错误 —— 探测请求本来就不完整，出现这个结果是预期内的。`;
    case "invalid":
      return `Key 被拒绝（HTTP ${result.status}）。请检查这把 Key 是否属于当前端点对应的平台与套餐。`;
    default:
      return `无法判断（HTTP ${result.status}）。服务端没有返回可用于判断的内容，通常是网关层直接拒绝。`;
  }
}

// src/speech/client.ts
var DEFAULT_BASE_URL = "https://dashscope.aliyuncs.com";
var DEFAULT_ASR_MODEL = "qwen-audio-3.0-asr-flash";
var DASHSCOPE_NATIVE_PATH = "/api/v1/services/aigc/multimodal-generation/generation";
var OPENAI_COMPATIBLE_PATH = "/chat/completions";
function buildEndpoint(baseUrl, transport) {
  const base = baseUrl.replace(/\/+$/, "");
  const path = transport === "openai-compatible" ? OPENAI_COMPATIBLE_PATH : DASHSCOPE_NATIVE_PATH;
  return `${base}${path}`;
}
function previewRequestBody(options, audioDataUri) {
  const body = options.transport === "openai-compatible" ? buildOpenAiCompatibleBody({
    model: options.model,
    audioDataUri,
    sampleRate: 16e3
  }) : buildAsrBody({ model: options.model, audioDataUri, sampleRate: 16e3 });
  return JSON.stringify(body, null, 2).replaceAll(
    audioDataUri,
    `«base64 音频，${audioDataUri.length} 字符»`
  );
}
async function listModels(options) {
  if (!options.apiKey) throw new Error("尚未配置 API Key。");
  const url = `${options.baseUrl.replace(/\/+$/, "")}/models`;
  const response = await (0, import_obsidian.requestUrl)({
    url,
    method: "GET",
    headers: { Authorization: `Bearer ${options.apiKey}` },
    throw: false
  });
  if (response.status < 200 || response.status >= 300) {
    const body = response.text ?? "";
    console.error("[Echo Read] 获取模型列表失败", {
      status: response.status,
      url,
      body
    });
    throw new Error(`获取模型列表失败（HTTP ${response.status}）：${truncate(body, 400)}`);
  }
  return extractModelIds(response.json);
}
async function probeApiKey(options) {
  if (!options.apiKey) throw new Error("尚未配置 API Key。");
  const url = buildEndpoint(options.baseUrl, options.transport);
  const response = await (0, import_obsidian.requestUrl)({
    url,
    method: "POST",
    headers: {
      Authorization: `Bearer ${options.apiKey}`,
      "Content-Type": "application/json",
      "X-DashScope-SSE": "disable"
    },
    body: JSON.stringify(buildProbeBody(options.model, options.transport)),
    throw: false
  });
  const body = response.text ?? "";
  return {
    outcome: classifyKeyProbe(response.status, safeJson(response.text)),
    status: response.status,
    detail: body.slice(0, 400)
  };
}
function safeJson(text) {
  if (!text) return void 0;
  try {
    return JSON.parse(text);
  } catch {
    return void 0;
  }
}
async function transcribeAudio(options, audioDataUri) {
  if (!options.apiKey) {
    throw new Error("尚未配置 API Key，请先在插件设置中填写。");
  }
  const url = buildEndpoint(options.baseUrl, options.transport);
  const requestBody = options.transport === "openai-compatible" ? buildOpenAiCompatibleBody({
    model: options.model,
    audioDataUri,
    sampleRate: 16e3
  }) : buildAsrBody({ model: options.model, audioDataUri, sampleRate: 16e3 });
  const response = await (0, import_obsidian.requestUrl)({
    url,
    method: "POST",
    headers: {
      Authorization: `Bearer ${options.apiKey}`,
      "Content-Type": "application/json",
      "X-DashScope-SSE": "disable"
    },
    body: JSON.stringify(requestBody),
    throw: false
  });
  if (response.status < 200 || response.status >= 300) {
    const body = response.text ?? "";
    console.error("[Echo Read] 语音识别请求失败", {
      status: response.status,
      url,
      body
    });
    throw new Error(
      `语音识别请求失败（HTTP ${response.status}）：${truncate(body, 600)}`
    );
  }
  return extractTranscript(response.json);
}
function truncate(text, limit = 600) {
  return text.length > limit ? `${text.slice(0, limit)}…` : text;
}

// src/store/sample.ts
var TEST_SAMPLE_PATH = "_lingo/test-sample.wav";
var TEST_SAMPLE_DIR = "_lingo";
async function hasTestSample(app) {
  return app.vault.adapter.exists(TEST_SAMPLE_PATH);
}
async function saveTestSample(app, wav) {
  const adapter = app.vault.adapter;
  if (!await adapter.exists(TEST_SAMPLE_DIR)) await adapter.mkdir(TEST_SAMPLE_DIR);
  await adapter.writeBinary(TEST_SAMPLE_PATH, wav);
}
async function loadTestSample(app) {
  const adapter = app.vault.adapter;
  if (!await adapter.exists(TEST_SAMPLE_PATH)) return void 0;
  return adapter.readBinary(TEST_SAMPLE_PATH);
}
async function deleteTestSample(app) {
  const adapter = app.vault.adapter;
  if (await adapter.exists(TEST_SAMPLE_PATH)) await adapter.remove(TEST_SAMPLE_PATH);
}

// src/recorder-modal.ts
var RecorderModal = class extends import_obsidian2.Modal {
  plugin;
  recorder;
  recording;
  wavBuffer;
  timerId;
  startedAt = 0;
  statusEl;
  resultEl;
  recordButton;
  playButton;
  transcribeButton;
  saveSampleButton;
  referenceInput;
  constructor(app, plugin) {
    super(app);
    this.plugin = plugin;
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.createEl("h2", { text: "Echo Read 录音工作台" });
    contentEl.createEl("p", {
      cls: "setting-item-description",
      text: `录音最长 ${MAX_RECORDING_MS / 1e3} 秒，采集后自动降采样到 16 kHz 单声道用于识别。`
    });
    this.statusEl = contentEl.createDiv({ text: "未开始。" });
    this.statusEl.style.margin = "12px 0";
    const buttons = contentEl.createDiv();
    buttons.style.display = "flex";
    buttons.style.gap = "8px";
    buttons.style.flexWrap = "wrap";
    buttons.style.marginBottom = "12px";
    this.recordButton = buttons.createEl("button", { text: "开始录音" });
    this.playButton = buttons.createEl("button", { text: "播放录音" });
    this.transcribeButton = buttons.createEl("button", { text: "转写并评分" });
    this.saveSampleButton = buttons.createEl("button", { text: "存为测试音频" });
    this.playButton.disabled = true;
    this.transcribeButton.disabled = true;
    this.saveSampleButton.disabled = true;
    this.recordButton.addEventListener("click", () => void this.toggleRecording());
    this.playButton.addEventListener("click", () => void this.playback());
    this.transcribeButton.addEventListener("click", () => void this.transcribe());
    this.saveSampleButton.addEventListener("click", () => void this.saveAsTestSample());
    new import_obsidian2.Setting(contentEl).setName("参考文本（可选）").setDesc("填上原句，转写后会同时给出准确度、完整度、流利度与总分。").addText((text) => {
      this.referenceInput = text.inputEl;
      text.setPlaceholder("The plan is ready.");
    });
    this.resultEl = contentEl.createEl("pre");
    this.resultEl.style.whiteSpace = "pre-wrap";
    this.resultEl.style.userSelect = "text";
    this.resultEl.style.maxHeight = "280px";
    this.resultEl.style.overflow = "auto";
    this.resultEl.style.fontSize = "12px";
    this.resultEl.style.lineHeight = "1.5";
  }
  onClose() {
    window.clearInterval(this.timerId);
    if (this.recorder) {
      void this.recorder.stop().catch(() => void 0);
      this.recorder = void 0;
    }
    this.contentEl.empty();
  }
  async toggleRecording() {
    if (this.recorder) {
      await this.stopRecording();
      return;
    }
    await this.startRecording();
  }
  async startRecording() {
    try {
      this.recorder = new Recorder();
      await this.recorder.start();
    } catch (error) {
      this.recorder = void 0;
      this.setStatus(`无法开始录音：${messageOf(error)}`);
      return;
    }
    this.startedAt = Date.now();
    this.wavBuffer = void 0;
    this.recording = void 0;
    this.recordButton.setText("停止录音");
    this.playButton.disabled = true;
    this.transcribeButton.disabled = true;
    this.saveSampleButton.disabled = true;
    this.setResult("");
    this.tick();
    this.timerId = window.setInterval(() => this.tick(), 200);
  }
  tick() {
    const elapsed = Date.now() - this.startedAt;
    this.setStatus(`● 录音中… ${(elapsed / 1e3).toFixed(1)} 秒（最长 ${MAX_RECORDING_MS / 1e3} 秒）`);
    if (elapsed >= MAX_RECORDING_MS) void this.stopRecording();
  }
  async stopRecording() {
    const recorder = this.recorder;
    if (!recorder) return;
    window.clearInterval(this.timerId);
    this.recorder = void 0;
    try {
      const recording = await recorder.stop();
      this.recording = recording;
      this.wavBuffer = encodeWav(recording.samples, recording.sampleRate);
    } catch (error) {
      this.setStatus(`录音失败：${messageOf(error)}`);
      this.recordButton.setText("开始录音");
      return;
    }
    this.recordButton.setText("开始录音");
    this.playButton.disabled = false;
    this.transcribeButton.disabled = false;
    this.saveSampleButton.disabled = false;
    const seconds = ((this.recording?.durationMs ?? 0) / 1e3).toFixed(1);
    const samples = this.recording?.samples.length ?? 0;
    const kb = Math.round((this.wavBuffer?.byteLength ?? 0) / 1024);
    this.setStatus(`录音完成：${seconds} 秒，${samples} 个采样，16-bit WAV 约 ${kb} KB。`);
  }
  async playback() {
    if (!this.wavBuffer) return;
    const url = URL.createObjectURL(new Blob([this.wavBuffer], { type: "audio/wav" }));
    const audio = new Audio(url);
    audio.addEventListener("ended", () => URL.revokeObjectURL(url));
    try {
      await audio.play();
    } catch (error) {
      URL.revokeObjectURL(url);
      new import_obsidian2.Notice(`播放失败：${messageOf(error)}`);
    }
  }
  async saveAsTestSample() {
    if (!this.wavBuffer) return;
    try {
      await saveTestSample(this.app, this.wavBuffer);
      new import_obsidian2.Notice("已存为测试音频。插件设置里的「测试连接」以后会用它，不再用静音。");
    } catch (error) {
      new import_obsidian2.Notice(`保存失败：${messageOf(error)}`);
    }
  }
  async transcribe() {
    const { asrKeyId, asrBaseUrl, asrModel, asrTransport } = this.plugin.settings;
    const apiKey = this.plugin.apiKeys[asrKeyId];
    if (!asrKeyId || !apiKey) {
      new import_obsidian2.Notice("请先在插件设置里为「语音识别」绑定一把 Key。");
      return;
    }
    if (!this.wavBuffer) {
      new import_obsidian2.Notice("请先录一段音。");
      return;
    }
    this.transcribeButton.disabled = true;
    this.setResult("转写中…");
    const dataUri = bytesToDataUri(new Uint8Array(this.wavBuffer), "audio/wav");
    try {
      const text = await transcribeAudio(
        {
          baseUrl: asrBaseUrl,
          apiKey,
          model: asrModel,
          transport: asrTransport
        },
        dataUri
      );
      this.renderTranscript(text);
    } catch (error) {
      this.setResult(`转写失败：${messageOf(error)}`);
    } finally {
      this.transcribeButton.disabled = false;
    }
  }
  renderTranscript(text) {
    const reference = this.referenceInput.value.trim();
    const lines = [`识别结果：${text || "（空）"}`];
    if (reference) {
      const stats = diffDictation(reference, text).stats;
      const score = scoreAttempt(reference, stats, this.recording?.durationMs ?? 0);
      lines.push("");
      lines.push(`准确度 ${score.accuracy}　完整度 ${score.completeness}　流利度 ${score.fluency}`);
      lines.push(`总分 ${score.overall}`);
      lines.push(
        `差异：漏 ${stats.missing}　多 ${stats.extra}　错 ${stats.wrong}`
      );
    }
    this.setResult(lines.join("\n"));
  }
  setStatus(text) {
    this.statusEl.setText(text);
  }
  setResult(text) {
    this.resultEl.setText(text);
  }
};
function messageOf(error) {
  return error instanceof Error ? error.message : String(error);
}

// src/reader/controller.ts
var import_obsidian4 = require("obsidian");

// src/audio/playback.ts
var current = null;
async function playAudioBytes(bytes, mimeType) {
  const url = URL.createObjectURL(new Blob([bytes], { type: mimeType }));
  const audio = new Audio(url);
  current = audio;
  try {
    await new Promise((resolve, reject) => {
      const cleanup = () => {
        URL.revokeObjectURL(url);
        if (current === audio) current = null;
      };
      audio.addEventListener("ended", () => {
        cleanup();
        resolve();
      });
      audio.addEventListener("error", () => {
        cleanup();
        reject(new Error("音频播放失败。"));
      });
      audio.play().catch((error) => {
        cleanup();
        reject(error);
      });
    });
  } catch (error) {
    if (current === audio) current = null;
    throw error;
  }
}
function stopPlayback() {
  if (!current) return;
  current.pause();
  current = null;
}

// src/speech/tts-system.ts
function loadVoices(timeoutMs = 2e3) {
  return new Promise((resolve) => {
    const immediate = speechSynthesis.getVoices();
    if (immediate.length > 0) {
      resolve(immediate);
      return;
    }
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      speechSynthesis.removeEventListener("voiceschanged", finish);
      resolve(speechSynthesis.getVoices());
    };
    speechSynthesis.addEventListener("voiceschanged", finish);
    window.setTimeout(finish, timeoutMs);
  });
}
function speak(text, options = {}) {
  return new Promise((resolve, reject) => {
    if (typeof speechSynthesis === "undefined") {
      reject(new Error("当前环境不支持系统语音。"));
      return;
    }
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "en-US";
    utterance.rate = options.rate ?? 1;
    if (options.voiceURI) {
      const voice = speechSynthesis.getVoices().find((v) => v.voiceURI === options.voiceURI);
      if (voice) utterance.voice = voice;
    }
    utterance.onend = () => resolve();
    utterance.onerror = () => reject(new Error("系统语音朗读失败。"));
    speechSynthesis.cancel();
    speechSynthesis.speak(utterance);
  });
}
function stopSpeaking() {
  if (typeof speechSynthesis !== "undefined") speechSynthesis.cancel();
}

// src/speech/tts-client.ts
var import_obsidian3 = require("obsidian");

// src/speech/tts-request.ts
function buildTtsBody(options) {
  return {
    model: options.model,
    input: {
      text: options.text,
      voice: options.voice,
      format: options.format ?? "mp3",
      sample_rate: options.sampleRate ?? 24e3
    }
  };
}
function extractAudioUrl(payload) {
  if (!payload || typeof payload !== "object") {
    throw new Error(`无法解析语音合成响应：${safeStringify3(payload)}`);
  }
  const audio = payload.output?.audio;
  if (!audio || typeof audio !== "object") {
    throw new Error(`语音合成响应里没有 audio 字段：${safeStringify3(payload)}`);
  }
  const node = audio;
  if (typeof node.url !== "string" || node.url === "") {
    throw new Error(`语音合成响应里没有可用的音频地址：${safeStringify3(payload)}`);
  }
  return {
    url: node.url,
    expiresAt: typeof node.expires_at === "number" ? node.expires_at : void 0
  };
}
function safeStringify3(value) {
  try {
    return JSON.stringify(value).slice(0, 500);
  } catch {
    return "[无法序列化的响应]";
  }
}

// src/speech/tts-client.ts
var TTS_HTTP_PATH = "/api/v1/services/audio/tts/SpeechSynthesizer";
function guessMimeType(format) {
  switch (format.toLowerCase()) {
    case "mp3":
      return "audio/mpeg";
    case "wav":
      return "audio/wav";
    case "pcm":
      return "audio/L16";
    default:
      return "application/octet-stream";
  }
}
function previewTtsBody(options, text) {
  return JSON.stringify(
    buildTtsBody({
      model: options.model,
      text,
      voice: options.voice,
      format: options.format ?? "mp3",
      sampleRate: options.sampleRate ?? 24e3
    }),
    null,
    2
  );
}
async function synthesizeSpeech(options, text) {
  if (!options.apiKey) throw new Error("尚未配置 API Key。");
  if (!options.voice) throw new Error("尚未配置音色 —— 合成接口的 voice 是必填项。");
  const format = options.format ?? "mp3";
  const url = `${options.baseUrl.replace(/\/+$/, "")}${TTS_HTTP_PATH}`;
  const response = await (0, import_obsidian3.requestUrl)({
    url,
    method: "POST",
    headers: {
      Authorization: `Bearer ${options.apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(
      buildTtsBody({
        model: options.model,
        text,
        voice: options.voice,
        format,
        sampleRate: options.sampleRate ?? 24e3
      })
    ),
    throw: false
  });
  if (response.status < 200 || response.status >= 300) {
    const body = response.text ?? "";
    console.error("[Echo Read] 语音合成请求失败", {
      status: response.status,
      url,
      body
    });
    throw new Error(`语音合成失败（HTTP ${response.status}）：${truncate2(body, 600)}`);
  }
  const audio = extractAudioUrl(response.json);
  const download = await (0, import_obsidian3.requestUrl)({ url: audio.url, method: "GET", throw: false });
  if (download.status < 200 || download.status >= 300) {
    throw new Error(`下载合成音频失败（HTTP ${download.status}）。链接可能已过期。`);
  }
  return {
    bytes: download.arrayBuffer,
    mimeType: guessMimeType(format),
    expiresAt: audio.expiresAt
  };
}
function truncate2(text, limit) {
  return text.length > limit ? `${text.slice(0, limit)}…` : text;
}

// src/store/audio-cache.ts
var AUDIO_CACHE_DIR = "_lingo/audio";
function toHex(bytes) {
  return Array.from(new Uint8Array(bytes)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
function buildCacheKey(parts) {
  return [parts.model, parts.voice, parts.format, parts.text].join("\0");
}
async function hashCacheKey(key) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key));
  return toHex(digest).slice(0, 32);
}
async function audioCachePath(text, voice, model, format) {
  const hash = await hashCacheKey(buildCacheKey({ text, voice, model, format }));
  return `${AUDIO_CACHE_DIR}/${hash}.${format}`;
}
async function readCachedAudio(app, path) {
  const adapter = app.vault.adapter;
  if (!await adapter.exists(path)) return void 0;
  try {
    return await adapter.readBinary(path);
  } catch {
    return void 0;
  }
}
async function writeCachedAudio(app, path, bytes) {
  const adapter = app.vault.adapter;
  if (!await adapter.exists(AUDIO_CACHE_DIR)) await adapter.mkdir(AUDIO_CACHE_DIR);
  await adapter.writeBinary(path, bytes);
}

// src/reader/actions.ts
async function speakSentence(app, plugin, text) {
  const settings = plugin.settings;
  if (settings.ttsMode === "system") {
    await speak(text, { voiceURI: settings.voiceURI, rate: settings.speechRate });
    return "system";
  }
  const format = "mp3";
  const path = await audioCachePath(text, settings.ttsVoice, settings.ttsModel, format);
  const cached = await readCachedAudio(app, path);
  if (cached) {
    await playAudioBytes(cached, guessMimeType(format));
    return "cache";
  }
  const apiKey = plugin.apiKeys[settings.ttsKeyId];
  if (!settings.ttsKeyId || !apiKey) {
    throw new Error("云端合成尚未绑定 Key 或 Key 为空，请到插件设置里处理。");
  }
  if (!settings.ttsVoice) {
    throw new Error("云端合成缺少音色，请到插件设置里填写。");
  }
  const result = await synthesizeSpeech(
    {
      baseUrl: settings.ttsBaseUrl,
      apiKey,
      model: settings.ttsModel,
      voice: settings.ttsVoice,
      format
    },
    text
  );
  await writeCachedAudio(app, path, result.bytes);
  await playAudioBytes(result.bytes, result.mimeType);
  return "cloud";
}

// src/core/sentence.ts
var TITLES = /* @__PURE__ */ new Set([
  "mr",
  "mrs",
  "ms",
  "dr",
  "prof",
  "st",
  "jr",
  "sr",
  "vs",
  "etc",
  "no",
  "fig",
  "eq",
  "inc",
  "ltd",
  "co",
  "approx"
]);
var ACRONYMS = /* @__PURE__ */ new Set(["e.g", "i.e", "u.s", "u.k", "a.m", "p.m"]);
var CLOSERS = /* @__PURE__ */ new Set(['"', "'", "”", "’", ")", "]", "»"]);
var ENDERS = /* @__PURE__ */ new Set([".", "!", "?", "…"]);
function splitSentenceRanges(text) {
  const out = [];
  let start = 0;
  let i = 0;
  while (i < text.length) {
    if (!ENDERS.has(text[i])) {
      i++;
      continue;
    }
    let j = i;
    while (j < text.length && ENDERS.has(text[j])) j++;
    let k = j;
    while (k < text.length && CLOSERS.has(text[k])) k++;
    const next = text[k];
    if (next !== void 0 && !isWhitespace(next)) {
      i = k;
      continue;
    }
    if (text[i] === ".") {
      const token = tokenBefore(text, i);
      if (TITLES.has(token)) {
        i = j;
        continue;
      }
      if (ACRONYMS.has(token) && !nextWordStartsUppercase(text, k)) {
        i = j;
        continue;
      }
      if (isDecimal(text, i)) {
        i = j;
        continue;
      }
    }
    pushRange(out, text, start, k);
    start = k;
    i = k;
  }
  pushRange(out, text, start, text.length);
  return out;
}
function pushRange(out, text, from, to) {
  let start = from;
  let end = to;
  while (start < end && isWhitespace(text[start])) start++;
  while (end > start && isWhitespace(text[end - 1])) end--;
  if (end > start) out.push({ start, end, text: text.slice(start, end) });
}
function isWhitespace(ch) {
  return ch === " " || ch === "\n" || ch === "	" || ch === "\r";
}
function tokenBefore(s, dotIndex) {
  let p = dotIndex - 1;
  while (p >= 0 && /[A-Za-z.]/.test(s[p])) p--;
  return s.slice(p + 1, dotIndex).toLowerCase();
}
function nextWordStartsUppercase(s, from) {
  let p = from;
  while (p < s.length && isWhitespace(s[p])) p++;
  if (p >= s.length) return true;
  return /[A-Z]/.test(s[p]);
}
function isDecimal(s, dotIndex) {
  const prev = s[dotIndex - 1];
  const next = s[dotIndex + 1];
  return prev !== void 0 && next !== void 0 && /\d/.test(prev) && /\d/.test(next);
}

// src/reader/decorate.ts
var SENTENCE_ATTR = "data-echo-read-sentence";
var PARAGRAPH_ATTR = "data-echo-read-paragraph";
var CURRENT_CLASS = "echo-read-current";
var MIN_SENTENCES = 2;
var MIN_LENGTH = 40;
function decorateParagraph(paragraph) {
  if (paragraph.hasAttribute(PARAGRAPH_ATTR)) return false;
  const nodes = collectTextNodes(paragraph);
  if (nodes.length === 0) return false;
  const text = nodes.map((node) => node.nodeValue ?? "").join("");
  if (text.trim().length < MIN_LENGTH) return false;
  const ranges = splitSentenceRanges(text);
  if (ranges.length < MIN_SENTENCES) return false;
  let wrapped = false;
  for (const { node, index } of assignOwners(nodes, ranges)) {
    if (index < 0) continue;
    wrapTextNode(node, index);
    wrapped = true;
  }
  if (wrapped) paragraph.setAttribute(PARAGRAPH_ATTR, "");
  return wrapped;
}
function collectTextNodes(root) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.nodeValue && node.nodeValue.length > 0) nodes.push(node);
  }
  return nodes;
}
function assignOwners(nodes, ranges) {
  const owners = [];
  let offset = 0;
  for (const node of nodes) {
    const length = node.nodeValue?.length ?? 0;
    const nodeEnd = offset + length;
    let cursor = offset;
    let current2 = node;
    while (cursor < nodeEnd) {
      const index = ranges.findIndex((range) => cursor >= range.start && cursor < range.end);
      if (index < 0) {
        const next = ranges.find((range) => range.start > cursor);
        const stop = Math.min(next ? next.start : nodeEnd, nodeEnd);
        if (stop <= cursor) break;
        current2 = current2.splitText(stop - cursor);
        cursor = stop;
        continue;
      }
      const boundary = ranges[index].end;
      if (boundary >= nodeEnd) {
        owners.push({ node: current2, index });
        break;
      }
      const rest = current2.splitText(boundary - cursor);
      owners.push({ node: current2, index });
      current2 = rest;
      cursor = boundary;
    }
    offset = nodeEnd;
  }
  return owners;
}
function wrapTextNode(node, index) {
  const parent = node.parentNode;
  if (!parent) return;
  const span = document.createElement("span");
  span.setAttribute(SENTENCE_ATTR, String(index));
  parent.insertBefore(span, node);
  span.appendChild(node);
}

// src/reader/controller.ts
var ReadingController = class {
  constructor(app, plugin) {
    this.app = app;
    this.plugin = plugin;
  }
  app;
  plugin;
  currentGroup = [];
  /** 拖选出来的目标。用克隆的 Range 而不是缓存矩形，滚动后重新取仍然准确。 */
  currentRange = null;
  currentText = "";
  bar = null;
  statusEl = null;
  resultEl = null;
  shadowButton = null;
  continuousButton = null;
  recorder;
  continuous = false;
  repositionQueued = false;
  register() {
    this.plugin.registerMarkdownPostProcessor((element) => {
      element.querySelectorAll("p").forEach((paragraph) => decorateParagraph(paragraph));
    });
    this.plugin.registerDomEvent(document, "click", (event) => this.onClick(event));
    this.plugin.registerDomEvent(document, "mouseup", () => this.scheduleSelectionCheck());
    this.plugin.registerDomEvent(document, "keyup", () => this.scheduleSelectionCheck());
    this.plugin.registerDomEvent(window, "scroll", () => this.scheduleReposition(), true);
    this.plugin.registerDomEvent(window, "resize", () => this.scheduleReposition());
    this.plugin.register(() => this.dispose());
  }
  onClick(event) {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    if (this.bar && this.bar.contains(target)) return;
    if (this.hasLiveSelection()) return;
    if (target.closest("a")) return;
    const span = target.closest(`[${SENTENCE_ATTR}]`);
    if (!(span instanceof HTMLElement)) {
      this.clearSelection();
      return;
    }
    const index = Number(span.getAttribute(SENTENCE_ATTR));
    if (!Number.isFinite(index)) return;
    this.stopContinuous();
    this.cancelRecording();
    this.selectSentence(index, span);
    if (this.plugin.settings.speakOnClick) void this.speak();
  }
  selectSentence(index, span) {
    const scope = span.closest(`[${PARAGRAPH_ATTR}]`) ?? document;
    const group = Array.from(
      scope.querySelectorAll(`[${SENTENCE_ATTR}="${index}"]`)
    );
    if (group.length === 0) return;
    this.highlightGroup(group);
    this.currentRange = null;
    this.showBar();
  }
  highlightGroup(group) {
    this.clearHighlight();
    for (const element of group) element.classList.add(CURRENT_CLASS);
    this.currentGroup = group;
    this.currentText = group.map((element) => element.textContent ?? "").join("");
  }
  clearHighlight() {
    for (const element of this.currentGroup) element.classList.remove(CURRENT_CLASS);
    this.currentGroup = [];
  }
  clearSelection() {
    this.stopContinuous();
    this.cancelRecording();
    this.clearHighlight();
    this.currentRange = null;
    this.currentText = "";
    stopSpeaking();
    stopPlayback();
    if (this.bar) this.bar.style.display = "none";
  }
  showBar() {
    const bar = this.ensureBar();
    bar.style.display = "flex";
    bar.style.visibility = "hidden";
    this.setStatus("");
    this.setResult("");
    this.positionPopover();
  }
  /**
   * 把操作条锚定在选中句的正下方 —— 操作就在你读的那句话旁边，
   * 不用把视线移到屏幕底部。
   *
   * 被选中的句子可能跨多行，所以要取所有 span 的并集包围盒；
   * 下方放不下时翻到上方，左右也会夹在视口内避免溢出。
   */
  positionPopover() {
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
   * 操作对象可能是「整句」（多个 span），也可能是「拖选的一段文字」（一个 Range）。
   * Range 是实时求值的，所以滚动后位置依然准确 —— 缓存矩形做不到这一点。
   */
  targetRects() {
    if (this.currentGroup.length > 0) {
      return this.currentGroup.map((element) => element.getBoundingClientRect());
    }
    if (this.currentRange) return [this.currentRange.getBoundingClientRect()];
    return null;
  }
  hasLiveSelection() {
    const selection = window.getSelection();
    return selection !== null && !selection.isCollapsed && selection.toString().trim() !== "";
  }
  scheduleSelectionCheck() {
    window.setTimeout(() => this.handleSelection(), 0);
  }
  /**
   * 把任意选中的文本作为朗读 / 跟读对象。
   *
   * 这条路径补上了「点整句」覆盖不到的场景：只练一个短语或生词，
   * 以及标题、列表、表格这类不会被装饰成句子 span 的地方。
   */
  handleSelection() {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) return;
    const text = selection.toString().trim();
    if (!text) return;
    const range = selection.getRangeAt(0);
    if (this.isInsideBar(range)) return;
    if (!this.isInsideNote(range.commonAncestorContainer)) return;
    this.stopContinuous();
    this.cancelRecording();
    this.clearHighlight();
    this.currentGroup = [];
    this.currentRange = range.cloneRange();
    this.currentText = text;
    this.showBar();
  }
  isInsideBar(range) {
    if (!this.bar) return false;
    const node = range.commonAncestorContainer;
    const element = node instanceof HTMLElement ? node : node.parentElement;
    return element !== null && this.bar.contains(element);
  }
  /** 只处理笔记正文里的选择，避开设置面板、模态框等其它界面。 */
  isInsideNote(node) {
    const element = node instanceof HTMLElement ? node : node.parentElement;
    if (!element) return false;
    if (element.closest(".modal-container, .vertical-tab-content")) return false;
    return element.closest(".markdown-preview-view, .markdown-source-view, .cm-editor") !== null;
  }
  scheduleReposition() {
    if (this.repositionQueued) return;
    this.repositionQueued = true;
    window.requestAnimationFrame(() => {
      this.repositionQueued = false;
      this.positionPopover();
    });
  }
  ensureBar() {
    if (this.bar) return this.bar;
    const bar = document.body.createDiv({ cls: "echo-read-bar" });
    this.shadowButton = bar.createEl("button", { text: "跟读打分" });
    this.shadowButton.addEventListener("click", () => void this.toggleShadowing());
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
  // ---------------- 朗读 ----------------
  async speak() {
    if (!this.currentText.trim()) return;
    this.setResult("");
    this.setStatus("朗读中…");
    try {
      const source = await speakSentence(this.app, this.plugin, this.currentText);
      this.setStatus(
        source === "cache" ? "已朗读（命中缓存，未计费）" : source === "cloud" ? "已朗读（云端合成）" : "已朗读"
      );
    } catch (error) {
      this.reportFailure("朗读", error);
    }
  }
  // ---------------- 连续朗读 ----------------
  async toggleContinuous() {
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
  stopContinuous() {
    if (!this.continuous) return;
    this.continuous = false;
    stopSpeaking();
    stopPlayback();
    this.updateContinuousButton();
  }
  updateContinuousButton() {
    this.continuousButton?.setText(this.continuous ? "停止连读" : "连续朗读");
  }
  textOf(group) {
    return group.map((element) => element.textContent ?? "").join("");
  }
  // ---------------- 跟读打分 ----------------
  /** 第一次点开始录音，第二次点结束并评分。 */
  async toggleShadowing() {
    if (this.recorder) {
      await this.finishShadowing();
      return;
    }
    if (!this.currentText.trim()) return;
    this.stopContinuous();
    try {
      this.recorder = new Recorder();
      await this.recorder.start();
      this.setResult("");
      this.setStatus("● 录音中… 读完后再点一次「跟读打分」");
      this.shadowButton?.setText("结束并评分");
    } catch (error) {
      this.recorder = void 0;
      this.reportFailure("录音", error);
    }
  }
  async finishShadowing() {
    const recorder = this.recorder;
    if (!recorder) return;
    this.recorder = void 0;
    this.shadowButton?.setText("跟读打分");
    this.setStatus("识别中…");
    try {
      const recording = await recorder.stop();
      const wav = encodeWav(recording.samples, recording.sampleRate);
      const dataUri = bytesToDataUri(new Uint8Array(wav), "audio/wav");
      const settings = this.plugin.settings;
      const apiKey = this.plugin.apiKeys[settings.asrKeyId];
      if (!settings.asrKeyId || !apiKey) {
        throw new Error("语音识别尚未绑定 Key 或 Key 为空，请到插件设置里处理。");
      }
      const text = await transcribeAudio(
        {
          baseUrl: settings.asrBaseUrl,
          apiKey,
          model: settings.asrModel,
          transport: settings.asrTransport
        },
        dataUri
      );
      const stats = diffDictation(this.currentText, text).stats;
      const score = scoreAttempt(this.currentText, stats, recording.durationMs);
      this.setStatus(
        `准确度 ${score.accuracy}　完整度 ${score.completeness}　流利度 ${score.fluency}　总分 ${score.overall}`
      );
      this.setResult(
        [
          `识别：${text || "（空）"}`,
          `漏 ${stats.missing}　多 ${stats.extra}　错 ${stats.wrong}　用时 ${(recording.durationMs / 1e3).toFixed(1)} 秒`
        ].join("\n")
      );
    } catch (error) {
      this.reportFailure("跟读评分", error);
    }
  }
  cancelRecording() {
    if (!this.recorder) return;
    const recorder = this.recorder;
    this.recorder = void 0;
    this.shadowButton?.setText("跟读打分");
    void recorder.stop().catch(() => void 0);
  }
  // ---------------- 杂项 ----------------
  reportFailure(action, error) {
    const message = error instanceof Error ? error.message : String(error);
    this.setStatus(`${action}失败`);
    this.setResult(message);
    new import_obsidian4.Notice(`${action}失败：${message}`, 8e3);
  }
  setStatus(text) {
    this.statusEl?.setText(text);
    this.scheduleReposition();
  }
  setResult(text) {
    this.resultEl?.setText(text);
    this.scheduleReposition();
  }
  dispose() {
    this.stopContinuous();
    this.cancelRecording();
    this.bar?.remove();
    this.bar = null;
    this.statusEl = null;
    this.resultEl = null;
    this.shadowButton = null;
    this.continuousButton = null;
  }
};
function collectSentenceGroups(root) {
  const spans = Array.from(root.querySelectorAll(`[${SENTENCE_ATTR}]`));
  const groups = [];
  let bucket = [];
  let lastParagraph = null;
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

// src/settings/key-format.ts
function classifyApiKey(key) {
  const trimmed = key.trim();
  if (trimmed.startsWith("sk-sp-")) return "token-plan";
  if (trimmed.startsWith("sk-")) return "standard";
  return "unknown";
}
function describeApiKeyKind(kind) {
  switch (kind) {
    case "token-plan":
      return "Token Plan 型（sk-sp- 开头）";
    case "standard":
      return "普通 API Key 型（sk- 开头）";
    default:
      return "未识别的格式";
  }
}
function describeKeyEndpointMismatch(key, baseUrl) {
  const kind = classifyApiKey(key);
  const isTokenPlanEndpoint = baseUrl.toLowerCase().includes("token-plan");
  const isCompatibleEndpoint = baseUrl.toLowerCase().includes("compatible-mode");
  if (kind === "token-plan" && !isTokenPlanEndpoint) {
    return "当前 Key 是 Token Plan 型（sk-sp-），但接入地址不是 Token Plan 端点。Token Plan 的 Key 不能用于普通端点，服务端会返回 InvalidApiKey。";
  }
  if (kind === "standard" && isTokenPlanEndpoint) {
    return "当前 Key 是普通型（sk-），但接入地址是 Token Plan 端点。Token Plan 端点需要 sk-sp- 开头的 Key。";
  }
  if (kind === "token-plan" && isTokenPlanEndpoint && !isCompatibleEndpoint) {
    return "Token Plan 端点的文档化路径都带 /compatible-mode/v1，当前地址看起来缺少这一段。";
  }
  return void 0;
}

// src/settings/store.ts
var KEYS_DIR = "_lingo";
var KEYS_PATH = "_lingo/keys.json";
function migrateKeys(file) {
  const out = {};
  for (const [id, record] of Object.entries(file.keys ?? {})) {
    out[id] = {
      label: record.label ?? id,
      kind: record.kind ?? "unknown",
      value: typeof record.value === "string" ? record.value : ""
    };
  }
  return { keys: out };
}
function listKeySummaries(file) {
  return Object.entries(file.keys ?? {}).map(([id, record]) => ({
    id,
    label: record.label,
    kind: record.kind,
    hasValue: record.value.trim() !== ""
  })).sort((a, b) => a.label.localeCompare(b.label));
}
function makeKeyId(existing, label) {
  const slug = label.trim().toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "-").replace(/^-+|-+$/g, "");
  const base = slug === "" ? "key" : slug;
  if (!existing.includes(base)) return base;
  let index = 2;
  while (existing.includes(`${base}-${index}`)) index++;
  return `${base}-${index}`;
}
async function readKeys(app) {
  const adapter = app.vault.adapter;
  if (!await adapter.exists(KEYS_PATH)) return { keys: {} };
  try {
    const parsed = JSON.parse(await adapter.read(KEYS_PATH));
    return migrateKeys(parsed);
  } catch {
    return { keys: {} };
  }
}
async function writeKeys(app, file) {
  const adapter = app.vault.adapter;
  if (!await adapter.exists(KEYS_DIR)) await adapter.mkdir(KEYS_DIR);
  await adapter.write(KEYS_PATH, JSON.stringify(file, null, 2));
}
async function listKeys(app) {
  return listKeySummaries(await readKeys(app));
}
async function saveKey(app, id, label, apiKey) {
  const file = await readKeys(app);
  file.keys = file.keys ?? {};
  file.keys[id] = { label, kind: classifyApiKey(apiKey), value: apiKey };
  await writeKeys(app, file);
}
async function deleteKey(app, id) {
  const file = await readKeys(app);
  if (file.keys) delete file.keys[id];
  await writeKeys(app, file);
}
async function loadKeyValues(app) {
  const file = await readKeys(app);
  const values = {};
  for (const [id, record] of Object.entries(file.keys ?? {})) {
    if (record.value.trim() !== "") values[id] = record.value;
  }
  return values;
}

// src/settings/tab.ts
var import_obsidian5 = require("obsidian");

// src/settings/types.ts
var SPEECH_PRESETS = [
  {
    id: "qianwen",
    name: "千问AI平台",
    transport: "dashscope-native",
    baseUrl: DEFAULT_BASE_URL,
    note: "已验证可用。识别与合成共用这个地址，但可以绑定不同的 Key。"
  },
  {
    id: "bailian",
    name: "阿里云百炼（直连）",
    transport: "dashscope-native",
    baseUrl: "https://dashscope.aliyuncs.com",
    note: "同协议的另一家平台，换账号时用。"
  },
  {
    id: "custom-speech",
    name: "自定义",
    transport: "dashscope-native",
    baseUrl: "",
    note: "手填 DashScope 原生协议的接入地址。"
  }
];
var TEXT_PRESETS = [
  {
    id: "qianwen-token-plan",
    name: "千问AI平台 · Token Plan",
    transport: "openai-compatible",
    baseUrl: "https://token-plan.maas.qianwenaiapi.com/compatible-mode/v1",
    note: "用 sk-sp- 开头的 Token Plan Key。语音能力在此端点上不可用，仅用于文本。"
  },
  {
    id: "deepseek",
    name: "DeepSeek",
    transport: "openai-compatible",
    baseUrl: "https://api.deepseek.com/v1",
    note: "用 DeepSeek 的普通 Key。"
  },
  {
    id: "custom-text",
    name: "自定义（OpenAI 兼容）",
    transport: "openai-compatible",
    baseUrl: "",
    note: "任何 OpenAI 兼容端点。"
  }
];
function findPreset(id) {
  return [...SPEECH_PRESETS, ...TEXT_PRESETS].find((preset) => preset.id === id);
}
var DEFAULT_TTS_BASE_URL = DEFAULT_BASE_URL;
var DEFAULT_CLOUD_TTS_MODEL = "qwen-audio-3.0-tts-flash";
var DEFAULT_CLOUD_TTS_VOICE = "longanhuan_v3.6";
var DEFAULT_SETTINGS = {
  asrPresetId: "qianwen",
  asrKeyId: "",
  asrTransport: "dashscope-native",
  asrBaseUrl: DEFAULT_BASE_URL,
  asrModel: DEFAULT_ASR_MODEL,
  ttsMode: "system",
  ttsPresetId: "qianwen",
  ttsKeyId: "",
  ttsBaseUrl: DEFAULT_TTS_BASE_URL,
  ttsModel: DEFAULT_CLOUD_TTS_MODEL,
  ttsVoice: DEFAULT_CLOUD_TTS_VOICE,
  llmPresetId: "qianwen-token-plan",
  llmKeyId: "",
  llmTransport: "openai-compatible",
  llmBaseUrl: TEXT_PRESETS[0].baseUrl,
  llmModel: "qwen3.8-flash",
  voiceURI: "",
  speechRate: 1,
  speakOnClick: true
};
function mergeSettings(stored) {
  const merged = { ...DEFAULT_SETTINGS, ...stored ?? {} };
  if (merged.speechRate <= 0) merged.speechRate = DEFAULT_SETTINGS.speechRate;
  if (!findPreset(merged.asrPresetId)) merged.asrPresetId = DEFAULT_SETTINGS.asrPresetId;
  if (!findPreset(merged.ttsPresetId)) merged.ttsPresetId = DEFAULT_SETTINGS.ttsPresetId;
  if (!findPreset(merged.llmPresetId)) merged.llmPresetId = DEFAULT_SETTINGS.llmPresetId;
  return merged;
}

// src/settings/tab.ts
var TRANSPORT_LABELS = {
  "dashscope-native": "DashScope 原生",
  "openai-compatible": "OpenAI 兼容"
};
var EchoReadSettingTab = class extends import_obsidian5.PluginSettingTab {
  plugin;
  keys = [];
  newKeyLabel = "";
  newKeyValue = "";
  diagnosticEl = null;
  diagnosticLines = [];
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }
  display() {
    void this.render();
  }
  async render() {
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
  renderKeys() {
    const { containerEl } = this;
    containerEl.createEl("h3", { text: "密钥" });
    containerEl.createEl("p", {
      cls: "setting-item-description",
      text: "Key 明文保存在 _lingo/keys.json，会随 vault 一起同步到云端。不同能力可以绑定不同的 Key —— 例如语音用普通 Key、文本用 Token Plan 的 Key。"
    });
    if (this.keys.length === 0) {
      containerEl.createEl("p", {
        text: "还没有保存任何 Key。",
        cls: "setting-item-description"
      });
    }
    for (const key of this.keys) {
      new import_obsidian5.Setting(containerEl).setName(key.label).setDesc(
        key.hasValue ? describeApiKeyKind(key.kind) : `${describeApiKeyKind(key.kind)}　·　⚠ 值为空，需要重新填写`
      ).addButton(
        (button) => button.setButtonText("删除").setWarning().onClick(async () => {
          await deleteKey(this.app, key.id);
          new import_obsidian5.Notice(`已删除「${key.label}」。`);
          this.display();
        })
      );
    }
    new import_obsidian5.Setting(containerEl).setName("新增 Key").setDesc("名称只是给你自己看的标签，例如「语音」「Token Plan」。").addText(
      (text) => text.setPlaceholder("名称").onChange((value) => {
        this.newKeyLabel = value;
      })
    ).addText((text) => {
      text.inputEl.type = "password";
      text.setPlaceholder("API Key").onChange((value) => {
        this.newKeyValue = value;
      });
    }).addButton(
      (button) => button.setButtonText("保存").setCta().onClick(async () => {
        if (!this.newKeyLabel.trim() || !this.newKeyValue.trim()) {
          new import_obsidian5.Notice("名称和 Key 都要填。");
          return;
        }
        const id = makeKeyId(
          this.keys.map((item) => item.id),
          this.newKeyLabel
        );
        try {
          await saveKey(this.app, id, this.newKeyLabel.trim(), this.newKeyValue.trim());
          this.plugin.apiKeys = await loadKeyValues(this.app);
          this.newKeyLabel = "";
          this.newKeyValue = "";
          new import_obsidian5.Notice("已保存。");
          this.display();
        } catch (error) {
          new import_obsidian5.Notice(`保存失败：${messageOf2(error)}`);
        }
      })
    );
  }
  // ---------------- 语音识别 ----------------
  renderAsr() {
    const { containerEl } = this;
    containerEl.createEl("h3", { text: "语音识别" });
    this.addPresetSetting(containerEl, "平台预设", SPEECH_PRESETS, this.plugin.settings.asrPresetId, async (preset) => {
      await this.plugin.updateSettings({
        asrPresetId: preset.id,
        asrTransport: preset.transport,
        asrBaseUrl: preset.baseUrl
      });
      this.display();
    });
    this.addKeyBinding(containerEl, "使用的 Key", this.plugin.settings.asrKeyId, async (keyId) => {
      await this.plugin.updateSettings({ asrKeyId: keyId });
    });
    new import_obsidian5.Setting(containerEl).setName("协议").addDropdown((dropdown) => {
      dropdown.addOption("dashscope-native", TRANSPORT_LABELS["dashscope-native"]);
      dropdown.addOption("openai-compatible", TRANSPORT_LABELS["openai-compatible"]);
      dropdown.setValue(this.plugin.settings.asrTransport).onChange(async (value) => {
        await this.plugin.updateSettings({ asrTransport: value });
      });
    });
    new import_obsidian5.Setting(containerEl).setName("接入地址").addText(
      (text) => text.setValue(this.plugin.settings.asrBaseUrl).onChange(async (value) => {
        await this.plugin.updateSettings({ asrBaseUrl: value.trim() });
      })
    );
    new import_obsidian5.Setting(containerEl).setName("识别模型").addText(
      (text) => text.setValue(this.plugin.settings.asrModel).onChange(async (value) => {
        await this.plugin.updateSettings({ asrModel: value.trim() });
      })
    );
    new import_obsidian5.Setting(containerEl).setName("测试识别").setDesc(
      "用已保存的测试音频（没有则用 1.5 秒静音）发一次真实识别请求。静音可能被判为「没有语音」，建议先在录音工作台录一句并「存为测试音频」。"
    ).addButton(
      (button) => button.setButtonText("开始测试").onClick(async () => {
        button.setDisabled(true);
        button.setButtonText("测试中…");
        await this.runWithDiagnostics(
          button,
          "开始测试",
          "测试中…",
          this.asrContext(),
          () => this.runConnectionTest()
        );
      })
    );
  }
  // ---------------- 语音合成 ----------------
  renderTts() {
    const { containerEl } = this;
    containerEl.createEl("h3", { text: "语音合成" });
    new import_obsidian5.Setting(containerEl).setName("朗读方式").setDesc("系统语音免费且离线；云端合成按字符计费（约 0.8～1 元/万字符）。").addDropdown((dropdown) => {
      dropdown.addOption("system", "系统语音（免费）");
      dropdown.addOption("cloud", "云端合成（按字符计费）");
      dropdown.setValue(this.plugin.settings.ttsMode).onChange(async (value) => {
        await this.plugin.updateSettings({ ttsMode: value });
      });
    });
    this.addPresetSetting(containerEl, "平台预设", SPEECH_PRESETS, this.plugin.settings.ttsPresetId, async (preset) => {
      await this.plugin.updateSettings({
        ttsPresetId: preset.id,
        ttsBaseUrl: preset.baseUrl
      });
      this.display();
    });
    this.addKeyBinding(containerEl, "使用的 Key", this.plugin.settings.ttsKeyId, async (keyId) => {
      await this.plugin.updateSettings({ ttsKeyId: keyId });
    });
    new import_obsidian5.Setting(containerEl).setName("接入地址").setDesc("走 HTTP 接口，与识别通道彼此独立。").addText(
      (text) => text.setValue(this.plugin.settings.ttsBaseUrl).onChange(async (value) => {
        await this.plugin.updateSettings({ ttsBaseUrl: value.trim() });
      })
    );
    new import_obsidian5.Setting(containerEl).setName("合成模型").addText(
      (text) => text.setValue(this.plugin.settings.ttsModel).onChange(async (value) => {
        await this.plugin.updateSettings({ ttsModel: value.trim() });
      })
    );
    new import_obsidian5.Setting(containerEl).setName("音色").setDesc("必填，接口没有默认值。文档示例：longanhuan_v3.6 / longxiaochun。").addText(
      (text) => text.setValue(this.plugin.settings.ttsVoice).onChange(async (value) => {
        await this.plugin.updateSettings({ ttsVoice: value.trim() });
      })
    );
    new import_obsidian5.Setting(containerEl).setName("试听云端音色").setDesc("合成一句固定的英文并播放，结果按「模型 + 音色 + 格式 + 文本」缓存。").addButton(
      (button) => button.setButtonText("试听").onClick(async () => {
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
            `绑定 Key：${this.describeBoundKey(this.plugin.settings.ttsKeyId)}`
          ],
          () => this.auditionCloudVoice()
        );
      })
    );
  }
  // ---------------- 文本能力 ----------------
  renderLlm() {
    const { containerEl } = this;
    containerEl.createEl("h3", { text: "文本能力（预留）" });
    containerEl.createEl("p", {
      cls: "setting-item-description",
      text: "用于弱项解释与卡片选词。Token Plan 的语音能力在插件内不可用，但它的文本模型走 OpenAI 兼容协议，在这里可以正常使用。功能尚未接入。"
    });
    this.addPresetSetting(containerEl, "平台预设", TEXT_PRESETS, this.plugin.settings.llmPresetId, async (preset) => {
      await this.plugin.updateSettings({
        llmPresetId: preset.id,
        llmTransport: preset.transport,
        llmBaseUrl: preset.baseUrl
      });
      this.display();
    });
    this.addKeyBinding(containerEl, "使用的 Key", this.plugin.settings.llmKeyId, async (keyId) => {
      await this.plugin.updateSettings({ llmKeyId: keyId });
    });
    new import_obsidian5.Setting(containerEl).setName("接入地址").addText(
      (text) => text.setValue(this.plugin.settings.llmBaseUrl).onChange(async (value) => {
        await this.plugin.updateSettings({ llmBaseUrl: value.trim() });
      })
    );
    new import_obsidian5.Setting(containerEl).setName("模型").addText(
      (text) => text.setValue(this.plugin.settings.llmModel).onChange(async (value) => {
        await this.plugin.updateSettings({ llmModel: value.trim() });
      })
    );
  }
  // ---------------- 朗读 ----------------
  renderReading() {
    const { containerEl } = this;
    containerEl.createEl("h3", { text: "朗读与交互" });
    new import_obsidian5.Setting(containerEl).setName("点句即朗读").setDesc(
      "点任意一句就直接读出来，省掉「先选中再点按钮」那一步。关掉后点句只选中、不发声。"
    ).addToggle(
      (toggle) => toggle.setValue(this.plugin.settings.speakOnClick).onChange(async (value) => {
        await this.plugin.updateSettings({ speakOnClick: value });
      })
    );
    new import_obsidian5.Setting(containerEl).setName("语速").addSlider(
      (slider) => slider.setLimits(0.5, 1.5, 0.05).setValue(this.plugin.settings.speechRate).setDynamicTooltip().onChange(async (value) => {
        await this.plugin.updateSettings({ speechRate: value });
      })
    );
    new import_obsidian5.Setting(containerEl).setName("音色").setDesc("留空使用系统默认英语音色。").addDropdown((dropdown) => {
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
  renderDiagnostics() {
    const { containerEl } = this;
    containerEl.createEl("h3", { text: "诊断" });
    const sampleSetting = new import_obsidian5.Setting(containerEl).setName("测试音频").setDesc("检查中…");
    void this.refreshSampleDescription(sampleSetting);
    sampleSetting.addButton(
      (button) => button.setButtonText("清除").onClick(async () => {
        await deleteTestSample(this.app);
        new import_obsidian5.Notice("已清除测试音频。");
        this.display();
      })
    );
    new import_obsidian5.Setting(containerEl).setName("只测 Key（不发音频）").setDesc("发一个参数不完整的请求：Key 无效会在鉴权阶段被拒，Key 有效则会走到参数校验。").addButton(
      (button) => button.setButtonText("检测 Key").onClick(async () => {
        button.setDisabled(true);
        button.setButtonText("检测中…");
        await this.runWithDiagnostics(button, "检测 Key", "检测中…", this.asrContext(), async () => {
          const result = await this.runKeyProbe();
          return [describeProbeOutcome(result), `服务端原文：${result.detail || "（空）"}`].join("\n");
        });
      })
    );
    new import_obsidian5.Setting(containerEl).setName("列出可用模型").setDesc("调用该渠道的 GET /models，确认模型 ID 是否真的存在。").addButton(
      (button) => button.setButtonText("获取列表").onClick(async () => {
        button.setDisabled(true);
        button.setButtonText("获取中…");
        await this.runWithDiagnostics(button, "获取列表", "获取中…", this.asrContext(), async () => {
          const ids = await this.runModelList();
          return `共 ${ids.length} 个模型：
${ids.join("\n")}`;
        });
      })
    );
    this.diagnosticEl = containerEl.createEl("pre");
    this.diagnosticEl.style.whiteSpace = "pre-wrap";
    this.diagnosticEl.style.userSelect = "text";
    this.diagnosticEl.style.maxHeight = "320px";
    this.diagnosticEl.style.overflow = "auto";
    this.diagnosticEl.style.fontSize = "12px";
    this.diagnosticEl.style.lineHeight = "1.5";
    new import_obsidian5.Setting(containerEl).setName("复制诊断信息").addButton(
      (button) => button.setButtonText("复制").onClick(async () => {
        try {
          await navigator.clipboard.writeText(this.diagnosticLines.join("\n"));
          new import_obsidian5.Notice("已复制。");
        } catch {
          new import_obsidian5.Notice("复制失败，请手动选中上面的文本。");
        }
      })
    );
  }
  // ---------------- 共用小部件 ----------------
  addPresetSetting(containerEl, name, presets, currentId, onChange) {
    new import_obsidian5.Setting(containerEl).setName(name).setDesc(findPreset(currentId)?.note ?? "").addDropdown((dropdown) => {
      for (const preset of presets) dropdown.addOption(preset.id, preset.name);
      dropdown.setValue(currentId);
      dropdown.onChange(async (value) => {
        const preset = findPreset(value);
        if (preset) await onChange(preset);
      });
    });
  }
  addKeyBinding(containerEl, name, currentId, onChange) {
    new import_obsidian5.Setting(containerEl).setName(name).setDesc(
      this.keys.length === 0 ? "尚未保存任何 Key，请先在上方「密钥」里添加。" : "选择这个能力使用哪把 Key。"
    ).addDropdown((dropdown) => {
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
  describeBoundKey(keyId) {
    if (!keyId) return "未绑定";
    const found = this.keys.find((key) => key.id === keyId);
    return found ? `${found.label}（${describeApiKeyKind(found.kind)}）` : keyId;
  }
  /** 说明当前识别通道的配置，供诊断头部使用。 */
  asrContext() {
    return [
      "用途：语音识别",
      `协议：${this.plugin.settings.asrTransport}`,
      `识别模型：${this.plugin.settings.asrModel}`,
      `绑定 Key：${this.describeBoundKey(this.plugin.settings.asrKeyId)}`
    ];
  }
  async refreshSampleDescription(setting) {
    const exists = await hasTestSample(this.app);
    setting.setDesc(
      exists ? "已保存一段真实录音，测试会用它而不是静音。" : "尚未保存。在录音工作台录一句英文并点「存为测试音频」，测试结果才有参考价值。"
    );
  }
  async runWithDiagnostics(button, idleLabel, busyLabel, context, action) {
    this.diagnosticLines = [];
    this.appendDiagnostic(`构建时间：${"2026-10-04T06:40:22.681Z"}`);
    this.appendDiagnostic(`时间：${(/* @__PURE__ */ new Date()).toLocaleString()}`);
    for (const line of context) this.appendDiagnostic(line);
    try {
      const result = await action();
      this.appendDiagnostic("结果：成功");
      this.appendDiagnostic(result);
      new import_obsidian5.Notice("成功，详见下方诊断信息。", 8e3);
    } catch (error) {
      this.appendDiagnostic("结果：失败");
      this.appendDiagnostic(messageOf2(error));
      new import_obsidian5.Notice("失败，详见下方诊断信息。", 8e3);
    } finally {
      button.setDisabled(false);
      button.setButtonText(idleLabel);
    }
  }
  appendDiagnostic(line) {
    this.diagnosticLines.push(line);
    this.diagnosticEl?.setText(this.diagnosticLines.join("\n"));
  }
  // ---------------- 各诊断动作 ----------------
  requireKey(keyId, capability) {
    if (!keyId) throw new Error(`尚未为「${capability}」绑定 Key。`);
    const value = this.plugin.apiKeys[keyId];
    if (!value) {
      throw new Error(`「${this.describeBoundKey(keyId)}」的值是空的，请到「密钥」里重新填写。`);
    }
    return value;
  }
  async runConnectionTest() {
    const apiKey = this.requireKey(this.plugin.settings.asrKeyId, "语音识别");
    if (!this.plugin.settings.asrBaseUrl) throw new Error("尚未填写接入地址。");
    const mismatch = describeKeyEndpointMismatch(apiKey, this.plugin.settings.asrBaseUrl);
    if (mismatch) this.appendDiagnostic(`⚠ ${mismatch}`);
    const saved = await loadTestSample(this.app);
    const wav = saved ?? encodeWav(new Float32Array(16e3 * 1.5), 16e3);
    const dataUri = bytesToDataUri(new Uint8Array(wav), "audio/wav");
    this.appendDiagnostic(
      `请求地址：${buildEndpoint(this.plugin.settings.asrBaseUrl, this.plugin.settings.asrTransport)}`
    );
    this.appendDiagnostic(
      saved ? `音频：已保存的真实录音，base64 后 ${Math.round(dataUri.length / 1024)} KB` : `音频：1.5 秒静音（可能被判为「没有语音」），base64 后 ${Math.round(dataUri.length / 1024)} KB`
    );
    this.appendDiagnostic(
      `请求体预览：
${previewRequestBody(
        {
          transport: this.plugin.settings.asrTransport,
          model: this.plugin.settings.asrModel
        },
        dataUri
      )}`
    );
    const text = await transcribeAudio(
      {
        baseUrl: this.plugin.settings.asrBaseUrl,
        apiKey,
        model: this.plugin.settings.asrModel,
        transport: this.plugin.settings.asrTransport
      },
      dataUri
    );
    return `识别结果：${text || "（空）"}`;
  }
  async runKeyProbe() {
    const apiKey = this.requireKey(this.plugin.settings.asrKeyId, "语音识别");
    return probeApiKey({
      baseUrl: this.plugin.settings.asrBaseUrl,
      apiKey,
      model: this.plugin.settings.asrModel,
      transport: this.plugin.settings.asrTransport
    });
  }
  async runModelList() {
    const apiKey = this.requireKey(this.plugin.settings.asrKeyId, "语音识别");
    return listModels({ baseUrl: this.plugin.settings.asrBaseUrl, apiKey });
  }
  async auditionCloudVoice() {
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
      `请求体预览：
${previewTtsBody(
        { baseUrl: ttsBaseUrl, apiKey, model: ttsModel, voice: ttsVoice, format },
        text
      )}`
    );
    const path = await audioCachePath(text, ttsVoice, ttsModel, format);
    let bytes = await readCachedAudio(this.app, path);
    const cached = bytes !== void 0;
    if (!bytes) {
      const result = await synthesizeSpeech(
        { baseUrl: ttsBaseUrl, apiKey, model: ttsModel, voice: ttsVoice, format },
        text
      );
      bytes = result.bytes;
      await writeCachedAudio(this.app, path, bytes);
    }
    await playAudioBytes(bytes, guessMimeType(format));
    return [
      `待合成文本：${text}`,
      `音频字节：${bytes.byteLength} B`,
      cached ? "命中缓存，未产生费用" : `已缓存到 ${path}`
    ].join("\n");
  }
};
function messageOf2(error) {
  return error instanceof Error ? error.message : String(error);
}

// src/main.ts
var EchoReadPlugin = class extends import_obsidian6.Plugin {
  settings = DEFAULT_SETTINGS;
  /** 已保存的 Key，按 Key ID 索引。明文存储，见 design 15.3 的修订说明。 */
  apiKeys = {};
  async onload() {
    this.settings = mergeSettings(
      await this.loadData()
    );
    this.apiKeys = await loadKeyValues(this.app);
    this.addSettingTab(new EchoReadSettingTab(this.app, this));
    this.addRibbonIcon("mic", "Echo Read：录音工作台", () => this.openRecorder());
    this.addCommand({
      id: "open-recorder",
      name: "打开录音工作台",
      callback: () => this.openRecorder()
    });
    new ReadingController(this.app, this).register();
    console.log("Echo Read loaded");
  }
  openRecorder() {
    new RecorderModal(this.app, this).open();
  }
  async updateSettings(patch) {
    this.settings = mergeSettings({ ...this.settings, ...patch });
    await this.saveData(this.settings);
  }
};
