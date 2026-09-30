/* Force-directed memory graph on canvas.
   No libraries — the whole point is that this file is readable and the vault it
   draws is a real folder of markdown, not a demo animation. */
(function (global) {
  'use strict';

  /* #rrggbb -> rgba() without allocating a canvas gradient per edge per frame. */
  var HEXCACHE = {}, HEXCOUNT = 0;
  function hexA(hex, a) {
    var key = hex + '|' + a.toFixed(3);
    if (HEXCACHE[key]) return HEXCACHE[key];
    var n = parseInt((hex || '#8fa3bf').slice(1), 16);
    var out = 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')';
    if (HEXCOUNT < 900) { HEXCACHE[key] = out; HEXCOUNT++; }
    return out;
  }

  function MemoryGraph(canvas, opts) {
    this.cv = canvas;
    this.ctx = canvas.getContext('2d');
    this.opts = opts || {};
    this.nodes = [];
    this.links = [];
    this.byId = new Map();
    this.adj = new Map();
    this.hidden = new Set();          // filtered-out types
    this.focus = null;                // focused node id
    this.trace = null;                // [ids] shortest path
    this.showLabels = true;
    this.dim = false;
    this.tx = 0; this.ty = 0; this.scale = 1;
    this.elapsed = 0;
    this.lastFrame = null;
    this.motionLevel = 0;
    this.nextPulse = 2;
    this.reducedMotion = !!(global.matchMedia && global.matchMedia("(prefers-reduced-motion: reduce)").matches);
    // Layout constants, kept together so the cloud can be retuned in one place.
    this.p = {
      repulsion: 3200,     // node-node push, falls off with distance squared
      alphaFloor: 0.05,    // settling solver temperature floor
      activity: 0,         // target for smoothly eased visual activity
      reach: 160,          // ignore pairs further apart than this
      spring: 0.035,       // link pull toward its rest length
      rest: 78,            // rest length before radii
      centre: 0.0026,      // drift toward the middle
      damping: 0.82
    };
    this.alpha = 1;                   // simulation temperature
    this.drag = null; this.panning = null; this.hover = null;
    this.pulses = [];    // packets of light travelling along edges
    this._bind();
    this._needsFit = false;
    this._loop = this._loop.bind(this);
    if (global.ResizeObserver) {
      var self = this;
      new ResizeObserver(function () {
        // Only a real viewport resize may reframe the graph. Never follow nodes.
        if (self.nodes.length) self.fit();
      }).observe(canvas);
    }
    requestAnimationFrame(this._loop);
  }

  MemoryGraph.prototype.setData = function (data) {
    var prev = new Map(this.nodes.map(function (n) { return [n.id, n]; }));
    var W = this.cv.clientWidth || 900, H = this.cv.clientHeight || 600;
    var spread = Math.min(W, H) * 0.42 || 260;
    this.nodes = data.nodes.map(function (n, i) {
      var old = prev.get(n.id);
      // golden-angle spiral: an even starting cloud, so the sim only has to
      // relax it rather than untangle a knot at the origin.
      var ang = i * 2.39996;
      var rad = spread * Math.sqrt((i + 1) / data.nodes.length);
      return Object.assign({}, n, {
        x: old ? old.x : W / 2 + Math.cos(ang) * rad,
        y: old ? old.y : H / 2 + Math.sin(ang) * rad,
        anchorX: old ? old.anchorX : null, anchorY: old ? old.anchorY : null,
        vx: 0, vy: 0, opacity: old ? old.opacity : 1, hoverAmount: 0,
        phase: (i * 1.7) % (Math.PI * 2),   // unique drift offset per node
        wob: 0.55 + ((i * 37) % 100) / 140, // and a slightly different speed
        r: 4.5 + Math.min(25, Math.sqrt(n.degree || 0) * 3.3)
      });
    });
    this.byId = new Map(this.nodes.map(function (n) { return [n.id, n]; }));
    var self = this;
    this.links = data.links.filter(function (l) {
      return self.byId.has(l.source) && self.byId.has(l.target);
    }).map(function (l) {
      return { s: self.byId.get(l.source), t: self.byId.get(l.target) };
    });
    this.adj = new Map();
    this.nodes.forEach(function (n) { self.adj.set(n.id, []); });
    this.links.forEach(function (l) {
      self.adj.get(l.s.id).push(l.t.id);
      self.adj.get(l.t.id).push(l.s.id);
    });
    this.alpha = 1;
    if (!prev.size) {
      this.warmup(this.nodes.length > 500 ? 40 : 480);
      this.nodes.forEach(function(n) { n.anchorX=n.x; n.anchorY=n.y; });
      this.fit();
    } else {
      // Refreshes keep the existing layout and camera, including dragged nodes.
      this.nodes.forEach(function(n) {
        if (n.anchorX !== null) return;
        var neighbours=(self.adj.get(n.id)||[]).map(function(id){return self.byId.get(id);}).filter(function(v){return prev.has(v.id);});
        if(neighbours.length) {
          n.x=neighbours.reduce(function(sum,v){return sum+v.anchorX;},0)/neighbours.length+Math.cos(n.phase)*70;
          n.y=neighbours.reduce(function(sum,v){return sum+v.anchorY;},0)/neighbours.length+Math.sin(n.phase)*70;
        }
        n.anchorX=n.x;n.anchorY=n.y;
      });
    }
    this._labelKey=null;
  };

  /* Run the simulation off-screen so the first frame the user sees is already
     settled, instead of watching 133 nodes crawl apart. */
  MemoryGraph.prototype.warmup = function (steps) {
    for (var i = 0; i < steps; i++) this._tick();
  };

  MemoryGraph.prototype.relayout = function (steps) {
    var W = this.cv.clientWidth || 900, H = this.cv.clientHeight || 600;
    var spread = Math.min(W, H) * 0.42 || 260, n = this.nodes.length;
    this.nodes.forEach(function (nd, i) {
      var ang = i * 2.39996, rad = spread * Math.sqrt((i + 1) / n);
      nd.x = W / 2 + Math.cos(ang) * rad; nd.y = H / 2 + Math.sin(ang) * rad;
      nd.vx = nd.vy = 0;
    });
    this.alpha = 1;
    this.warmup(steps || 480);
    this.nodes.forEach(function(n){n.anchorX=n.x;n.anchorY=n.y;});
    this.fit();
    return this.span();
  };

  MemoryGraph.prototype.span = function () {
    var vis = this.nodes.filter(this.visible, this);
    var xs = vis.map(function (n) { return n.anchorX == null ? n.x : n.anchorX; }).sort(function (a, b) { return a - b; });
    var ys = vis.map(function (n) { return n.anchorY == null ? n.y : n.anchorY; }).sort(function (a, b) { return a - b; });
    var c = Math.floor(xs.length * 0.03);
    return {
      w: Math.round(xs[xs.length - 1 - c] - xs[c]),
      h: Math.round(ys[ys.length - 1 - c] - ys[c]),
      scale: +this.scale.toFixed(2)
    };
  };

  MemoryGraph.prototype.visible = function (n) { return !this.hidden.has(n.type); };

  MemoryGraph.prototype.setFilter = function (hiddenTypes) {
    this.hidden = new Set(hiddenTypes);
    this._labelKey=null; // Filtering changes visibility, never the camera.
  };

  MemoryGraph.prototype.setFocus = function (id, additive) {
    if (!id) { this.focus = null; this.trace = null; this._emit(null); return; }
    id = String(id).toLowerCase();
    if (!this.byId.has(id)) return false;
    if (additive && this.focus && this.focus !== id) {
      this.trace = this._path(this.focus, id);
    } else {
      this.focus = id; this.trace = null;
    }
    this._emit(this.byId.get(id));
    return true;
  };

  MemoryGraph.prototype._emit = function (node) {
    if (this.opts.onSelect) this.opts.onSelect(node, this.trace);
  };

  /* BFS shortest path, so "shift-click to trace" means something real. */
  MemoryGraph.prototype._path = function (a, b) {
    var prev = new Map([[a, null]]), queue = [a];
    while (queue.length) {
      var cur = queue.shift();
      if (cur === b) break;
      var nbrs = this.adj.get(cur) || [];
      for (var i = 0; i < nbrs.length; i++) {
        if (!prev.has(nbrs[i])) { prev.set(nbrs[i], cur); queue.push(nbrs[i]); }
      }
    }
    if (!prev.has(b)) return null;
    var path = [], step = b;
    while (step) { path.unshift(step); step = prev.get(step); }
    return path;
  };

  MemoryGraph.prototype._neighbours = function (id) {
    var set = new Set([id]);
    (this.adj.get(id) || []).forEach(function (x) { set.add(x); });
    return set;
  };

  /* ── simulation ─────────────────────────── */
  MemoryGraph.prototype._tick = function () {
    this.t = (this.t || 0) + 1;
    var nodes = this.nodes, n = nodes.length;
    var W = this.cv.clientWidth, H = this.cv.clientHeight;
    var cx = W / 2, cy = H / 2;

    // Spatial grid: evaluate only nearby buckets, never every node pair.
    var grid = new Map(), reach = this.p.reach, reach2 = reach * reach;
    for (var i = 0; i < n; i++) {
      var a = nodes[i], gx = Math.floor(a.x / reach), gy = Math.floor(a.y / reach);
      for (var ox = -1; ox <= 1; ox++) for (var oy = -1; oy <= 1; oy++) {
        var bucket = grid.get((gx + ox) + ',' + (gy + oy)) || [];
        for (var j = 0; j < bucket.length; j++) {
          var b = bucket[j], dx = b.x - a.x, dy = b.y - a.y;
          var d2 = dx * dx + dy * dy || 0.01;
          if (d2 > reach2) continue;
          var d = Math.sqrt(d2), f = this.p.repulsion * this.alpha / d2;
          var fx = dx / d * f, fy = dy / d * f;
          a.vx -= fx; a.vy -= fy; b.vx += fx; b.vy += fy;
        }
      }
      var key = gx + ',' + gy;
      if (!grid.has(key)) grid.set(key, []);
      grid.get(key).push(a);
    }
    for (var k = 0; k < this.links.length; k++) {
      var l = this.links[k];
      var dx2 = l.t.x - l.s.x, dy2 = l.t.y - l.s.y;
      var dist = Math.sqrt(dx2 * dx2 + dy2 * dy2) || 0.01;
      var target = this.p.rest + (l.s.r + l.t.r);
      // Divide by the smaller endpoint degree: without this a 47-link hub
      // gets 47x the pull and drags the whole cloud into a knot.
      var strength = 1 / Math.max(1, Math.min(l.s.degree || 1, l.t.degree || 1));
      var force = ((dist - target) / dist) * this.p.spring * strength * this.alpha;
      var ax = dx2 * force, ay = dy2 * force;
      l.s.vx += ax; l.s.vy += ay; l.t.vx -= ax; l.t.vy -= ay;
    }
    for (var m = 0; m < n; m++) {
      var node = nodes[m];
      node.vx += (cx - node.x) * this.p.centre * this.alpha;
      node.vy += (cy - node.y) * this.p.centre * this.alpha;
      if (this.drag && this.drag.node === node) continue;
      node.vx *= this.p.damping; node.vy *= this.p.damping;
      node.x += node.vx; node.y += node.vy;
    }
    this.alpha = Math.max(this.p.alphaFloor, this.alpha * 0.994);
  };

  /* ── render ─────────────────────────────── */
  // The force solver runs only before display. Idle motion is bounded around
  // settled anchors, so it cannot drag the cloud or change the camera framing.
  MemoryGraph.prototype._animate = function(dt) {
    this.elapsed += dt;
    this.motionLevel += (this.p.activity-this.motionLevel)*(1-Math.exp(-dt*2));
    var amp=this.reducedMotion ? 0 : (4+this.motionLevel*2)*Math.min(1,this.elapsed/2);
    for(var i=0;i<this.nodes.length;i++) {
      var n=this.nodes[i];
      n.hoverAmount += ((this.hover===n?1:0)-n.hoverAmount)*(1-Math.exp(-dt*12));
      if(this.drag && this.drag.node===n) continue;
      var rate=.20+n.wob*.09;
      n.x=n.anchorX+Math.sin(this.elapsed*rate+n.phase)*amp;
      n.y=n.anchorY+Math.cos(this.elapsed*rate*.83+n.phase)*amp;
    }
  };

  MemoryGraph.prototype._loop = function (timestamp) {
    this._resize();
    if (this._needsFit && this.cv.clientWidth >= 50 && this.cv.clientHeight >= 50) this.fit();
    // Do not catch up after a suspended/background tab: resume gently.
    var dt=this.lastFrame===null ? 0 : Math.min(.05,Math.max(0,(timestamp-this.lastFrame)/1000));
    this.lastFrame=timestamp;
    this._animate(dt);
    var ctx = this.ctx, W = this.cv.clientWidth, H = this.cv.clientHeight;
    ctx.clearRect(0, 0, W, H);
    ctx.save();
    ctx.translate(this.tx, this.ty);
    ctx.scale(this.scale, this.scale);

    var selected = this.hover ? this.hover.id : this.focus;
    var lit = selected ? this._neighbours(selected) : null;
    if (this.highlights && this.highlights.size && !selected) lit = this.highlights;
    var traceSet = this.trace ? new Set(this.trace) : null;
    var base = this.dim ? 0.045 : 0.19;

    for (var i = 0; i < this.links.length; i++) {
      var l = this.links[i];
      if (!this.visible(l.s) || !this.visible(l.t)) continue;
      var onTrace = traceSet && traceSet.has(l.s.id) && traceSet.has(l.t.id)
        && Math.abs(this.trace.indexOf(l.s.id) - this.trace.indexOf(l.t.id)) === 1;
      var onFocus = lit && lit.has(l.s.id) && lit.has(l.t.id);
      ctx.beginPath();
      ctx.moveTo(l.s.x, l.s.y);
      ctx.lineTo(l.t.x, l.t.y);
      if (onTrace) { ctx.strokeStyle = 'rgba(255,179,64,.95)'; ctx.lineWidth = 2.2; }
      else if (onFocus) { ctx.strokeStyle = 'rgba(120,235,255,.8)'; ctx.lineWidth = 1.5; }
      else if (lit) { ctx.strokeStyle = 'rgba(95,228,255,.05)'; ctx.lineWidth = 0.8; }
      else {
        // Tint each edge with its source node's colour so the web reads as a
        // structure rather than a uniform cyan mesh.
        ctx.strokeStyle = hexA(l.s.colour, base * (0.72 + (i % 5) * 0.09));
        ctx.lineWidth = 1;
      }
      ctx.stroke();
    }

    this._pulses(ctx, lit, dt);

    for (var j = 0; j < this.nodes.length; j++) {
      var nd = this.nodes[j];
      if (!this.visible(nd)) continue;
      var isLit = !lit || lit.has(nd.id);
      var isTrace = traceSet && traceSet.has(nd.id);
      var alpha = isTrace ? 1 : (isLit ? 1 : 0.085);
      nd.opacity += (alpha-nd.opacity)*(1-Math.exp(-dt*10));
      ctx.globalAlpha = nd.opacity;
      if ((isTrace || (this.focus === nd.id)) || (nd.r > 9 && !lit)) {
        ctx.shadowColor = nd.colour; ctx.shadowBlur = isTrace ? 22 : 14;
      } else { ctx.shadowBlur = 0; }
      ctx.beginPath();
      ctx.arc(nd.x, nd.y, nd.r * (1+nd.hoverAmount*.16), 0, Math.PI * 2);
      ctx.fillStyle = nd.colour;
      ctx.fill();
      if (this.focus === nd.id || isTrace) {
        ctx.shadowBlur = 0;
        ctx.lineWidth = 2; ctx.strokeStyle = '#fff'; ctx.stroke();
        var breathe = 1 + Math.sin(this.elapsed * 1.5) * 0.1;
        ctx.beginPath();
        ctx.arc(nd.x, nd.y, nd.r * 1.9 * breathe, 0, Math.PI * 2);
        ctx.strokeStyle = hexA(nd.colour, 0.34);
        ctx.lineWidth = 1;
        ctx.stroke();
      }
      ctx.shadowBlur = 0;
      ctx.globalAlpha = 1;
    }
    // Place important labels first and reject colliding rectangles.
    var occupied = [], self = this;
    if (this.showLabels && this.scale > 0.3) {
      var candidates = this.nodes.filter(function (n) {
        return self.visible(n) && (!lit || lit.has(n.id)) && (n.degree > 5 || lit || n === self.hover);
      }).sort(function (a,b) { return (b === self.hover ? 10000 : b.degree) - (a === self.hover ? 10000 : a.degree); });
      ctx.font = '500 ' + (11 / Math.max(.8, this.scale)) + 'px ui-monospace, Menlo, monospace';
      ctx.textAlign = 'center';
      var labelKey=candidates.map(function(n){return n.id;}).join(',')+'|'+this.scale;
      var rebuild=this._labelKey!==labelKey;this._labelKey=labelKey;
      candidates.forEach(function (n) {
        var w = ctx.measureText(n.title).width, h = 15 / self.scale;
        var box = {x:n.x-w/2-4,y:n.y-n.r-h-7,w:w+8,h:h+5};
        if(rebuild){
          box.x-=7;box.y-=7;box.w+=14;box.h+=14;
          n.drawLabel=!occupied.some(function(b){return box.x<b.x+b.w&&box.x+box.w>b.x&&box.y<b.y+b.h&&box.y+box.h>b.y;});
          if(n.drawLabel)occupied.push(box);
        }
        if(!n.drawLabel)return;
        ctx.globalAlpha = .92;
        ctx.lineWidth = 3.5 / self.scale; ctx.strokeStyle = '#030609';
        ctx.strokeText(n.title,n.x,n.y-n.r-7);
        ctx.fillStyle = '#d5dee7';ctx.fillText(n.title,n.x,n.y-n.r-7);
      });
      ctx.globalAlpha = 1;
    }
    ctx.restore();
    requestAnimationFrame(this._loop);
  };

  /* Traffic on the graph: small bright packets run along random edges. Rate
     scales with activity, so the whole cloud visibly wakes up while Codex is
     working and settles back to a slow trickle when idle. */
  MemoryGraph.prototype._pulses = function (ctx, lit, dt) {
    var want = 1 + Math.round(this.motionLevel * 4);
    this.nextPulse -= dt;
    if (this.links.length && this.pulses.length < want && this.nextPulse<=0 && !this.reducedMotion) {
      var link = this.links[(Math.random() * this.links.length) | 0];
      if (this.visible(link.s) && this.visible(link.t)) {
        this.pulses.push({ l: link, t: 0, v: .18 + Math.random() * .12 });
        this.nextPulse=(2+Math.random()*2)/(1+this.motionLevel*4);
      }
    }
    for (var i = this.pulses.length - 1; i >= 0; i--) {
      var pz = this.pulses[i];
      pz.t += pz.v * dt * (1 + this.motionLevel);
      if (pz.t >= 1 || !this.visible(pz.l.s) || !this.visible(pz.l.t)) {
        this.pulses.splice(i, 1);
        continue;
      }
      if (lit && !(lit.has(pz.l.s.id) && lit.has(pz.l.t.id))) continue;
      var x = pz.l.s.x + (pz.l.t.x - pz.l.s.x) * pz.t;
      var y = pz.l.s.y + (pz.l.t.y - pz.l.s.y) * pz.t;
      var fade = Math.sin(pz.t * Math.PI);          // fade in and out at the ends
      ctx.beginPath();
      ctx.arc(x, y, 1.9, 0, Math.PI * 2);
      ctx.fillStyle = hexA(pz.l.t.colour, 0.85 * fade);
      ctx.shadowColor = pz.l.t.colour;
      ctx.shadowBlur = 9 * fade;
      ctx.fill();
      ctx.shadowBlur = 0;
    }
  };

  /* 0 = idle, 1 = working. Drives drift amplitude and pulse traffic. */
  MemoryGraph.prototype.setActivity = function (level) {
    this.p.activity = Math.max(0, Math.min(1, level));
    // Activity only eases pulse speed and bounded motion, never reheats layout.
  };

  MemoryGraph.prototype._resize = function () {
    var dpr = Math.min(global.devicePixelRatio || 1, 2);
    var w = this.cv.clientWidth, h = this.cv.clientHeight;
    if (this.cv.width !== w * dpr || this.cv.height !== h * dpr) {
      this.cv.width = w * dpr; this.cv.height = h * dpr;
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
  };

  MemoryGraph.prototype.fit = function () {
    var vis = this.nodes.filter(this.visible, this);
    // A zero-size canvas (layout not settled yet) would clamp the scale to its
    // minimum and strand the cloud in a corner. Wait for real dimensions.
    if (!vis.length || this.cv.clientWidth < 50 || this.cv.clientHeight < 50) {
      this._needsFit = true;
      return;
    }
    this._needsFit = false;
    // Trim the extremes before measuring: two stray nodes on the rim must not
    // shrink the whole cloud to a dot in the middle of the canvas.
    var xs = vis.map(function (n) { return n.anchorX == null ? n.x : n.anchorX; }).sort(function (a, b) { return a - b; });
    var ys = vis.map(function (n) { return n.anchorY == null ? n.y : n.anchorY; }).sort(function (a, b) { return a - b; });
    var cut = Math.floor(xs.length * 0.03);
    var minX = xs[cut], maxX = xs[xs.length - 1 - cut];
    var minY = ys[cut], maxY = ys[ys.length - 1 - cut];
    var W = this.cv.clientWidth, H = this.cv.clientHeight, pad = 46;
    var s = Math.min((W - pad * 2) / Math.max(maxX - minX, 1),
                     (H - pad * 2) / Math.max(maxY - minY, 1));
    this.scale = Math.max(0.25, Math.min(2.4, s));
    this.tx = W / 2 - ((minX + maxX) / 2) * this.scale;
    this.ty = H / 2 - ((minY + maxY) / 2) * this.scale;
  };

  MemoryGraph.prototype._at = function (ev) {
    var rect = this.cv.getBoundingClientRect();
    var x = (ev.clientX - rect.left - this.tx) / this.scale;
    var y = (ev.clientY - rect.top - this.ty) / this.scale;
    for (var i = this.nodes.length - 1; i >= 0; i--) {
      var n = this.nodes[i];
      if (!this.visible(n)) continue;
      var dx = n.x - x, dy = n.y - y;
      if (dx * dx + dy * dy <= (n.r + 5) * (n.r + 5)) return n;
    }
    return null;
  };

  MemoryGraph.prototype._bind = function () {
    var self=this, cv=this.cv, start=null, moved=false;
    cv.addEventListener('pointerdown',function(e){
      if (e.button!==0) return;

      cv.setPointerCapture(e.pointerId); start={x:e.clientX,y:e.clientY};moved=false;
      var hit=self._at(e);
      if(hit) self.drag={node:hit};
      else self.panning={x:e.clientX-self.tx,y:e.clientY-self.ty};
    });
    cv.addEventListener('pointermove',function(e){
      if(start && Math.hypot(e.clientX-start.x,e.clientY-start.y)>4)moved=true;
      if(self.drag && moved){
        var r=cv.getBoundingClientRect();
        self.drag.node.x=(e.clientX-r.left-self.tx)/self.scale;
        self.drag.node.y=(e.clientY-r.top-self.ty)/self.scale;
        var nd=self.drag.node,amp=self.reducedMotion?0:(4+self.motionLevel*2)*Math.min(1,self.elapsed/2),rate=.20+nd.wob*.09;
        // Offset the anchor by the current drift so release has no snap.
        nd.anchorX=nd.x-Math.sin(self.elapsed*rate+nd.phase)*amp;
        nd.anchorY=nd.y-Math.cos(self.elapsed*rate*.83+nd.phase)*amp;
        nd.vx=nd.vy=0;
      } else if(self.panning && moved){self.tx=e.clientX-self.panning.x;self.ty=e.clientY-self.panning.y;}
      else if(!start){self.hover=self._at(e);cv.style.cursor=self.hover?'pointer':'grab';}
    });
    cv.addEventListener('pointerup',function(e){
      if(!moved){if(self.drag)self.setFocus(self.drag.node.id,e.shiftKey);else self.setFocus(null);}
      self.drag=null;self.panning=null;start=null;
    });
    cv.addEventListener('pointercancel',function(){self.drag=null;self.panning=null;start=null;});
    cv.addEventListener('pointerleave',function(){self.hover=null;});
    cv.addEventListener('wheel',function(e){

      e.preventDefault();var r=cv.getBoundingClientRect(),mx=e.clientX-r.left,my=e.clientY-r.top;
      var next=Math.max(.15,Math.min(5,self.scale*Math.exp(-e.deltaY*.0015)));
      self.tx=mx-(mx-self.tx)*(next/self.scale);self.ty=my-(my-self.ty)*(next/self.scale);self.scale=next;
    },{passive:false});
    cv.addEventListener('dblclick',function(){self.focus=null;self.trace=null;self.highlights=null;self.fit();self._emit(null);});
  };
  MemoryGraph.prototype.highlight = function(ids){this.highlights=new Set(ids||[]);this.focus=null;this.trace=null;};

  global.MemoryGraph = MemoryGraph;
})(window);
