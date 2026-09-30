"""Read-only graph index, source-aware retrieval, and wikilink resolution."""
import collections
import hashlib
import re
import threading
import time
from . import data,memory

COLORS={"call":"#4d88f4","note":"#d5dce2","concept":"#f1c644","project":"#36b7e6","person":"#a77be8","client":"#29bb70","invoice":"#de6cad","proposal":"#edb33d","sop":"#ef9a50","brief":"#a8b4c7","campaign":"#838ba3","memory":"#76d2bc"}
CACHE={"at":0,"graph":None}
LOCK=threading.RLock()

def invalidate():CACHE["at"]=0

def graph(force=False):
    with LOCK:
        if not force and CACHE["graph"] and time.monotonic()-CACHE["at"]<5:return CACHE["graph"]
        docs,warnings=data.documents()
        docs+=memory.read_all()
        nodes=[]
        for d in docs:
            text=d["text"]
            meta={}
            match=re.match(r"\A---\s*\n(.*?)\n---\s*\n",text,re.S)
            if match:
                for ln in match[1].splitlines():
                    k,sep,v=ln.partition(":")
                    if sep:meta[k.strip()]=v.strip()
                text=text[match.end():]
            title=re.search(r"^#\s+(.+)",text,re.M)
            title=title[1].strip() if title else d["relative"].rsplit("/",1)[-1].rsplit(".",1)[0]
            kind=meta.get("type","note").lower()
            nid=hashlib.sha256((d["root"]+"/"+d["relative"]).encode()).hexdigest()[:16]
            nodes.append(dict(id=nid,title=title,type=kind,colour=COLORS.get(kind,"#91a8ba"),source=d["relative"],path=d["path"],root=d["root"],body=text.strip()[:18000],snippet=re.sub(r"\[\[([^\]|]+)(?:\|[^\]]+)?\]\]",r"\1",text).strip()[:650],degree=0,updated=meta.get("updated",meta.get("date",""))))
        aliases=collections.defaultdict(list)
        for n in nodes:
            aliases[n["title"].lower()].append(n)
            stem=n["source"].rsplit("/",1)[-1].rsplit(".",1)[0].lower()
            if stem!=n["title"].lower():aliases[stem].append(n)
        edges=set()
        for n in nodes:
            for title in re.findall(r"\[\[([^\]|#]+)(?:[|#][^\]]*)?\]\]",n["body"]):
                matches=aliases.get(title.lower(),[])
                same=[m for m in matches if m["root"]==n["root"]]
                matches=same or matches
                if len(matches)==1 and matches[0]["id"]!=n["id"]:edges.add(tuple(sorted([n["id"],matches[0]["id"]])))
        byid={n["id"]:n for n in nodes}
        for a,b in edges:byid[a]["degree"]+=1;byid[b]["degree"]+=1
        counts=collections.Counter(n["type"] for n in nodes)
        g=dict(nodes=nodes,links=[{"source":a,"target":b} for a,b in sorted(edges)],hubs=sorted(nodes,key=lambda n:(-n["degree"],n["title"]))[:10],counts=sorted(counts.items(),key=lambda kv:-kv[1]),total=len(nodes),warnings=warnings,demo=data.demo())
        CACHE.update(at=time.monotonic(),graph=g)
        return g

STOP={"what","which","that","this","with","from","have","does","about","your","please","could","would","show","tell","some","doing","does","there","they","their","them","hello","jarvis","how","our","the","and","are","for","you","can","me","my"}

def search(query,limit=6):
    words=[w for w in re.findall(r"\w+",query.lower()) if len(w)>2 and w not in STOP]
    if not words:return []
    results=[]
    for n in graph()["nodes"]:
        title=n["title"].lower();body=n["body"].lower()
        score=sum(5 if w in title else 1 if w in body else 0 for w in words)
        if score:results.append((score,n))
    results.sort(key=lambda v:(-v[0],-v[1]["degree"],v[1]["title"]))
    return [n for _,n in results[:limit]]
