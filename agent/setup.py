"""Private interactive setup. The key is never echoed or passed to Codex."""
import getpass
import shutil
import sys
from . import settings, voice


def main():
    if not sys.stdin.isatty():
        print("Open Jarvis Settings → Voice to enter your ElevenLabs API key privately.")
        return
    print("JARVIS ORBIT · Private setup")
    print("Codex: " + ("installed; uses your existing login" if shutil.which("codex") else "not found — install Codex and run codex login"))
    name = input("How should Jarvis address you? [sir]: ").strip() or "sir"
    business = input("What work do you do? [optional]: ").strip()
    context = input("Tools or personal context to remember? [optional]: ").strip()
    values = dict(name=name[:80], business=business[:4000], context=context[:4000], setup_complete=True)
    print("ElevenLabs powers listening and speech. Its usage consumes your account credits.")
    secret = getpass.getpass("ElevenLabs API key (hidden; Enter to set up later): ").strip()
    if secret:
        try:
            voices = voice.list_voices(secret)
            if not voices:
                raise ValueError("No voices available on this account")
            for index, item in enumerate(voices, 1):
                print(f"  {index}. {item['name']}")
            choice = int(input("Voice number [1]: ").strip() or "1")
            if choice < 1 or choice > len(voices):
                raise ValueError("Invalid voice number")
            consent = input("Enable paid ElevenLabs listening and speech? [y/N]: ").strip().lower() == "y"
            values.update(elevenlabs_key=secret, voice_id=voices[choice-1]["id"], voice_enabled=consent)
        except (ValueError, RuntimeError, OSError) as e:
            print("Voice setup incomplete: " + str(e))
            print("You can complete it in Settings → Voice.")
    settings.save(values)
    print("Saved privately. Run ./start.sh to open Jarvis. Demo mode stays on.")


if __name__ == "__main__":
    try:
        main()
    except (EOFError, KeyboardInterrupt):
        print("\nSetup cancelled. No new key saved.")
