import { App } from "obsidian";

/**
 * 测试音频：把一段真实录音存下来，作为「测试连接」的输入。
 *
 * 为什么不用静音做测试：静音有可能被服务端判为「没有检测到语音」而报错，
 * 那种失败和配置无关，却会掩盖真正的问题。用真实语音测试才有意义。
 *
 * 存在 _lingo/test-sample.wav，不进版本管理（是个人语音）。
 */
export const TEST_SAMPLE_PATH = "_lingo/test-sample.wav";
export const TEST_SAMPLE_DIR = "_lingo";

export async function hasTestSample(app: App): Promise<boolean> {
  return app.vault.adapter.exists(TEST_SAMPLE_PATH);
}

export async function saveTestSample(app: App, wav: ArrayBuffer): Promise<void> {
  const adapter = app.vault.adapter;
  if (!(await adapter.exists(TEST_SAMPLE_DIR))) await adapter.mkdir(TEST_SAMPLE_DIR);
  await adapter.writeBinary(TEST_SAMPLE_PATH, wav);
}

export async function loadTestSample(app: App): Promise<ArrayBuffer | undefined> {
  const adapter = app.vault.adapter;
  if (!(await adapter.exists(TEST_SAMPLE_PATH))) return undefined;
  return adapter.readBinary(TEST_SAMPLE_PATH);
}

export async function deleteTestSample(app: App): Promise<void> {
  const adapter = app.vault.adapter;
  if (await adapter.exists(TEST_SAMPLE_PATH)) await adapter.remove(TEST_SAMPLE_PATH);
}
