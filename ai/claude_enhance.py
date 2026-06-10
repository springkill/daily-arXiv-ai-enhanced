#!/usr/bin/env python3
"""
两段式 AI 增强:用本机 headless Claude Code 对每篇论文逐个总结并按研究关注点排序。
Two-stage AI enhancement powered by the local headless Claude Code CLI.

流程 / Pipeline:
  Stage 1 (prefilter, cheap model, batched):
      对全部论文逐篇打"相关性分 0-10" + topic + 一句话 reason/tldr。
  Stage 2 (deep, strong model, per paper):
      只对 relevance_score >= RELEVANCE_THRESHOLD 且当天 Top-DEEP_TOP_K 的论文,
      生成 tldr/motivation/method/result/conclusion 五段深度总结。
  其余论文保留 Stage 1 的分数 + 一句话 tldr(AI 其它字段留空)。

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


def claude_json(prompt: str, model: str):
    """调用 headless claude,返回解析后的 JSON 对象/数组;失败返回 None。"""
    global _total_cost, _call_count
    args = [
        CLAUDE_BIN, "-p", prompt,
        "--output-format", "json",
        "--model", model,
        "--setting-sources", "",            # 不加载任何 settings(砍掉插件/skill 开销)
        "--strict-mcp-config", "--mcp-config", '{"mcpServers":{}}',  # 不加载任何 MCP
    ]
    last_err = ""
    for attempt in range(CALL_RETRIES + 1):
        try:
            p = subprocess.run(
                args, capture_output=True, text=True,
                stdin=subprocess.DEVNULL, cwd=HERE, timeout=CALL_TIMEOUT,
            )
            if p.returncode != 0:
                last_err = f"rc={p.returncode} stderr={p.stderr[-200:]}"
                continue
            outer = json.loads(p.stdout)
            if outer.get("is_error"):
                last_err = f"is_error subtype={outer.get('subtype')}"
                continue
            with _cost_lock:
                _total_cost += float(outer.get("total_cost_usd") or 0.0)
                _call_count += 1
            payload = _strip_fence(outer.get("result", ""))
            return json.loads(payload)
        except subprocess.TimeoutExpired:
            last_err = f"timeout>{CALL_TIMEOUT}s"
        except json.JSONDecodeError as e:
            last_err = f"json decode: {e}"
        except Exception as e:  # noqa
            last_err = f"{type(e).__name__}: {e}"
    log(f"  ⚠️ claude 调用失败({model}, {CALL_RETRIES + 1} 次): {last_err}")
    return None


# --------------------------------------------------------------------------- #
# Stage 1 — 相关性预筛打分 (批量, 便宜模型)
# --------------------------------------------------------------------------- #
def prefilter_batch(focus: str, batch):
    plist = "\n".join(
        f'[{i}] id={p["id"]} | title: {p.get("title", "")} | abstract: {p.get("summary", "")}'
        for i, p in enumerate(batch)
    )
    prompt = f"""你是一个学术论文相关性评估器。下面是我的研究关注点:

<research_focus>
{focus}
</research_focus>

请对每篇论文,依据 research_focus 给出 0-10 的相关性整数分(打分指引见 research_focus 末尾),
并给出一个简短的主题标签 topic、一句话的打分理由 reason、以及一句话的论文速览 tldr。
reason 和 tldr 用{LANGUAGE}书写。

只输出一个 JSON 数组(不要任何 markdown 围栏、不要多余文字),每篇论文一个对象,字段如下:
[{{"id": "论文id", "relevance_score": 整数0到10, "topic": "简短主题标签", "reason": "一句话理由", "tldr": "一句话速览"}}]

论文列表(共 {len(batch)} 篇):
{plist}"""
    res = claude_json(prompt, PREFILTER_MODEL)
    out = {}
    if isinstance(res, dict):
        # 容错:模型可能把数组包在某个 key 里
        for v in res.values():
            if isinstance(v, list):
                res = v
                break
    if isinstance(res, list):
        for obj in res:
            if isinstance(obj, dict) and obj.get("id"):
                out[str(obj["id"])] = obj
    return out


def run_prefilter(focus: str, papers):
    batches = [papers[i:i + PREFILTER_BATCH] for i in range(0, len(papers), PREFILTER_BATCH)]
    log(f"Stage 1 预筛: {len(papers)} 篇 → {len(batches)} 批 (每批{PREFILTER_BATCH}, {PREFILTER_WORKERS}并发, 模型={PREFILTER_MODEL})")
    scores = {}
    done = 0
    with ThreadPoolExecutor(max_workers=PREFILTER_WORKERS) as ex:
        futs = {ex.submit(prefilter_batch, focus, b): bi for bi, b in enumerate(batches)}
        for fut in as_completed(futs):
            try:
                scores.update(fut.result())
            except Exception as e:
                log(f"  预筛批次异常: {e}")
            done += 1
            log(f"  预筛进度 {done}/{len(batches)}")
    return scores


# --------------------------------------------------------------------------- #
# Stage 2 — 深度总结 (单篇, 强模型)
# --------------------------------------------------------------------------- #
DEEP_FALLBACK = {
    "tldr": "深度总结生成失败", "motivation": "", "method": "",
    "result": "", "conclusion": "",
}


def deep_summarize(focus: str, paper):
    prompt = f"""你是一个严谨的学术论文摘要助手。我的研究关注点如下(仅供你把握重点,不要在输出里复述):

<research_focus>
{focus}
</research_focus>

请用{LANGUAGE}对下面这篇 arXiv 论文做结构化深度总结。只输出一个 JSON 对象
(不要任何 markdown 围栏、不要多余文字),字段如下:
{{"tldr": "一句话总结", "motivation": "研究动机/要解决的问题", "method": "核心方法", "result": "主要结果", "conclusion": "结论与意义"}}

标题: {paper.get("title", "")}
作者: {", ".join(paper.get("authors", [])) if isinstance(paper.get("authors"), list) else paper.get("authors", "")}
摘要: {paper.get("summary", "")}"""
    res = claude_json(prompt, DEEP_MODEL)
    if not isinstance(res, dict):
        return dict(DEEP_FALLBACK)
    return {k: str(res.get(k, "")) for k in ("tldr", "motivation", "method", "result", "conclusion")}


def run_deep(focus: str, selected):
    log(f"Stage 2 深度总结: {len(selected)} 篇 ({DEEP_WORKERS}并发, 模型={DEEP_MODEL})")
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

    # Stage 1
    scores = run_prefilter(focus, papers)

    # 把分数挂回每篇;选出深度总结对象
    for p in papers:
        s = scores.get(str(p["id"]), {})
        p["relevance_score"] = int(s.get("relevance_score", 0) or 0)
        p["topic"] = str(s.get("topic", "") or "未分类")
        p["relevance_reason"] = str(s.get("reason", "") or "")
        p["_prefilter_tldr"] = str(s.get("tldr", "") or "")

    ranked = sorted(papers, key=lambda x: x["relevance_score"], reverse=True)
    selected = [p for p in ranked if p["relevance_score"] >= RELEVANCE_THRESHOLD][:DEEP_TOP_K]
    sel_ids = {str(p["id"]) for p in selected}
    log(f"达到阈值(≥{RELEVANCE_THRESHOLD})且 Top{DEEP_TOP_K} 进入深度总结: {len(selected)} 篇")

    # Stage 2
    deep = run_deep(focus, selected) if selected else {}

    # 组装 AI 字段
    for p in ranked:
        pid = str(p["id"])
        if pid in sel_ids and pid in deep:
            p["AI"] = deep[pid]
            p["deep"] = True
        else:
            p["AI"] = {
                "tldr": p.get("_prefilter_tldr") or "(未深度总结)",
                "motivation": "", "method": "", "result": "", "conclusion": "",
            }
            p["deep"] = False
        p.pop("_prefilter_tldr", None)

    # 输出(按相关分降序)
    target = args.data.replace(".jsonl", f"_AI_enhanced_{LANGUAGE}.jsonl")
    if os.path.exists(target):
        os.remove(target)
    with open(target, "w", encoding="utf-8") as f:
        for p in ranked:
            f.write(json.dumps(p, ensure_ascii=False) + "\n")

    deep_n = sum(1 for p in ranked if p.get("deep"))
    log(f"✅ 完成: 写出 {len(ranked)} 篇 → {target}")
    log(f"   深度总结 {deep_n} 篇, 其余 {len(ranked) - deep_n} 篇仅预筛")
    log(f"   claude 调用 {_call_count} 次, 累计成本 ≈ ${_total_cost:.4f}")


if __name__ == "__main__":
    main()
