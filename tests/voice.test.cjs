const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const source = fs.readFileSync(require('node:path').join(__dirname, '../ui/app.js'), 'utf8');

function harness() {
  const elements = new Map();
  const element = key => {
    if (!elements.has(key)) elements.set(key, {content:'test-token', dataset:{}, textContent:'', hidden:true,
      classList:{add(){},remove(){},toggle(){}}, style:{}, setAttribute(){},querySelectorAll(){return [];}});
    return elements.get(key);
  };
  let now=1000, played=0, resolveFetch;
  class Recorder {
    constructor(){this.state='inactive';this.mimeType='audio/webm';}
    start(){this.state='recording';}
    stop(){this.state='inactive';this.ondataavailable?.({data:new Blob(['test'])});this.onstop?.();}
  }
  const context=vm.createContext({document:{querySelector:element,body:element('body')},window:{addEventListener(){}},
    performance:{now:()=>now}, navigator:{}, MediaRecorder:Recorder, Blob, AbortController, URL,
    Audio:class {constructor(){played++;}},
    fetch:()=>new Promise(resolve=>resolveFetch=resolve),setTimeout(){},clearTimeout(){},setInterval(){},clearInterval(){},console});
  vm.runInContext(source,context);
  return {run:s=>vm.runInContext(s,context),time:v=>now=v,played:()=>played,
    resolve:()=>resolveFetch({ok:true,blob:async()=>new Blob(['audio'])})};
}

test('silence completes a real-duration utterance once',()=>{
  const h=harness();h.run('Live.on=true;Live.level=()=>.1;Live.send=()=>{Live.sent=(Live.sent||0)+1};Live.tick()');
  h.time(1800);h.run('Live.tick()');h.time(2800);h.run('Live.level=()=>0;Live.tick()');
  assert.equal(h.run('Live.sent'),1);assert.equal(h.run('Live.armed'),false);
});

test('a short noise burst is discarded',()=>{
  const h=harness();h.run('Live.on=true;Live.level=()=>.1;Live.send=()=>{Live.sent=true};Live.tick()');
  h.time(1950);h.run('Live.level=()=>0;Live.tick()');
  assert.equal(h.run('Live.sent'),undefined);assert.equal(h.run('Live.armed'),false);
});

test('speaking suspends recording and prevents echo submission',()=>{
  const h=harness();h.run('Live.on=true;Live.level=()=>.1;Live.send=()=>{Live.sent=true};Live.tick();Live.speaking=true;Live.tick()');
  assert.equal(h.run('Live.armed'),false);assert.equal(h.run('Live.sent'),undefined);
});

test('cancelling a pending TTS response cannot start delayed playback',async()=>{
  const h=harness();h.run('status={voice:true,voice_enabled:true}');
  const pending=h.run('speak("Hello sir")');h.run('stopAudio()');h.resolve();await pending;
  assert.equal(h.played(),0);assert.equal(h.run('Live.speaking'),false);
});

test('mic shutdown stops every track and invalidates pending acquisition',()=>{
  const h=harness();h.run('Live.on=true;Live.stopped=0;Live.stream={getTracks:()=>[{stop:()=>Live.stopped++},{stop:()=>Live.stopped++}]};Live.disable()');
  assert.equal(h.run('Live.stopped'),2);assert.equal(h.run('Live.on'),false);assert.equal(h.run('Live.epoch'),1);
});
