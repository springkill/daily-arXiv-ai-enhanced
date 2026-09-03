#!/bin/bash
# cron 入口:补全非交互环境(PATH/HOME/venv),再调用每日流水线。
# crontab 里指向本脚本即可,例如每天 09:00:
#   0 9 * * * /path/to/repo/scripts/cron-wrapper.sh >> /path/to/repo/logs/cron.log 2>&1
set -uo pipefail

# 仓库根目录:按本脚本自身位置推导,不写死路径,换台机器/换用户都不用改。
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT" || exit 1

# cron 不给 HOME,而 Claude Code / Codex 的登录凭据都在 $HOME 下(~/.claude、~/.codex)。
# 缺了它整条流水线在第一步认证预检就会失败。
export HOME="${HOME:-$(getent passwd "$(id -u)" | cut -d: -f6)}"

# cron 的 PATH 很精简,node 装在 nvm 里时一定不在里面。
# 优先用 .env.local 里显式配置的 CLAUDE_BIN/CODEX_BIN;这里再兜一层常见位置。
NODE_BIN="$(dirname "$(command -v node 2>/dev/null || echo /usr/bin/node)")"
for d in "$HOME"/.nvm/versions/node/*/bin; do
    [ -d "$d" ] && NODE_BIN="$d"          # 取最后一个(通常是最新版)
done
export PATH="$NODE_BIN:$HOME/.local/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"

# 禁用 CLI 自动更新:长时间批量运行中途换掉二进制会导致 FileNotFoundError
export DISABLE_AUTOUPDATER=1
export CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1

mkdir -p logs

# 激活 Python 虚拟环境(scrapy / arxiv 等依赖)
if [ -f "$ROOT/.venv/bin/activate" ]; then
    # shellcheck disable=SC1091
    source "$ROOT/.venv/bin/activate"
else
    echo "⚠️ 找不到 $ROOT/.venv —— 先建虚拟环境并装依赖(见 README)" >&2
fi

exec ./run-local.sh
