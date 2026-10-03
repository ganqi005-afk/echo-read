import { Plugin } from "obsidian";

export default class EchoReadPlugin extends Plugin {
  async onload() {
    console.log("Echo Read loaded");
  }
}
