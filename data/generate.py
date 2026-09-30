"""Rebuild fictional demo notes with a fixed seed; never reads personal files."""
import json
import pathlib
import random

ROOT = pathlib.Path(__file__).resolve().parent

def generate():
    rng = random.Random(23476)
    notes = ROOT / "notes"
    notes.mkdir(exist_ok=True)
    clients = ["Fairview Dental", "Copper & Rye", "Halden Physio", "Northbeam Automation", "Harbour Accounting", "Kestrel Logistics", "Lumen Fitness", "Vantage Property", "Orchard Legal"]
    people = ["Priya Raman", "Sam Okafor", "Nadia Bell", "Ines Duarte", "Callum Reid", "Farrah Nasser", "Tom Rivers", "Dee Whitlock", "Marcus Feld", "Yasmin Choudhury"]
    concepts = ["Margin model", "Reusable components", "Lead qualification", "Discovery call", "Handover pack", "Pricing floor", "Capacity planning", "Fixed price", "Scope creep", "Positioning", "Retainer motion", "Client onboarding", "Component library", "Automation audit", "Change orders", "Outbound campaign"]
    projects = ["Filect", "Northbeam reporting stack", "Fairview recall engine", "Copper & Rye stock alerts", "Halden intake forms", "Harbour year-end pack", "Kestrel quote engine", "Lumen member winback", "Vantage viewing scheduler", "Orchard intake automation", "Component library v3"]
    sops = ["SOP — Automation build", "SOP — Handover", "SOP — Discovery call", "SOP — Invoicing", "SOP — Weekly review", "SOP — Change order"]
    anchors = projects[:1] + sops[:2] + concepts[:5]
    all_notes = []
    def add(title, kind, body, links):
        links = list(dict.fromkeys(x for x in links if x != title))
        text = f"---\ntype: {kind}\nupdated: 2026-10-01\nsample: true\n---\n\n# {title}\n\n{body}\n\n" + " · ".join(f"[[{x}]]" for x in links) + "\n"
        (notes / (title + ".md")).write_text(text, encoding="utf-8")
        all_notes.append(title)
    for i, c in enumerate(clients):
        add(c, "client", "Fictional demonstration client for a small automation studio. This is sample data, not a real account.", [projects[i+1], people[i], *rng.sample(anchors, 3)])
    for i,p in enumerate(projects):
        add(p,"project", "Example automation project. Delivery requires a clear brief, an owner, and a documented handover.", [clients[i%len(clients)], *rng.sample(anchors, 4)])
    for p in people:
        add(p,"person", "Fictional team member or client contact. Sam is assigned to the Northbeam handover in the demo schedule.", rng.sample(clients+anchors,4))
    for p in concepts:
        add(p,"concept", "A sample operating principle: scope the work carefully, document assumptions, and review the margin before committing.", rng.sample(anchors+projects,4))
    for p in sops:
        add(p,"sop", "Example checklist: confirm scope, assign the owner, record the decision, and prepare the handover.", rng.sample(anchors+projects,5))
    for i in range(38):
        c = clients[i%len(clients)]
        add(f"Call {i+1:02d} — {c}","call",f"Demo call with {c}. Review progress, clarify the next milestone, and capture any scope changes.",[c,people[i%len(people)],*rng.sample(anchors,2)])
    for i in range(19):
        add(f"Note {i+1:02d} — Delivery insight","note","A fictional observation: reusable components reduce delivery effort when the acceptance criteria stay clear.",rng.sample(concepts+anchors,3))
    for i,c in enumerate(clients):
        add(f"Invoice {2601+i} — {c}","invoice","Fictional invoice. Never infer a discount from a partial payment; check project stage and the original invoice.",[c,"SOP — Invoicing","Margin model"])
        add(f"Proposal — {c}","proposal","Illustrative proposal only. Scope and commercial terms must be confirmed before work starts.",[c, "Pricing floor", "Filect"])
    add("Brief — Automation audit","brief","A sample two-week audit with findings, priorities, and a short implementation plan.",["Automation audit","Filect","Reusable components"])
    add("Brief — Growth package","brief","An illustrative recurring service, with clear boundaries around support and delivery.",["Retainer motion","Margin model","Filect"])
    add("Campaign — Autumn outbound","campaign","Fictional outreach campaign. Copper & Rye is linked to this demo source.",["Copper & Rye","Outbound campaign","Lead qualification"])
    fixtures = {
        "as_of":"2026-10-01", "currency":"EUR",
        "clients":[{"name":n,"signed":d,"paid":p,"qualification":"Payment received; demo record, not total contract value."} for n,d,p in [("Fairview Dental","2026-09-30",2400),("Copper & Rye","2026-09-28",2100),("Halden Physio","2026-09-26",1500)]],
        "inbox":[{"from":"Priya Raman","subject":"Fairview handover notes","summary":"Please review the draft runbook before our call.","client":"Fairview Dental","unread":True},{"from":"Ines Duarte","subject":"Kestrel audit scope","summary":"Can the quote separate discovery from implementation?","client":"Kestrel Logistics","unread":True}],
        "calendar":[{"time":"10:00","title":"Fairview handover review","client":"Fairview Dental"},{"time":"14:00","title":"Kestrel discovery call","client":"Kestrel Logistics"}],
        "tasks":["Review the Kestrel audit scope before the discovery call.","Check the Fairview handover runbook.","Clarify Sams capacity before committing to new work.","Review outstanding invoice terms.","Protect a ninety-minute delivery block."]
    }
    (ROOT/"fixtures.json").write_text(json.dumps(fixtures,indent=2)+"\n")
    print(f"Generated {len(all_notes)} fictional notes with seed 23476.")

if __name__ == "__main__":generate()
