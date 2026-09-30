"""Read-only assistant actions. Every result has a spoken line and a detail card."""
import re
from . import data,vault,settings


def result(tool,spoken,title,**card):
    return dict(tool=tool,spoken=spoken,card=dict(title=title,demo=data.demo(),**card))

def route(message):
    q=message.lower().strip()
    if re.match(r"^(?:/remember\b|remember that\b|remember this\b)",q):return "remember"
    if re.search(r"\b(brief me|morning brief|my calendar|my schedule|whats on today|what.s on today)\b",q):return "brief_me"
    if re.search(r"\b(plan my day|plan the day|what should i do|my priorities)\b",q):return "plan_day"
    if re.search(r"\b(inbox|unread|read my emails|who emailed)\b",q):return "read_inbox"
    if re.match(r"^(research|look up|search the web|find online)\b",q):return "research_web"
    if re.search(r"\b(how is|how.s|how are)\b.*\b(studio|agency|business|doing)\b|\b(revenue|paid this week|new clients)\b",q):return "business_summary"
    if re.match(r"^(hello|hi|hey|good morning|can you hear me|are you there|thank you|thanks|why|what about the second one)[?.! ]*$",q):return "conversation"
    return "search_brain" if vault.search(message,1) else "conversation"

def source_card(nodes):
    return [{"id":n["id"],"title":n["title"],"file":n["source"],"excerpt":n["snippet"][:380]} for n in nodes]

def execute(name,message):
    sir=settings.load().get("name","sir")
    if name=="remember":
        fact=re.sub(r"^(?:/remember\s*|remember (?:that|this)\s*)","",message,flags=re.I).strip()
        return result(name,"I have the note ready, "+sir+". Confirm it on screen before I save it.","Memory draft",kind="memory",fact=fact)
    if name=="search_brain":
        hits=vault.search(message)
        return result(name,f"I found {len(hits)} relevant notes, {sir}. The source files are on screen.","From your memory",kind="sources",sources=source_card(hits),highlights=[n["id"] for n in hits],context="\n\n".join(n["source"]+"\n"+n["body"][:2500] for n in hits))
    if name=="business_summary":
        f=data.fixtures()
        if f:
            clients=f["clients"];total=sum(c["paid"] for c in clients)
            hits=[n for n in vault.graph()["nodes"] if n["title"] in [c["name"] for c in clients]]
            return result(name,f"In the demo, three new clients and six thousand euros received, {sir}. Those are payments received, not total contract value.","Last 7 days · demo",kind="table",columns=["Client","Signed","Paid"],rows=[[c["name"],c["signed"],"€"+format(c["paid"],",")] for c in clients],total="€"+format(total,","),qualifier="Payments received, not contracted revenue. Fictional snapshot as of "+f["as_of"],sources=source_card(hits),highlights=[n["id"] for n in hits])
        hits=vault.search("invoice payment revenue")
        return result(name,"I will only use the amounts and qualifications in your source files, "+sir+".","Business source notes",kind="sources",sources=source_card(hits),highlights=[n["id"] for n in hits],context="\n\n".join(n["source"]+"\n"+n["body"] for n in hits))
    if name in ("read_inbox","brief_me","plan_day"):
        inbox,mail_source=data.account_data("inbox")
        calendar,calendar_source=data.account_data("calendar")
        if name=="read_inbox":
            if inbox is None:return result(name,"Your inbox is not connected, "+sir+". Add a read-only export in Settings.","Inbox not connected",kind="notice",body=mail_source)
            entries=[]; highlights=[]
            for entry in inbox[:8]:
                hits=vault.search(str(entry.get("client","") or entry.get("from","")),2)
                highlights += [n["id"] for n in hits]
                entries.append({"title":str(entry.get("from","Unknown sender"))+" · "+str(entry.get("subject","No subject")),"body":str(entry.get("summary","")),"match":hits[0]["title"] if hits else "No matching note"})
            label = "demo inbox" if data.demo() else "imported inbox snapshot"
            return result(name,f"{len(inbox)} messages in the {label}, {sir}. I have matched the senders against your notes.","Inbox · read only",kind="entries",entries=entries,source=mail_source,highlights=highlights)
        if name=="brief_me":
            entries=[{"title":str(e.get("time",""))+" · "+str(e.get("title","Untitled event")),"body":str(e.get("client",""))} for e in (calendar or [])[:5]]
            if inbox is not None:entries.append({"title":str(sum(bool(e.get("unread")) for e in inbox))+" unread in snapshot","body":"Inbox import; no messages have been sent."})
            if not entries:return result(name,"Calendar and inbox are not connected yet, "+sir+".","Your briefing",kind="notice",body="Add read-only calendar and inbox JSON exports in Settings. Your notes remain available.")
            return result(name,("Your demo day has two client calls and two unread messages, " if data.demo() else "Your imported schedule is on screen, ")+sir+". Check the source dates before acting.","Daily briefing",kind="entries",entries=entries,source=calendar_source+" · "+mail_source)
        tasks=data.fixtures().get("tasks",[])
        if not tasks:
            tasks=["Review "+str(e.get("title","the next event"))+" and its preparation notes." for e in (calendar or [])[:3]]
            tasks += ["Triage "+str(e.get("subject","the next unread message"))+"; draft any reply for review." for e in (inbox or []) if e.get("unread")][:2]
        if not tasks:return result(name,"I need your priorities or schedule to make a useful plan, "+sir+".","Plan your day",kind="notice",body="Tell Jarvis your goals, or add a calendar/inbox snapshot. No invented obligations.")
        return result(name,str(min(5,len(tasks)))+" suggested priorities, "+sir+". The client commitments come first; nothing has been scheduled or sent.","Suggested priorities",kind="list",items=tasks[:5],qualifier="Draft plan from "+("fictional demo data" if data.demo() else "imported snapshots")+". No calendar changes.")
    if name=="research_web":
        hits=vault.search(message,3)
        return result(name,"I will check current sources, "+sir+".","Web research",kind="research",query=message,body="Codex is checking the web. Sources will appear with the answer.",sources=source_card(hits),highlights=[n["id"] for n in hits],context="\n\n".join(n["source"]+"\n"+n["body"][:2500] for n in hits))
    return None

def fallback(message,history):
    sir=settings.load().get("name","sir")
    q=message.strip().lower()
    if re.search(r"hear|hello|^hi\b|^hey\b|morning|there",q):return "At your service, "+sir+". Local memory is ready; Codex is currently unavailable."
    if q in {"why?","why","what about the second one?","what about the second one"} and history:
        return "The previous answer is still in this conversation, "+sir+". I need Codex online to explain that follow-up."
    if "thank" in q:return "You are welcome, "+sir+"."
    return "I need Codex online for that, "+sir+". You can still search notes, view the demo briefing, or save a memory."
