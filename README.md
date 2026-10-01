# JARVIS · Orbit Smooth

A separate voice assistant with a living canvas memory graph, a rotating reactor,
source cards, and a Codex conversation backend. Inspired by the supplied Jarvis
reference screenshots. Addresses you as **sir** by default.

This edition keeps the view still while the graph breathes. Nodes drift gently
around settled positions, with animation timing independent of screen refresh
rate. There is no automatic zoom or recentering during idle motion, filtering,
replies, or data refreshes. Fit, manual pan/zoom, and an actual window resize can
still change the view. Dragged nodes stay where you place them. Labels and the
inspector panel keep stable positions, and reactor rotation stays continuous
when assistant activity changes.

## Start

Using a fresh Codex session? Copy the [installation prompt](INSTALL_PROMPT.md).
Private repositories require an authorized GitHub login; anonymous cloning only
works after the owner makes the repository public.

Requires Python **3.9+**, an installed Codex CLI signed in with `codex login`,
and a current browser with microphone access on localhost. No Python packages,
JavaScript packages, database, or build step.

```sh
./start.sh
```

On the first terminal launch, setup asks how to address you, optional business
context, and your **ElevenLabs API key using hidden input**. You can skip voice
and use text immediately. Setup lists your available voices and asks you to
enable credit-consuming voice use. Re-run setup any time with `./setup.sh`.
When launched without an interactive terminal, Settings → Voice asks for the key.

Open **http://localhost:8740**. It is independent of other Jarvis projects and
does not modify them. Change `JARVIS_PORT` if needed. On Windows, use
`python -m agent.setup` and `python -m agent.main` instead of the shell scripts.

## What works

- 130 fictional notes with 484 wiki-link connections and a fixed-seed generator.
- Canvas force layout with a spatial grid, breathing motion, link pulses,
  non-overlapping labels, focus, drag/pan, zoom, type filters, and shortest paths.
- Click a node to read its note. Shift-click another to trace a path. Double-click
  the graph or choose Fit to reset. Ask from the bottom bar.
- Codex conversations with recent context, note retrieval with source cards,
  optional web research, inbox matching, briefings, and suggested priorities.
- Press the microphone once for turn-taking. Speech ends after about 900ms of
  silence. ElevenLabs Scribe transcribes the recording; ElevenLabs speaks replies.
- Audio bars reflect actual mic/playback levels. Mic input is suspended while
  Jarvis thinks or speaks. Mic, Space, or Esc interrupts; Esc also turns listening off.
- Explicit memory preview and save: one dated Markdown file per confirmed fact.
- Missing model, mic permissions, and voice errors appear on screen.

There is no browser Web Speech fallback. Captions show “Listening…” during a
recording and the transcript after silence; word-by-word streaming transcription
is not implemented. Browser microphone support and background recording behavior
vary, especially on mobile.

## Codex connection

The server starts `codex app-server` using your existing Codex login, streams
replies, and resumes its task during the current server session. No separate
OpenAI API key is required. The Codex badge opens the associated task through
the desktop app's task link. This is a Codex backend integration, not screen
automation of the app and not control of other existing Codex tasks.

This version follows the supplied brief's **read-only assistant** rules. Shell,
file-editing access, hooks, apps, plugins, subagents, and inherited MCP servers
are disabled before a model turn; effective configuration is checked and unsafe
or incompatible settings cause a visible failure. Only explicitly requested web
research enables Codex web search. Original source files cannot be changed via
the assistant. It does not execute arbitrary coding tasks or send messages.

Codex API compatibility can vary with CLI version. If the badge says unavailable,
check the displayed reason, `codex login status`, and `codex app-server --help`.
An inherited MCP name containing characters other than letters, digits, `_`, or
`-` is refused; use a clean Codex configuration in that case.

## Your data

The default `JARVIS_DEMO=1` reads only the included invented business fixtures
plus facts you explicitly save in this project's memory folder. Demo dates are a
fixed snapshot, never today's live business results. Do not include private
memories in a screen recording.

To opt into personal files:

1. Add selected folder paths in Settings → Memory sources.
2. Copy `.env.example` to `.env`, change `JARVIS_DEMO=0`, and restart.

Only `agent/data.py` reads that switch and your configured external data. It
indexes Markdown and text recursively, skipping hidden folders, `.git`,
`node_modules`, symlinks, and files over 2 MB. PDF extraction uses `pdftotext`
only if already installed; otherwise a visible warning explains that PDFs were
skipped. Nothing is installed automatically. Scanned PDFs need OCR elsewhere.

Inbox/calendar support is **read-only JSON imports**, not live Gmail or Calendar
authentication. In Settings, select existing exports using these shapes:

```json
{"inbox":[{"from":"Example client","subject":"Review","summary":"Please review the draft.","client":"Example client","unread":true}]}
```

```json
{"calendar":[{"time":"10:00","title":"Client review","client":"Example client"}]}
```

Personal priorities are derived from the imported schedule and unread messages;
the app does not infer revenue rankings when those facts are absent. Sources
and their snapshot status are displayed. It never sends or changes calendar data.

`PROFILE.md` is the generic starting persona. Put private business/context details
in Settings; do not publish them in that file. Explicitly saved facts live in
`memory/`, are searchable, and are included in conversational context. The last
ten exchanges are held in server memory. Codex separately retains its task
according to your Codex account/settings.

## Credentials, privacy, and costs

Settings are written atomically to `.jarvis.local.json` with owner-only
permissions on POSIX. That file, `.env`, and memory files are gitignored. The
server never returns a saved API key or passes it to the Codex subprocess.
The terminal installer keeps the key out of the browser. If you choose the
masked browser setup field, the key necessarily travels from that form to the
localhost server; it is cleared afterward and never saved in browser storage.

Requests stay on a loopback-only server with Host/Origin checks and a per-launch
request token. This is a single-user local app, not a service to expose publicly.
Relevant notes/profile and conversation are sent to Codex to answer requests.
Voice sends recordings and spoken reply text to ElevenLabs. Web research uses
Codex's web provider. The server stores no audio recordings.

Text uses your existing Codex plan/limits. Voice consumes ElevenLabs STT/TTS
credits under your account's current plan; there are no purchases or top-ups in
this app. Listing voices validates the key; recording and speaking only occur
after you enable voice. Exact charges depend on your provider plan and usage.
Keep voice disabled for a text-only demo. Live ElevenLabs playback requires your
own key; no key is bundled.

## Development

```sh
python3 data/generate.py
python3 -m unittest discover -s tests -v
node --check ui/app.js
node --check ui/graph.js
node --test tests/graph.test.cjs tests/voice.test.cjs
```

`JARVIS_OPEN=0` suppresses automatic browser opening. `JARVIS_MODEL` overrides
the Codex default. `JARVIS_TIMEOUT` controls the idle connection timeout.
`SILENCE_MS` at the top of `ui/app.js` tunes voice turn completion.

Graph code derives from this account's earlier Jarvis Codex project; the Orbit
interface, local data/tool layer, setup, and read-only adapter are separate.
