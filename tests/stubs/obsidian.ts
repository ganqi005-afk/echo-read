/** 仅供单元测试使用的最小桩，不参与打包。 */

export class Plugin {}

export class PluginSettingTab {}

export class Setting {}

export class Notice {}

export function normalizePath(path: string): string {
  return path;
}

export async function requestUrl(): Promise<never> {
  throw new Error("单元测试中不应发起真实网络请求。");
}
