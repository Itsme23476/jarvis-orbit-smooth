# Jarvis Orbit

This is a separate, local, read-only voice assistant. Use Python standard library
and vanilla browser JavaScript. Do not install packages without the user's request.

When asked to install or configure it, ask the user to enter their ElevenLabs
API key through `./setup.sh` (hidden terminal input) or Settings → Voice.
Do not ask them to paste a secret in chat or put one in a command argument.
Explain that voice uses their ElevenLabs credits and let them enable it.
Ask how they want to be addressed and what work, tools, and personal context
they want to provide. These details are optional and private.

Keep demo mode on unless the user opts into their folders. `agent/data.py` is the
only reader of selected external data. No source-folder writes, external sends,
or purchases. Memory saves require an explicit preview and confirmation.
Do not weaken the Codex runtime's fail-closed configuration verification.

Never commit `.env`, `.jarvis.local.json`, saved memories, conversation data, or
personal source files. Test with temporary directories and fictional fixtures.

Verification: `python3 -m unittest discover -s tests -v`, `node --check ui/app.js`,
`node --check ui/graph.js`, and `node --test tests/voice.test.cjs`. Run from this directory.
