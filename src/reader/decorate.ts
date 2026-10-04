import { splitSentenceRanges, type SentenceRange } from "../core/sentence";

export const SENTENCE_ATTR = "data-echo-read-sentence";
export const PARAGRAPH_ATTR = "data-echo-read-paragraph";
export const CURRENT_CLASS = "echo-read-current";

const MIN_SENTENCES = 2;
const MIN_LENGTH = 40;

/**
 * 把段落里的文本切成句子，并给每段文本节点包一层带索引的 span。
 *
 * 核心约束：**只切分文本节点，不重建元素**（设计文档 4.5）。
 * 一句跨越行内元素（如 <strong>）时，会由多个 span 共同表示，
 * 它们共享同一个索引 —— 这样永远不需要"包住一个元素"，
 * 也就不会遇到 Range.surroundContents 在跨元素时抛错的问题。
 *
 * 返回是否做了装饰。
 */
export function decorateParagraph(paragraph: HTMLElement): boolean {
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

function collectTextNodes(root: HTMLElement): Text[] {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.nodeValue && node.nodeValue.length > 0) nodes.push(node as Text);
  }
  return nodes;
}

/**
 * 逐个文本节点判断它落在哪个句子里；跨句的节点会被切开。
 *
 * 一个必须处理的细节：句子之间通常有空白（如 "句一。 句二。"），
 * 那段空白不属于任何句子范围。不专门跳过它的话，循环会在间隙处中断，
 * 导致后面的句子永远不被包裹。
 */
function assignOwners(
  nodes: Text[],
  ranges: SentenceRange[],
): Array<{ node: Text; index: number }> {
  const owners: Array<{ node: Text; index: number }> = [];
  let offset = 0;

  for (const node of nodes) {
    const length = node.nodeValue?.length ?? 0;
    const nodeEnd = offset + length;
    let cursor = offset;
    let current: Text = node;

    while (cursor < nodeEnd) {
      const index = ranges.findIndex((range) => cursor >= range.start && cursor < range.end);

      if (index < 0) {
        // 落在句子之间的间隙：切掉它继续往后找，而不是中断
        const next = ranges.find((range) => range.start > cursor);
        const stop = Math.min(next ? next.start : nodeEnd, nodeEnd);
        if (stop <= cursor) break;
        current = current.splitText(stop - cursor);
        cursor = stop;
        continue;
      }

      const boundary = ranges[index].end;
      if (boundary >= nodeEnd) {
        owners.push({ node: current, index });
        break;
      }

      const rest = current.splitText(boundary - cursor);
      owners.push({ node: current, index });
      current = rest;
      cursor = boundary;
    }

    offset = nodeEnd;
  }

  return owners;
}

function wrapTextNode(node: Text, index: number): void {
  const parent = node.parentNode;
  if (!parent) return;
  const span = document.createElement("span");
  span.setAttribute(SENTENCE_ATTR, String(index));
  parent.insertBefore(span, node);
  span.appendChild(node);
}
