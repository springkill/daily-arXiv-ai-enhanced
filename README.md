<div align="center">

# Daily arXiv AI Enhanced · 自托管版

**每天自动追 arXiv，用你自己的 Claude Code / Codex 做总结、打分、审稿。不需要任何 API key。**

**Track arXiv daily. Summarize, rank and review papers with *your own*
Claude Code / Codex CLI — no third-party API key required.**

[中文](#中文) · [English](#english) · [详细文档 / Full Guide](./docs/GUIDE.md)

</div>

---

<div align="center">
<img src="images/ui-papers-dark.png" width="88%" alt="论文列表 / Paper list">
</div>

---

<a id="中文"></a>

# 中文

## 这是什么

上游 [dw-dengwei/daily-arXiv-ai-enhanced](https://github.com/dw-dengwei/daily-arXiv-ai-enhanced)
用 GitHub Actions + 第三方 LLM API key 跑。这个分支把它改成**本机 cron + 本机 CLI**：

调用的是你已经登录好的 **Claude Code** 或 **Codex**，走你自己的订阅额度，
不需要申请任何 API key，论文数据和审稿结果全部留在你自己机器上。

| | 上游 | 本分支 |
|---|---|---|
| 运行方式 | GitHub Actions | 本机 cron |
| 模型 | DeepSeek / OpenAI API key | 你本机已登录的 Claude Code 或 Codex |
| 花费 | 按 token 付费 | 用已有订阅额度，无需 API key |
| 前端 | 多页面 | 单页应用，切换不重载 |
| 排序 | 按类别 | 按你写的研究方向打 0–10 分排序 |
| 额外功能 | — | 一键审稿、跨设备标记、研究趋势图、明暗主题 |

## 功能

### 相关性排序，而不是按类别堆

在 `ai/research_focus.txt` 里写下你的研究方向，它是打分的**唯一依据**。
每天全部论文都会拿到 0–10 分和完整五段总结；分数达标且当天靠前的，
再用最强的模型重写一遍。改完这个文件，下次跑自动生效，不用碰代码。

### 一键审稿

<div align="center">
<img src="images/ui-review.png" width="88%" alt="一键审稿 / One-click review">
</div>

两层：先用快模型从固定会议白名单里判定这篇最可能投哪个会（NDSS / USENIX Security /
ICSE / NeurIPS …），再按 **快速 / 正常 / 深度** 选模型，以该会议审稿人的身份给出
总体评价、优点、不足、详细意见、给作者的问题、评分、推荐、置信度。

三档差别是实打实的：同一篇论文，快模型给「小修 8/10」，中档模型给「大修 4/10」
并具体质疑到「2.6 微秒/决策低于 OPA/Rego 的典型延迟，需说明测量口径」。

### 研究趋势

<div align="center">
<img src="images/ui-stats.png" width="88%" alt="研究趋势 / Trends">
</div>

主方向、子方向、关键词的每日趋势。十字准线一次读出当天所有系列的数值，
图例可点开关，随时切表格视图。子方向标签是自举的——模型先查已有标签，
确实没有匹配的才新建。

### 跨设备标记 × 审稿结论

<div align="center">
<img src="images/ui-marked.png" width="88%" alt="已标记 / Bookmarks">
</div>

标记和审稿结果存在同一个 sqlite 里，所以收藏列表直接显示推荐、评分和会议，
不用再点进去。可以只看已审稿的。

### 明暗主题 · 手机可用

<div align="center">
<img src="images/ui-papers-light.png" width="44%" alt="浅色 / Light">
<img src="images/ui-mobile.png" width="21%" alt="手机 / Mobile">
</div>

黑白绿配色，跟随系统或手动切换。首屏绘制前就定好主题，深色模式不会闪白。

## 快速开始

### 1. 准备 CLI（二选一）

```bash
# Claude Code —— https://claude.com/claude-code
npm i -g @anthropic-ai/claude-code && claude      # 交互式登录一次

# 或 Codex CLI —— https://developers.openai.com/codex/cli
npm i -g @openai/codex && codex login
```

登录信息在 `~/.claude` / `~/.codex`，项目直接复用，**不需要 API key**。

### 2. 装依赖

```bash
git clone https://github.com/springkill/daily-arXiv-ai-enhanced.git
cd daily-arXiv-ai-enhanced
python3 -m venv .venv && source .venv/bin/activate
pip install -e .
```

### 3. 配置

```bash
cp .env.local.example .env.local
$EDITOR .env.local                              # 改 CATEGORIES 和 LLM_PROVIDER

cp ai/research_focus.example.txt ai/research_focus.txt
$EDITOR ai/research_focus.txt                   # 写你的研究方向
```

自检 LLM 是否可用：

```bash
python3 ai/llm.py "reply with exactly: OK"
```

### 4. 跑起来

```bash
./run-local.sh                    # 爬取 → 总结 → 打标 → 出 Markdown
python3 -m http.server 8000       # 打开 http://localhost:8000
```

### 5. 后端与定时（可选）

「已标记」和「一键审稿」需要后端；不起后端其余功能照常可用。

```bash
ln -sf "$PWD/deploy/api/arxiv-api.service" ~/.config/systemd/user/
systemctl --user daemon-reload && systemctl --user enable --now arxiv-api

crontab -e
# 0 9 * * * /abs/path/to/repo/scripts/cron-wrapper.sh >> /abs/path/to/repo/logs/cron.log 2>&1
```

生产部署（nginx / docker / HTTPS / 访问控制）见 **[SELF-HOSTED.md](./SELF-HOSTED.md)**，
原理与配置详解见 **[docs/GUIDE.md](./docs/GUIDE.md)**。

## 你的数据在哪

| 路径 | 内容 | 进 git |
|---|---|---|
| `data/` | 每日 jsonl 与 Markdown | 否 |
| `var/store.sqlite3` | 标记 + 审稿结果 | 否 |
| `.env.local` | 你的配置 | 否 |
| `ai/research_focus.txt` | 你的研究方向 | 否（仓库里只有 `.example`） |
| `assets/trend-taxonomy.json` | 自举的子方向标签库 | 否（仓库里只有 `.seed`） |

**仓库里不含任何人的私人数据。** 每个人跑自己的实例、存自己的东西。

> [!CAUTION]
> 若您所在法域对学术数据有审查要求，谨慎运行本代码；任何二次分发版本必须履行合规审查
> （包括但不限于原始论文合规性、AI 合规性）义务，否则一切法律后果由下游自行承担。

---

<a id="english"></a>

# English

## What this is

Upstream [dw-dengwei/daily-arXiv-ai-enhanced](https://github.com/dw-dengwei/daily-arXiv-ai-enhanced)
runs on GitHub Actions with a third-party LLM API key. This fork rewires it to
**local cron + local CLI**: it drives the **Claude Code** or **Codex** CLI you have
already logged into, using your own subscription quota. No API key to obtain,
and every paper and review stays on your machine.

| | Upstream | This fork |
|---|---|---|
| Runtime | GitHub Actions | local cron |
| Model | DeepSeek / OpenAI API key | your logged-in Claude Code or Codex |
| Cost | pay per token | your existing subscription, no API key |
| Frontend | multi-page | single-page app, no reload between views |
| Ordering | by category | ranked 0–10 against *your* research focus |
| Extras | — | one-click review, cross-device bookmarks, trend charts, dark mode |

## Features

**Relevance ranking, not a category dump.** Write your research directions in
`ai/research_focus.txt` — it is the *sole* basis for scoring. Every paper gets a
0–10 score and a full five-section summary from the fast model; those above the
threshold and in the day's top-K get rewritten by the strongest model. Edit the
file and the next run picks it up — no code changes.

**One-click review.** Two stages: a fast model picks the most likely venue from a
fixed whitelist (NDSS / USENIX Security / ICSE / NeurIPS …), then **Quick / Normal /
Deep** selects the model that writes the review as a reviewer *for that venue* —
summary, strengths, weaknesses, detailed comments, questions, rating,
recommendation, confidence. The tiers genuinely differ: on the same paper the fast
model said "Minor revision, 8/10" while the mid tier said "Major revision, 4/10"
and questioned a specific latency claim.

**Trends.** Daily trends for primary categories, sub-directions and keywords, with
a crosshair that reads out every series at once, toggleable legend and a table
view. Sub-direction labels are bootstrapped: the model reuses existing labels and
only creates a new one when nothing fits.

**Bookmarks × reviews.** Both live in one sqlite file, so the bookmark list shows
the recommendation, rating and venue inline, with a "reviewed only" filter.

**Dark mode & mobile.** Black/white/green palette, follows the system or toggled
manually; the theme is set before first paint so dark-mode users never see a
white flash.

## Quick start

```bash
# 1. Install and log into one CLI
npm i -g @anthropic-ai/claude-code && claude     # https://claude.com/claude-code
# or
npm i -g @openai/codex && codex login            # https://developers.openai.com/codex/cli

# 2. Install
git clone https://github.com/springkill/daily-arXiv-ai-enhanced.git
cd daily-arXiv-ai-enhanced
python3 -m venv .venv && source .venv/bin/activate && pip install -e .

# 3. Configure
cp .env.local.example .env.local && $EDITOR .env.local
cp ai/research_focus.example.txt ai/research_focus.txt && $EDITOR ai/research_focus.txt
python3 ai/llm.py "reply with exactly: OK"       # smoke-test the CLI

# 4. Run
./run-local.sh
python3 -m http.server 8000                      # http://localhost:8000
```

Bookmarks and reviews need the backend (optional — everything else works without it):

```bash
ln -sf "$PWD/deploy/api/arxiv-api.service" ~/.config/systemd/user/
systemctl --user daemon-reload && systemctl --user enable --now arxiv-api
```

For production deployment see **[SELF-HOSTED.md](./SELF-HOSTED.md)**;
for how it works and every config knob see **[docs/GUIDE.md](./docs/GUIDE.md)**.

## Where your data lives

`data/` (daily jsonl), `var/store.sqlite3` (bookmarks + reviews), `.env.local`,
`ai/research_focus.txt` and `assets/trend-taxonomy.json` are **all gitignored** —
the repository ships only `.example` / `.seed` templates and contains nobody's
personal data.

> [!CAUTION]
> If your jurisdiction has censorship requirements for academic data, run this code
> with caution; any redistributed version must fulfil its content review obligations
> (including but not limited to the compliance of the original papers and of AI
> output), otherwise all legal consequences are borne by the downstream party.

---

## 贡献者 / Contributors

本项目的功能与代码绝大部分来自上游 [dw-dengwei/daily-arXiv-ai-enhanced](https://github.com/dw-dengwei/daily-arXiv-ai-enhanced)。
感谢以下贡献者为原项目贡献代码、发现缺陷、提出想法：

*Most of this project's functionality comes from upstream
[dw-dengwei/daily-arXiv-ai-enhanced](https://github.com/dw-dengwei/daily-arXiv-ai-enhanced).
Thanks to the following contributors of the original project for contributing code,
discovering bugs, and sharing useful ideas:*
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

## 致谢 / Acknowledgement

感谢以下个人与组织对原项目的推荐与支持：

*Sincere thanks to the following individuals and organizations for promoting and supporting the original project:*
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

## 上游项目 / Upstream

- 原项目 / Original: [dw-dengwei/daily-arXiv-ai-enhanced](https://github.com/dw-dengwei/daily-arXiv-ai-enhanced)
- 路线图 / Roadmap: https://github.com/users/dw-dengwei/projects/3

本分支只改了运行方式与前端，核心思路、爬虫与数据格式都来自上游。
*This fork changes the runtime and the frontend; the core idea, the crawler and the
data format all come from upstream.*

## 许可 / License

沿用上游许可证，见 [LICENSE](./LICENSE)。
*Same license as upstream, see [LICENSE](./LICENSE).*
