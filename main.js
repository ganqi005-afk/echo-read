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
var import_obsidian4 = require("obsidian");

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
var Recorder = class {
  stream;
  recorder;
  chunks = [];
  startedAt = 0;
  async start() {
    if (this.recorder) throw new Error("\u5F55\u97F3\u5DF2\u5728\u8FDB\u884C\u4E2D\u3002");
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
    if (!recorder || !stream) throw new Error("\u5F53\u524D\u6CA1\u6709\u8FDB\u884C\u4E2D\u7684\u5F55\u97F3\u3002");
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
      sample_rate: options.sampleRate ?? 16e3
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
  throw new Error(`\u65E0\u6CD5\u4ECE\u54CD\u5E94\u4E2D\u63D0\u53D6\u8BC6\u522B\u6587\u672C\u3002\u539F\u59CB\u54CD\u5E94\uFF1A${safeStringify(payload)}`);
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
    return "[\u65E0\u6CD5\u5E8F\u5217\u5316\u7684\u54CD\u5E94]";
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
async function transcribeAudio(options, audioDataUri) {
  if (!options.apiKey) {
    throw new Error("\u5C1A\u672A\u914D\u7F6E API Key\uFF0C\u8BF7\u5148\u5728\u63D2\u4EF6\u8BBE\u7F6E\u4E2D\u586B\u5199\u3002");
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
    console.error("[Echo Read] \u8BED\u97F3\u8BC6\u522B\u8BF7\u6C42\u5931\u8D25", {
      status: response.status,
      url,
      body
    });
    throw new Error(
      `\u8BED\u97F3\u8BC6\u522B\u8BF7\u6C42\u5931\u8D25\uFF08HTTP ${response.status}\uFF09\uFF1A${truncate(body, 600)}`
    );
  }
  return extractTranscript(response.json);
}
function truncate(text, limit = 600) {
  return text.length > limit ? `${text.slice(0, limit)}\u2026` : text;
}

// src/debug.ts
var current;
function installDebugHook() {
  window.echoReadDebug = {
    async start() {
      current = new Recorder();
      await current.start();
      return "\u5F55\u97F3\u4E2D\u2026\u2026\u73B0\u5728\u8BF4\u4E00\u53E5\u82F1\u6587\uFF0C\u7136\u540E\u8C03\u7528 stopAndTranscribe(key)";
    },
    async stopAndTranscribe(apiKey, expected, baseUrl = DEFAULT_BASE_URL, model = DEFAULT_ASR_MODEL, transport = "dashscope-native") {
      if (!current) throw new Error("\u8BF7\u5148\u8C03\u7528 start()");
      const recorder = current;
      current = void 0;
      const recording = await recorder.stop();
      const wav = encodeWav(recording.samples, recording.sampleRate);
      const dataUri = bytesToDataUri(new Uint8Array(wav), "audio/wav");
      const startedAt = Date.now();
      const text = await transcribeAudio({ baseUrl, apiKey, model, transport }, dataUri);
      const result = {
        seconds: Math.round(recording.durationMs / 100) / 10,
        payloadKB: Math.round(dataUri.length / 1024),
        elapsedMs: Date.now() - startedAt,
        text
      };
      if (expected) {
        const stats = diffDictation(expected, text).stats;
        result.diff = stats;
        result.score = scoreAttempt(expected, stats, recording.durationMs);
      }
      return result;
    }
  };
}

// src/settings/tab.ts
var import_obsidian3 = require("obsidian");

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

// src/settings/store.ts
var import_obsidian2 = require("obsidian");

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
  if (!blob) throw new Error("\u5C1A\u672A\u4FDD\u5B58 API Key\u3002");
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
    name: "\u963F\u91CC\u4E91\u767E\u70BC \xB7 \u6309\u91CF\u8BA1\u8D39",
    transport: "dashscope-native",
    baseUrl: DEFAULT_BASE_URL,
    keyPrefixHint: "sk-",
    note: "\u8BC6\u522B 0.00022 \u5143/\u79D2\uFF0C\u5408\u6210 0.8 \u5143/\u4E07\u5B57\u7B26\u3002\u514D\u8D39\u989D\u5EA6\uFF1A\u8BC6\u522B 36,000 \u79D2 / \u5408\u6210 1 \u4E07\u5B57\u7B26\u3002"
  },
  {
    id: "bailian-token-plan",
    name: "\u963F\u91CC\u4E91\u767E\u70BC \xB7 Token Plan\uFF08\u8BA2\u9605\u5236\uFF09",
    transport: "openai-compatible",
    baseUrl: "https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1",
    keyPrefixHint: "sk-sp-",
    note: "\u6309 Credits \u62B5\u6263\u3002\u8BE5\u6E20\u9053\u662F\u5426\u8986\u76D6\u8BED\u97F3\u8BC6\u522B\u4E0E\u5408\u6210\u6A21\u578B\u5C1A\u672A\u9A8C\u8BC1\uFF0C\u8BF7\u7528\u300C\u6D4B\u8BD5\u8FDE\u63A5\u300D\u786E\u8BA4\u3002"
  },
  {
    id: "custom",
    name: "\u81EA\u5B9A\u4E49\uFF08\u5343\u95EEAI\u5E73\u53F0\u7B49\u517C\u5BB9\u6E20\u9053\uFF09",
    transport: "openai-compatible",
    baseUrl: "",
    keyPrefixHint: "\u4EFB\u610F",
    note: "\u586B\u5165\u4EFB\u610F OpenAI \u517C\u5BB9\u7AEF\u70B9\u7684 Base URL\u3002"
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
  if (!found) throw new Error(`\u672A\u77E5\u7684\u6E20\u9053\u9884\u8BBE\uFF1A${id}`);
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
  "dashscope-native": "DashScope \u539F\u751F",
  "openai-compatible": "OpenAI \u517C\u5BB9"
};
var EchoReadSettingTab = class extends import_obsidian3.PluginSettingTab {
  plugin;
  passphrase = "";
  keyDraft = "";
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }
  display() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "Echo Read \u8BBE\u7F6E" });
    this.renderProvider();
    this.renderModels();
    this.renderCredentials();
    this.renderSpeech();
    this.renderDiagnostics();
  }
  // ---------- 接入渠道 ----------
  renderProvider() {
    const { containerEl } = this;
    containerEl.createEl("h3", { text: "\u63A5\u5165\u6E20\u9053" });
    new import_obsidian3.Setting(containerEl).setName("\u670D\u52A1\u5546").setDesc("\u5207\u6362\u6E20\u9053\u4F1A\u540C\u65F6\u66F4\u65B0\u534F\u8BAE\u4E0E\u63A5\u5165\u5730\u5740\uFF0C\u4E8C\u8005\u4ECD\u53EF\u624B\u52A8\u6539\u3002").addDropdown((dropdown) => {
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
    new import_obsidian3.Setting(containerEl).setName("\u534F\u8BAE").setDesc("DashScope \u539F\u751F\u8D70 multimodal-generation \u63A5\u53E3\uFF1BOpenAI \u517C\u5BB9\u8D70 chat/completions\u3002").addDropdown((dropdown) => {
      dropdown.addOption("dashscope-native", TRANSPORT_LABELS["dashscope-native"]);
      dropdown.addOption("openai-compatible", TRANSPORT_LABELS["openai-compatible"]);
      dropdown.setValue(this.plugin.settings.transport).onChange(async (value) => {
        await this.plugin.updateSettings({ transport: value });
      });
    });
    new import_obsidian3.Setting(containerEl).setName("\u63A5\u5165\u5730\u5740\uFF08Base URL\uFF09").setDesc("\u4E0D\u5305\u542B\u5177\u4F53\u8DEF\u5F84\uFF0C\u63D2\u4EF6\u4F1A\u6309\u534F\u8BAE\u81EA\u884C\u62FC\u63A5\u3002").addText(
      (text) => text.setPlaceholder("https://dashscope.aliyuncs.com").setValue(this.plugin.settings.baseUrl).onChange(async (value) => {
        await this.plugin.updateSettings({ baseUrl: value.trim() });
      })
    );
  }
  // ---------- 模型 ----------
  renderModels() {
    const { containerEl } = this;
    containerEl.createEl("h3", { text: "\u6A21\u578B" });
    new import_obsidian3.Setting(containerEl).setName("\u8BED\u97F3\u8BC6\u522B\u6A21\u578B").setDesc("\u9ED8\u8BA4 qwen-audio-3.0-asr-flash\uFF080.00022 \u5143/\u79D2\uFF09\u3002").addText(
      (text) => text.setValue(this.plugin.settings.asrModel).onChange(async (value) => {
        await this.plugin.updateSettings({ asrModel: value.trim() });
      })
    );
    new import_obsidian3.Setting(containerEl).setName("\u8BED\u97F3\u5408\u6210\u6A21\u578B").setDesc("\u9ED8\u8BA4 qwen3-tts-flash\uFF080.8 \u5143/\u4E07\u5B57\u7B26\uFF09\u3002\u5F53\u524D\u7248\u672C\u6717\u8BFB\u4ECD\u8D70\u7CFB\u7EDF\u8BED\u97F3\uFF0C\u6B64\u9879\u4E3A\u540E\u7EED\u4E91\u5408\u6210\u9884\u7559\u3002").addText(
      (text) => text.setValue(this.plugin.settings.ttsModel).onChange(async (value) => {
        await this.plugin.updateSettings({ ttsModel: value.trim() });
      })
    );
  }
  // ---------- 凭据 ----------
  renderCredentials() {
    const { containerEl } = this;
    containerEl.createEl("h3", { text: "\u51ED\u636E" });
    const preset = findPreset(this.plugin.settings.presetId);
    const status = containerEl.createEl("p", { cls: "setting-item-description" });
    void this.renderCredentialStatus(status, preset.keyPrefixHint);
    new import_obsidian3.Setting(containerEl).setName("API Key").setDesc(`\u8BE5\u6E20\u9053\u7684 Key \u4EE5 ${preset.keyPrefixHint} \u5F00\u5934\u3002Key \u4F1A\u7528\u4E0B\u9762\u7684\u53E3\u4EE4\u52A0\u5BC6\u540E\u5B58\u5165 vault\u3002`).addText((text) => {
      text.inputEl.type = "password";
      text.setPlaceholder("sk-\u2026").onChange((value) => {
        this.keyDraft = value;
      });
    });
    new import_obsidian3.Setting(containerEl).setName("\u52A0\u5BC6\u53E3\u4EE4").setDesc("\u53E3\u4EE4\u672C\u8EAB\u4E0D\u4F1A\u88AB\u4FDD\u5B58\uFF0C\u5FD8\u8BB0\u53E3\u4EE4\u53EA\u80FD\u91CD\u65B0\u586B\u5199\u4E00\u6B21 API Key\u3002").addText((text) => {
      text.inputEl.type = "password";
      text.setPlaceholder("\u672C\u8BBE\u5907\u53E3\u4EE4").onChange((value) => {
        this.passphrase = value;
      });
    });
    new import_obsidian3.Setting(containerEl).setName("\u4FDD\u5B58\u5E76\u89E3\u9501").setDesc("\u52A0\u5BC6\u5199\u5165 _lingo/secrets.json\uFF0C\u5E76\u628A\u660E\u6587\u53EA\u7559\u5728\u5185\u5B58\u4E2D\u3002").addButton(
      (button) => button.setButtonText("\u4FDD\u5B58 Key").setCta().onClick(async () => {
        if (!this.passphrase) {
          new import_obsidian3.Notice("\u8BF7\u5148\u586B\u5199\u52A0\u5BC6\u53E3\u4EE4\u3002");
          return;
        }
        if (!this.keyDraft) {
          new import_obsidian3.Notice("\u8BF7\u5148\u586B\u5199 API Key\u3002");
          return;
        }
        try {
          await saveSecret(this.app, SECRET_KEY_NAME, this.keyDraft, this.passphrase);
          this.plugin.unlockedApiKey = this.keyDraft;
          this.keyDraft = "";
          new import_obsidian3.Notice("\u5DF2\u52A0\u5BC6\u4FDD\u5B58\u5E76\u89E3\u9501\u3002");
          this.display();
        } catch (error) {
          new import_obsidian3.Notice(`\u4FDD\u5B58\u5931\u8D25\uFF1A${messageOf(error)}`);
        }
      })
    ).addButton(
      (button) => button.setButtonText("\u4EC5\u89E3\u9501").onClick(async () => {
        if (!this.passphrase) {
          new import_obsidian3.Notice("\u8BF7\u5148\u586B\u5199\u52A0\u5BC6\u53E3\u4EE4\u3002");
          return;
        }
        try {
          this.plugin.unlockedApiKey = await loadSecret(
            this.app,
            SECRET_KEY_NAME,
            this.passphrase
          );
          new import_obsidian3.Notice("\u5DF2\u89E3\u9501\u3002");
          this.display();
        } catch {
          new import_obsidian3.Notice("\u89E3\u9501\u5931\u8D25\uFF1A\u53E3\u4EE4\u4E0D\u6B63\u786E\uFF0C\u6216\u5C1A\u672A\u4FDD\u5B58\u8FC7 Key\u3002");
        }
      })
    ).addButton(
      (button) => button.setButtonText("\u6E05\u9664").setWarning().onClick(async () => {
        await deleteSecret(this.app, SECRET_KEY_NAME);
        this.plugin.unlockedApiKey = void 0;
        new import_obsidian3.Notice("\u5DF2\u6E05\u9664\u4FDD\u5B58\u7684 Key\u3002");
        this.display();
      })
    );
  }
  async renderCredentialStatus(element, keyPrefixHint) {
    const saved = await hasSecret(this.app, SECRET_KEY_NAME);
    const unlocked = this.plugin.unlockedApiKey !== void 0;
    element.setText(
      saved ? unlocked ? "\u72B6\u6001\uFF1A\u5DF2\u4FDD\u5B58\uFF0C\u4E14\u5F53\u524D\u5DF2\u89E3\u9501\u3002" : "\u72B6\u6001\uFF1A\u5DF2\u4FDD\u5B58\uFF0C\u4F46\u672A\u89E3\u9501 \u2014\u2014 \u8BF7\u586B\u5199\u53E3\u4EE4\u540E\u70B9\u300C\u4EC5\u89E3\u9501\u300D\u3002" : `\u72B6\u6001\uFF1A\u5C1A\u672A\u4FDD\u5B58\u3002\u8BE5\u6E20\u9053\u7684 Key \u4EE5 ${keyPrefixHint} \u5F00\u5934\u3002`
    );
  }
  // ---------- 朗读 ----------
  renderSpeech() {
    const { containerEl } = this;
    containerEl.createEl("h3", { text: "\u6717\u8BFB" });
    new import_obsidian3.Setting(containerEl).setName("\u8BED\u901F").setDesc("\u7CFB\u7EDF\u8BED\u97F3\u7684\u6717\u8BFB\u901F\u5EA6\u3002").addSlider(
      (slider) => slider.setLimits(0.5, 1.5, 0.05).setValue(this.plugin.settings.speechRate).setDynamicTooltip().onChange(async (value) => {
        await this.plugin.updateSettings({ speechRate: value });
      })
    );
    new import_obsidian3.Setting(containerEl).setName("\u7CFB\u7EDF\u97F3\u8272").setDesc("\u7559\u7A7A\u5219\u4F7F\u7528\u7CFB\u7EDF\u9ED8\u8BA4\u82F1\u8BED\u97F3\u8272\u3002\u5217\u8868\u7531\u7CFB\u7EDF\u63D0\u4F9B\uFF0C\u52A0\u8F7D\u53EF\u80FD\u9700\u8981\u4E00\u70B9\u65F6\u95F4\u3002").addDropdown((dropdown) => {
      dropdown.addOption("", "\u7CFB\u7EDF\u9ED8\u8BA4");
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
    containerEl.createEl("h3", { text: "\u8BCA\u65AD" });
    new import_obsidian3.Setting(containerEl).setName("\u6D4B\u8BD5\u8FDE\u63A5").setDesc(
      "\u53D1\u9001 0.3 \u79D2\u9759\u97F3\u97F3\u9891\u505A\u4E00\u6B21\u771F\u5B9E\u8BC6\u522B\u8BF7\u6C42\uFF0C\u7528\u6765\u786E\u8BA4\u9274\u6743\u4E0E\u534F\u8BAE\u662F\u5426\u5339\u914D\u3002Token Plan \u662F\u5426\u652F\u6301\u8BED\u97F3\u6A21\u578B\uFF0C\u9760\u8FD9\u4E00\u9879\u5C31\u80FD\u9A8C\u8BC1\u3002"
    ).addButton(
      (button) => button.setButtonText("\u5F00\u59CB\u6D4B\u8BD5").onClick(async () => {
        button.setDisabled(true);
        button.setButtonText("\u6D4B\u8BD5\u4E2D\u2026");
        try {
          const result = await this.runConnectionTest();
          new import_obsidian3.Notice(`\u8FDE\u63A5\u6210\u529F\u3002\u8FD4\u56DE\u6587\u672C\uFF1A\u300C${result || "\uFF08\u7A7A\uFF09"}\u300D`, 8e3);
        } catch (error) {
          new import_obsidian3.Notice(`\u8FDE\u63A5\u5931\u8D25\uFF1A${messageOf(error)}`, 12e3);
        } finally {
          button.setDisabled(false);
          button.setButtonText("\u5F00\u59CB\u6D4B\u8BD5");
        }
      })
    );
  }
  async runConnectionTest() {
    const apiKey = this.plugin.unlockedApiKey;
    if (!apiKey) throw new Error("\u5C1A\u672A\u89E3\u9501 API Key\u3002");
    if (!this.plugin.settings.baseUrl) throw new Error("\u5C1A\u672A\u586B\u5199\u63A5\u5165\u5730\u5740\u3002");
    const silence = new Float32Array(16e3 * 0.3);
    const wav = encodeWav(silence, 16e3);
    const dataUri = bytesToDataUri(new Uint8Array(wav), "audio/wav");
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
};
function messageOf(error) {
  return error instanceof Error ? error.message : String(error);
}

// src/main.ts
var EchoReadPlugin = class extends import_obsidian4.Plugin {
  settings = DEFAULT_SETTINGS;
  /** 解密后的 API Key，只存在内存中（设计文档 15.3）。 */
  unlockedApiKey;
  async onload() {
    this.settings = mergeSettings(
      await this.loadData()
    );
    this.addSettingTab(new EchoReadSettingTab(this.app, this));
    installDebugHook();
    console.log("Echo Read loaded");
  }
  async updateSettings(patch) {
    this.settings = mergeSettings({ ...this.settings, ...patch });
    await this.saveData(this.settings);
  }
};
