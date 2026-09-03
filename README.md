# daily-arXiv-ai-enhanced（自托管分支）

每天自动抓 arXiv 新论文，用**你自己已登录的编码助手 CLI**（Claude Code 或 Codex）
做中文总结、按你的研究方向打分排序，并提供一个单页阅读器：论文列表、一键审稿、
跨设备标记、研究趋势统计。

> 这是 [dw-dengwei/daily-arXiv-ai-enhanced](https://github.com/dw-dengwei/daily-arXiv-ai-enhanced)
> 的自托管改造分支。上游走 GitHub Actions + 第三方 LLM API key；本分支改成
> **本机 cron + 本机 CLI**，不需要任何 API key，数据和花费都在你自己这边。

> [!CAUTION]
> 若您所在法域对学术数据有审查要求，谨慎运行本代码；任何二次分发版本必须履行合规审查
> （包括但不限于原始论文合规性、AI 合规性）义务，否则一切法律后果由下游自行承担。

## 和上游的区别

| | 上游 | 本分支 |
|---|---|---|
| 运行 | GitHub Actions | 本机 cron |
| 模型 | DeepSeek / OpenAI API key | 你本机已登录的 **Claude Code 或 Codex** |
| 花费 | 按 token 付费 | 用你自己的订阅额度，无需 API key |
| 前端 | 多页 | 单页应用（hash 路由，切换不重载） |
| 排序 | 按类别 | 按你写的研究方向打 0-10 分排序 |
| 额外 | — | 一键审稿、跨设备标记、研究趋势图、明暗主题 |

## 功能

- **每日流水线**：爬取 → 近 7 天去重 → 全量打分与五段总结（fast 档）→ 高分论文用
  deep 档重写 → 子方向打标 → 生成 Markdown。
- **相关性排序**：`ai/research_focus.txt` 里写你的研究方向，它是打分的唯一依据。
  改完下次跑自动生效，不用动代码。
- **一键审稿**：两层。先用 fast 档从固定会议白名单里判定投稿会议，
  再按「快速 / 正常 / 深度」选模型，以该会议审稿人的身份出结构化意见
  （总评、优点、不足、详细意见、给作者的问题、评分、推荐、置信度）。
- **跨设备标记**：标过的论文在任何设备上都能看到，并直接显示审稿结论。
- **研究趋势**：主方向 / 子方向 / 关键词的每日趋势图，可切表格视图。
- **明暗主题**：跟随系统或手动切换。

## 快速开始

### 1. 准备 LLM CLI（二选一）

```bash
# Claude Code —— https://claude.com/claude-code
npm i -g @anthropic-ai/claude-code && claude      # 交互式登录一次

# 或 Codex CLI —— https://developers.openai.com/codex/cli
npm i -g @openai/codex && codex login
```

登录信息存在 `~/.claude` / `~/.codex`，本项目直接复用，**不需要任何 API key**。

### 2. 装依赖

```bash
git clone <你的 fork> && cd daily-arXiv-ai-enhanced
python3 -m venv .venv && source .venv/bin/activate
pip install -e .        # 或 uv sync
```

### 3. 配置

```bash
cp .env.local.example .env.local
$EDITOR .env.local          # 至少改 CATEGORIES 和 LLM_PROVIDER
$EDITOR ai/research_focus.txt   # 写你的研究方向，这是打分的唯一依据
```

自检一下 LLM 通不通：

```bash
python3 ai/llm.py "reply with exactly: OK"
```

### 4. 跑一次

```bash
./run-local.sh              # 爬取 → 总结 → 打标 → 出 Markdown
```

产物在 `data/<日期>_AI_enhanced_<语言>.jsonl`。

### 5. 看页面

任何静态服务器都能起：

```bash
python3 -m http.server 8000     # 然后打开 http://localhost:8000
```

「已标记」和「一键审稿」需要后端（见下）；不起后端的话其余功能照常可用。

### 6. 后端 + 定时任务（可选）

```bash
# 后端 API（标记 + 审稿），systemd 用户级
ln -sf "$PWD/deploy/api/arxiv-api.service" ~/.config/systemd/user/
systemctl --user daemon-reload && systemctl --user enable --now arxiv-api

# 每天 09:00 跑流水线
crontab -e
# 0 9 * * * /abs/path/to/repo/scripts/cron-wrapper.sh >> /abs/path/to/repo/logs/cron.log 2>&1
```

生产部署（nginx / docker / HTTPS / basic auth）见 **[SELF-HOSTED.md](./SELF-HOSTED.md)**。

## 数据放哪

| 路径 | 内容 | 进 git？ |
|---|---|---|
| `data/` | 每日 jsonl 与 Markdown | 否 |
| `var/store.sqlite3` | 你的标记 + 审稿结果 | **否** |
| `.env.local` | 你的配置 | **否** |
| `ai/research_focus.txt` | 你的研究方向 | 是（自己改） |

标记和审稿结果按用户分行存（`user` 取自反向代理转发的 `X-Auth-User`），
**每个人跑自己的实例、存自己的数据**，仓库里不含任何人的私人数据。

## 目录

```
ai/          llm.py（provider 抽象）、local_enhance.py（每日总结）、trend_tagger.py（子方向打标）
daily_arxiv/ scrapy 爬虫
js/ css/     单页前端（shell/router/store + 四个视图）
deploy/      api/（后端 + sqlite）、web.conf、docker-compose.yml
to_md/       jsonl → Markdown
```

# Plans
See https://github.com/users/dw-dengwei/projects/3

# Contributors
Thanks to the following special contributors for contributing code, discovering bugs, and sharing useful ideas for this project!!!
<table>
  <tbody>
    <tr>
      <td align="center" valign="top">
        <a href="https://github.com/JianGuanTHU"><img src="https://avatars.githubusercontent.com/u/44895708?v=4" width="100px;" alt="JianGuanTHU"/><br /><sub><b>JianGuanTHU</b></sub></a><br />
      </td>
      <td align="center" valign="top">
        <a href="https://github.com/Chi-hong22"><img src="https://avatars.githubusercontent.com/u/75403952?v=4" width="100px;" alt="Chi-hong22"/><br /><sub><b>Chi-hong22</b></sub></a><br />
      </td>
      <td align="center" valign="top">
        <a href="https://github.com/chaozg"><img src="https://avatars.githubusercontent.com/u/69794131?v=4" width="100px;" alt="chaozg"/><br /><sub><b>chaozg</b></sub></a><br />
      </td>
      <td align="center" valign="top">
        <a href="https://github.com/quantum-ctrl"><img src="https://avatars.githubusercontent.com/u/16505311?v=4" width="100px;" alt="quantum-ctrl"/><br /><sub><b>quantum-ctrl</b></sub></a><br />
      </td>
      <td align="center" valign="top">
        <a href="https://github.com/Zhao2z"><img src="https://avatars.githubusercontent.com/u/141019403?v=4" width="100px;" alt="Zhao2z"/><br /><sub><b>Zhao2z</b></sub></a><br />
      </td>
      <td align="center" valign="top">
        <a href="https://github.com/eclipse0922"><img src="https://avatars.githubusercontent.com/u/6214316?v=4" width="100px;" alt="eclipse0922"/><br /><sub><b>eclipse0922</b></sub></a><br />
      </td>
    </tr>


  </tbody>
  <tbody>
   <tr>
      <td align="center" valign="top">
        <a href="https://github.com/xuemian168"><img src="https://avatars.githubusercontent.com/u/38741078?v=4" width="100px;" alt="xuemian168"/><br /><sub><b>xuemian168</b></sub></a><br />
      </td>
      <td align="center" valign="top">
        <a href="https://github.com/Lrrrr549"><img src="https://avatars.githubusercontent.com/u/71866027?v=4" width="100px;" alt="Lrrrr549"/><br /><sub><b>Lrrrr549</b></sub></a><br />
      </td>
      <td align="center" valign="top">
        <a href="https://github.com/AinzRimuru"><img src="https://avatars.githubusercontent.com/u/59441476?v=4" width="100px;" alt="AinzRimuru"/><br /><sub><b>AinzRimuru</b></sub></a><br />
      </td>
      <td align="center" valign="top">
        <a href="https://github.com/fengxueguiren"><img src="https://avatars.githubusercontent.com/u/153522370?v=4" width="100px;" alt="fengxueguiren"/><br /><sub><b>fengxueguiren</b></sub></a><br />
      </td>
      <td align="center" valign="top">
        <a href="https://github.com/zerocpp"><img src="https://avatars.githubusercontent.com/u/2630297?v=4" width="100px;" alt="fengxueguiren"/><br /><sub><b>zerocpp</b></sub></a><br />
      </td>
   </tr>
  </tbody>
</table>

# Acknowledgement
We sincerely thank the following individuals and organizations for their promotion and support!!!
<table>
  <tbody>
    <tr>
      <td align="center" valign="top">
        <a href="https://x.com/GitHub_Daily/status/1930610556731318781"><img src="https://pbs.twimg.com/profile_images/1660876795347111937/EIo6fIr4_400x400.jpg" width="100px;" alt="Github_Daily"/><br /><sub><b>Github_Daily</b></sub></a><br />
      </td>
      <td align="center" valign="top">
        <a href="https://x.com/aigclink/status/1930897858963853746"><img src="https://pbs.twimg.com/profile_images/1729450995850027008/gllXr6bh_400x400.jpg" width="100px;" alt="AIGCLINK"/><br /><sub><b>AIGCLINK</b></sub></a><br />
      </td>
      <td align="center" valign="top">
        <a href="https://www.ruanyifeng.com/blog/2025/06/weekly-issue-353.html"><img src="https://avatars.githubusercontent.com/u/905434" width="100px;" alt="阮一峰的网络日志"/><br /><sub><b>阮一峰的网络日志 <br> 科技爱好者周刊 <br> （第 353 期）</b></sub></a><br />
      </td>
      <td align="center" valign="top">
        <a href="https://hellogithub.com/periodical/volume/111"><img src="https://github.com/user-attachments/assets/eff6b6dd-0323-40c4-9db6-444a51bbc80a" width="100px;" alt="《HelloGitHub》第 111 期"/><br /><sub><b>《HelloGitHub》<br> 月刊第 111 期</b></sub></a><br />
      </td>
    </tr>
  </tbody>
</table>


# Star history

[![Stargazers over time](https://starchart.cc/dw-dengwei/daily-arXiv-ai-enhanced.svg?variant=adaptive)](https://starchart.cc/dw-dengwei/daily-arXiv-ai-enhanced)

# Buy me a coffee
[here](./buy-me-a-coffee/README.md)
