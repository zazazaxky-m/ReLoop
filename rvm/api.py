from __future__ import annotations

import json
import mimetypes
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

from .controller import RvmController


class LocalApiServer:
    def __init__(self, controller: RvmController, assets: Path):
        self.controller = controller
        self.assets = assets
        self.httpd: ThreadingHTTPServer | None = None

    def serve(self) -> None:
        controller = self.controller
        assets = self.assets
        media_root = Path(controller.config.media_cache_dir).resolve()

        class Handler(BaseHTTPRequestHandler):
            server_version = "ReLoopRVM/1.0"

            def json_response(self, status: int, data: dict) -> None:
                raw = json.dumps(data, separators=(",", ":")).encode()
                try:
                    self.send_response(status)
                    self.send_header("Content-Type", "application/json")
                    self.send_header("Cache-Control", "no-store")
                    self.send_header("X-Content-Type-Options", "nosniff")
                    self.send_header("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self'")
                    self.send_header("Content-Length", str(len(raw)))
                    self.end_headers()
                    self.wfile.write(raw)
                except ConnectionError:
                    pass

            def file_response(self, target: Path, content_type: str, cache_control: str) -> None:
                size = target.stat().st_size
                start, end, partial = 0, max(0, size - 1), False
                range_header = self.headers.get("Range", "")
                if range_header.startswith("bytes=") and size:
                    try:
                        raw_start, raw_end = range_header.removeprefix("bytes=").split("-", 1)
                        start = int(raw_start) if raw_start else 0
                        end = min(int(raw_end) if raw_end else size - 1, size - 1)
                        if start < 0 or start > end:
                            raise ValueError("invalid range")
                        partial = True
                    except ValueError:
                        self.send_response(416)
                        self.send_header("Content-Range", f"bytes */{size}")
                        self.end_headers()
                        return
                length = end - start + 1 if size else 0
                try:
                    self.send_response(206 if partial else 200)
                    self.send_header("Content-Type", content_type)
                    self.send_header("Cache-Control", cache_control)
                    self.send_header("Accept-Ranges", "bytes")
                    self.send_header("X-Content-Type-Options", "nosniff")
                    self.send_header("Content-Length", str(length))
                    if partial:
                        self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
                    self.end_headers()
                    with target.open("rb") as source:
                        source.seek(start)
                        remaining = length
                        while remaining > 0:
                            chunk = source.read(min(64 * 1024, remaining))
                            if not chunk:
                                break
                            self.wfile.write(chunk)
                            remaining -= len(chunk)
                except (ConnectionError, BrokenPipeError):
                    pass

            def body(self) -> dict:
                size = min(int(self.headers.get("Content-Length", "0")), 65536)
                return json.loads(self.rfile.read(size) or b"{}")

            def do_GET(self) -> None:  # noqa: N802
                route = urlparse(self.path).path
                if route == "/api/state":
                    self.json_response(200, controller.public_state())
                    return
                if route == "/api/health":
                    self.json_response(200, {"ok": True, "version": "1.0.0"})
                    return
                if route.startswith("/media/"):
                    filename = route.removeprefix("/media/")
                    target = (media_root / filename).resolve()
                    if target.parent != media_root or not target.is_file():
                        self.send_error(404)
                        return
                    self.file_response(target, mimetypes.guess_type(target.name)[0] or "application/octet-stream", "public, max-age=31536000, immutable")
                    return
                relative = "index.html" if route == "/" else route.lstrip("/")
                target = (assets / relative).resolve()
                if assets.resolve() not in target.parents and target != assets.resolve():
                    self.send_error(403)
                    return
                if not target.is_file():
                    self.send_error(404)
                    return
                raw = target.read_bytes()
                try:
                    self.send_response(200)
                    self.send_header("Content-Type", mimetypes.guess_type(target.name)[0] or "application/octet-stream")
                    self.send_header("Cache-Control", "no-cache")
                    self.send_header("Content-Length", str(len(raw)))
                    self.end_headers()
                    self.wfile.write(raw)
                except ConnectionError:
                    pass

            def do_POST(self) -> None:  # noqa: N802
                route = urlparse(self.path).path
                try:
                    data = self.body()
                    if route == "/api/session/lease":
                        ok = controller.activate_lease(data)
                        self.json_response(200 if ok else 401, {"ok": ok})
                        return
                    if route == "/api/maintenance/login":
                        token = controller.maintenance_login(str(data.get("pin", "")))
                        self.json_response(200 if token else 401, {"token": token})
                        return
                    if route == "/api/maintenance/command":
                        token = self.headers.get("Authorization", "").removeprefix("Bearer ").strip()
                        if not controller.maintenance_authorized(token):
                            self.json_response(401, {"error": "Unauthorized"})
                            return
                        result = controller.maintenance_command(str(data.get("command", "")), data)
                        self.json_response(200, result)
                        return
                    self.send_error(404)
                except (ValueError, json.JSONDecodeError) as exc:
                    self.json_response(422, {"error": str(exc)})

            def log_message(self, *_args) -> None:
                return

        self.httpd = ThreadingHTTPServer((controller.config.host, controller.config.port), Handler)
        self.httpd.serve_forever()

    def stop(self) -> None:
        if self.httpd:
            self.httpd.shutdown()
