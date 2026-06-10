#!/bin/bash
# cron 入口:补全非交互环境(PATH/HOME/venv),再调用每日流水线。
# crontab 里只需指向本脚本即可。
set -uo pipefail

export HOME=/home/user
# cron 的 PATH 很精简,显式补上 node(claude)、uv、常用路径
export PATH="/home/user/.nvm/versions/node/v24.13.0/bin:/home/user/.local/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
# 禁用 claude 自动更新,避免长时间运行中途换掉二进制
export DISABLE_AUTOUPDATER=1
export CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1

ROOT="<仓库路径>"
cd "$ROOT" || exit 1

mkdir -p logs
# 激活 Python 虚拟环境(scrapy / arxiv / 等依赖)
# shellcheck disable=SC1091
source "$ROOT/.venv/bin/activate"

exec ./run-local.sh
