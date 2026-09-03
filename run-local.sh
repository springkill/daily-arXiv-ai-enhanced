#!/bin/bash
# ===========================================================================
# 自托管每日流水线 / Self-hosted daily pipeline
#   crawl → dedup → Claude 两段式总结+打分排序 → markdown → 更新文件列表
# 由 cron 调用(见 scripts/cron-wrapper.sh)。总结引擎是本机 headless Claude,
# 不调用任何第三方 LLM API。
# ===========================================================================
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

# 载入本地配置 / Load local config (gitignored)
if [ -f "$ROOT/.env.local" ]; then
    set -a
    # shellcheck disable=SC1091
    source "$ROOT/.env.local"
    set +a
fi

: "${CATEGORIES:?需要在 .env.local 设置 CATEGORIES}"
export LANGUAGE="${LANGUAGE:-Chinese}"

# 用本地日期,与 check_stats.py 的 datetime.now() 保持一致(避免跨 UTC 日界错位)
today=$(date "+%Y-%m-%d")
log() { echo "[$(date "+%F %T")] $*"; }

log "===== 每日流水线开始 ($today) ====="
log "类别: $CATEGORIES"
log "语言: $LANGUAGE | 深度模型: ${DEEP_MODEL:-opus} | 预筛模型: ${PREFILTER_MODEL:-haiku}"

# ---- 0. Claude 认证预检 / Auth preflight -------------------------------------
log "步骤0: Claude 认证预检..."
CLAUDE_BIN="${CLAUDE_BIN:-$(command -v claude)}"
if [ -z "$CLAUDE_BIN" ]; then
    log "❌ 找不到 claude 可执行文件"; exit 3
fi
if ! echo '{}' | "$CLAUDE_BIN" -p "reply with the single word: ok" \
        --model "${PREFILTER_MODEL:-haiku}" --setting-sources "" \
        --strict-mcp-config --mcp-config '{"mcpServers":{}}' \
        </dev/null >/tmp/arxiv_auth_check.txt 2>&1; then
    log "❌ Claude 预检失败,可能 token 过期。请在交互式 claude 里重新登录后再跑。"
    cat /tmp/arxiv_auth_check.txt
    exit 3
fi
log "✅ Claude 可用"

# ---- 1. 爬取 / Crawl --------------------------------------------------------
log "步骤1: 爬取 arXiv..."
[ -f "data/${today}.jsonl" ] && rm -f "data/${today}.jsonl"
( cd daily_arxiv && scrapy crawl arxiv -o "../data/${today}.jsonl" --loglevel=INFO )
if [ ! -f "data/${today}.jsonl" ]; then
    log "❌ 爬取失败,无数据文件"; exit 1
fi
log "爬取完成: $(wc -l < "data/${today}.jsonl") 篇(去重前)"

# ---- 2. 去重 / Dedup (近7天) ------------------------------------------------
log "步骤2: 历史去重..."
( cd daily_arxiv && python daily_arxiv/check_stats.py )
case $? in
  0) log "去重完成,有新内容";;
  1) log "⏹️ 去重后无新内容,结束"; exit 0;;
  *) log "❌ 去重出错"; exit 2;;
esac

# ---- 3. Claude 两段式总结 + 打分排序 ----------------------------------------
log "步骤3: Claude 总结与相关性排序..."
( cd ai && python local_enhance.py --data "../data/${today}.jsonl" )
if [ $? -ne 0 ]; then log "❌ AI 增强失败"; exit 1; fi
AI_FILE="data/${today}_AI_enhanced_${LANGUAGE}.jsonl"
if [ ! -f "$AI_FILE" ]; then log "❌ 未生成增强文件 $AI_FILE"; exit 1; fi

# ---- 3.5 研究趋势子方向打标 ------------------------------------------------
log "步骤3.5: 趋势子方向打标..."
python ai/trend_tagger.py --data "$AI_FILE" \
  || log "⚠️ 趋势打标失败(不阻断当天日常,可稍后重跑)"

# ---- 4. 转 Markdown ---------------------------------------------------------
log "步骤4: 转 Markdown..."
( cd to_md && python convert.py --data "../$AI_FILE" ) || log "⚠️ markdown 转换失败(不致命)"

# ---- 5. 更新文件列表(前端据此发现可用日期)--------------------------------
log "步骤5: 更新文件列表..."
ls data/*_AI_enhanced_*.jsonl 2>/dev/null | sed 's|data/||' > assets/file-list.txt
log "文件列表: $(wc -l < assets/file-list.txt) 个增强文件"

log "===== 每日流水线完成 ($today) ====="
