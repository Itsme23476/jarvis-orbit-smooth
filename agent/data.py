"""The only reader of configured personal folders and imported account data."""
import json
import os
import pathlib
import shutil
import subprocess
from . import settings

ROOT = pathlib.Path(__file__).resolve().parent.parent
MAX_BYTES = 2 * 1024 * 1024
SKIP = {"node_modules", ".git", ".venv", "__pycache__", ".codex", ".agents"}

def demo():
    return os.environ.get("JARVIS_DEMO", "1").strip().lower() not in {"0", "false", "no", "off"}

def sources():
    if demo():return [ROOT / "data" / "notes"]
    return [pathlib.Path(p).expanduser().absolute() for p in settings.load().get("folders", [])]

def documents():
    found, warnings, seen = [], [], set()
    for root in sources():
        if root.is_symlink() or not root.is_dir():
            warnings.append(f"Folder unavailable: {root}");continue
        root = root.resolve()
        for current, dirs, files in os.walk(root, followlinks=False):
            dirs[:] = sorted(d for d in dirs if d not in SKIP and not d.startswith(".") and not pathlib.Path(current,d).is_symlink())
            for name in sorted(files):
                p = pathlib.Path(current,name)
                if name.startswith(".") or p.suffix.lower() not in {".md", ".txt", ".pdf"}:continue
                try:
                    if p.is_symlink() or not p.is_file() or p.stat().st_size > MAX_BYTES:continue
                    resolved = p.resolve()
                    if root != resolved and root not in resolved.parents:continue
                    if resolved in seen:continue
                    seen.add(resolved)
                    if p.suffix.lower() == ".pdf":
                        exe = shutil.which("pdftotext")
                        if not exe:
                            warnings.append(f"PDF skipped (pdftotext is not installed): {p.name}");continue
                        r = subprocess.run([exe,"-layout",str(p),"-"],capture_output=True,timeout=15)
                        if r.returncode:
                            warnings.append(f"PDF could not be read: {p.name}");continue
                        text = r.stdout[:MAX_BYTES].decode("utf-8","replace")
                    else:
                        with p.open("r",encoding="utf-8",errors="replace") as f:text=f.read(MAX_BYTES)
                    found.append({"path":str(p),"relative":str(p.relative_to(root)),"root":str(root),"text":text,"mtime":p.stat().st_mtime_ns})
                except (OSError, subprocess.TimeoutExpired):warnings.append(f"Unable to read: {p.name}")
    return found,warnings

def fixtures():
    if demo():return json.loads((ROOT/"data"/"fixtures.json").read_text())
    return {}

def account_data(kind):
    if kind not in {"inbox","calendar"}:raise ValueError("Unknown data source")
    if demo():return fixtures()[kind],"data/fixtures.json (fictional)"
    path=settings.load().get(kind+"_file","")
    if not path:return None,"Not connected. Add a read-only JSON export in Settings."
    p=pathlib.Path(path).expanduser()
    if p.is_symlink() or not p.is_file() or p.suffix.lower()!=".json" or p.stat().st_size>MAX_BYTES:raise ValueError("Choose a regular JSON file under 2 MB.")
    obj=json.loads(p.read_text())
    entries=obj.get(kind) if isinstance(obj,dict) else obj
    if not isinstance(entries,list):raise ValueError(f"The {kind} export must contain a list.")
    if not all(isinstance(x,dict) for x in entries):raise ValueError("Export entries must be objects.")
    return entries[:100],str(p.resolve())
