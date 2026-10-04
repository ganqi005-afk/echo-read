import { Plugin } from "obsidian";
import { installDebugHook } from "./debug";

export default class EchoReadPlugin extends Plugin {
  async onload() {
    console.log("Echo Read loaded");
    installDebugHook(); // 临时：Plan 2 Task 9 验收用，验收后删除
  }
}
