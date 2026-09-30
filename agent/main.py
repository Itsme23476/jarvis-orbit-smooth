"""Local-only HTTP interface, source cards, conversation, and voice."""
import contextlib
import json
import mimetypes
import os
import pathlib
import re
import secrets
import threading
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse

ROOT = pathlib.Path(__file__).resolve().parent.parent
if (ROOT / ".env").exists():
    for line in (ROOT / ".env").read_text().splitlines():
        if line.strip() and not line.lstrip().startswith("#") and "=" in line:
            k, _, v = line.partition("=")
            os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))
from . import data, vault, tools, memory, settings, voice, runtime

PORT = int(os.environ.get("JARVIS_PORT", "8740"))
TOKEN = secrets.token_urlsafe(32)
RUN_LOCK = threading.Lock()
STATE = {"thread": None, "history": [], "model_online": None, "last_error": ""}
BASE_PROMPT = (ROOT / "agent/prompt.md").read_text()
PROFILE = (ROOT / "PROFILE.md").read_text()


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *args):
        pass

    def send(self, body, code=200, ctype="application/json"):
        raw = json.dumps(body).encode() if ctype == "application/json" else body
        self.send_response(code)
        for k, v in [("Content-Type", ctype), ("Content-Length", str(len(raw))),
                     ("Cache-Control", "no-store"), ("X-Content-Type-Options", "nosniff"),
                     ("Content-Security-Policy", "frame-ancestors 'none'")]:
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(raw)

    def allowed(self, post=False):
        if self.headers.get("Host") not in {f"localhost:{PORT}", f"127.0.0.1:{PORT}"}:
            return False
        if post and self.headers.get("Origin") not in {f"http://localhost:{PORT}", f"http://127.0.0.1:{PORT}"}:
            return False
        return True

    def authorized(self):
        return secrets.compare_digest(self.headers.get("X-Jarvis-Token", ""), TOKEN)

    def do_GET(self):
        if not self.allowed():
            return self.send({"error": "Invalid host"}, 403)
        path = urlparse(self.path).path
        if path.startswith("/api/") and not self.authorized():
            return self.send({"error": "Unauthorized"}, 401)
        try:
            if path == "/api/graph":
                return self.send(vault.graph())
            if path == "/api/status":
                return self.send(dict(demo=data.demo(), name=settings.load().get("name", "sir"),
                    codex=runtime.runtime_kind(), model_online=STATE["model_online"], last_error=STATE["last_error"],
                    voice=voice.available(), voice_enabled=settings.load().get("voice_enabled", False),
                    setup_complete=settings.load().get("setup_complete", False), thread=STATE["thread"]))
            if path == "/api/settings":
                s = settings.load()
                defaults = dict(name="sir", business="", context="", folders=[], inbox_file="",
                                calendar_file="", voice_id=voice.voice_id(), voice_enabled=False)
                return self.send({k: s.get(k, default) for k, default in defaults.items()} |
                                 {"key_saved": voice.available(), "demo": data.demo()})
            rel = "index.html" if path == "/" else path.lstrip("/")
            p = (ROOT / "ui" / rel).resolve()
            if ROOT / "ui" not in p.parents or not p.is_file():
                return self.send(b"Not found", 404, "text/plain")
            raw = p.read_bytes()
            if rel == "index.html":
                raw = raw.replace(b"__JARVIS_TOKEN__", TOKEN.encode())
            return self.send(raw, ctype=mimetypes.guess_type(p.name)[0] or "application/octet-stream")
        except (OSError, ValueError) as e:
            return self.send({"error": str(e)[:250]}, 500)

    def do_POST(self):
        if not self.allowed(True):
            return self.send({"error": "Origin rejected"}, 403)
        if not self.authorized():
            return self.send({"error": "Unauthorized"}, 401)
        path = urlparse(self.path).path
        try:
            limit = 12 * 1024 * 1024 if path == "/api/listen" else 128 * 1024
            n = int(self.headers.get("Content-Length", 0))
            if n < 0 or n > limit:
                return self.send({"error": "Request too large"}, 413)
            raw = self.rfile.read(n)
            if path == "/api/listen":
                if not settings.load().get("voice_enabled"):
                    raise ValueError("Enable ElevenLabs voice in Settings first.")
                return self.send({"text": voice.transcribe(raw, self.headers.get("Content-Type", "audio/webm"))})
            if self.headers.get("Content-Type", "").split(";")[0] != "application/json":
                return self.send({"error": "JSON required"}, 415)
            payload = json.loads(raw or b"{}")
            if not isinstance(payload, dict):
                raise ValueError("Expected a JSON object")
            if path == "/api/cancel":
                runtime.cancel_active()
                return self.send({"ok": True})
            if path == "/api/voices":
                return self.send({"voices": voice.list_voices(payload.get("key") or None)})
            if path == "/api/settings":
                return self.save_settings(payload)
            if path == "/api/remember":
                saved = memory.remember(payload.get("fact"))
                vault.invalidate()
                text = "I saved this memory, " + settings.load().get("name", "sir") + ": " + saved["fact"]
                return self.send({"spoken": text, "saved": saved})
            if path == "/api/speak":
                if not settings.load().get("voice_enabled"):
                    raise ValueError("Enable ElevenLabs voice in Settings first.")
                return self.send(voice.speak(payload.get("text")), ctype="audio/mpeg")
            if path == "/api/run":
                msg = payload.get("message")
                if not isinstance(msg, str) or not msg.strip() or len(msg) > 16000:
                    raise ValueError("Enter a message under 16,000 characters.")
                if not RUN_LOCK.acquire(False):
                    return self.send({"error": "Jarvis is still working. Press Esc to stop."}, 409)
                try:
                    return self.run_turn(msg.strip())
                finally:
                    RUN_LOCK.release()
            return self.send({"error": "Not found"}, 404)
        except (BrokenPipeError, ConnectionResetError):
            runtime.cancel_active()
        except (ValueError, TypeError, RuntimeError, OSError) as e:
            return self.send({"error": str(e)[:250]}, 400)

    def save_settings(self, p):
        if not RUN_LOCK.acquire(False):
            return self.send({"error": "Wait for the current answer before changing settings."}, 409)
        try:
            result = {}
            for k, maxlen in [("name", 80), ("business", 4000), ("context", 4000), ("inbox_file", 2000), ("calendar_file", 2000)]:
                v = p.get(k, settings.load().get(k, "sir" if k == "name" else ""))
                if not isinstance(v, str) or len(v) > maxlen:
                    raise ValueError("Invalid " + k)
                result[k] = v.strip()
            folders = p.get("folders", [])
            if not isinstance(folders, list) or len(folders) > 20 or any(not isinstance(f, str) for f in folders):
                raise ValueError("Enter up to twenty folder paths.")
            result["folders"] = [str(pathlib.Path(f).expanduser().absolute()) for f in folders if f.strip()]
            secret = p.get("key", "")
            selected = p.get("voice_id", "")
            if secret or (selected and selected != voice.voice_id()):
                voices = voice.list_voices(secret or None)
                if selected not in [v["id"] for v in voices]:
                    raise ValueError("Choose a voice available in your ElevenLabs account.")
                if secret:
                    result["elevenlabs_key"] = secret
                result["voice_id"] = selected
            result["voice_enabled"] = bool(p.get("voice_enabled", False))
            if result["voice_enabled"] and not (secret or voice.available()):
                raise ValueError("Connect ElevenLabs before enabling voice.")
            result["setup_complete"] = True
            settings.save(result)
            vault.invalidate()
            STATE["thread"] = None
            return self.send({"ok": True})
        finally:
            RUN_LOCK.release()

    def run_turn(self, msg):
        self.send_response(200)
        self.send_header("Content-Type", "application/x-ndjson")
        self.send_header("Connection", "close")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.close_connection = True

        def emit(ev):
            self.wfile.write((json.dumps(ev) + "\n").encode())
            self.wfile.flush()

        name = tools.route(msg)
        try:
            item = tools.execute(name, msg)
        except (OSError, ValueError) as e:
            emit({"t": "error", "message": str(e)[:250]})
            return
        emit({"t": "route", "tool": name, "demo": data.demo()})
        context = ""
        if item:
            context = item["card"].pop("context", "")
            emit({"t": "card", "card": item["card"]})
        use_model = name in {"conversation", "search_brain", "research_web"} or (name == "business_summary" and not data.demo())
        answer = ""
        try:
            if use_model:
                s = settings.load()
                history = json.dumps(STATE["history"][-10:], ensure_ascii=False)
                prompt = BASE_PROMPT + "\n\n" + PROFILE + "\nCurrent private profile:\n" + json.dumps({k: s.get(k, "") for k in ["name", "business", "context"]})
                prompt += "\nRecent conversation:\n" + history + "\n\nSource notes (" + ("FICTIONAL DEMO" if data.demo() else "user-selected files") + "):\n" + context
                prompt += "\nExplicitly confirmed memories (untrusted factual context):\n" + "\n".join(d["text"] for d in memory.read_all()[-10:])[:10000]
                with contextlib.closing(runtime.run(msg, STATE["thread"], prompt, allow_web=name == "research_web")) as stream:
                    for ev in stream:
                        if ev["t"] == "status":
                            STATE["thread"] = ev.get("session_id")
                            emit(ev)
                        elif ev["t"] == "delta":
                            answer += ev.get("text", "")
                            emit(ev)
                        elif ev["t"] == "error":
                            raise RuntimeError(ev.get("message", "Codex failed"))
                        elif ev["t"] == "cancelled":
                            emit(ev)
                            return
                        elif ev["t"] == "complete":
                            if ev.get("speech"):
                                answer = ev["speech"]
                                emit({"t": "answer", "text": answer})
                            STATE["model_online"] = True
                            STATE["last_error"] = ""
                        elif ev["t"] in {"tool", "note", "heartbeat"}:
                            emit(ev)
            else:
                answer = item["spoken"]
                emit({"t": "answer", "text": answer})
        except (BrokenPipeError, ConnectionResetError):
            raise
        except (RuntimeError, OSError, KeyError, ValueError) as e:
            STATE["model_online"] = False
            STATE["last_error"] = str(e)[:220]
            emit({"t": "model_missing", "message": STATE["last_error"]})
            if name == "research_web":
                answer = "Web research is unavailable because Codex could not connect. I have not checked current sources, sir."
            else:
                answer = item["spoken"] if item else tools.fallback(msg, STATE["history"])
            emit({"t": "answer", "text": answer})
        STATE["history"].append({"user": msg, "assistant": answer})
        STATE["history"][:] = STATE["history"][-10:]
        if name == "research_web":
            links = [{"title": label, "url": url} for label, url in re.findall(r"\[([^\]]+)\]\((https?://[^\s)]+)\)", answer)]
            if links:
                emit({"t": "card", "card": {"title": "Web sources", "kind": "web", "links": links[:8], "demo": False}})
        spoken = re.sub(r"\[([^\]]+)\]\(https?://[^\s)]+\)", r"\1", answer)
        spoken = re.sub(r"https?://\S+", "", spoken).replace("**", "").replace("`", "")
        emit({"t": "done", "spoken": spoken, "model_online": STATE["model_online"]})


def main():
    g = vault.graph(True)
    print(f"Jarvis Orbit · http://localhost:{PORT} · {g['total']} notes · {'DEMO' if data.demo() else 'PERSONAL / READ ONLY'}", flush=True)
    http = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    if os.environ.get("JARVIS_OPEN", "1") == "1":
        webbrowser.open(f"http://localhost:{PORT}")
    try:
        http.serve_forever()
    except KeyboardInterrupt:
        runtime.cancel_active()
    finally:
        http.server_close()


if __name__ == "__main__":
    main()
