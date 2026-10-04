import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { execFileSync } from "node:child_process";

// 插件本体：这三件是运行必需的
const REQUIRED = ["manifest.json", "main.js", "styles.css"];
// 插件设置。"填好的"配置在这里，里面只有地址、模型、音色这类信息
const OPTIONAL = ["data.json"];

const OUT_DIR = path.resolve("dist/echo-read");
const ZIP_PATH = path.resolve("dist/echo-read.zip");

// 真实密钥形态：sk- 后面还有一长串。代码里用来分类的前缀 "sk-sp-" 不会命中 ——
// 它后面只有 3 个字符，够不到 12 的长度门槛
const KEY_SHAPE = /sk-[A-Za-z0-9_-]{12,}/g;

function readDeployTarget() {
  try {
    const value = fs.readFileSync(path.resolve(".deploy-target"), "utf8").trim();
    return value || undefined;
  } catch {
    return undefined;
  }
}

// 从 vault 里读出真实的 Key 值，用来做最强的那道校验：
// 只要导出文件里出现任何一个完整 Key，就报错中止
function collectRealKeys(vaultPath) {
  if (!vaultPath) return [];
  const keysPath = path.join(vaultPath, "_lingo", "keys.json");
  if (!fs.existsSync(keysPath)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(keysPath, "utf8"));
    return Object.values(parsed.keys ?? {})
      .map((record) => record?.value)
      .filter((value) => typeof value === "string" && value.trim().length >= 12);
  } catch {
    return [];
  }
}

function assertClean(file, content, realKeys) {
  const shaped = content.match(KEY_SHAPE);
  if (shaped) {
    throw new Error(`${file} 里出现了疑似密钥形态的字符串（${shaped[0].slice(0, 9)}…）`);
  }
  for (const key of realKeys) {
    if (content.includes(key)) {
      throw new Error(`${file} 里出现了完整的 API Key —— 导出已中止`);
    }
  }
}

function resolveSource(name, vaultPath) {
  const fromVault = vaultPath
    ? path.join(vaultPath, ".obsidian", "plugins", "echo-read", name)
    : "";
  // data.json 优先取 vault 里"填好的"那一份
  if (name === "data.json" && fromVault !== "" && fs.existsSync(fromVault)) return fromVault;
  return path.resolve(name);
}

const vaultPath = readDeployTarget();
const realKeys = collectRealKeys(vaultPath);

fs.rmSync(OUT_DIR, { recursive: true, force: true });
fs.mkdirSync(OUT_DIR, { recursive: true });

const exported = [];
for (const name of [...REQUIRED, ...OPTIONAL]) {
  const source = resolveSource(name, vaultPath);
  if (!fs.existsSync(source)) {
    if (REQUIRED.includes(name)) {
      console.error(`缺少必需文件：${name}（先运行 npm run build）`);
      process.exit(1);
    }
    continue;
  }

  const content = fs.readFileSync(source);
  assertClean(name, content.toString("utf8"), realKeys);
  fs.writeFileSync(path.join(OUT_DIR, name), content);
  exported.push(name);
}

console.log(`已导出：${exported.join(" / ")}`);
console.log(`→ ${OUT_DIR}`);

const verdict = realKeys.length > 0
  ? `已用密钥库里的 ${realKeys.length} 个真实 Key 逐字节核对，全部未出现。`
  : "未找到密钥库，仅按密钥形态做了检查。";
console.log(verdict);
console.log("未包含：_lingo/ 下的任何数据（密钥、音频、卡片、队列、提示词）。");

// 打包是锦上添花，失败不该让整个导出算失败 —— 文件夹本身已经可以直接拷
try {
  if (fs.existsSync(ZIP_PATH)) fs.rmSync(ZIP_PATH);
  execFileSync("tar", ["-a", "-c", "-f", ZIP_PATH, "-C", path.dirname(OUT_DIR), "echo-read"]);
  console.log(`→ ${ZIP_PATH}`);
} catch {
  console.log("（压缩包生成失败，直接拷 dist/echo-read 文件夹即可）");
}
