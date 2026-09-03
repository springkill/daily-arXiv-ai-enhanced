#!/usr/bin/env python3
"""
LLM 提供方抽象层 —— 让本项目既能用 Claude Code,也能用 Codex,或你自己接的别的。

设计前提:本项目**不要任何第三方 API key**。它调用的是你本机上已经登录好的
编码助手 CLI(Claude Code / Codex),用的是你自己的订阅额度。
所以每个人跑这个项目,配的都是自己的账号,数据和花费都在自己这边。

用法:
    import llm
    text = llm.generate("你好", tier="fast", timeout=120)

三档 tier(具体模型由环境变量决定,见下):
    fast  —— 便宜快的,用于批量预筛、打标、选会议
    mid   —— 中档,常规审稿
    deep  —— 最强的,深度总结与深度审稿

环境变量:
    LLM_PROVIDER            claude | codex   (不设则按 PATH 里有谁自动挑,claude 优先)
    LLM_TIMEOUT             单次调用超时秒数,默认 240
    LLM_RETRIES             失败重试次数,默认 2
    LLM_RETRY_BACKOFF       重试退避基数(秒),默认 8

    # Claude Code
    CLAUDE_BIN              claude 可执行文件路径(不设则用 PATH)
    CLAUDE_MODEL_FAST       默认 haiku
    CLAUDE_MODEL_MID        默认 sonnet
    CLAUDE_MODEL_DEEP       默认 opus

    # Codex
    CODEX_BIN               codex 可执行文件路径(不设则用 PATH)
    CODEX_MODEL_FAST        不设则不传 -m,用你 ~/.codex/config.toml 里的默认模型
    CODEX_MODEL_MID         同上
    CODEX_MODEL_DEEP        同上
"""
import json
import os
import shutil
import subprocess
import sys
import tempfile
import threading
import time

TIERS = ("fast", "mid", "deep")

DEFAULT_TIMEOUT = int(os.environ.get("LLM_TIMEOUT", "240"))
RETRIES = int(os.environ.get("LLM_RETRIES", "2"))
BACKOFF = int(os.environ.get("LLM_RETRY_BACKOFF", "8"))

_stats_lock = threading.Lock()
_stats = {"calls": 0, "cost_usd": 0.0}


def log(msg):
    print(f"[llm] {msg}", file=sys.stderr, flush=True)


def _which(env_name, exe):
    return os.environ.get(env_name) or shutil.which(exe)


def provider():
    """当前使用的提供方。显式设置优先,否则按 PATH 里有谁来挑。"""
    p = (os.environ.get("LLM_PROVIDER") or "").strip().lower()
    if p in ("claude", "codex"):
        return p
    if _which("CLAUDE_BIN", "claude"):
        return "claude"
    if _which("CODEX_BIN", "codex"):
        return "codex"
    raise RuntimeError(
        "找不到可用的 LLM CLI。请先安装并登录 Claude Code 或 Codex,"
        "或用 LLM_PROVIDER / CLAUDE_BIN / CODEX_BIN 指定。"
    )


def model_for(tier, prov=None):
    prov = prov or provider()
    tier = tier if tier in TIERS else "mid"
    if prov == "claude":
        return {
            "fast": os.environ.get("CLAUDE_MODEL_FAST", "haiku"),
            "mid":  os.environ.get("CLAUDE_MODEL_MID", "sonnet"),
            "deep": os.environ.get("CLAUDE_MODEL_DEEP", "opus"),
        }[tier]
    # Codex:不设就不传 -m,沿用用户 ~/.codex/config.toml 里的默认模型。
    # 硬编码一个模型名反而容易过期。
    return os.environ.get({"fast": "CODEX_MODEL_FAST",
                           "mid":  "CODEX_MODEL_MID",
                           "deep": "CODEX_MODEL_DEEP"}[tier]) or None


# --------------------------------------------------------------------------- #
# Claude Code
# --------------------------------------------------------------------------- #

def _run_claude(prompt, model, timeout, cwd):
    args = [
        _which("CLAUDE_BIN", "claude"), "-p", prompt,
        "--output-format", "json",
        "--model", model,
        "--setting-sources", "",                                     # 不加载 settings,砍掉插件/skill 开销
        "--strict-mcp-config", "--mcp-config", '{"mcpServers":{}}',  # 不加载任何 MCP
    ]
    env = {
        **os.environ,
        # 关键:禁用自动更新。长批量运行中途换掉二进制会导致 FileNotFoundError
        "DISABLE_AUTOUPDATER": "1",
        "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC": "1",
    }
    p = subprocess.run(args, capture_output=True, text=True, env=env,
                       stdin=subprocess.DEVNULL, cwd=cwd, timeout=timeout)
    if p.returncode != 0:
        raise RuntimeError(f"claude rc={p.returncode}: {p.stderr[-300:]}")
    outer = json.loads(p.stdout)
    if outer.get("is_error"):
        raise RuntimeError(f"claude is_error: {outer.get('subtype')}")
    with _stats_lock:
        _stats["calls"] += 1
        _stats["cost_usd"] += float(outer.get("total_cost_usd") or 0.0)
    return outer.get("result", "")


# --------------------------------------------------------------------------- #
# Codex
# --------------------------------------------------------------------------- #

def _run_codex(prompt, model, timeout, cwd):
    # codex exec 把过程日志打到 stdout,最终回答要用 -o 写到文件里取,
    # 否则还得从一堆事件里扒。
    fd, out_path = tempfile.mkstemp(prefix="codex-out-", suffix=".txt")
    os.close(fd)
    try:
        args = [
            _which("CODEX_BIN", "codex"), "exec",
            "--skip-git-repo-check",   # 允许在非 git 目录跑
            "--sandbox", "read-only",  # 我们只要文本生成,不需要它动文件
            "--color", "never",
            "-o", out_path,
        ]
        if model:
            args += ["-m", model]
        args.append(prompt)

        p = subprocess.run(args, capture_output=True, text=True,
                           env={**os.environ}, stdin=subprocess.DEVNULL,
                           cwd=cwd, timeout=timeout)
        text = ""
        try:
            with open(out_path, "r", encoding="utf-8") as f:
                text = f.read().strip()
        except OSError:
            pass
        if p.returncode != 0 and not text:
            tail = (p.stderr or p.stdout or "")[-300:]
            raise RuntimeError(f"codex rc={p.returncode}: {tail}")
        if not text:
            raise RuntimeError("codex 没有产出最终回答(--output-last-message 为空)")
        with _stats_lock:
            _stats["calls"] += 1     # codex 不回报成本,只计次数
        return text
    finally:
        try:
            os.unlink(out_path)
        except OSError:
            pass


# --------------------------------------------------------------------------- #
# 对外接口
# --------------------------------------------------------------------------- #

def generate(prompt, tier="mid", timeout=None, cwd=None, retries=None):
    """跑一次生成,返回纯文本。失败会重试,重试完仍失败则抛异常。"""
    prov = provider()
    model = model_for(tier, prov)
    timeout = timeout or DEFAULT_TIMEOUT
    retries = RETRIES if retries is None else retries
    cwd = cwd or os.path.dirname(os.path.abspath(__file__))

    last = ""
    for attempt in range(retries + 1):
        try:
            if prov == "claude":
                return _run_claude(prompt, model, timeout, cwd)
            return _run_codex(prompt, model, timeout, cwd)
        except subprocess.TimeoutExpired:
            raise                                  # 超时不重试,重试只会更慢
        except Exception as e:
            last = f"{type(e).__name__}: {e}"
            if attempt < retries:
                # 退避也是为了熬过 CLI 自动更新 / 短时限流的窗口
                time.sleep(BACKOFF * (attempt + 1))
    raise RuntimeError(f"{prov} 调用失败({retries + 1} 次): {last}")


def generate_or_none(prompt, tier="mid", timeout=None, cwd=None):
    try:
        return generate(prompt, tier, timeout, cwd)
    except Exception as e:
        log(f"⚠️ 调用失败: {e}")
        return None


def stats():
    with _stats_lock:
        return dict(_stats)


def describe():
    prov = provider()
    return f"{prov}(fast={model_for('fast', prov) or '默认'}, " \
           f"mid={model_for('mid', prov) or '默认'}, " \
           f"deep={model_for('deep', prov) or '默认'})"


if __name__ == "__main__":
    # 自检:python3 ai/llm.py "你好"
    print(f"provider: {describe()}", file=sys.stderr)
    q = sys.argv[1] if len(sys.argv) > 1 else "reply with exactly: OK"
    print(generate(q, tier="fast", timeout=120))
