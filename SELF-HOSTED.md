# 自托管部署说明 / Self-hosted Deployment

把本项目改造为:**每天定时抓取指定 arXiv 类别 → 用本机 Claude Code 逐篇总结 →
按"研究关注点"相关性打分排序 → 自建 nginx 网关 + 域名 + 密码** 对外提供服务。
分支:`self-hosted`。总结引擎是本机已认证的 Claude Code(headless),不调用任何第三方 LLM API key。

---

## 1. 架构

```
cron(每天 08:30 AEST)
  └─ scripts/cron-wrapper.sh         # 补全 PATH/HOME + 激活 venv
       └─ run-local.sh
            ├─ 0. claude 认证预检
            ├─ 1. scrapy crawl arxiv           → data/<日期>.jsonl   (CATEGORIES)
            ├─ 2. check_stats.py 近7天去重
            ├─ 3. ai/claude_enhance.py          → data/<日期>_AI_enhanced_<语言>.jsonl
            │       Stage1 Haiku 批量打相关分(0-10)
            │       Stage2 Opus 只深度总结 相关分≥阈值 且 Top-K 的论文
            │       输出按相关分降序
            ├─ 4. to_md/convert.py              → data/<日期>.md
            └─ 5. 更新 assets/file-list.txt

docker(deploy/docker-compose.yml): daily-arxiv-web (nginx:alpine)
  托管仓库静态前端 + 本机 data/ + assets/,加入外部网络 gateway,容器名 daily-arxiv-web

~/services/nginx-gateway(已有反代):
  conf.d/arxiv.conf  →  proxy_pass http://daily-arxiv-web:80
  arxiv.example.com(通配符证书 *.example.com)+ basic auth(.htpasswd_arxiv)
```

## 2. 访问

- 网址:`https://arxiv.example.com`
- 用户名 `arxiv`,密码见部署时生成值(存于本机,可重置见下)。
- **需要手动一次**:在 Cloudflare 给 `arxiv` 加一条 A 记录 → `<你的公网 IP>`(橙云代理开启)。

## 3. 改配置(都不用动代码)

| 想改什么 | 改哪里 |
|----------|--------|
| 研究关注点(打分依据) | `ai/research_focus.txt`,下次跑自动生效 |
| 抓取的类别 | `.env.local` 的 `CATEGORIES`(逗号分隔) |
| 深度总结模型 / 预筛模型 | `.env.local` 的 `DEEP_MODEL` / `PREFILTER_MODEL`(opus/sonnet/haiku) |
| 深度总结范围 | `.env.local` 的 `RELEVANCE_THRESHOLD`(默认6)、`DEEP_TOP_K`(默认60) |
| 摘要语言 | `.env.local` 的 `LANGUAGE`(`Chinese` 或 `English`) |
| 运行时间 | `crontab -e` 改那行 `30 8 * * *` |
| 站点密码 | 重新生成 htpasswd(见下) |

重置站点密码:
```bash
docker run --rm httpd:alpine htpasswd -bn arxiv '新密码' > ~/services/nginx-gateway/.htpasswd_arxiv
docker exec nginx-gateway nginx -s reload
```

## 4. 手动运行 / 调试

```bash
cd ~/GithubProject/daily-arXiv-ai-enhanced
source .venv/bin/activate
./run-local.sh                 # 完整跑一遍(读 .env.local)
# 只测总结器(不爬取):
CATEGORIES=cs.CR ... 自行准备 data/<日期>.jsonl 后:
cd ai && python claude_enhance.py --data ../data/<日期>.jsonl
```
日志:`logs/cron.log`。

## 5. 运维

- 重启前端容器:`cd deploy && docker compose restart`
- 更新前端代码后:`cd deploy && docker compose up -d`
- 网关重载(仅改 conf):`docker exec nginx-gateway nginx -t && docker exec nginx-gateway nginx -s reload`
- **Claude token 过期**:cron 里 headless claude 依赖 `~/.claude/.credentials.json`。若预检失败,
  在交互式 `claude` 里重新登录即可;`run-local.sh` 步骤0 会在过期时直接报错中止,不会空跑。

## 6. 成本

- 深度总结被 `DEEP_TOP_K`(默认60)+ `RELEVANCE_THRESHOLD`(默认6)双重限流,
  与类别多少无关,估算每天约 $6–12(Opus 深度 + Haiku 预筛)。
- 想更省:`DEEP_MODEL=sonnet` 或调低 `DEEP_TOP_K`。
