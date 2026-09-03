#!/usr/bin/env python3
"""
研究趋势子方向打标器 / Research trend sub-direction tagger

输入: 当天 AI 增强后的 *_AI_enhanced_<LANG>.jsonl(含 title/summary/categories)
输出: (1) 每篇论文新增 trend_tags: ["tag_id", ...](1~2 个),回写同文件;
      (2) 更新 assets/trend-taxonomy.json 的 sub 标签库(自举,详见下)。

自举机制 / Bootstrap:
- 标签库初始为人工种子(见 assets/trend-taxonomy.json sub)。
- 打标时 prompt 只给"当前活跃标签"(按近 30 天流行度取 topN)。
- 指令为"先查后建":优先归入已有标签(id),确实没有匹配的才新建规范名。
- 新建的标签进入库并带 last_seen/count,长期不活跃的降级(不再进 prompt),但保留在库中可复活。

用法:
  python trend_tagger.py --data ../data/2026-08-16_AI_enhanced_Chinese.jsonl
环境变量(可覆盖): TAXONOMY_FILE, ACTIVE_TOP_N, TAGGING_BATCH,
  TAGGING_WORKERS
"""
import argparse
import json
import os
import random
import re
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed

import llm

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
TAXONOMY_FILE = os.environ.get("TAXONOMY_FILE", os.path.join(ROOT, "assets", "trend-taxonomy.json"))
ACTIVE_TOP_N = int(os.environ.get("ACTIVE_TOP_N", "150"))
TAGGING_BATCH = int(os.environ.get("TAGGING_BATCH", "20"))
TAGGING_WORKERS = int(os.environ.get("TAGGING_WORKERS", "4"))


def log(msg):
    print(f"[trend_tagger] {msg}", file=sys.stderr, flush=True)


def load_taxonomy(path=TAXONOMY_FILE):
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
        return data
    except Exception as e:
        log(f"⚠️ 标签库读取失败({path}): {e},返回空库")
        return {"version": 1, "updated": time.strftime("%Y-%m-%d"), "primary": [], "sub": []}


def save_taxonomy(data, path=TAXONOMY_FILE):
    data["updated"] = time.strftime("%Y-%m-%d")
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    os.replace(tmp, path)
    log(f"✅ 标签库已更新: {path} ({len(data.get('sub', []))} 个子方向)")


def active_subset(taxonomy, top_n=ACTIVE_TOP_N):
    """按流行度(最近出现次数)取活跃子方向,供 prompt 使用。降级保留在库中,可复活。"""
    subs = taxonomy.get("sub", [])
    # 流行度:count 字段(有则按它);没有就按 id 排序兜底
    def pop(s):
        if isinstance(s.get("count"), (int, float)):
            return s.get("count", 0)
        return 0
    active = sorted(subs, key=lambda s: (-pop(s), s.get("id", "")))
    # 只保留有明确标签名的活跃项
    active = [s for s in active if s.get("label") and s.get("id")]
    return active[:top_n]


def _build_prompt(active_subs, papers_batch, focus=""):
    """active_subs: [{id,label}] ; 返回 prompt 字符串。"""
    catalog = "\n".join(f"- {s['id']} | {s['label']}" for s in active_subs)
    plist = "\n\n".join(
        f'[{i}] title: {p.get("title", "")}\ncategories: {", ".join(p.get("categories", []))}\nabstract: {p.get("summary", "")}'
        for i, p in enumerate(papers_batch)
    )
    focus_block = f"""
<research_focus>
{focus}
</research_focus>""" if focus else ""
    return f"""你是研究趋势打标助手。下面是可用的子方向标签目录(每个标签有 id 和规范名):

<tag_catalog>
{catalog}
</tag_catalog>
{focus_block}

请给【每一篇】论文标注 1~2 个最贴切的子方向标签。
要求(先查后建):
- 优先从 tag_catalog 里选择完全匹配的已有标签,输出其 id;
- 只有当 catalog 里【确实没有】合适标签时,才新建一个规范中文名(尽量简洁,8 字以内),
  格式: new|规范名;
- 不要用同一篇论文造新标签来绕开 catalog,目标是让同类论文尽量共用同一标签。

严格按下面格式输出,每篇一个区块,@@标记@@ 独占一行。除这些区块外不要输出任何其它内容。
`[i]` 序号原样填到 @@ITEM i@@。

@@ITEM 0@@
@@TAGS@@
tag_id1, tag_id2   （或 new|规范名）

（下一篇用 @@ITEM 1@@ 继续,以此类推）

论文列表(共 {len(papers_batch)} 篇):
{plist}"""


def parse_tags_block(text):
    """解析 @@TAGS@@ 下的内容,支持 'id, id2' 与 'new|规范名'。"""
    tags = []
    for line in text.splitlines():
        line = line.strip()
        if not line:
            continue
        if line.startswith("@@") or line.startswith("["):
            continue
        for part in line.split(","):
            part = part.strip()
            if not part:
                continue
            if part.startswith("new|"):
                tags.append(("new", part.split("|", 1)[1].strip()))
            else:
                tags.append(("existing", re.sub(r"[^A-Za-z0-9_-]", "", part)))
    return tags


def run_tagger(active_subs, papers_batch):
    prompt = _build_prompt(active_subs, papers_batch)
    raw = fallback_text(prompt)
    if not raw:
        return {}
    # 解析 @@ITEM i@@ 区块
    parts = re.split(r"@@ITEM\s+(\d+)@@", raw)
    out = {}
    for k in range(1, len(parts), 2):
        try:
            i = int(parts[k])
        except ValueError:
            continue
        if i < 0 or i >= len(papers_batch):
            continue
        body = parts[k + 1] if k + 1 < len(parts) else ""
        m = re.search(r"@@TAGS@@(.*?)(?=@@ITEM|@@SCORE|$)", body, re.S)
        block = m.group(1) if m else body
        tags = parse_tags_block(block)
        if tags:
            out[str(papers_batch[i]["id"])] = tags
    return out


def fallback_text(prompt):
    """统一走 ai/llm.py,provider 由 LLM_PROVIDER 决定(claude / codex)。
    原来这里写死了某台机器上的 claude 绝对路径,换台机器就跑不了。"""
    global _fb_calls
    _fb_calls += 1
    return llm.generate_or_none(prompt, tier="fast", timeout=240, cwd=HERE)



def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--data", type=str, required=True, help="AI 增强后的 jsonl 文件")
    args = parser.parse_args()

    data_file = os.path.abspath(args.data)
    if not os.path.exists(data_file):
        log(f"❌ 数据文件不存在: {data_file}")
        sys.exit(2)

    taxonomy = load_taxonomy()
    active = active_subset(taxonomy)

    # 读取论文
    papers = []
    with open(data_file, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                item = json.loads(line)
            except Exception:
                continue
            if item.get("id"):
                papers.append(item)
    log(f"读入 {len(papers)} 篇论文, 活跃子方向目录 {len(active)} 个")

    if not papers:
        log("无论文,跳过打标。")
        return

    # 并发打标
    batches = [papers[i:i + TAGGING_BATCH] for i in range(0, len(papers), TAGGING_BATCH)]
    results = {}
    done = 0
    with ThreadPoolExecutor(max_workers=TAGGING_WORKERS) as ex:
        futs = {ex.submit(run_tagger, active, b): bi for bi, b in enumerate(batches)}
        for fut in as_completed(futs):
            try:
                results.update(fut.result())
            except Exception as e:
                log(f"批次异常: {e}")
            done += 1
            log(f"打标进度 {done}/{len(batches)}")

    # 回写 trend_tags(统一走 _rewrite_trend_tags,自动处理新建标签注册)
    new_tags = {}
    _rewrite_trend_tags(papers, results, taxonomy, new_tags)

    # 写回数据文件
    with open(data_file, "w", encoding="utf-8") as f:
        for p in papers:
            f.write(json.dumps(p, ensure_ascii=False) + "\n")

    save_taxonomy(taxonomy)


def _new_tag_id(taxonomy):
    """生成一个库内唯一的 t###### 标签 id。"""
    used = {s.get("id") for s in taxonomy.get("sub", [])}
    for _ in range(1000):
        tid = "t" + ("%06d" % (int(time.time() * 1000) % 1000000 + random.randint(0, 999)))[-6:]
        if tid not in used:
            return tid
    raise RuntimeError("无法生成唯一标签 id")


def _rewrite_trend_tags(papers, results, taxonomy, new_tags):
    """统一回写 trend_tags:解析 results -> [id] (validated)，处理 new 注册，并更新标签流行度。"""
    today = time.strftime("%Y-%m-%d")
    applied = 0
    for p in papers:
        pid = str(p.get("id"))
        tags = results.get(pid, [])
        final_ids = []
        for kind, val in tags:
            if kind == "existing":
                # 只接受既有的合法 id
                if any(s.get("id") == val for s in taxonomy.get("sub", [])):
                    final_ids.append(val)
            elif kind == "new":
                label = val
                if not label:
                    continue
                # 同 label 已有(避免重复建)
                found = next((s for s in taxonomy.get("sub", []) if s.get("label") == label), None)
                if found:
                    final_ids.append(found["id"])
                else:
                    # 注意括号:[-6:] 必须切在格式化后的字符串上。
                    # 原写法 "%06d" % (... )[-6:] 先对 int 取切片,每次新建标签都抛
                    # TypeError,整个回写函数中断 —— 结果是没有任何论文拿到 trend_tags,
                    # 前端子方向趋势图长期为空。
                    tid = _new_tag_id(taxonomy)
                    taxonomy["sub"].append({
                        "id": tid, "label": label, "aliases": [], "count": 0,
                        "last_seen": today, "created": today
                    })
                    new_tags[label] = tid
                    final_ids.append(tid)
        if final_ids:
            p["trend_tags"] = final_ids
            applied += 1
    # 更新标签流行度:当天用到的标签 count+1,last_seen=今天
    used_ids = set()
    for p in papers:
        for tid in p.get("trend_tags", []):
            used_ids.add(tid)
    for s in taxonomy.get("sub", []):
        if s.get("id") in used_ids:
            s["count"] = (s.get("count") or 0) + 1
            s["last_seen"] = today
        else:
            # 降级逻辑:超过 N 天未出现则 count 衰减(仅用于活跃排序,不删库)
            if isinstance(s.get("last_seen"), str) and s.get("last_seen") < today:
                # 简单衰减:未出现的一天减 0.5(长期不活跃自然跌出活跃集)
                s["count"] = max(0, int((s.get("count") or 0) * 0.95))
    log(f"本次共打标 {applied} 篇")


if __name__ == "__main__":
    main()
