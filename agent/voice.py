"""Server-side ElevenLabs Scribe transcription and speech synthesis."""
import json
import os
import re
import urllib.error
import urllib.request
from urllib.parse import quote
from . import settings

API = "https://api.elevenlabs.io"
DEFAULT_VOICE = "JBFqnCBsd6RMkjVDRZzb"
MODEL = os.environ.get("ELEVENLABS_MODEL", "eleven_multilingual_v2")
STT_MODEL = os.environ.get("ELEVENLABS_STT_MODEL", "scribe_v1")


def key():
    return settings.load().get("elevenlabs_key", "") or os.environ.get("ELEVENLABS_API_KEY", "").strip()


def voice_id():
    return settings.load().get("voice_id") or os.environ.get("ELEVENLABS_VOICE_ID", "").strip() or DEFAULT_VOICE


def available():
    return bool(key())


def describe():
    return "ElevenLabs · " + MODEL if available() else "Voice not configured — open Setup"


def _request(path, payload=None, content_type="application/json", api_key=None):
    secret = api_key if api_key is not None else key()
    if not isinstance(secret,str) or len(secret)>500 or any(c in secret for c in "\r\n\0"):
        raise ValueError("Invalid API key format")
    if not secret:
        raise ValueError("Enter your ElevenLabs API key in Setup first.")
    req = urllib.request.Request(API + path, data=payload,
        headers={"xi-api-key": secret, "Content-Type": content_type})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return r.read()
    except urllib.error.HTTPError as e:
        # Provider response bodies can contain sensitive request data.
        hints = {401: "Invalid API key.", 403: "Your key needs permission for this feature.",
                 402: "Insufficient ElevenLabs credits.", 429: "Rate limit or quota reached."}
        raise RuntimeError(f"ElevenLabs HTTP {e.code}. " + hints.get(e.code, "The voice service could not complete the request.")) from None
    except urllib.error.URLError:
        raise RuntimeError("Could not reach ElevenLabs. Check your internet connection.") from None


def list_voices(api_key=None):
    data = json.loads(_request("/v2/voices?page_size=100", api_key=api_key))
    return [{"id": v["voice_id"], "name": v.get("name", v["voice_id"])} for v in data.get("voices", [])]


def speak(text):
    if not isinstance(text, str) or not text.strip():
        raise ValueError("Enter some text to speak.")
    text = re.sub(r"\[([^\]]+)\]\(https?://[^\s)]+\)", r"\1", text)
    text = re.sub(r"https?://\S+", "", text).replace("**", "").replace("`", "")
    # Stage directions are not supported by this TTS model.
    text = re.sub(r"\[[^\]\[]{1,90}\]", "", text).strip()
    body = json.dumps({"text": text[:5000], "model_id": MODEL}).encode()
    return _request("/v1/text-to-speech/" + quote(voice_id(), safe="") + "?output_format=mp3_44100_128", body)


def stt_kind():
    return "elevenlabs" if available() else "unavailable"


def describe_stt():
    return "ElevenLabs Scribe" if available() else "Set up ElevenLabs to enable listening"


def transcribe(audio, mime="audio/webm"):
    if not audio:
        raise ValueError("Empty audio recording")
    if stt_kind() == "unavailable":
        raise ValueError("Listening is not configured. Open Setup.")
    mime = mime.split(";")[0].strip().lower()
    exts = {"audio/webm": "webm", "audio/ogg": "ogg", "audio/mp4": "mp4", "audio/mpeg": "mp3", "audio/wav": "wav"}
    if mime not in exts:
        raise ValueError("Unsupported audio format")
    boundary = "----jarvis" + os.urandom(16).hex()
    fields = {"model_id": STT_MODEL, "tag_audio_events": "false", "diarize": "false"}
    body = b""
    for name, value in fields.items():
        body += (f'--{boundary}\r\nContent-Disposition: form-data; name="{name}"\r\n\r\n{value}\r\n').encode()
    body += (f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="turn.{exts[mime]}"\r\nContent-Type: {mime}\r\n\r\n').encode()
    body += audio + f"\r\n--{boundary}--\r\n".encode()
    data = json.loads(_request("/v1/speech-to-text", body, "multipart/form-data; boundary=" + boundary))
    return str(data.get("text", "")).strip()
