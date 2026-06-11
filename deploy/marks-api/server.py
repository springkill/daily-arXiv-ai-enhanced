#!/usr/bin/env python3
"""
极简跨设备"已标记论文"API(单用户,前置 nginx basic auth)。
纯标准库,无第三方依赖。存储为 /data/marks.json。

路由:
  GET    /api/marks            -> {"marks": [ {id,title,url,date,categories,relevance_score,topic,marked_at}, ... ]}
  PUT    /api/marks/<id>       body=元数据 JSON -> 新增/更新一条标记
  DELETE /api/marks/<id>       -> 删除一条标记
  GET    /api/health           -> {"ok": true, "count": N}
"""
import json
import os
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import unquote

DATA_FILE = os.environ.get("MARKS_FILE", "/data/marks.json")
PORT = int(os.environ.get("PORT", "8000"))
_lock = threading.Lock()


def _load():
    try:
        with open(DATA_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
            return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def _save(marks: dict):
    os.makedirs(os.path.dirname(DATA_FILE), exist_ok=True)
    tmp = DATA_FILE + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(marks, f, ensure_ascii=False)
    os.replace(tmp, DATA_FILE)  # 原子替换


ALLOWED_FIELDS = ("title", "url", "date", "categories", "relevance_score", "topic")


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def _json(self, code, payload):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _mark_id(self):
        # 路径形如 /api/marks/<id>
        parts = self.path.split("?", 1)[0].split("/")
        # ['', 'api', 'marks', '<id...>'] —— id 可能含点/版本号
        if len(parts) >= 4 and parts[1] == "api" and parts[2] == "marks":
            return unquote("/".join(parts[3:])).strip()
        return None

    def do_GET(self):
        p = self.path.split("?", 1)[0]
        if p == "/api/health":
            with _lock:
                return self._json(200, {"ok": True, "count": len(_load())})
        if p == "/api/marks":
            with _lock:
                marks = _load()
            items = list(marks.values())
            items.sort(key=lambda x: x.get("marked_at", 0), reverse=True)
            return self._json(200, {"marks": items})
        return self._json(404, {"error": "not found"})

    def do_PUT(self):
        mid = self._mark_id()
        if not mid:
            return self._json(400, {"error": "missing id"})
        length = int(self.headers.get("Content-Length", "0") or "0")
        raw = self.rfile.read(length) if length else b"{}"
        try:
            meta = json.loads(raw or b"{}")
            if not isinstance(meta, dict):
                meta = {}
        except Exception:
            meta = {}
        entry = {k: meta.get(k) for k in ALLOWED_FIELDS}
        entry["id"] = mid
        entry["marked_at"] = int(time.time() * 1000)
        with _lock:
            marks = _load()
            # 若已存在,保留原始 marked_at(标记时间不变)
            if mid in marks and marks[mid].get("marked_at"):
                entry["marked_at"] = marks[mid]["marked_at"]
            marks[mid] = entry
            _save(marks)
        return self._json(200, {"ok": True, "id": mid, "marked": True})

    def do_DELETE(self):
        mid = self._mark_id()
        if not mid:
            return self._json(400, {"error": "missing id"})
        with _lock:
            marks = _load()
            existed = marks.pop(mid, None) is not None
            if existed:
                _save(marks)
        return self._json(200, {"ok": True, "id": mid, "marked": False})

    def log_message(self, *args):
        pass  # 静默,避免刷屏


if __name__ == "__main__":
    print(f"marks-api on :{PORT}, store={DATA_FILE}", flush=True)
    ThreadingHTTPServer(("0.0.0.0", PORT), Handler).serve_forever()
