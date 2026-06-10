#!/usr/bin/env python3
"""
两段式 AI 增强:用本机 headless Claude Code 对每篇论文逐个总结并按研究关注点排序。
Two-stage AI enhancement powered by the local headless Claude Code CLI.

流程 / Pipeline:
  Stage 1 (analyze, cheap model, batched):
      对【全部】论文打"相关性分 0-10" + topic + reason,并生成完整五段总结
      (tldr/motivation/method/result/conclusion)。所以每篇都有丰富内容。
  Stage 2 (deep, strong model, per paper):
      对 relevance_score >= RELEVANCE_THRESHOLD 且当天 Top-DEEP_TOP_K 的论文,
      用强模型(Opus)重新生成五段,覆盖 Stage 1 的版本 → 顶部相关论文为最佳质量。
  全部用分隔标记(@@MARK@@)而非 JSON 解析,长段中文含引号/反斜杠/LaTeX 也不会出错。

输出 / Output: <data>_AI_enhanced_<LANGUAGE>.jsonl,按 relevance_score 降序排列,
与前端 (js/app.js) 和 to_md/convert.py 兼容(保留 item['AI'] 的五个字段)。

不依赖任何第三方 LLM API key —— 总结引擎就是这台机器上已认证的 Claude Code。
"""
import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed

# --------------------------------------------------------------------------- #
# 配置 (全部可用环境变量覆盖) / Config (override via env)
# --------------------------------------------------------------------------- #
HERE = os.path.dirname(os.path.abspath(__file__))

CLAUDE_BIN          = os.environ.get("CLAUDE_BIN") or shutil.which("claude") \
                      or "/home/user/.nvm/versions/node/v24.13.0/bin/claude"
PREFILTER_MODEL     = os.environ.get("PREFILTER_MODEL", "haiku")
DEEP_MODEL          = os.environ.get("DEEP_MODEL", "opus")
RELEVANCE_THRESHOLD = int(os.environ.get("RELEVANCE_THRESHOLD", "6"))
DEEP_TOP_K          = int(os.environ.get("DEEP_TOP_K", "60"))
PREFILTER_BATCH     = int(os.environ.get("PREFILTER_BATCH", "12"))
PREFILTER_WORKERS   = int(os.environ.get("PREFILTER_WORKERS", "4"))
DEEP_WORKERS        = int(os.environ.get("DEEP_WORKERS", "3"))
CALL_TIMEOUT        = int(os.environ.get("CLAUDE_CALL_TIMEOUT", "240"))
CALL_RETRIES        = int(os.environ.get("CLAUDE_CALL_RETRIES", "2"))
LANGUAGE            = os.environ.get("LANGUAGE", "Chinese")
RESEARCH_FOCUS_FILE = os.environ.get("RESEARCH_FOCUS_FILE", os.path.join(HERE, "research_focus.txt"))

# 累计成本统计(若走订阅,这是名义值,仍可用于观察额度消耗)
_cost_lock = threading.Lock()
_total_cost = 0.0
_call_count = 0


def log(msg):
    print(msg, file=sys.stderr, flush=True)


def load_research_focus() -> str:
    try:
        with open(RESEARCH_FOCUS_FILE, "r", encoding="utf-8") as f:
            # 去掉以 # 开头的注释行,保留正文
            lines = [ln for ln in f.read().splitlines() if not ln.lstrip().startswith("#")]
        focus = "\n".join(lines).strip()
        if not focus:
            raise ValueError("research_focus 为空")
        return focus
    except Exception as e:
        log(f"❌ 无法读取研究关注点文件 {RESEARCH_FOCUS_FILE}: {e}")
        sys.exit(2)


def _strip_fence(text: str) -> str:
    """去掉 ```json ... ``` 围栏。"""
    t = text.strip()
    t = re.sub(r"^```[a-zA-Z]*\s*", "", t)
    t = re.sub(r"\s*```$", "", t)
    return t.strip()


def _run_once(prompt: str, model: str) -> str:
    """跑一次 headless claude,返回模型输出的原始文本(Claude Code 的 JSON 信封很可靠,
    我们只信任它取出内层 result)。失败抛异常。"""
    global _total_cost, _call_count
    args = [
        CLAUDE_BIN, "-p", prompt,
        "--output-format", "json",
        "--model", model,
        "--setting-sources", "",            # 不加载任何 settings(砍掉插件/skill 开销)
        "--strict-mcp-config", "--mcp-config", '{"mcpServers":{}}',  # 不加载任何 MCP
    ]
    p = subprocess.run(
        args, capture_output=True, text=True,
        stdin=subprocess.DEVNULL, cwd=HERE, timeout=CALL_TIMEOUT,
    )
    if p.returncode != 0:
        raise RuntimeError(f"rc={p.returncode} stderr={p.stderr[-200:]}")
    outer = json.loads(p.stdout)
    if outer.get("is_error"):
        raise RuntimeError(f"is_error subtype={outer.get('subtype')}")
    with _cost_lock:
        _total_cost += float(outer.get("total_cost_usd") or 0.0)
        _call_count += 1
    return outer.get("result", "")


def claude_json(prompt: str, model: str):
    """返回解析后的 JSON 对象/数组(短结构化字段用);失败返回 None。解析失败会重试。"""
    last_err = ""
    for _ in range(CALL_RETRIES + 1):
        try:
            return json.loads(_strip_fence(_run_once(prompt, model)))
        except Exception as e:  # noqa
            last_err = f"{type(e).__name__}: {e}"
    log(f"  ⚠️ claude(JSON) 调用失败({model}, {CALL_RETRIES + 1} 次): {last_err}")
    return None


def claude_text(prompt: str, model: str):
    """返回模型原始文本(长文本用,避免 JSON 转义问题);失败返回 None。"""
    last_err = ""
    for _ in range(CALL_RETRIES + 1):
        try:
            return _run_once(prompt, model)
        except Exception as e:  # noqa
            last_err = f"{type(e).__name__}: {e}"
    log(f"  ⚠️ claude(text) 调用失败({model}, {CALL_RETRIES + 1} 次): {last_err}")
    return None


# --------------------------------------------------------------------------- #
# 通用:分隔标记解析(代替 JSON,长文本鲁棒)
# --------------------------------------------------------------------------- #
def _parse_markers(text: str, markers):
    """markers: [(key, '@@MARK@@'), ...] → {key: 该标记后到下一个标记前的文本}。"""
    found = []
    for key, m in markers:
        idx = text.find(m)
        if idx >= 0:
            found.append((idx, key, m))
    found.sort()
    out = {}
    for j, (idx, key, m) in enumerate(found):
        start = idx + len(m)
        end = found[j + 1][0] if j + 1 < len(found) else len(text)
        out[key] = text[start:end].strip()
    return out


def _to_score(val) -> int:
    m = re.search(r"-?\d+", str(val or ""))
    if not m:
        return 0
    return max(0, min(10, int(m.group())))


# --------------------------------------------------------------------------- #
# Stage 1 — 全量分析:相关分 + 主题 + 完整五段总结 (批量, 便宜模型)
# --------------------------------------------------------------------------- #
_ANALYZE_FIELDS = [
    ("score", "@@SCORE@@"), ("topic", "@@TOPIC@@"), ("reason", "@@REASON@@"),
    ("tldr", "@@TLDR@@"), ("motivation", "@@MOTIVATION@@"),
    ("method", "@@METHOD@@"), ("result", "@@RESULT@@"), ("conclusion", "@@CONCLUSION@@"),
]


def analyze_batch(focus: str, batch):
    plist = "\n\n".join(
        f'[{i}] title: {p.get("title", "")}\nabstract: {p.get("summary", "")}'
        for i, p in enumerate(batch)
    )
    prompt = f"""你是一个学术论文分析助手。下面是我的研究关注点:

<research_focus>
{focus}
</research_focus>

请对列表里的【每一篇】论文,依据 research_focus 给出:0-10 的相关性整数分(打分指引见 research_focus 末尾)、
一个简短主题标签、一句话打分理由,以及完整的{LANGUAGE}五段总结(速览/动机/方法/结果/结论)。

严格按下面格式输出,每篇论文一个区块,@@标记@@ 各自独占一行、其后紧跟正文(纯文字,可多句,
不要 markdown 列表/代码块/表格)。除这些区块外不要输出任何其它内容。`[i]` 里的序号 i 要原样填到 @@ITEM i@@。

@@ITEM 0@@
@@SCORE@@
（0到10的整数）
@@TOPIC@@
（简短主题标签）
@@REASON@@
（一句话打分理由）
@@TLDR@@
（一句话速览）
@@MOTIVATION@@
（研究动机 / 要解决的问题）
@@METHOD@@
（核心方法）
@@RESULT@@
（主要结果）
@@CONCLUSION@@
（结论与意义）

（下一篇用 @@ITEM 1@@ 继续,以此类推）

论文列表(共 {len(batch)} 篇):
{plist}"""
    raw = claude_text(prompt, PREFILTER_MODEL)
    out = {}
    if not raw:
        return out
    parts = re.split(r"@@ITEM\s+(\d+)@@", raw)
    # parts: [preamble, idx0, body0, idx1, body1, ...]
    for k in range(1, len(parts), 2):
        try:
            i = int(parts[k])
        except ValueError:
            continue
        if i < 0 or i >= len(batch):
            continue
        body = parts[k + 1] if k + 1 < len(parts) else ""
        fields = _parse_markers(body, _ANALYZE_FIELDS)
        if fields:
            out[str(batch[i]["id"])] = fields
    return out


def run_analyze(focus: str, papers):
    batches = [papers[i:i + PREFILTER_BATCH] for i in range(0, len(papers), PREFILTER_BATCH)]
    log(f"Stage 1 全量分析+总结: {len(papers)} 篇 → {len(batches)} 批 (每批{PREFILTER_BATCH}, {PREFILTER_WORKERS}并发, 模型={PREFILTER_MODEL})")
    analyzed = {}
    done = 0
    with ThreadPoolExecutor(max_workers=PREFILTER_WORKERS) as ex:
        futs = {ex.submit(analyze_batch, focus, b): bi for bi, b in enumerate(batches)}
        for fut in as_completed(futs):
            try:
                analyzed.update(fut.result())
            except Exception as e:
                log(f"  分析批次异常: {e}")
            done += 1
            log(f"  分析进度 {done}/{len(batches)}")
    return analyzed


# --------------------------------------------------------------------------- #
# Stage 2 — 深度总结 (单篇, 强模型)
# --------------------------------------------------------------------------- #
DEEP_FALLBACK = {
    "tldr": "深度总结生成失败", "motivation": "", "method": "",
    "result": "", "conclusion": "",
}
# 用分隔标记代替 JSON:长段中文里含引号/反斜杠/LaTeX 也不会破坏解析
_SECTIONS = [
    ("tldr", "@@TLDR@@"), ("motivation", "@@MOTIVATION@@"),
    ("method", "@@METHOD@@"), ("result", "@@RESULT@@"), ("conclusion", "@@CONCLUSION@@"),
]


def _parse_sections(text: str):
    out = _parse_markers(text, _SECTIONS)
    if not out:  # 一个标记都没解析到 → 视为失败
        return None
    for key, _ in _SECTIONS:
        out.setdefault(key, "")
    return out


def deep_summarize(focus: str, paper):
    prompt = f"""你是一个严谨的学术论文摘要助手。我的研究关注点如下(仅供你把握重点,不要在输出里复述):

<research_focus>
{focus}
</research_focus>

请用{LANGUAGE}对下面这篇 arXiv 论文做结构化深度总结。严格按下面的格式输出:
每个 @@标记@@ 独占一行,其后紧跟该部分的正文(纯文字,可多句,不要用 markdown 列表/代码块/表格)。
除这五段外不要输出任何其它内容。

@@TLDR@@
一句话总结
@@MOTIVATION@@
研究动机 / 要解决的问题
@@METHOD@@
核心方法
@@RESULT@@
主要结果
@@CONCLUSION@@
结论与意义

标题: {paper.get("title", "")}
作者: {", ".join(paper.get("authors", [])) if isinstance(paper.get("authors"), list) else paper.get("authors", "")}
摘要: {paper.get("summary", "")}"""
    raw = claude_text(prompt, DEEP_MODEL)
    if not raw:
        return dict(DEEP_FALLBACK)
    parsed = _parse_sections(raw)
    return parsed if parsed else dict(DEEP_FALLBACK)


def run_deep(focus: str, selected):
    log(f"Stage 2 Opus 深度精修: {len(selected)} 篇 ({DEEP_WORKERS}并发, 模型={DEEP_MODEL})")
    results = {}
    done = 0
    with ThreadPoolExecutor(max_workers=DEEP_WORKERS) as ex:
        futs = {ex.submit(deep_summarize, focus, p): str(p["id"]) for p in selected}
        for fut in as_completed(futs):
            pid = futs[fut]
            try:
                results[pid] = fut.result()
            except Exception as e:
                log(f"  深度总结异常 {pid}: {e}")
                results[pid] = dict(DEEP_FALLBACK)
            done += 1
            log(f"  深度进度 {done}/{len(selected)}")
    return results


# --------------------------------------------------------------------------- #
def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--data", type=str, required=True, help="爬取得到的 jsonl 文件")
    args = parser.parse_args()

    focus = load_research_focus()

    # 读取并按 id 去重
    seen, papers = set(), []
    with open(args.data, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            item = json.loads(line)
            pid = str(item.get("id", ""))
            if pid and pid not in seen:
                seen.add(pid)
                papers.append(item)
    log(f"读入 {len(papers)} 篇待处理论文 (来自 {args.data})")
    if not papers:
        log("无论文,退出。")
        return

    # Stage 1:全量分析 + 完整五段总结
    analyzed = run_analyze(focus, papers)

    # 把分数 + 五段挂回每篇(此时每篇都已有完整 AI 内容)
    for p in papers:
        a = analyzed.get(str(p["id"]), {})
        p["relevance_score"] = _to_score(a.get("score"))
        p["topic"] = (a.get("topic") or "").strip() or "未分类"
        p["relevance_reason"] = (a.get("reason") or "").strip()
        ai = {k: (a.get(k) or "").strip() for k in ("tldr", "motivation", "method", "result", "conclusion")}
        if not any(ai.values()):           # 分析整篇失败的兜底
            ai["tldr"] = "(分析失败)"
        p["AI"] = ai
        p["deep"] = False

    ranked = sorted(papers, key=lambda x: x["relevance_score"], reverse=True)
    selected = [p for p in ranked if p["relevance_score"] >= RELEVANCE_THRESHOLD][:DEEP_TOP_K]
    log(f"达到阈值(≥{RELEVANCE_THRESHOLD})且 Top{DEEP_TOP_K} → Opus 深度精修: {len(selected)} 篇")

    # Stage 2:Top 相关论文用 Opus 重写五段,覆盖 Haiku 版
    deep = run_deep(focus, selected) if selected else {}
    for p in selected:
        d = deep.get(str(p["id"]))
        if d and d.get("tldr") != DEEP_FALLBACK["tldr"]:   # 成功才覆盖,失败保留 Haiku 版
            p["AI"] = d
            p["deep"] = True

    # 输出(按相关分降序)
    target = args.data.replace(".jsonl", f"_AI_enhanced_{LANGUAGE}.jsonl")
    if os.path.exists(target):
        os.remove(target)
    with open(target, "w", encoding="utf-8") as f:
        for p in ranked:
            f.write(json.dumps(p, ensure_ascii=False) + "\n")

    deep_n = sum(1 for p in ranked if p.get("deep"))
    log(f"✅ 完成: 写出 {len(ranked)} 篇 → {target}")
    log(f"   每篇都有完整五段总结;其中 {deep_n} 篇为 Opus 精修, 其余 {len(ranked) - deep_n} 篇为 {PREFILTER_MODEL} 版")
    log(f"   claude 调用 {_call_count} 次, 累计成本 ≈ ${_total_cost:.4f}")


if __name__ == "__main__":
    main()
