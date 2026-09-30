"""Explicit, dated memory; writes only under this projects memory directory."""
import datetime
import os
import pathlib
import uuid

ROOT = pathlib.Path(__file__).resolve().parent.parent / "memory"

def remember(fact):
    if not isinstance(fact,str) or not fact.strip() or len(fact)>4000:raise ValueError("Enter one fact, up to 4,000 characters.")
    if ROOT.is_symlink():raise ValueError("Memory directory must not be a symlink.")
    ROOT.mkdir(exist_ok=True)
    day=datetime.date.today().isoformat()
    name=day+"-"+uuid.uuid4().hex[:10]+".md"
    p=ROOT/name
    fd=os.open(p,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
    with os.fdopen(fd,"w") as f:f.write(f"---\ntype: memory\ndate: {day}\n---\n\n{fact.strip()}\n")
    return {"filename":name,"fact":fact.strip(),"date":day}

def read_all():
    if ROOT.is_symlink():return []
    out=[]
    for p in sorted(ROOT.glob("*.md"))[-50:]:
        if p.is_symlink() or p.stat().st_size>10000:continue
        out.append({"path":str(p),"relative":"memory/"+p.name,"root":str(ROOT),"text":p.read_text(),"mtime":p.stat().st_mtime_ns})
    return out
