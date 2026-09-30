const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const source = fs.readFileSync(require('node:path').join(__dirname,'../ui/graph.js'),'utf8');

function graph(reduced=false) {
  const handlers={};
  const ctx=new Proxy({measureText:t=>({width:t.length*7})},{get:(o,k)=>k in o?o[k]:(()=>{})});
  const canvas={clientWidth:900,clientHeight:650,width:900,height:650,style:{},getContext:()=>ctx,
    addEventListener:(n,f)=>handlers[n]=f,setPointerCapture(){},getBoundingClientRect:()=>({left:0,top:0})};
  const window={devicePixelRatio:1,matchMedia:()=>({matches:reduced})};
  const context=vm.createContext({window,requestAnimationFrame(){},console});
  vm.runInContext(source,context);
  const g=new window.MemoryGraph(canvas);
  const data={nodes:Array.from({length:12},(_,i)=>({id:String(i),title:'Note '+i,type:i%2?'call':'note',degree:2,colour:'#4d88f4'})),
    links:Array.from({length:12},(_,i)=>({source:String(i),target:String((i+1)%12)}))};
  g.setData(data);
  return {g,data,handlers};
}
const camera=g=>[g.tx,g.ty,g.scale];

test('camera remains exactly fixed while nodes move for 30 seconds',()=>{
  const {g}=graph(),before=camera(g),position=[g.nodes[0].x,g.nodes[0].y];
  for(let f=0;f<=1800;f++)g._loop(f*1000/60);
  assert.deepEqual(camera(g),before);
  assert.notDeepEqual([g.nodes[0].x,g.nodes[0].y],position);
  for(const n of g.nodes){assert.ok(Math.abs(n.x-n.anchorX)<=4.001);assert.ok(Math.abs(n.y-n.anchorY)<=4.001);}
});

test('motion travels the same distance at 30, 60 and 120 Hz',()=>{
  const positions=[30,60,120].map(hz=>{const {g}=graph();for(let f=0;f<=hz*10;f++)g._loop(f*1000/hz);return [g.nodes[0].x,g.nodes[0].y];});
  for(const p of positions)for(let i=0;i<2;i++)assert.ok(Math.abs(p[i]-positions[0][i])<.00001);
});

test('activity, filters, refresh and highlighting never reframe the view',()=>{
  const {g,data}=graph();g.tx+=55;g.scale*=1.2;const before=camera(g),anchor=g.nodes[0].anchorX;
  g.setActivity(1);g.setFilter(new Set(['call']));g.highlight(['0']);g.setData(data);
  for(let f=0;f<=120;f++)g._loop(f*1000/60);
  assert.deepEqual(camera(g),before);assert.equal(g.nodes[0].anchorX,anchor);
});

test('returning from a background tab cannot jump nodes forward',()=>{
  const {g}=graph();g._loop(0);g._loop(2000);const elapsed=g.elapsed;
  g._loop(302000);assert.ok(g.elapsed-elapsed<=.050001);
});

test('a dragged node stays where released without snapping to its old anchor',()=>{
  const {g,handlers}=graph();g._animate(3);const n=g.nodes[0];
  const x=n.x*g.scale+g.tx,y=n.y*g.scale+g.ty;
  handlers.pointerdown({button:0,pointerId:1,clientX:x,clientY:y});
  assert.equal(g.drag.node,n);
  handlers.pointermove({clientX:x+60,clientY:y+25});
  const released=[n.x,n.y];handlers.pointerup({});g._animate(1/60);
  assert.ok(Math.hypot(n.x-released[0],n.y-released[1])<.1);
});

test('reduced motion leaves nodes fixed and disables travelling pulses',()=>{
  const {g}=graph(true),before=g.nodes.map(n=>[n.x,n.y]);
  for(let f=0;f<=180;f++)g._loop(f*1000/60);
  assert.deepEqual(g.nodes.map(n=>[n.x,n.y]),before);assert.equal(g.pulses.length,0);
});
