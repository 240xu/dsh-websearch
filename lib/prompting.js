/**
 * dsh-websearch — 系统性搜索提示词（纯函数，零依赖）。
 *
 * 依据权威资料（2024-2026 官方文档与一手论文）实现三项必做：
 *   1. 查询整形（query shaping）：后端扇出前对口语化长查询做确定性归一，
 *      并导出给宿主/代理层使用的查询构造指引。
 *      依据：Tavily Best Practices（agent 风格 ≤1500 字符查询、子查询分解）
 *      https://docs.tavily.com/documentation/best-practices/best-practices-search
 *      Exa Search Best Practices（语义丰富、描述性查询）
 *      https://exa.ai/docs/search-best-practices
 *   2. 结果呈现头（result-presentation header）：模型看到的结果块以「来源
 *      甄别 + 引用要求」开头，要求每条事实注明来源链接、优先官方/一手来源、
 *      时效敏感主题优先较新结果。
 *      依据：Anthropic Web Search Tool（结果块置于问题之前、引用来源）
 *      https://platform.claude.com/docs/en/agents-and-tools/tool-use/web-search-tool
 *      OpenAI Prompt Engineering（分解 + 持久性指令）
 *      https://platform.openai.com/docs/guides/prompt-engineering
 *   3. 多面查询分解指引（导出常量，供宿主/代理层按需使用；不对本插件内
 *      的单次请求盲目多查询——盲目多查询可能劣化，见 arXiv:2404.01037）。
 *      依据：RAG-Fusion / 多查询变体 https://github.com/Raudaschl/rag-fusion
 *      Step-Back Prompting https://arxiv.org/abs/2310.06117
 *      HyDE https://arxiv.org/abs/2212.10496
 * @module dsh-websearch/prompting
 */

/** 查询硬上限（Tavily：agent 查询应简短聚焦；>1500 字符视为跑题长文）。 */
export const QUERY_MAX_CHARS = 1500;

/** 去口语化前缀（中英常见寒暄/请求词，确定性剥离，不改写语义）。 */
const FILLER_PREFIX_RE =
  /^(?:please|pls|kindly|could you(?: please)?|can you(?: please)?|help me(?: to)?|search for|search|look up|google|find me|find|i(?:'d| would)? like to know|tell me|what is|who is|when is|where is|"|「|『)\s*/i;
const FILLER_PREFIX_RE_ZH =
  /^(?:请|麻烦|帮我?|帮忙|帮我查一?下|查一?下|查询|搜索一下?|搜一下?|查一下?|帮我找|找一下?|我想知道|请问)/;

/**
 * 确定性查询整形：剥离口语前缀（循环多次以处理叠加寒暄）、压缩空白、
 * 截断到 QUERY_MAX_CHARS。绝不改写实体/版本号/日期。
 * @param {string} query
 * @returns {string}
 */
export function shapeQuery(query) {
  if (typeof query !== "string") return "";
  let q = query.replace(/\s+/g, " ").trim();
  // 中文寒暄与英文寒暄交替剥离，直到稳定。
  for (let i = 0; i < 6; i++) {
    const before = q;
    q = q.replace(FILLER_PREFIX_RE, "").trim();
    q = q.replace(FILLER_PREFIX_RE_ZH, "").trim();
    if (q === before) break;
  }
  if (q.length > QUERY_MAX_CHARS) q = q.slice(0, QUERY_MAX_CHARS).trim();
  return q;
}

/**
 * 结果呈现头（英文）。置于模型可见结果块最前（Anthropic：结果先于问题
 * 显著提升引用召回）。要求：逐条标注 [n]、优先官方/一手来源、时效敏感
 * 主题优先较新结果、每条事实给出来源链接、与问题无关的条目忽略。
 */
export const RESULT_HEADER_EN =
  "Web search results (merged from multiple engines, deduplicated by URL). " +
  "Each entry: [n] title — URL. Prefer official / primary sources; prefer newer " +
  "results for fast-moving topics; ignore entries whose snippet does not actually " +
  "answer the question. Cite the URL for every fact you take from a result.";

/** 结果呈现头（中文）。 */
export const RESULT_HEADER_ZH =
  "网页搜索结果（多引擎合并、已按 URL 去重）。每条格式：[n] 标题 — 链接。" +
  "优先采用官方/一手来源；时效敏感主题优先较新结果；摘要与问题无关的条目直接忽略。" +
  "引用结果中的任何事实时必须注明来源链接。";

/**
 * 查询构造指引（导出给宿主/代理层注入 agent 系统提示用；本插件不发送）。
 * EN 面向 agent，ZH 为同义说明。要点：一条聚焦查询、保留专名/版本/日期、
 * 多面请求按维度拆成多条子查询、首轮结果不佳时先写 2-3 句假想答案再以其
 * 关键短语重搜（HyDE）、持续检索直到每个维度都有答案。
 */
export const QUERY_GUIDANCE_EN =
  "When searching the web: issue ONE concise, agent-style query (keep named " +
  "entities, version numbers and dates; drop conversational filler). If the " +
  "request has 2+ independent facets, issue separate focused queries per facet " +
  "and merge findings. If the first round returns poor results, write a 2-3 " +
  "sentence hypothetical ideal answer and re-query with its key phrases. " +
  "Keep searching until every facet is answered or demonstrably unavailable.";

/** 查询构造指引（中文版）。 */
export const QUERY_GUIDANCE_ZH =
  "联网检索时：一次发出一条简洁的 agent 风格查询（保留专名/版本号/日期，去掉口语寒暄）。" +
  "若请求含 2 个以上独立维度，按维度分别发起聚焦查询并汇总结论。" +
  "首轮结果不佳时，先写 2-3 句假想的理想答案，再用其中的关键短语重新检索。" +
  "持续检索直到每个维度都有答案或确认不可得。";

/**
 * 按语言取结果呈现头。
 * @param {"zh"|"en"|string} [lang]
 */
export function resultHeader(lang) {
  return String(lang || "").toLowerCase().startsWith("zh") ? RESULT_HEADER_ZH : RESULT_HEADER_EN;
}

/**
 * 遥测行自标注（零成本修复）：模型可能把后端失败遥测误读为结果来源；
 * 显式声明「仅诊断，不是来源」。随结果块一并呈现。
 */
export const TELEMETRY_TAG = " (diagnostic only, not a source)";
