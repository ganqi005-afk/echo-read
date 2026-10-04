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
var import_obsidian5 = require("obsidian");

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
    const apiKey = this.plugin.unlockedApiKey;
    if (!apiKey) {
      new import_obsidian2.Notice("尚未解锁 API Key，请先到插件设置里解锁。");
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
          baseUrl: this.plugin.settings.baseUrl,
          apiKey,
          model: this.plugin.settings.asrModel,
          transport: this.plugin.settings.transport
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

// src/settings/tab.ts
var import_obsidian4 = require("obsidian");

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
var import_obsidian3 = require("obsidian");

// src/store/secrets.ts
var PRODUCTION_ITERATIONS = 6e5;
var encoder = new TextEncoder();
var decoder = new TextDecoder();
function toBase64(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}
function fromBase64(value) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
async function deriveKey(passphrase, salt, iterations) {
  const material = await crypto.subtle.importKey(
    "raw",
    encoder.encode(passphrase),
    "PBKDF2",
    false,
    ["deriveKey"]
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations, hash: "SHA-256" },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}
async function encryptString(plaintext, passphrase, iterations = PRODUCTION_ITERATIONS) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(passphrase, salt, iterations);
  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    encoder.encode(plaintext)
  );
  return {
    v: 1,
    kdf: "PBKDF2-SHA256",
    iter: iterations,
    salt: toBase64(salt),
    iv: toBase64(iv),
    ct: toBase64(new Uint8Array(ct))
  };
}
async function decryptString(blob, passphrase) {
  const key = await deriveKey(passphrase, fromBase64(blob.salt), blob.iter);
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: fromBase64(blob.iv) },
    key,
    fromBase64(blob.ct)
  );
  return decoder.decode(plain);
}

// src/settings/store.ts
var SECRETS_DIR = "_lingo";
var SECRETS_PATH = "_lingo/secrets.json";
async function readSecrets(app) {
  const adapter = app.vault.adapter;
  if (!await adapter.exists(SECRETS_PATH)) return {};
  try {
    return JSON.parse(await adapter.read(SECRETS_PATH));
  } catch {
    return {};
  }
}
async function writeSecrets(app, secrets) {
  const adapter = app.vault.adapter;
  if (!await adapter.exists(SECRETS_DIR)) await adapter.mkdir(SECRETS_DIR);
  await adapter.write(SECRETS_PATH, JSON.stringify(secrets, null, 2));
}
async function saveSecret(app, name, value, passphrase) {
  const secrets = await readSecrets(app);
  secrets[name] = await encryptString(value, passphrase, PRODUCTION_ITERATIONS);
  await writeSecrets(app, secrets);
}
async function hasSecret(app, name) {
  return (await readSecrets(app))[name] !== void 0;
}
async function loadSecret(app, name, passphrase) {
  const secrets = await readSecrets(app);
  const blob = secrets[name];
  if (!blob) throw new Error("尚未保存 API Key。");
  return decryptString(blob, passphrase);
}
async function deleteSecret(app, name) {
  const secrets = await readSecrets(app);
  delete secrets[name];
  await writeSecrets(app, secrets);
}

// src/settings/types.ts
var PROVIDER_PRESETS = [
  {
    id: "bailian",
    name: "阿里云百炼 · 按量计费",
    transport: "dashscope-native",
    baseUrl: DEFAULT_BASE_URL,
    keyPrefixHint: "sk-",
    note: "识别 0.00022 元/秒，合成 0.8 元/万字符。免费额度：识别 36,000 秒 / 合成 1 万字符。"
  },
  {
    id: "bailian-token-plan",
    name: "阿里云百炼 · Token Plan（订阅制）",
    transport: "openai-compatible",
    baseUrl: "https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1",
    keyPrefixHint: "sk-sp-",
    note: "按 Credits 抵扣。该渠道是否覆盖语音识别与合成模型尚未验证，请用「测试连接」确认。"
  },
  {
    id: "qianwen-speech",
    name: "千问AI平台 · 语音接口（DashScope 原生）",
    transport: "dashscope-native",
    baseUrl: "https://maas.qianwenaiapi.com",
    keyPrefixHint: "sk-",
    note: "qwen-audio-3.x-asr-flash 在这家平台上走 DashScope 原生协议。语音模型请用这一项，不要用 Token Plan 端点。"
  },
  {
    id: "qianwen-token-plan",
    name: "千问AI平台 · Token Plan（OpenAI 兼容）",
    transport: "openai-compatible",
    baseUrl: "https://token-plan.maas.qianwenaiapi.com/compatible-mode/v1",
    keyPrefixHint: "sk-",
    note: "这是 Token Plan 的聊天端点。用它调语音模型会返回空的 400，语音请改用上一项。"
  },
  {
    id: "custom",
    name: "自定义（千问AI平台等兼容渠道）",
    transport: "openai-compatible",
    baseUrl: "",
    keyPrefixHint: "任意",
    note: "填入任意 OpenAI 兼容端点的 Base URL。"
  }
];
var DEFAULT_TTS_MODEL_ID = "qwen3-tts-flash";
var DEFAULT_SETTINGS = {
  presetId: "bailian",
  transport: "dashscope-native",
  baseUrl: DEFAULT_BASE_URL,
  asrModel: DEFAULT_ASR_MODEL,
  ttsModel: DEFAULT_TTS_MODEL_ID,
  voiceURI: "",
  speechRate: 1
};
function findPreset(id) {
  const found = PROVIDER_PRESETS.find((preset) => preset.id === id);
  if (!found) throw new Error(`未知的渠道预设：${id}`);
  return found;
}
function mergeSettings(stored) {
  const merged = { ...DEFAULT_SETTINGS, ...stored ?? {} };
  if (merged.speechRate <= 0) merged.speechRate = DEFAULT_SETTINGS.speechRate;
  return merged;
}
var SECRET_KEY_NAME = "bailianApiKey";

// src/settings/tab.ts
var TRANSPORT_LABELS = {
  "dashscope-native": "DashScope 原生",
  "openai-compatible": "OpenAI 兼容"
};
var EchoReadSettingTab = class extends import_obsidian4.PluginSettingTab {
  plugin;
  passphrase = "";
  keyDraft = "";
  diagnosticEl = null;
  diagnosticLines = [];
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }
  display() {
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
  renderProvider() {
    const { containerEl } = this;
    containerEl.createEl("h3", { text: "接入渠道" });
    new import_obsidian4.Setting(containerEl).setName("服务商").setDesc("切换渠道会同时更新协议与接入地址，二者仍可手动改。").addDropdown((dropdown) => {
      for (const preset2 of PROVIDER_PRESETS) {
        dropdown.addOption(preset2.id, preset2.name);
      }
      dropdown.setValue(this.plugin.settings.presetId).onChange(async (value) => {
        const preset2 = findPreset(value);
        await this.plugin.updateSettings({
          presetId: preset2.id,
          transport: preset2.transport,
          baseUrl: preset2.baseUrl
        });
        this.display();
      });
    });
    const preset = findPreset(this.plugin.settings.presetId);
    containerEl.createEl("p", { text: preset.note, cls: "setting-item-description" });
    new import_obsidian4.Setting(containerEl).setName("协议").setDesc("DashScope 原生走 multimodal-generation 接口；OpenAI 兼容走 chat/completions。").addDropdown((dropdown) => {
      dropdown.addOption("dashscope-native", TRANSPORT_LABELS["dashscope-native"]);
      dropdown.addOption("openai-compatible", TRANSPORT_LABELS["openai-compatible"]);
      dropdown.setValue(this.plugin.settings.transport).onChange(async (value) => {
        await this.plugin.updateSettings({ transport: value });
      });
    });
    new import_obsidian4.Setting(containerEl).setName("接入地址（Base URL）").setDesc("不包含具体路径，插件会按协议自行拼接。").addText(
      (text) => text.setPlaceholder("https://dashscope.aliyuncs.com").setValue(this.plugin.settings.baseUrl).onChange(async (value) => {
        await this.plugin.updateSettings({ baseUrl: value.trim() });
      })
    );
  }
  // ---------- 模型 ----------
  renderModels() {
    const { containerEl } = this;
    containerEl.createEl("h3", { text: "模型" });
    new import_obsidian4.Setting(containerEl).setName("语音识别模型").setDesc("默认 qwen-audio-3.0-asr-flash（0.00022 元/秒）。").addText(
      (text) => text.setValue(this.plugin.settings.asrModel).onChange(async (value) => {
        await this.plugin.updateSettings({ asrModel: value.trim() });
      })
    );
    new import_obsidian4.Setting(containerEl).setName("语音合成模型").setDesc("默认 qwen3-tts-flash（0.8 元/万字符）。当前版本朗读仍走系统语音，此项为后续云合成预留。").addText(
      (text) => text.setValue(this.plugin.settings.ttsModel).onChange(async (value) => {
        await this.plugin.updateSettings({ ttsModel: value.trim() });
      })
    );
  }
  // ---------- 凭据 ----------
  renderCredentials() {
    const { containerEl } = this;
    containerEl.createEl("h3", { text: "凭据" });
    const preset = findPreset(this.plugin.settings.presetId);
    const status = containerEl.createEl("p", { cls: "setting-item-description" });
    void this.renderCredentialStatus(status, preset.keyPrefixHint);
    new import_obsidian4.Setting(containerEl).setName("API Key").setDesc(`该渠道的 Key 以 ${preset.keyPrefixHint} 开头。Key 会用下面的口令加密后存入 vault。`).addText((text) => {
      text.inputEl.type = "password";
      text.setPlaceholder("sk-…").onChange((value) => {
        this.keyDraft = value;
      });
    });
    new import_obsidian4.Setting(containerEl).setName("加密口令").setDesc("口令本身不会被保存，忘记口令只能重新填写一次 API Key。").addText((text) => {
      text.inputEl.type = "password";
      text.setPlaceholder("本设备口令").onChange((value) => {
        this.passphrase = value;
      });
    });
    new import_obsidian4.Setting(containerEl).setName("保存并解锁").setDesc("加密写入 _lingo/secrets.json，并把明文只留在内存中。").addButton(
      (button) => button.setButtonText("保存 Key").setCta().onClick(async () => {
        if (!this.passphrase) {
          new import_obsidian4.Notice("请先填写加密口令。");
          return;
        }
        if (!this.keyDraft) {
          new import_obsidian4.Notice("请先填写 API Key。");
          return;
        }
        try {
          await saveSecret(this.app, SECRET_KEY_NAME, this.keyDraft, this.passphrase);
          this.plugin.unlockedApiKey = this.keyDraft;
          this.keyDraft = "";
          new import_obsidian4.Notice("已加密保存并解锁。");
          this.display();
        } catch (error) {
          new import_obsidian4.Notice(`保存失败：${messageOf2(error)}`);
        }
      })
    ).addButton(
      (button) => button.setButtonText("仅解锁").onClick(async () => {
        if (!this.passphrase) {
          new import_obsidian4.Notice("请先填写加密口令。");
          return;
        }
        try {
          this.plugin.unlockedApiKey = await loadSecret(
            this.app,
            SECRET_KEY_NAME,
            this.passphrase
          );
          new import_obsidian4.Notice("已解锁。");
          this.display();
        } catch {
          new import_obsidian4.Notice("解锁失败：口令不正确，或尚未保存过 Key。");
        }
      })
    ).addButton(
      (button) => button.setButtonText("清除").setWarning().onClick(async () => {
        await deleteSecret(this.app, SECRET_KEY_NAME);
        this.plugin.unlockedApiKey = void 0;
        new import_obsidian4.Notice("已清除保存的 Key。");
        this.display();
      })
    );
  }
  async renderCredentialStatus(element, keyPrefixHint) {
    const saved = await hasSecret(this.app, SECRET_KEY_NAME);
    const unlocked = this.plugin.unlockedApiKey !== void 0;
    element.setText(
      saved ? unlocked ? "状态：已保存，且当前已解锁。" : "状态：已保存，但未解锁 —— 请填写口令后点「仅解锁」。" : `状态：尚未保存。该渠道的 Key 以 ${keyPrefixHint} 开头。`
    );
    const key = this.plugin.unlockedApiKey;
    if (!key) return;
    element.setText(
      `${element.getText()} 当前 Key 类型：${describeApiKeyKind(classifyApiKey(key))}。`
    );
    const mismatch = describeKeyEndpointMismatch(key, this.plugin.settings.baseUrl);
    if (mismatch) {
      element.createEl("br");
      element.createEl("strong", { text: `⚠ ${mismatch}` });
    }
  }
  // ---------- 朗读 ----------
  renderSpeech() {
    const { containerEl } = this;
    containerEl.createEl("h3", { text: "朗读" });
    new import_obsidian4.Setting(containerEl).setName("语速").setDesc("系统语音的朗读速度。").addSlider(
      (slider) => slider.setLimits(0.5, 1.5, 0.05).setValue(this.plugin.settings.speechRate).setDynamicTooltip().onChange(async (value) => {
        await this.plugin.updateSettings({ speechRate: value });
      })
    );
    new import_obsidian4.Setting(containerEl).setName("系统音色").setDesc("留空则使用系统默认英语音色。列表由系统提供，加载可能需要一点时间。").addDropdown((dropdown) => {
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
  }
  // ---------- 诊断 ----------
  renderDiagnostics() {
    const { containerEl } = this;
    containerEl.createEl("h3", { text: "诊断" });
    const endpoint = this.plugin.settings.baseUrl ? buildEndpoint(this.plugin.settings.baseUrl, this.plugin.settings.transport) : "（尚未填写接入地址）";
    containerEl.createEl("p", {
      text: `实际请求地址：${endpoint}`,
      cls: "setting-item-description"
    });
    new import_obsidian4.Setting(containerEl).setName("测试连接").setDesc(
      "发送一段音频做一次真实识别请求。默认用静音，但静音可能被判为「没有语音」，那种失败与配置无关 —— 建议先在录音工作台录一句英文并存为测试音频。"
    ).addButton(
      (button) => button.setButtonText("开始测试").onClick(async () => {
        button.setDisabled(true);
        button.setButtonText("测试中…");
        await this.runWithDiagnostics(
          button,
          "开始测试",
          "测试中…",
          () => this.runConnectionTest()
        );
      })
    );
    const sampleSetting = new import_obsidian4.Setting(containerEl).setName("测试音频").setDesc("检查中…");
    void this.refreshSampleDescription(sampleSetting);
    sampleSetting.addButton(
      (button) => button.setButtonText("清除").onClick(async () => {
        await deleteTestSample(this.app);
        new import_obsidian4.Notice("已清除测试音频。");
        this.display();
      })
    );
    new import_obsidian4.Setting(containerEl).setName("列出可用模型").setDesc(
      "调用该渠道的 GET /models，确认某个模型 ID 在本渠道是否真的存在。完整列表会打印到控制台（Ctrl+Shift+I）。"
    ).addButton(
      (button) => button.setButtonText("获取列表").onClick(async () => {
        button.setDisabled(true);
        button.setButtonText("获取中…");
        await this.runWithDiagnostics(button, "获取列表", "获取中…", async () => {
          const ids = await this.runModelList();
          return `共 ${ids.length} 个模型：
${ids.join("\n")}`;
        });
      })
    );
    new import_obsidian4.Setting(containerEl).setName("只测 Key（不发音频）").setDesc(
      "故意发一个参数不完整的请求：Key 无效会在鉴权阶段被拒（401），Key 有效则会走到参数校验并报参数错误。用来把「鉴权问题」和「音频问题」分开。"
    ).addButton(
      (button) => button.setButtonText("检测 Key").onClick(async () => {
        button.setDisabled(true);
        button.setButtonText("检测中…");
        await this.runWithDiagnostics(button, "检测 Key", "检测中…", async () => {
          const result = await this.runKeyProbe();
          return [
            describeProbeOutcome(result),
            `服务端原文：${result.detail || "（空）"}`
          ].join("\n");
        });
      })
    );
    this.diagnosticEl = containerEl.createEl("pre", { cls: "echo-read-diagnostic" });
    this.diagnosticEl.style.whiteSpace = "pre-wrap";
    this.diagnosticEl.style.userSelect = "text";
    this.diagnosticEl.style.maxHeight = "320px";
    this.diagnosticEl.style.overflow = "auto";
    this.diagnosticEl.style.fontSize = "12px";
    this.diagnosticEl.style.lineHeight = "1.5";
    this.diagnosticEl.setText(this.diagnosticLines.join("\n"));
    new import_obsidian4.Setting(containerEl).setName("复制诊断信息").setDesc("把上面的内容复制到剪贴板，便于排查。").addButton(
      (button) => button.setButtonText("复制").onClick(async () => {
        try {
          await navigator.clipboard.writeText(this.diagnosticLines.join("\n"));
          new import_obsidian4.Notice("已复制。");
        } catch {
          new import_obsidian4.Notice("复制失败，请手动选中上面的文本。");
        }
      })
    );
  }
  async runWithDiagnostics(button, idleLabel, busyLabel, action) {
    this.diagnosticLines = [];
    this.appendDiagnostic(`构建时间：${"2026-10-04T05:00:18.043Z"}`);
    this.appendDiagnostic(`时间：${(/* @__PURE__ */ new Date()).toLocaleString()}`);
    this.appendDiagnostic(`协议：${this.plugin.settings.transport}`);
    this.appendDiagnostic(`模型：${this.plugin.settings.asrModel}`);
    this.appendDiagnostic(
      `Key：${this.plugin.unlockedApiKey ? "已解锁" : "未解锁（请先点「仅解锁」）"}`
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
      new import_obsidian4.Notice("成功，详见下方诊断信息。", 8e3);
    } catch (error) {
      this.appendDiagnostic("结果：失败");
      this.appendDiagnostic(messageOf2(error));
      new import_obsidian4.Notice("失败，详见下方诊断信息。", 8e3);
    } finally {
      button.setDisabled(false);
      button.setButtonText(idleLabel);
    }
  }
  appendDiagnostic(line) {
    this.diagnosticLines.push(line);
    this.diagnosticEl?.setText(this.diagnosticLines.join("\n"));
  }
  async refreshSampleDescription(setting) {
    const exists = await hasTestSample(this.app);
    setting.setDesc(
      exists ? "已保存一段真实录音，「测试连接」会用它而不是静音。" : "尚未保存。在录音工作台录一句英文并点「存为测试音频」，测试结果才有参考价值。"
    );
  }
  async runConnectionTest() {
    const apiKey = this.plugin.unlockedApiKey;
    if (!apiKey) throw new Error("尚未解锁 API Key。");
    if (!this.plugin.settings.baseUrl) throw new Error("尚未填写接入地址。");
    const saved = await loadTestSample(this.app);
    const wav = saved ?? encodeWav(new Float32Array(16e3 * 1.5), 16e3);
    const dataUri = bytesToDataUri(new Uint8Array(wav), "audio/wav");
    this.appendDiagnostic(`请求地址：${buildEndpoint(this.plugin.settings.baseUrl, this.plugin.settings.transport)}`);
    this.appendDiagnostic(
      saved ? `音频：已保存的真实录音，base64 后 ${Math.round(dataUri.length / 1024)} KB` : `音频：1.5 秒静音（可能被判为「没有语音」，建议改为真实录音），base64 后 ${Math.round(dataUri.length / 1024)} KB`
    );
    this.appendDiagnostic(
      `请求体预览：
${previewRequestBody(
        {
          transport: this.plugin.settings.transport,
          model: this.plugin.settings.asrModel
        },
        dataUri
      )}`
    );
    return transcribeAudio(
      {
        baseUrl: this.plugin.settings.baseUrl,
        apiKey,
        model: this.plugin.settings.asrModel,
        transport: this.plugin.settings.transport
      },
      dataUri
    );
  }
  async runModelList() {
    const apiKey = this.plugin.unlockedApiKey;
    if (!apiKey) throw new Error("尚未解锁 API Key。");
    if (!this.plugin.settings.baseUrl) throw new Error("尚未填写接入地址。");
    return listModels({ baseUrl: this.plugin.settings.baseUrl, apiKey });
  }
  async runKeyProbe() {
    const apiKey = this.plugin.unlockedApiKey;
    if (!apiKey) throw new Error("尚未解锁 API Key。");
    if (!this.plugin.settings.baseUrl) throw new Error("尚未填写接入地址。");
    return probeApiKey({
      baseUrl: this.plugin.settings.baseUrl,
      apiKey,
      model: this.plugin.settings.asrModel,
      transport: this.plugin.settings.transport
    });
  }
};
function messageOf2(error) {
  return error instanceof Error ? error.message : String(error);
}

// src/main.ts
var EchoReadPlugin = class extends import_obsidian5.Plugin {
  settings = DEFAULT_SETTINGS;
  /** 解密后的 API Key，只存在内存中（设计文档 15.3）。 */
  unlockedApiKey;
  async onload() {
    this.settings = mergeSettings(
      await this.loadData()
    );
    this.addSettingTab(new EchoReadSettingTab(this.app, this));
    this.addRibbonIcon("mic", "Echo Read：录音工作台", () => this.openRecorder());
    this.addCommand({
      id: "open-recorder",
      name: "打开录音工作台",
      callback: () => this.openRecorder()
    });
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
