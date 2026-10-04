import { describe, expect, it } from "vitest";
import {
  DEFAULT_ASK_PROMPT,
  DEFAULT_ETYMOLOGY_PROMPT,
  DEFAULT_PRACTICE_PROMPT,
  formatSynonymHint,
  parseFeedback,
  pickSynonymCycle,
  renderAskPrompt,
  renderEtymologyPrompt,
  renderPrompt,
  SYNONYM_CYCLES,
  type PracticeContext,
} from "../../src/llm/prompt";

const CONTEXT: PracticeContext = {
  text: "The plan is ready.",
  recognized: "the plan is ready",
  accuracy: 100,
  completeness: 100,
  fluency: 92,
  missing: 0,
  extra: 0,
  wrong: 0,
};

describe("renderPrompt", () => {
  it("substitutes every placeholder", () => {
    const rendered = renderPrompt(DEFAULT_PRACTICE_PROMPT, CONTEXT);
    expect(rendered).toContain("The plan is ready.");
    expect(rendered).toContain("92");
    expect(rendered).not.toContain("{{");
  });

  it("describes an empty recognition result instead of leaving a blank", () => {
    const rendered = renderPrompt(DEFAULT_PRACTICE_PROMPT, { ...CONTEXT, recognized: "" });
    expect(rendered).toContain("没有识别到内容");
  });

  it("leaves an unknown placeholder untouched so it is easy to spot", () => {
    expect(renderPrompt("hello {{NOPE}}", CONTEXT)).toBe("hello {{NOPE}}");
  });

  // 设计文档 13.3：整句翻译会摧毁"纯英文阅读"的前提
  it("keeps the do-not-translate rule in the default prompt", () => {
    expect(DEFAULT_PRACTICE_PROMPT).toContain("绝对不要翻译整句");
  });

  it("tells the model that an empty result is acceptable", () => {
    expect(DEFAULT_PRACTICE_PROMPT).toContain("空数组");
  });
});

describe("parseFeedback", () => {
  it("parses a plain JSON reply", () => {
    const raw = '{"explain": "注意连读", "cards": [{"term": "postpone", "cloze": "to ____ it"}]}';
    const feedback = parseFeedback(raw);
    expect(feedback.explain).toBe("注意连读");
    expect(feedback.cards).toEqual([{ term: "postpone", cloze: "to ____ it" }]);
  });

  // 真实模型经常给 JSON 套代码块，或前后加一句客套话
  it("tolerates a fenced code block", () => {
    const raw = '好的：\n```json\n{"explain": "不错", "cards": []}\n```\n希望有帮助。';
    expect(parseFeedback(raw).explain).toBe("不错");
  });

  it("tolerates surrounding prose without a fence", () => {
    expect(parseFeedback('结果如下 {"explain": "还行", "cards": []} 完毕').explain).toBe("还行");
  });

  it("accepts an empty result, as the prompt requires", () => {
    expect(parseFeedback('{"explain": "", "cards": []}')).toEqual({ explain: "", cards: [] });
  });

  it("caps the number of cards at two", () => {
    const raw = JSON.stringify({
      explain: "x",
      cards: [
        { term: "a", cloze: "1" },
        { term: "b", cloze: "2" },
        { term: "c", cloze: "3" },
      ],
    });
    expect(parseFeedback(raw).cards).toHaveLength(2);
  });

  it("drops malformed cards instead of failing the whole reply", () => {
    const raw = JSON.stringify({
      explain: "x",
      cards: [{ term: "a" }, { term: "", cloze: "y" }, { term: "ok", cloze: "z" }],
    });
    expect(parseFeedback(raw).cards).toEqual([{ term: "ok", cloze: "z" }]);
  });

  // 格式不符时给一段不完美的解释，比整个失败好得多
  it("falls back to the raw text when there is no JSON at all", () => {
    expect(parseFeedback("模型没有按要求返回").explain).toBe("模型没有按要求返回");
  });

  it("falls back when the JSON is broken", () => {
    expect(parseFeedback('{"explain": "x"').explain).toBe('{"explain": "x"');
  });
});

describe("renderAskPrompt", () => {
  it("fills in both the selection and the question", () => {
    const rendered = renderAskPrompt(DEFAULT_ASK_PROMPT, {
      text: "The plan is ready.",
      question: "为什么用现在完成时？",
    });
    expect(rendered).toContain("The plan is ready.");
    expect(rendered).toContain("为什么用现在完成时？");
    expect(rendered).not.toContain("{{");
  });

  /**
   * 这与「讲解」的规则刻意不同：
   * 讲解是自动生成的，所以禁止整句翻译；提问是用户主动发起的，
   * 明确要求翻译时就该给 —— 硬禁等于跟用户的意图对着干。
   */
  it("forbids unsolicited translation but yields to an explicit request", () => {
    expect(DEFAULT_ASK_PROMPT).toContain("不要主动给出整句中文翻译");
    expect(DEFAULT_ASK_PROMPT).toContain("明确要求时，照办");
  });

  it("keeps the answer bounded unless the user asks for more", () => {
    expect(DEFAULT_ASK_PROMPT).toContain("三句话以内");
  });
});

describe("同义词轮换", () => {
  /**
   * 原规则要求"接下来的 3–5 条解析中继续使用同一个同义词"。
   * 模型调用是无状态的，记不住上一条用了什么 —— 所以轮换只能由本地推进。
   */
  it("advances one cycle per turn", () => {
    expect(pickSynonymCycle(0)).not.toEqual(pickSynonymCycle(1));
  });

  it("wraps around after the last cycle", () => {
    expect(pickSynonymCycle(SYNONYM_CYCLES.length)).toEqual(pickSynonymCycle(0));
  });

  it("survives a negative turn without crashing or returning undefined", () => {
    expect(pickSynonymCycle(-1)).toEqual(SYNONYM_CYCLES[SYNONYM_CYCLES.length - 1]);
  });

  it("formats every pair into the hint line", () => {
    const hint = formatSynonymHint(pickSynonymCycle(0));
    expect(hint).toContain("understand → grasp");
    expect(hint).toContain("；");
  });
});

describe("renderEtymologyPrompt", () => {
  it("fills in the text and the synonym group for this turn", () => {
    const rendered = renderEtymologyPrompt(DEFAULT_ETYMOLOGY_PROMPT, {
      text: "suspect",
      synonyms: formatSynonymHint(pickSynonymCycle(0)),
    });
    expect(rendered).toContain("suspect");
    expect(rendered).toContain("grasp");
    expect(rendered).not.toContain("{{");
  });

  // 这份提示词的全部价值在于格式被严格遵守
  it("keeps every required section in order", () => {
    const order = [
      "## 1. 词根拆解",
      "## 2. 发音提示",
      "## 3. 英文解释",
      "## 4. 同义替换词汇",
      "## 5. 中文翻译",
      "## 6. 同根词举例",
    ];
    let cursor = -1;
    for (const heading of order) {
      const at = DEFAULT_ETYMOLOGY_PROMPT.indexOf(heading);
      expect(at).toBeGreaterThan(cursor);
      cursor = at;
    }
  });

  it("bans the international phonetic alphabet", () => {
    expect(DEFAULT_ETYMOLOGY_PROMPT).toContain("不使用国际音标");
  });

  it("asks for at least three substitutions", () => {
    expect(DEFAULT_ETYMOLOGY_PROMPT).toContain("至少替换 3 处");
  });
});
