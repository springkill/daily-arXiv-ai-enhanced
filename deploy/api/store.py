"""
持久化层 —— 一个 sqlite 文件装下「已标记」和「审稿结果」。

为什么是 sqlite 而不是继续用 JSON:
  * JSON 每次写都要全量读改写,攒到几千条会开始拖;sqlite 是单行更新。
  * 两张表在同一个库里,「已标记的论文 + 它的审稿结论」一条 SQL 就能取,
    这正是这次要打通的东西。
  * 事务保证并发写不会互相覆盖(审稿是多线程的)。

放在哪:
  默认 <仓库>/var/store.sqlite3,可用 ARXIV_STORE_DIR 覆盖。
  **不用 $HOME 默认值** —— 那会在家目录留下没人认领的孤儿文件。
  该目录已 gitignore:审稿意见和标记是各人自己的数据,不进版本库。

⚠️ 绝不要把 ARXIV_STORE_DIR 指到 /srv/scratch 之类的 sshfs 挂载点:
   sqlite 在 FUSE 上锁语义不可靠,会静默损坏数据。必须是本地盘。

多用户:
  所有表以 (user, ...) 为主键。user 取自 nginx 转发的 X-Auth-User
  (basic auth 的 $remote_user),没有就落到 'default'。
  现在只有一个账号,但表结构已经分好,加人不用改 schema。
"""
import json
import os
import sqlite3
import threading
import time

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", ".."))
STORE_DIR = os.environ.get("ARXIV_STORE_DIR", os.path.join(REPO, "var"))
DB_PATH = os.path.join(STORE_DIR, "store.sqlite3")

_local = threading.local()

SCHEMA = """
CREATE TABLE IF NOT EXISTS marks (
    user            TEXT    NOT NULL,
    id              TEXT    NOT NULL,
    title           TEXT,
    url             TEXT,
    date            TEXT,
    categories      TEXT,              -- JSON 数组
    relevance_score INTEGER,
    topic           TEXT,
    marked_at       INTEGER NOT NULL,  -- 毫秒时间戳
    PRIMARY KEY (user, id)
);

CREATE TABLE IF NOT EXISTS reviews (
    user       TEXT    NOT NULL,
    id         TEXT    NOT NULL,
    mode       TEXT    NOT NULL,       -- quick | normal | deep
    venue      TEXT,
    model      TEXT,
    title      TEXT,
    sections   TEXT    NOT NULL,       -- JSON,八个分节
    -- 下面三个从 sections 里提出来单独存,好让「已标记」页直接排序/筛选,
    -- 不用把 JSON 读出来再解析
    rating     INTEGER,
    recommend  TEXT,
    confidence INTEGER,
    elapsed    REAL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (user, id, mode)
);

CREATE INDEX IF NOT EXISTS idx_marks_user_time  ON marks(user, marked_at DESC);
CREATE INDEX IF NOT EXISTS idx_reviews_user_id  ON reviews(user, id);
"""

# 深度 > 正常 > 快速。同一篇有多份时,展示最深的那份。
MODE_RANK = {"quick": 1, "normal": 2, "deep": 3}


def conn():
    """每个线程一个连接。sqlite 的连接不是线程安全的,共用会偶发 ProgrammingError。"""
    c = getattr(_local, "conn", None)
    if c is None:
        os.makedirs(STORE_DIR, exist_ok=True)
        c = sqlite3.connect(DB_PATH, timeout=15)
        c.row_factory = sqlite3.Row
        c.execute("PRAGMA journal_mode=WAL")    # 读写并发,审稿在跑时前端照样能读
        c.execute("PRAGMA foreign_keys=ON")
        c.executescript(SCHEMA)
        _local.conn = c
    return c


def now_ms():
    return int(time.time() * 1000)


# --------------------------------------------------------------------------- #
# 标记
# --------------------------------------------------------------------------- #

MARK_FIELDS = ("title", "url", "date", "categories", "relevance_score", "topic")


def mark_put(user, pid, meta):
    c = conn()
    # 已存在就保留原始标记时间 —— 标记时间是「什么时候收藏的」,不该被元数据更新改掉
    row = c.execute("SELECT marked_at FROM marks WHERE user=? AND id=?", (user, pid)).fetchone()
    marked_at = row["marked_at"] if row else now_ms()
    cats = meta.get("categories")
    c.execute(
        """INSERT INTO marks (user, id, title, url, date, categories, relevance_score, topic, marked_at)
           VALUES (?,?,?,?,?,?,?,?,?)
           ON CONFLICT(user, id) DO UPDATE SET
             title=excluded.title, url=excluded.url, date=excluded.date,
             categories=excluded.categories, relevance_score=excluded.relevance_score,
             topic=excluded.topic""",
        (user, pid, meta.get("title"), meta.get("url"), meta.get("date"),
         json.dumps(cats, ensure_ascii=False) if cats is not None else None,
         meta.get("relevance_score"), meta.get("topic"), marked_at),
    )
    c.commit()
    return marked_at


def mark_delete(user, pid):
    c = conn()
    cur = c.execute("DELETE FROM marks WHERE user=? AND id=?", (user, pid))
    c.commit()
    return cur.rowcount > 0


def mark_list(user):
    """列出标记,并把每篇最深的那份审稿结论一起带出来 —— 这就是「打通」。
    审稿结果是花了钱的产出,在收藏列表里应该直接看得到结论,而不是再点进去。"""
    c = conn()
    rows = c.execute(
        "SELECT * FROM marks WHERE user=? ORDER BY marked_at DESC", (user,)
    ).fetchall()

    ids = [r["id"] for r in rows]
    reviews = {}
    if ids:
        q = ",".join("?" * len(ids))
        for rv in c.execute(
            f"SELECT id, mode, venue, model, rating, recommend, confidence "
            f"FROM reviews WHERE user=? AND id IN ({q})", (user, *ids)
        ):
            prev = reviews.get(rv["id"])
            if prev is None or MODE_RANK.get(rv["mode"], 0) > MODE_RANK.get(prev["mode"], 0):
                reviews[rv["id"]] = dict(rv)

    out = []
    for r in rows:
        item = {k: r[k] for k in r.keys()}
        if item.get("categories"):
            try:
                item["categories"] = json.loads(item["categories"])
            except Exception:
                item["categories"] = []
        rv = reviews.get(r["id"])
        if rv:
            rv.pop("id", None)
            item["review"] = rv
        out.append(item)
    return out


def mark_count(user):
    return conn().execute("SELECT COUNT(*) n FROM marks WHERE user=?", (user,)).fetchone()["n"]


# --------------------------------------------------------------------------- #
# 审稿
# --------------------------------------------------------------------------- #

def review_put(user, pid, mode, result):
    sec = result.get("sections") or {}
    c = conn()
    c.execute(
        """INSERT INTO reviews (user, id, mode, venue, model, title, sections,
                                rating, recommend, confidence, elapsed, created_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
           ON CONFLICT(user, id, mode) DO UPDATE SET
             venue=excluded.venue, model=excluded.model, title=excluded.title,
             sections=excluded.sections, rating=excluded.rating,
             recommend=excluded.recommend, confidence=excluded.confidence,
             elapsed=excluded.elapsed, created_at=excluded.created_at""",
        (user, pid, mode, result.get("venue"), result.get("model"), result.get("title"),
         json.dumps(sec, ensure_ascii=False), sec.get("rating"), sec.get("recommend"),
         sec.get("confidence"), result.get("elapsed"), now_ms()),
    )
    c.commit()


def review_get(user, pid, mode):
    r = conn().execute(
        "SELECT * FROM reviews WHERE user=? AND id=? AND mode=?", (user, pid, mode)
    ).fetchone()
    return _review_row(r) if r else None


def review_all(user, pid):
    rows = conn().execute(
        "SELECT * FROM reviews WHERE user=? AND id=?", (user, pid)
    ).fetchall()
    return {r["mode"]: _review_row(r) for r in rows}


def _review_row(r):
    return {
        "id": r["id"], "mode": r["mode"], "venue": r["venue"], "model": r["model"],
        "title": r["title"], "elapsed": r["elapsed"], "created_at": r["created_at"],
        "sections": json.loads(r["sections"]),
    }


def review_count(user=None):
    c = conn()
    if user:
        return c.execute("SELECT COUNT(*) n FROM reviews WHERE user=?", (user,)).fetchone()["n"]
    return c.execute("SELECT COUNT(*) n FROM reviews").fetchone()["n"]


# --------------------------------------------------------------------------- #
# 迁移:把旧的 JSON 存储导进来(一次性,幂等)
# --------------------------------------------------------------------------- #

def import_marks_json(path, user):
    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)
    n = 0
    c = conn()
    for pid, meta in (data or {}).items():
        cats = meta.get("categories")
        c.execute(
            """INSERT INTO marks (user, id, title, url, date, categories,
                                  relevance_score, topic, marked_at)
               VALUES (?,?,?,?,?,?,?,?,?)
               ON CONFLICT(user, id) DO NOTHING""",
            (user, str(pid), meta.get("title"), meta.get("url"), meta.get("date"),
             json.dumps(cats, ensure_ascii=False) if cats is not None else None,
             meta.get("relevance_score"), meta.get("topic"),
             int(meta.get("marked_at") or now_ms())),
        )
        n += 1
    c.commit()
    return n


def import_reviews_json(path, user):
    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)
    n = 0
    for key, result in (data or {}).items():
        if "|" not in key:
            continue
        pid, mode = key.rsplit("|", 1)
        review_put(user, pid, mode, result)
        n += 1
    return n


def rekey_user(src, dst):
    """把某个用户名下的数据整体挪到另一个用户名下。

    迁移时容易踩的坑:导入脚本默认写 user='default',而浏览器真实流量经过
    basic auth 后带的是 X-Auth-User: <htpasswd 里的用户名>。两者不一致的话,
    页面上会看到"标记全没了"。用这个命令对齐。
    """
    c = conn()
    n1 = c.execute("UPDATE OR IGNORE marks   SET user=? WHERE user=?", (dst, src)).rowcount
    n2 = c.execute("UPDATE OR IGNORE reviews SET user=? WHERE user=?", (dst, src)).rowcount
    c.execute("DELETE FROM marks   WHERE user=?", (src,))
    c.execute("DELETE FROM reviews WHERE user=?", (src,))
    c.commit()
    return n1, n2


def users():
    c = conn()
    rows = c.execute(
        "SELECT user, COUNT(*) n FROM marks GROUP BY user "
        "UNION ALL SELECT user, COUNT(*) FROM reviews GROUP BY user"
    ).fetchall()
    return [(r["user"], r["n"]) for r in rows]
