# 自托管部署说明 / Self-hosted Deployment

> 这份文档描述的是一套**参考部署**。域名、IP、用户名都是占位符,
> 按你自己的环境替换。只想本地跑起来的话看 [README](./README.md) 就够了。

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
            ├─ 3. ai/local_enhance.py          → data/<日期>_AI_enhanced_<语言>.jsonl
            │       Stage1 Haiku 批量打相关分(0-10)
            │       Stage2 Opus 只深度总结 相关分≥阈值 且 Top-K 的论文
            │       输出按相关分降序
            ├─ 4. to_md/convert.py              → data/<日期>.md
            └─ 5. 更新 assets/file-list.txt

docker(deploy/docker-compose.yml): daily-arxiv-web (nginx:alpine)
  托管仓库静态前端 + 本机 data/ + assets/,加入外部网络 gateway,容器名 daily-arxiv-web

~/services/nginx-gateway(已有反代):
  conf.d/arxiv.conf  →  proxy_pass http://daily-arxiv-web:80
  arxiv.example.com(通配符证书 *.example.com)+ basic auth(.htpasswd_arxiv   # <你自己的 htpasswd 文件>)
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
docker run --rm httpd:alpine htpasswd -bn arxiv '新密码' > ~/services/nginx-gateway/.htpasswd_arxiv   # <你自己的 htpasswd 文件>
docker exec nginx-gateway nginx -s reload
```

## 4. 手动运行 / 调试

```bash
cd ~/GithubProject/daily-arXiv-ai-enhanced
source .venv/bin/activate
./run-local.sh                 # 完整跑一遍(读 .env.local)
# 只测总结器(不爬取):
CATEGORIES=cs.CR ... 自行准备 data/<日期>.jsonl 后:
cd ai && python local_enhance.py --data ../data/<日期>.jsonl
```
日志:`logs/cron.log`。

## 5. 运维

- 重启前端容器:`cd deploy && docker compose restart`
- 更新前端代码后:`cd deploy && docker compose up -d`
- **改了 `deploy/web.conf` 后**:必须 `cd deploy && docker compose up -d --force-recreate`
  (单文件挂载有 inode 陷阱,改文件后容器还绑旧 inode,普通 reload 看不到改动)

## 跨设备标记(已标记论文)

- 在任意设备(手机/电脑)点论文卡片上的 ☆ 即可标记,顶栏⭐进入「已标记」页(`marked.html`)看到所有标记,跨设备同步。
- 后端:`deploy/marks-api/`(纯标准库 Python,容器 `daily-arxiv-marks`),web 容器把 `/api/` 反代过去。
  数据已迁到 `var/store.sqlite3`(见下节「后端 API」),不再用 docker 命名卷。
- 改了 `deploy/api/*.py` 后:`systemctl --user restart arxiv-api`。

## 后端 API(`deploy/api/`)—— 已标记 + 一键审稿

一个进程、一个 sqlite,跑在**宿主机**上(不是容器:审稿要用 `~/.claude` 的登录凭据调 claude CLI)。
原来的 `daily-arxiv-marks` 容器已下线并入这里 —— 两份数据在同一个库里才能做「标记 × 审稿」的联查。

### 装 / 起

```bash
mkdir -p ~/.config/systemd/user
ln -sf "$PWD/deploy/api/arxiv-api.service" ~/.config/systemd/user/
systemctl --user daemon-reload && systemctl --user enable --now arxiv-api
curl -s -H 'X-Auth-User: arxiv' http://<docker 网桥上的宿主地址,如 172.17.0.1>:8801/api/health
```

监听 `<docker 网桥上的宿主地址,如 172.17.0.1>:8801`(gateway 网桥上的宿主地址,容器里的 nginx 能到、局域网到不了)。
本机调试用 `REVIEW_BIND=127.0.0.1 REVIEW_PORT=8802`。

### 路由

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/health` | `{ok, user, marks, reviews, running}` |
| GET | `/api/marks` | 标记列表,每条带上**最深的那份审稿结论**(联查) |
| PUT/DELETE | `/api/marks/<id>` | 加/删标记 |
| POST | `/api/review` | `{id, date, mode}` → 真的审稿,会花钱 |
| GET | `/api/review?id=<id>` | 该论文已存的审稿结果,**只读,不触发审稿** |

公网路径就在站点同源下:`https://arxiv.example.com/api/...`,所以前端直接 `fetch('/api/...')`。

### 存储

sqlite:`var/store.sqlite3`(`ARXIV_STORE_DIR` 可覆盖)。两张表 `marks` / `reviews`,
主键都带 `user`。`var/` 已 gitignore —— 标记和审稿意见是各人自己的数据,不进版本库。

- **WAL 模式**,审稿在跑时前端照样能读。
- `rating` / `recommend` / `confidence` 从 sections JSON 里提出来单独存,
  「已标记」页要按结论筛选/排序时不用解析 JSON。
- ⚠️ **`ARXIV_STORE_DIR` 绝不能指到 sshfs 挂载点**(如 `/srv/scratch`):
  sqlite 在 FUSE 上锁语义不可靠,会静默损坏数据。必须本地盘。
- ⚠️ **整个仓库就是站点根**,所以 `web.conf` 里显式 deny 了 `/var/`、`/deploy/`
  和 `*.sqlite3` —— 否则库文件能被直接下载走。

### 多用户

`user` 取自 nginx 转发的 `X-Auth-User`,值就是网关 basic auth 的 `$remote_user`。
`proxy_set_header` 会覆盖客户端自带的同名头,伪造不了(实测伪造后落到 `default`,看不到别人的数据)。
没有该头时落到 `default`。

**迁移时最容易踩的坑**:导入脚本默认写 `user='default'`,而浏览器真实流量是
`user='arxiv'`,不对齐的话页面上会看到「标记全没了」。用:

```bash
python3 deploy/api/server.py --users                    # 看库里现有用户
python3 deploy/api/server.py --rekey default arxiv      # 对齐
```

### 从旧存储迁移(一次性,幂等)

```bash
docker exec daily-arxiv-marks sh -c 'cat /data/marks.json' > /tmp/marks.json
python3 deploy/api/server.py --import-marks /tmp/marks.json --import-reviews data/.review-cache.json --user arxiv
```

旧的命名卷 `deploy_marks-data` 暂时留着,确认无误后 `docker volume rm deploy_marks-data`。

### 备份

```bash
sqlite3 var/store.sqlite3 ".backup /path/to/store-$(date +%F).sqlite3"
```

审稿意见是花过钱的产出,值得进你自己的备份流程(但别进 git)。

### nginx 两层,超时都要放宽

`deploy/web.conf` 的 `location /api/`(900s)和网关
`~/runtime/nginx-gateway/conf.d/arxiv.conf` 的同名 block(900s)。
网关默认 `proxy_read_timeout` 是 60s,只改里面那层的话深度审稿照样 504。
两个 conf 都是 bind mount,`docker compose up -d` 不会重建容器,**必须显式 reload**:

```bash
docker exec daily-arxiv-web nginx -s reload
docker exec nginx-gateway  nginx -s reload
```

### 审稿怎么做的

两层:Layer 1 用 haiku 读本机存的标题+摘要,从 27 个会议的**固定白名单**里选一个,只返回编号;
Layer 2 按模式选模型(快速=haiku / 正常=sonnet / 深度=opus),以「你是 <会议> 审稿人」出意见。

**安全边界**:请求体只认 `{id, date, mode}`,分别过正则和白名单;标题与摘要一律由后端从
`data/*.jsonl` 按 id 查出,请求里带的任何文本都被丢弃 —— prompt 的内容不受调用方控制。
论文摘要本身来自 arXiv(不可信),所以 Layer 1 的输出被约束成白名单编号,
即使摘要里藏了提示注入,最坏也只是选错会议。返回结构化字段,HTML 由前端转义后生成。

**注意 `LANGUAGE` 是 POSIX locale 变量**(桌面会话里通常已是 `zh_CN:en`)。长驻服务会继承它,
所以本服务用的是 `ARXIV_LANGUAGE` 并且只认 `Chinese`/`English`。
`ai/local_enhance.py` 仍读 `LANGUAGE`,但它总是由 `run-local.sh` 从 `.env.local` 显式导出,不受影响。

## 移动端 / 手机

- 页面已响应式(纯 CSS 媒体查询,不再依赖已删除的 `js/mobile.js`;手机上顶栏拆两行、卡片单列)。
- 支持"添加到主屏"(PWA `manifest.webmanifest`):iOS Safari 分享→添加到主屏幕,Android Chrome 菜单→安装/添加到主屏,
  之后像 App 一样全屏打开。改图标:换 `assets/logo.png`。
- 网关重载(仅改 conf):`docker exec nginx-gateway nginx -t && docker exec nginx-gateway nginx -s reload`
- **Claude token 过期**:cron 里 headless claude 依赖 `~/.claude/.credentials.json`。若预检失败,
  在交互式 `claude` 里重新登录即可;`run-local.sh` 步骤0 会在过期时直接报错中止,不会空跑。

## 6. 成本

- 深度总结被 `DEEP_TOP_K`(默认60)+ `RELEVANCE_THRESHOLD`(默认6)双重限流,
  与类别多少无关,估算每天约 $6–12(Opus 深度 + Haiku 预筛)。
- 想更省:`DEEP_MODEL=sonnet` 或调低 `DEEP_TOP_K`。
