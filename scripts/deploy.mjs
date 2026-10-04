import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const PLUGIN_FILES = ["manifest.json", "main.js", "styles.css"];

function resolveTarget() {
  if (process.env.ECHO_READ_VAULT) return process.env.ECHO_READ_VAULT.trim();

  const configFile = path.resolve(".deploy-target");
  if (fs.existsSync(configFile)) {
    const value = fs.readFileSync(configFile, "utf8").trim();
    if (value) return value;
  }
  return undefined;
}

const target = resolveTarget();
if (!target) {
  console.error(
    "未配置部署目标。请在项目根目录创建 .deploy-target 写入 vault 路径，或设置环境变量 ECHO_READ_VAULT。",
  );
  process.exit(1);
}

if (!fs.existsSync(path.join(target, ".obsidian"))) {
  console.error(`目标不是 Obsidian 仓库（找不到 .obsidian 目录）：${target}`);
  process.exit(1);
}

const destination = path.join(target, ".obsidian", "plugins", "echo-read");
fs.mkdirSync(destination, { recursive: true });

const copied = [];
for (const file of PLUGIN_FILES) {
  const source = path.resolve(file);
  if (!fs.existsSync(source)) continue;
  fs.copyFileSync(source, path.join(destination, file));
  copied.push(file);
}

if (copied.length === 0) {
  console.error("没有找到可同步的文件，请先运行 npm run build。");
  process.exit(1);
}

console.log(`已同步 ${copied.join(" / ")}`);
console.log(`→ ${destination}`);
console.log("在 Obsidian 里重新加载插件（或重启）后生效。");
