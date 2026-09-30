import io
import json
import os
import pathlib
import queue
import tempfile
import threading
import unittest
from unittest.mock import patch

from agent import data, memory, settings, tools, vault, voice, runtime, main


class Isolated(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = pathlib.Path(self.tmp.name)
        self.patches = [patch.object(settings, "PATH", self.root / "settings.json"),
                        patch.object(memory, "ROOT", self.root / "memory"),
                        patch.dict(os.environ, {"JARVIS_DEMO": "1", "ELEVENLABS_API_KEY": ""})]
        for p in self.patches: p.start()
        vault.invalidate()

    def tearDown(self):
        for p in reversed(self.patches): p.stop()
        vault.invalidate()
        self.tmp.cleanup()


class DataTests(Isolated):
    def test_demo_ignores_personal_folder(self):
        settings.save({"folders": [str(self.root)]})
        (self.root / "private.md").write_text("secret personal data")
        docs, warnings = data.documents()
        self.assertEqual(len(docs), 130)
        self.assertFalse(any("secret personal data" in d["text"] for d in docs))
        self.assertFalse(warnings)

    def test_filters_and_symlinks(self):
        source = self.root / "sources"; source.mkdir()
        (source / "ok.md").write_text("# Alpha\n[[Beta]]")
        (source / "beta.txt").write_text("# Beta")
        (source / "big.md").write_bytes(b"x" * (data.MAX_BYTES + 1))
        (source / "node_modules").mkdir()
        (source / "node_modules/x.md").write_text("skip")
        (source / "link.md").symlink_to(source / "ok.md")
        (source / "loop").symlink_to(source)
        settings.save({"folders": [str(source)]})
        with patch.dict(os.environ, {"JARVIS_DEMO": "0"}):
            docs, _ = data.documents()
            self.assertEqual({d["relative"] for d in docs}, {"ok.md", "beta.txt"})
            g = vault.graph(True)
            self.assertEqual(len(g["links"]), 1)
            self.assertEqual(vault.search("Alpha")[0]["source"], "ok.md")

    def test_root_symlink_not_followed(self):
        (self.root / "alias").symlink_to(self.root)
        settings.save({"folders": [str(self.root / "alias")]})
        with patch.dict(os.environ, {"JARVIS_DEMO": "0"}):
            self.assertEqual(data.documents()[0], [])

    def test_pdf_missing_extractor_warns(self):
        (self.root / "report.pdf").write_bytes(b"%PDF")
        settings.save({"folders": [str(self.root)]})
        with patch.dict(os.environ, {"JARVIS_DEMO": "0"}), patch.object(data.shutil, "which", return_value=None):
            docs, warnings = data.documents()
            self.assertFalse(docs)
            self.assertIn("pdftotext", warnings[0])

    def test_demo_graph_and_qualified_numbers(self):
        g = vault.graph(True)
        self.assertEqual(g["total"], 130)
        self.assertEqual(len(g["links"]), 484)
        answer = tools.execute("business_summary", "How is the studio doing?")
        self.assertEqual(answer["card"]["total"], "€6,000")
        self.assertIn("payments received", answer["spoken"])
        self.assertTrue(answer["card"]["demo"])

    def test_routing_without_model(self):
        for q in ("hello", "why?", "can you hear me", "what about the second one?"):
            self.assertEqual(tools.route(q), "conversation")
        self.assertEqual(tools.route("What do I know about Filect?"), "search_brain")
        self.assertEqual(tools.route("Remember that I prefer tea"), "remember")

    def test_no_live_data_is_invented(self):
        with patch.dict(os.environ, {"JARVIS_DEMO": "0"}):
            self.assertIn("not connected", tools.execute("read_inbox", "Inbox")["spoken"])
            self.assertEqual(tools.execute("plan_day", "Plan my day")["card"]["kind"], "notice")

    def test_import_and_plan_bounds(self):
        p = self.root / "inbox.json"
        p.write_text(json.dumps([{"from": "Client", "subject": "Review", "unread": True}]*7))
        settings.save({"inbox_file": str(p)})
        with patch.dict(os.environ, {"JARVIS_DEMO": "0"}):
            self.assertEqual(len(data.account_data("inbox")[0]), 7)
            self.assertLessEqual(len(tools.execute("plan_day", "plan")["card"]["items"]), 5)

    def test_memory_draft_does_not_write(self):
        draft = tools.execute("remember", "Remember that I prefer tea")
        self.assertEqual(draft["card"]["fact"], "I prefer tea")
        self.assertFalse(memory.ROOT.exists())

    def test_confirmed_memory_and_permissions(self):
        saved = memory.remember("I prefer tea")
        p = memory.ROOT / saved["filename"]
        self.assertTrue(p.is_file())
        self.assertEqual(p.stat().st_mode & 0o777, 0o600)
        self.assertIn("I prefer tea", memory.read_all()[0]["text"])
        with self.assertRaises(ValueError): memory.remember("")

    def test_memory_symlink_blocked(self):
        memory.ROOT.symlink_to(self.root)
        with self.assertRaises(ValueError): memory.remember("escape")

    def test_secret_settings_permissions(self):
        settings.save({"elevenlabs_key": "test-only-key"})
        self.assertEqual(settings.PATH.stat().st_mode & 0o777, 0o600)
        self.assertEqual(settings.load()["elevenlabs_key"], "test-only-key")


class ApiTests(Isolated):
    def handler(self, path, method="GET", payload=None, host=None, origin=True, token=True):
        h = object.__new__(main.Handler)
        h.path = path
        h.headers = {"Host": host or f"localhost:{main.PORT}", "Content-Type": "application/json"}
        if origin: h.headers["Origin"] = f"http://localhost:{main.PORT}"
        if token: h.headers["X-Jarvis-Token"] = main.TOKEN
        raw = json.dumps(payload or {}).encode()
        h.headers["Content-Length"] = str(len(raw))
        h.rfile = io.BytesIO(raw)
        result = {}
        h.send = lambda body, code=200, ctype="application/json": result.update(body=body, code=code)
        if method == "GET": h.do_GET()
        else: h.do_POST()
        return result

    def test_token_host_and_origin(self):
        self.assertEqual(self.handler("/api/status", token=False)["code"], 401)
        self.assertEqual(self.handler("/api/status", host="evil.example")["code"], 403)
        self.assertEqual(self.handler("/api/remember", "POST", {"fact": "x"}, origin=False)["code"], 403)

    def test_settings_never_return_key(self):
        settings.save({"elevenlabs_key": "test-only-key", "name": "sir"})
        output = self.handler("/api/settings")
        self.assertTrue(output["body"]["key_saved"])
        self.assertNotIn("test-only-key", json.dumps(output))

    def test_voice_requires_explicit_enable(self):
        with patch.object(voice, "speak") as speak:
            self.assertEqual(self.handler("/api/speak", "POST", {"text": "hello"})["code"], 400)
            speak.assert_not_called()

    def test_setup_without_secret(self):
        response = self.handler("/api/settings", "POST", {"name": "sir", "folders": []})
        self.assertEqual(response["code"], 200)
        self.assertTrue(settings.load()["setup_complete"])

    def test_static_traversal_blocked(self):
        self.assertEqual(self.handler("/../agent/main.py")["code"], 404)


class VoiceTests(Isolated):
    def test_scribe_multipart(self):
        settings.save({"elevenlabs_key": "test-only-key"})
        with patch.object(voice, "_request", return_value=b'{"text":"Hello sir"}') as request:
            self.assertEqual(voice.transcribe(b"fake-audio", "audio/webm;codecs=opus"), "Hello sir")
            path, body, mime = request.call_args.args
            self.assertEqual(path, "/v1/speech-to-text")
            self.assertIn(b"scribe_v1", body)
            self.assertIn(b"fake-audio", body)
            self.assertTrue(mime.startswith("multipart/form-data; boundary="))

    def test_invalid_audio_and_key(self):
        settings.save({"elevenlabs_key": "invalid\nheader"})
        with self.assertRaises(ValueError): voice.list_voices()
        with self.assertRaises(ValueError): voice.transcribe(b"audio", "text/html")
        with self.assertRaises(ValueError): voice.transcribe(b"")


class RuntimeTests(unittest.TestCase):
    def test_safe_cli_argument_disable(self):
        with patch.dict(os.environ, {"CODEX_CMD": "/fake/codex"}):
            command = runtime.codex_command(["node_repl"])
            self.assertIn("mcp_servers.node_repl.enabled=false", command)
            self.assertIn("features.shell_tool=false", command)
            research = runtime.codex_command(["node_repl"], allow_web=True)
            self.assertIn("web_search=live", research)
            self.assertIn("features.code_mode_host=true", research)
            self.assertIn("features.shell_tool=false", research)
            with self.assertRaises(RuntimeError): runtime.codex_command(["a.b"])

    def test_readonly_request_declines(self):
        class C:
            thread = "example"
            sent = []
            def send(self, msg): self.sent.append(msg)
        c = C()
        runtime._server_request(c, {"id": 1, "method": "item/commandExecution/requestApproval", "params": {"threadId": "example"}})
        self.assertEqual(c.sent[-1]["result"]["decision"], "decline")

    def test_unverified_config_fails_before_thread(self):
        class Fake:
            thread = turn = None
            called = []
            def call(self, method, params): self.called.append(method); return {"config": {}}
            def send(self, obj): pass
            def close(self): pass
        fake = Fake()
        with patch.object(runtime, "Client", return_value=fake):
            with self.assertRaisesRegex(RuntimeError, "read-only"):
                list(runtime.run("hello"))
        self.assertNotIn("thread/start", fake.called)


if __name__ == "__main__": unittest.main()
