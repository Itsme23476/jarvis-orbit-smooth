"use strict";
const SILENCE_MS = 900;
const MIN_SPEECH_MS = 300;
const MAX_SPEECH_MS = 20000;
const METER_INTERVAL_MS = 40;
const $ = s => document.querySelector(s);
const token = $("meta[name=jarvis-token]").content;
const headers = extra => Object.assign({"X-Jarvis-Token":token},extra||{});
const escapeHTML = value => String(value??"").replace(/[&<>"\x27]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","\x27":"&#39;"}[c]));
let graph, graphData, status={}, muted=false, busy=false, controller=null, answer="", activeAudio=null, audioDone=null, outputAnalyser=null, outputData=null, noticeTimer;
const hiddenTypes=new Set();
let settingsTab="profile";

async function get(path){const r=await fetch(path,{headers:headers()});const d=await r.json();if(!r.ok)throw new Error(d.error||"Request failed");return d;}
async function post(path,data){const r=await fetch(path,{method:"POST",headers:headers({"Content-Type":"application/json"}),body:JSON.stringify(data)});const d=await r.json();if(!r.ok)throw new Error(d.error||"Request failed");return d;}
function notice(text,sticky=false){clearTimeout(noticeTimer);$("#notice").textContent=text;$("#notice").hidden=false;if(!sticky)noticeTimer=setTimeout(()=>$("#notice").hidden=true,6500);}
function state(name,hint){document.body.dataset.state=name;$("#stateText").textContent={idle:"STANDBY",listening:"LISTENING",hearing:"HEARING YOU",transcribing:"TRANSCRIBING",thinking:"THINKING",speaking:"SPEAKING"}[name]||name;$("#stateHint").textContent=hint||{idle:"At your service, "+(status.name||"sir")+".",listening:"Just speak. I am listening.",hearing:"I am listening…",transcribing:"One moment, sir.",thinking:"Connecting the dots.",speaking:"A little clarity."}[name];if(graph)graph.setActivity(name==="thinking"?1:name==="speaking"?.35:0);}
function caption(text){$("#userCaption").textContent=text;$("#userCaption").hidden=!text;}
function showReply(text){answer=text;$("#spokenReply").textContent=text;$("#spokenReply").hidden=!text;}
function renderInspector(node,trace){
 if(!node){$("#inspectorType").textContent="";$("#inspector").innerHTML="<p class=muted>Click a node to focus it — only that node and its connections light up, and you can read its note here. Shift-click a second node to trace the path.</p>";return;}
 $("#inspectorType").textContent=node.type;
 $("#inspector").innerHTML="<h3>"+escapeHTML(node.title)+"</h3><div class=source>"+escapeHTML(node.source)+"</div><pre>"+escapeHTML(node.body)+"</pre>"+(trace?"<div class=source>PATH · "+trace.map(id=>escapeHTML(graph.byId.get(id)?.title||id)).join(" → ")+"</div>":"");
}
function focusNode(id){graph.setFocus(id,false);}
function renderLists(){
 $("#hubs").replaceChildren();
 graphData.hubs.slice(0,8).forEach(n=>$("#hubs").appendChild(nodeRow(n.title,n.degree,n.colour,()=>focusNode(n.id))));
 $("#filters").replaceChildren();
 graphData.counts.forEach(([type,count])=>{const n=graphData.nodes.find(n=>n.type===type);const li=nodeRow(type[0].toUpperCase()+type.slice(1),count,n.colour,()=>{hiddenTypes.has(type)?hiddenTypes.delete(type):hiddenTypes.add(type);graph.setFilter(hiddenTypes);renderLists();});if(hiddenTypes.has(type))li.firstChild.classList.add("off");$("#filters").appendChild(li);});
}
function nodeRow(name,count,color,onclick){const li=document.createElement("li"),b=document.createElement("button");b.type="button";b.innerHTML="<i class=dot style=\"--dot:"+color+"\"></i><span class=name>"+escapeHTML(name)+"</span><span class=count>"+count+"</span>";b.onclick=onclick;li.appendChild(b);return li;}
async function loadGraph(){graphData=await get("/api/graph");graph.setData(graphData);renderLists();$("#memoryCount").textContent=graphData.total+" NODES / "+graphData.links.length+" CONNECTIONS";$("#graphEmpty").hidden=graphData.total>0;$("#modeBadge").textContent=graphData.demo?"DEMO":"PERSONAL";if(graphData.warnings.length)notice(graphData.warnings[0],true);}
async function loadStatus(){try{status=await get("/api/status");const offline=status.model_online===false||status.codex==="unavailable";$("#modelBadge").classList.toggle("offline",offline);$("#modelBadge").textContent=offline?"MODEL UNAVAILABLE":status.model_online?"CODEX · CONNECTED":"CODEX · READY";$("#modelBadge").title=offline?(status.last_error||"Install Codex and sign in."):"Read-only Codex backend";if(!busy&&!Live.on)state("idle");}catch(e){notice("Local server unavailable. Restart Jarvis to reconnect.",true);}}
function renderCard(card){
 const box=document.createElement("article");box.className="detail-card";
 const h=document.createElement("h3");h.textContent=card.title;box.appendChild(h);
 if(card.kind==="table"){
  const table=document.createElement("table");table.innerHTML="<thead><tr>"+card.columns.map(v=>"<th>"+escapeHTML(v)+"</th>").join("")+"</tr></thead><tbody>"+card.rows.map(row=>"<tr>"+row.map(v=>"<td>"+escapeHTML(v)+"</td>").join("")+"</tr>").join("")+(card.total?"<tr><td colspan=2>Total received</td><td>"+escapeHTML(card.total)+"</td></tr>":"")+"</tbody>";box.appendChild(table);
 }else if(card.kind==="entries"){
  card.entries.forEach(e=>{const div=document.createElement("div");div.className="source-row";div.innerHTML="<strong>"+escapeHTML(e.title)+"</strong><p>"+escapeHTML(e.body)+"</p>"+(e.match?"<div class=card-meta>MEMORY MATCH · "+escapeHTML(e.match)+"</div>":"");box.appendChild(div);});
 }else if(card.kind==="list"){
  const ol=document.createElement("ol");card.items.forEach(t=>{const li=document.createElement("li");li.textContent=t;ol.appendChild(li);});box.appendChild(ol);
 }else if(card.kind==="memory"){
  const p=document.createElement("p");p.textContent=card.fact;box.appendChild(p);const b=document.createElement("button");b.className="secondary";b.textContent="Review & save";b.onclick=()=>openMemory(card.fact);box.appendChild(b);
 }else if(card.kind==="web"){
  card.links.forEach(link=>{try{const url=new URL(link.url);if(!["http:","https:"].includes(url.protocol))return;const p=document.createElement("p"),a=document.createElement("a");a.href=url.href;a.textContent=link.title;a.target="_blank";a.rel="noopener noreferrer";p.appendChild(a);box.appendChild(p);}catch(e){}});
 }else if(card.kind==="sources"){
  (card.sources||[]).forEach(n=>{const div=document.createElement("div");div.className="source-row";const b=document.createElement("button");b.textContent=n.title;b.onclick=()=>focusNode(n.id);div.appendChild(b);const p=document.createElement("p");p.textContent=n.excerpt;div.appendChild(p);const f=document.createElement("div");f.className="card-meta";f.textContent=n.file;div.appendChild(f);box.appendChild(div);});
 }else{const p=document.createElement("p");p.textContent=card.body||"";box.appendChild(p);}
 if(card.sources?.length&&card.kind!=="sources"){const tags=document.createElement("div");tags.className="tags";card.sources.forEach(n=>{const b=document.createElement("button");b.textContent=n.title;b.title=n.file;b.onclick=()=>focusNode(n.id);tags.appendChild(b);});box.appendChild(tags);}
 const meta=document.createElement("div");meta.className="card-meta";meta.textContent=[card.demo?"FICTIONAL DEMO":"READ-ONLY SOURCES",card.qualifier,card.source].filter(Boolean).join(" · ");box.appendChild(meta);
 $("#detailCards").appendChild(box);
 if(card.highlights)graph.highlight(card.highlights);
}
async function transmit(message){
 message=message.trim();if(!message)return;
 if(busy){notice("One thought at a time, sir. Press Esc to interrupt.");return;}
 stopAudio();busy=true;controller=new AbortController();caption(message);showReply("");$("#detailCards").replaceChildren();graph.highlight([]);state("thinking");let done=false,spoken="";
 try{
  const r=await fetch("/api/run",{method:"POST",headers:headers({"Content-Type":"application/json"}),body:JSON.stringify({message}),signal:controller.signal});
  if(!r.ok){const d=await r.json();throw new Error(d.error||"Codex request failed");}
  const reader=r.body.getReader(),decoder=new TextDecoder();let buffer="";
  while(true){const part=await reader.read();if(part.done)break;buffer+=decoder.decode(part.value,{stream:true});let nl;while((nl=buffer.indexOf("\n"))>=0){const line=buffer.slice(0,nl);buffer=buffer.slice(nl+1);if(!line)continue;const e=JSON.parse(line);
   if(e.t==="card")renderCard(e.card);
   if(e.t==="delta")showReply(answer+e.text);
   if(e.t==="answer")showReply(e.text);
   if(e.t==="error")throw new Error(e.message);
   if(e.t==="cancelled"){notice("Stopped, sir.");return;}
   if(e.t==="model_missing"){notice("Codex is unavailable. Local tools still work. "+e.message,true);$("#modelBadge").classList.add("offline");$("#modelBadge").textContent="MODEL UNAVAILABLE";}
   if(e.t==="done"){done=true;spoken=e.spoken||answer;}
  }}
  if(!done)throw new Error("The connection ended before Jarvis finished.");
  await loadStatus();
  if(spoken&&!muted&&status.voice&&status.voice_enabled)await speak(spoken);
 }catch(e){if(e.name!=="AbortError"){notice(e.message,true);showReply(e.message);}}
 finally{busy=false;controller=null;state(Live.on?"listening":"idle");Live.cooldown=performance.now()+300;}
}
function stopAudio(){speechGeneration++;speechController?.abort();speechController=null;Live.speaking=false;if(activeAudio){activeAudio.pause();activeAudio=null;}if(audioDone){audioDone();audioDone=null;}outputAnalyser=null;}
async function cancel(keepMic=false){stopAudio();if(controller)controller.abort();await post("/api/cancel",{}).catch(()=>{});if(!keepMic)Live.disable();state(Live.on?"listening":"idle");}
let audioContext, speechController=null, speechGeneration=0;
async function getAudioContext(){audioContext ||= new (window.AudioContext||window.webkitAudioContext)();if(audioContext.state==="suspended")await audioContext.resume();return audioContext;}
async function speak(text){
 if(!status.voice||!status.voice_enabled){notice("Connect ElevenLabs and enable voice in Settings.");return;}
 stopAudio();const generation=speechGeneration;const request=new AbortController();speechController=request;Live.speaking=true;state("speaking");
 try{
  const r=await fetch("/api/speak",{method:"POST",headers:headers({"Content-Type":"application/json"}),body:JSON.stringify({text}),signal:request.signal});if(!r.ok){const e=await r.json();throw new Error(e.error||"Speech unavailable");}
  const blob=await r.blob();if(generation!==speechGeneration)return;const url=URL.createObjectURL(blob),audio=new Audio(url);activeAudio=audio;
  const ctx=await getAudioContext();if(generation!==speechGeneration){URL.revokeObjectURL(url);return;}outputAnalyser=ctx.createAnalyser();outputAnalyser.fftSize=256;outputData=new Uint8Array(outputAnalyser.frequencyBinCount);ctx.createMediaElementSource(audio).connect(outputAnalyser);outputAnalyser.connect(ctx.destination);
  await new Promise((resolve,reject)=>{let settled=false;const end=(err)=>{if(settled)return;settled=true;URL.revokeObjectURL(url);activeAudio=null;audioDone=null;err?reject(err):resolve();};audioDone=()=>end();audio.onended=()=>end();audio.onerror=()=>end(new Error("Audio playback failed"));audio.play().catch(()=>end(new Error("Playback blocked. Press Test saved voice to enable audio.")));});
 }catch(e){if(e.name!=="AbortError")notice("Voice unavailable: "+e.message,true);}
 finally{if(generation===speechGeneration){speechController=null;Live.speaking=false;outputAnalyser=null;Live.cooldown=performance.now()+300;state(Live.on?"listening":"idle");}}
}
const Live={on:false,enabling:false,epoch:0,speaking:false,transcribing:false,armed:false,recorder:null,stream:null,analyser:null,samples:null,threshold:.018,cooldown:0,startTime:0,lastVoice:0,timer:null,
 async enable(){
  if(this.enabling||this.on)return;
  if(!status.voice||!status.voice_enabled){notice("Please enter your ElevenLabs API key in the Voice settings, sir.");await openSettings("voice");return;}
  if(!navigator.mediaDevices?.getUserMedia||!window.MediaRecorder){notice("This browser cannot record audio. Use a current browser on localhost.",true);return;}
  this.enabling=true;const epoch=++this.epoch;
  try{
   const stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true}});
   if(epoch!==this.epoch){stream.getTracks().forEach(t=>t.stop());return;}this.stream=stream;
   const ctx=await getAudioContext();this.analyser=ctx.createAnalyser();this.analyser.fftSize=1024;this.samples=new Uint8Array(this.analyser.fftSize);ctx.createMediaStreamSource(this.stream).connect(this.analyser);
   this.on=true;$("#micButton").classList.add("on");$("#micButton").setAttribute("aria-label","Stop listening");state("listening","Calibrating the room…");
   const samples=[];for(let i=0;i<15&&this.on;i++){samples.push(this.level());await new Promise(r=>setTimeout(r,45));}
   if(!this.on)return;samples.sort((a,b)=>a-b);this.threshold=Math.max(.012,(samples[Math.floor(samples.length/2)]||.005)*3);state("listening");
   this.timer=setInterval(()=>this.tick(),METER_INTERVAL_MS);
  }catch(e){if(epoch===this.epoch){this.disable();notice("Microphone unavailable: "+e.message,true);}}finally{if(epoch===this.epoch)this.enabling=false;}
 },
 level(){if(!this.analyser)return 0;this.analyser.getByteTimeDomainData(this.samples);let sum=0;this.samples.forEach(x=>sum+=((x-128)/128)**2);return Math.sqrt(sum/this.samples.length);},
 tick(){
  if(!this.on)return;const level=this.level();if(!this.speaking)drawBars(level*12);
  if(busy||this.speaking||this.transcribing||performance.now()<this.cooldown){if(this.armed)this.discard();return;}
  const now=performance.now();if(level>this.threshold)this.lastVoice=now;
  if(!this.armed){if(level>this.threshold)this.start(now);return;}
  if(now-this.startTime>MAX_SPEECH_MS||now-this.lastVoice>SILENCE_MS){if(now-this.startTime-SILENCE_MS>MIN_SPEECH_MS)this.finish();else this.discard();}
 },
 start(now){
  try{const chunks=[],rec=new MediaRecorder(this.stream);this.recorder=rec;rec.sendClip=false;
   rec.ondataavailable=e=>{if(e.data.size)chunks.push(e.data);};rec.onstop=()=>{if(rec.sendClip&&this.on)this.send(new Blob(chunks,{type:rec.mimeType}));};rec.start();this.armed=true;this.startTime=now;this.lastVoice=now;state("hearing");caption("Listening…");
  }catch(e){this.disable();notice("Recording failed: "+e.message,true);}
 },
 finish(){this.armed=false;this.transcribing=true;this.recorder.sendClip=true;state("transcribing");try{this.recorder.stop();}catch(e){this.transcribing=false;notice(e.message);}},
 discard(){this.armed=false;if(this.recorder)this.recorder.sendClip=false;try{if(this.recorder?.state==="recording")this.recorder.stop();}catch(e){}},
 async send(blob){try{const r=await fetch("/api/listen",{method:"POST",headers:headers({"Content-Type":blob.type||"audio/webm"}),body:blob});const d=await r.json();if(!r.ok)throw new Error(d.error||"Transcription failed");if(!this.on)return;const text=(d.text||"").trim();if(text){caption(text);await transmit(text);}else{caption("");state("listening");}}catch(e){notice("Transcription unavailable: "+e.message,true);}finally{this.transcribing=false;state(this.on?"listening":"idle");}},
 disable(){this.epoch++;this.enabling=false;this.on=false;this.discard();clearInterval(this.timer);this.stream?.getTracks().forEach(t=>t.stop());this.stream=null;this.analyser=null;$("#micButton").classList.remove("on");$("#micButton").setAttribute("aria-label","Start listening");drawBars(0);if(!busy)state("idle");}
};
function drawBars(level){$("#audioBars").querySelectorAll("i").forEach((b,i)=>{b.style.height=(2+Math.min(15,level*18*(.4+.6*Math.sin(i*1.8+performance.now()/130)**2)))+"px";});}
function buildReactor(){
 for(const [id,count,r1,r2]of [["outerTicks",72,111,106],["innerTicks",40,46,39]]){let s="";for(let i=0;i<count;i++){const a=i/count*Math.PI*2;const r=i%6===0?r2-3:r2;s+=`<line x1="${120+Math.cos(a)*r1}" y1="${120+Math.sin(a)*r1}" x2="${120+Math.cos(a)*r}" y2="${120+Math.sin(a)*r}" stroke="${id==="innerTicks"?"#96d4e5":"#8197a9"}" stroke-opacity="${i%6===0?.72:.4}" stroke-width="${id==="innerTicks"?1.4:1}"/>`;}$("#"+id).innerHTML=s;}
 $("#audioBars").innerHTML="<i></i>".repeat(9);
 setInterval(()=>{if(outputAnalyser){outputAnalyser.getByteFrequencyData(outputData);drawBars(outputData.reduce((a,b)=>a+b,0)/outputData.length/90);}else if(!Live.on)drawBars(0);},40);
}
function switchTab(tab){settingsTab=tab;document.querySelectorAll("[data-pane]").forEach(e=>e.hidden=e.dataset.pane!==tab);document.querySelectorAll("[data-tab]").forEach(e=>e.classList.toggle("active",e.dataset.tab===tab));}
async function openSettings(tab="profile"){
 try{const s=await get("/api/settings");$("#profileName").value=s.name;$("#profileBusiness").value=s.business;$("#profileContext").value=s.context;$("#sourceFolders").value=s.folders.join("\n");$("#sourceInbox").value=s.inbox_file;$("#sourceCalendar").value=s.calendar_file;$("#voiceKey").value="";$("#voiceKey").placeholder=s.key_saved?"Saved securely — blank keeps your key":"Enter your ElevenLabs API key";$("#voiceConsent").checked=s.voice_enabled;$("#voiceSelect").replaceChildren(new Option(s.key_saved?"Saved voice":"Connect ElevenLabs first",s.key_saved?s.voice_id:""));$("#sourceMode").textContent=s.demo?"Demo mode uses fictional files. Personal folders are untouched.":"Personal mode: only your selected sources are indexed, read-only.";$("#settingsStatus").textContent="";switchTab(tab);$("#settingsDialog").showModal();}catch(e){notice(e.message,true);}
}
function openMemory(fact=""){if(busy){notice("Finish or stop the current answer before saving memory.");return;}$("#memoryFact").value=fact;$("#memoryDialog").showModal();$("#memoryFact").focus();}
window.addEventListener("DOMContentLoaded",async()=>{
 buildReactor();graph=new MemoryGraph($("#graph"),{onSelect:renderInspector});window.jarvisGraph=graph;
 $("#askForm").onsubmit=e=>{e.preventDefault();const text=$("#ask").value;$("#ask").value="";transmit(text);};
 $("#fitButton").onclick=()=>{graph.highlight([]);graph.setFocus(null);graph.autoFit=true;graph.fit();};
 $("#labelsButton").onclick=()=>{$("#labelsButton").classList.toggle("active",graph.showLabels=!graph.showLabels);};
 $("#dimButton").onclick=()=>{$("#dimButton").classList.toggle("active",graph.dim=!graph.dim);};
 $("#resetFilters").onclick=()=>{hiddenTypes.clear();graph.setFilter(hiddenTypes);renderLists();};
 $("#micButton").onclick=async()=>{await getAudioContext().catch(()=>{});if(busy||Live.speaking){await cancel(true);return;}Live.on?Live.disable():Live.enable();};
 $("#muteButton").onclick=()=>{muted=!muted;$("#muteButton").classList.toggle("muted",muted);$("#muteButton").setAttribute("aria-label",muted?"Unmute speech":"Mute speech");if(muted)stopAudio();notice(muted?"Speech muted.":"Speech enabled.");};
 $("#briefButton").onclick=()=>transmit("Brief me");$("#planButton").onclick=()=>transmit("Plan my day");$("#memoryButton").onclick=()=>openMemory();
 $("#settingsButton").onclick=()=>openSettings();$("#emptySettings").onclick=()=>openSettings("sources");$("#closeSettings").onclick=()=>$("#settingsDialog").close();$("#closeMemory").onclick=()=>$("#memoryDialog").close();
 $("#settingsDialog").addEventListener("close",()=>$("#voiceKey").value="");
 document.querySelectorAll("[data-tab]").forEach(b=>b.onclick=()=>switchTab(b.dataset.tab));
 $("#loadVoices").onclick=async()=>{const b=$("#loadVoices");b.disabled=true;$("#settingsStatus").textContent="Checking ElevenLabs…";try{const d=await post("/api/voices",{key:$("#voiceKey").value.trim()});$("#voiceSelect").replaceChildren(...d.voices.map(v=>new Option(v.name,v.id)));$("#settingsStatus").textContent=d.voices.length?"Connected. Choose your voice, enable voice usage, then save.":"No voices available in this account.";}catch(e){$("#settingsStatus").textContent=e.message;}finally{b.disabled=false;}};
 $("#settingsForm").onsubmit=async e=>{e.preventDefault();const b=e.submitter;b.disabled=true;try{await post("/api/settings",{name:$("#profileName").value,business:$("#profileBusiness").value,context:$("#profileContext").value,folders:$("#sourceFolders").value.split("\n").map(x=>x.trim()).filter(Boolean),inbox_file:$("#sourceInbox").value,calendar_file:$("#sourceCalendar").value,key:$("#voiceKey").value.trim(),voice_id:$("#voiceSelect").value,voice_enabled:$("#voiceConsent").checked});$("#voiceKey").value="";$("#settingsDialog").close();await loadStatus();await loadGraph();notice("Preferences saved, "+(status.name||"sir")+".");}catch(err){$("#settingsStatus").textContent=err.message;}finally{b.disabled=false;}};
 $("#testVoice").onclick=async()=>{await loadStatus();await speak("At your service, "+(status.name||"sir")+". What would you like to work on?");};
 $("#memoryForm").onsubmit=async e=>{e.preventDefault();const b=e.submitter;b.disabled=true;try{const r=await post("/api/remember",{fact:$("#memoryFact").value});$("#memoryDialog").close();showReply(r.spoken);$("#detailCards").replaceChildren();renderCard({title:"Memory saved",kind:"notice",body:r.saved.fact,source:"memory/"+r.saved.filename});await loadGraph();if(!muted)await speak(r.spoken);}catch(err){notice(err.message,true);}finally{b.disabled=false;}};
 $("#modelBadge").onclick=()=>{if(status.thread)location.href="codex://threads/"+encodeURIComponent(status.thread);else notice(status.last_error||"Codex uses your existing sign-in. Send a greeting to connect.");};
 document.addEventListener("keydown",e=>{if($("#settingsDialog").open||$("#memoryDialog").open)return;if(e.key==="Escape"){cancel();graph.setFocus(null);graph.highlight([]);}if(e.code==="Space"&&!["INPUT","TEXTAREA","SELECT","BUTTON"].includes(document.activeElement.tagName)){e.preventDefault();$("#micButton").click();}});
 const examples=["“How is the studio doing?”","“What do I know about Filect?”","“Brief me.”","“What should I focus on today?”"];let index=0;setInterval(()=>{if(!$("#ask").value&&document.activeElement!==$("#ask"))$("#ask").placeholder=examples[++index%examples.length];},6000);
 try{await loadGraph();await loadStatus();if(!status.setup_complete)notice("Welcome, sir. Set up your ElevenLabs API key in Settings → Voice, or use the hidden terminal installer.");}catch(e){notice(e.message,true);}setInterval(loadStatus,20000);
});
