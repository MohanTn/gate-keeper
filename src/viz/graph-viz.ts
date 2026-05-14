/**
 * Standalone interactive HTML graph visualizer.
 *
 * Generates a self-contained HTML file with:
 *   - Force-directed layout (Verlet integration, spring + repulsion + gravity)
 *   - SVG rendering with pan/zoom via pointer events
 *   - Hover tooltip and click detail panel
 *   - Search/filter nodes by name
 *   - Rating-coloured nodes, size proportional to in-degree
 *   - Full offline operation — zero external dependencies
 *
 * Pure function: generateGraphViz(nodes, edges) → HTML string
 */

interface VizNode {
  id: string;
  label: string;
  rating: number;
  metrics?: { linesOfCode?: number; cyclomaticComplexity?: number; importCount?: number };
  violations?: Array<{ type: string; severity: string }>;
}

interface VizEdge { source: string; target: string; type?: string }

export interface GraphVizOptions {
  title?: string;
  width?: number;
  height?: number;
}

export function generateGraphViz(
  nodes: ReadonlyArray<VizNode>,
  edges: ReadonlyArray<VizEdge>,
  opts: GraphVizOptions = {},
): string {
  const title = opts.title ?? 'Gate Keeper — Dependency Graph';
  const W = opts.width ?? 1200;
  const H = opts.height ?? 800;

  // Serialise graph data as JSON for embedding
  const graphData = JSON.stringify({
    nodes: nodes.map(n => ({
      id: n.id,
      label: n.label,
      rating: n.rating,
      loc: n.metrics?.linesOfCode ?? 0,
      complexity: n.metrics?.cyclomaticComplexity ?? 0,
      imports: n.metrics?.importCount ?? 0,
      errors: n.violations?.filter(v => v.severity === 'error').length ?? 0,
      warnings: n.violations?.filter(v => v.severity === 'warning').length ?? 0,
    })),
    edges: edges.map(e => ({ s: e.source, t: e.target, tp: e.type ?? 'import' })),
  });

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${htmlEsc(title)}</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:system-ui,sans-serif;background:#1e1e2e;color:#cdd6f4;height:100vh;display:flex;flex-direction:column}
#toolbar{display:flex;align-items:center;gap:10px;padding:8px 14px;background:#181825;border-bottom:1px solid #313244;flex-shrink:0}
#toolbar h1{font-size:14px;font-weight:600;color:#cba6f7;white-space:nowrap}
#search{background:#313244;border:1px solid #45475a;border-radius:6px;color:#cdd6f4;padding:4px 10px;font-size:13px;width:200px}
#search:focus{outline:none;border-color:#89b4fa}
#stats{font-size:12px;color:#6c7086;margin-left:auto}
.legend{display:flex;gap:12px;font-size:11px;align-items:center}
.litem{display:flex;align-items:center;gap:4px}
.ldot{width:10px;height:10px;border-radius:50%;flex-shrink:0}
#main{display:flex;flex:1;overflow:hidden}
#canvas-wrap{flex:1;overflow:hidden;position:relative;cursor:grab}
#canvas-wrap.grabbing{cursor:grabbing}
svg{width:100%;height:100%;display:block}
.edge{stroke:#45475a;stroke-width:1;fill:none;opacity:0.6}
.edge.call{stroke:#89b4fa;opacity:0.8}
.edge.extends{stroke:#cba6f7;stroke-width:2;opacity:0.9}
.node circle{stroke:#1e1e2e;stroke-width:1.5;transition:stroke-width .15s}
.node circle:hover,.node.selected circle{stroke:#f38ba8;stroke-width:3}
.node text{font-size:9px;fill:#cdd6f4;pointer-events:none;user-select:none}
#panel{width:300px;background:#181825;border-left:1px solid #313244;overflow-y:auto;flex-shrink:0;transform:translateX(100%);transition:transform .2s}
#panel.open{transform:translateX(0)}
#panel-inner{padding:16px}
#panel h2{font-size:14px;color:#cba6f7;margin-bottom:12px}
.metric{display:flex;justify-content:space-between;font-size:12px;padding:4px 0;border-bottom:1px solid #313244}
.metric .val{color:#a6e3a1;font-weight:600}
.metric .val.bad{color:#f38ba8}
.metric .val.warn{color:#fab387}
#close-panel{position:absolute;top:8px;right:8px;background:none;border:none;color:#6c7086;font-size:18px;cursor:pointer}
#close-panel:hover{color:#cdd6f4}
#tooltip{position:absolute;background:#313244;border:1px solid #45475a;border-radius:6px;padding:8px 12px;font-size:12px;pointer-events:none;opacity:0;transition:opacity .1s;max-width:240px;z-index:10}
#tooltip.show{opacity:1}
</style>
</head>
<body>
<div id="toolbar">
  <h1>⬡ ${htmlEsc(title)}</h1>
  <input id="search" placeholder="Search files…" autocomplete="off">
  <div class="legend">
    <div class="litem"><div class="ldot" style="background:#a6e3a1"></div>≥8</div>
    <div class="litem"><div class="ldot" style="background:#f9e2af"></div>6–8</div>
    <div class="litem"><div class="ldot" style="background:#fab387"></div>4–6</div>
    <div class="litem"><div class="ldot" style="background:#f38ba8"></div>&lt;4</div>
  </div>
  <div id="stats"></div>
</div>
<div id="main">
  <div id="canvas-wrap">
    <svg id="svg"><g id="g-edges"></g><g id="g-nodes"></g></svg>
    <div id="tooltip"></div>
  </div>
  <div id="panel">
    <button id="close-panel">×</button>
    <div id="panel-inner"></div>
  </div>
</div>
<script>
(function(){
'use strict';
const DATA = ${graphData};

// ── State ──────────────────────────────────────────────────
const nodeMap = new Map(DATA.nodes.map(n => [n.id, n]));
const adjOut = new Map(); // id → [target ids]
const adjIn  = new Map(); // id → [source ids]
DATA.nodes.forEach(n => { adjOut.set(n.id,[]); adjIn.set(n.id,[]); });
DATA.edges.forEach(e => {
  (adjOut.get(e.s)||[]).push(e.t);
  (adjIn.get(e.t)||[]).push(e.s);
});

let pan={x:0,y:0}, zoom=1;
let dragging=null, lastPointer=null;
let simRunning=true, tick=0;

// Physics state
const sim = DATA.nodes.map((n,i) => {
  const angle = (2*Math.PI*i)/DATA.nodes.length;
  const r = 200 + Math.random()*80;
  return { id:n.id, x:r*Math.cos(angle), y:r*Math.sin(angle), vx:0, vy:0 };
});
const simMap = new Map(sim.map(s => [s.id, s]));

// ── Colors ────────────────────────────────────────────────
function ratingColor(r) {
  if(r>=8) return '#a6e3a1';
  if(r>=6) return '#f9e2af';
  if(r>=4) return '#fab387';
  return '#f38ba8';
}
function nodeR(id) {
  const d = (adjIn.get(id)||[]).length;
  return Math.max(6, Math.min(18, 6 + d*1.5));
}

// ── SVG helpers ────────────────────────────────────────────
const SVG_NS = 'http://www.w3.org/2000/svg';
function el(tag, attrs={}) {
  const e = document.createElementNS(SVG_NS, tag);
  for(const [k,v] of Object.entries(attrs)) e.setAttribute(k,v);
  return e;
}

// ── Build SVG elements ─────────────────────────────────────
const svg  = document.getElementById('svg');
const gEdges = document.getElementById('g-edges');
const gNodes = document.getElementById('g-nodes');

const edgeEls = DATA.edges.map(e => {
  const cls = e.tp==='FUNCTION_CALL'?'edge call':e.tp==='CLASS_EXTENDS'?'edge extends':'edge';
  const line = el('line',{class:cls,'data-s':e.s,'data-t':e.t});
  gEdges.appendChild(line);
  return {el:line, s:e.s, t:e.t};
});

const nodeEls = new Map();
DATA.nodes.forEach(n => {
  const g = el('g',{class:'node','data-id':n.id});
  const c = el('circle',{r:nodeR(n.id), fill:ratingColor(n.rating), cx:'0', cy:'0'});
  const txt = el('text',{x:(nodeR(n.id)+3).toString(), y:'3'});
  txt.textContent = n.label;
  g.appendChild(c); g.appendChild(txt);
  gNodes.appendChild(g);
  nodeEls.set(n.id, {g, c});
});

// ── Force simulation ───────────────────────────────────────
function step() {
  const K=80, REPEL=3000, GRAVITY=0.04, DAMP=0.85;
  const idx = Array.from(simMap.values());
  // Repulsion
  for(let i=0;i<idx.length;i++) {
    for(let j=i+1;j<idx.length;j++) {
      const a=idx[i], b=idx[j];
      const dx=b.x-a.x, dy=b.y-a.y;
      const d2=dx*dx+dy*dy+0.1;
      const f=REPEL/d2;
      const fx=f*dx/Math.sqrt(d2), fy=f*dy/Math.sqrt(d2);
      a.vx-=fx; a.vy-=fy; b.vx+=fx; b.vy+=fy;
    }
  }
  // Spring attraction
  DATA.edges.forEach(e => {
    const a=simMap.get(e.s), b=simMap.get(e.t);
    if(!a||!b) return;
    const dx=b.x-a.x, dy=b.y-a.y;
    const d=Math.sqrt(dx*dx+dy*dy)+0.1;
    const f=(d-K)/d*0.3;
    a.vx+=f*dx; a.vy+=f*dy; b.vx-=f*dx; b.vy-=f*dy;
  });
  // Gravity toward origin
  for(const s of idx) {
    s.vx-=s.x*GRAVITY; s.vy-=s.y*GRAVITY;
    s.vx*=DAMP; s.vy*=DAMP;
    s.x+=s.vx; s.y+=s.vy;
  }
}

// ── Render ─────────────────────────────────────────────────
function applyTransform() {
  svg.querySelector('#g-edges').setAttribute('transform',
    \`translate(\${pan.x+window.innerWidth/2},\${pan.y+window.innerHeight/2}) scale(\${zoom})\`);
  svg.querySelector('#g-nodes').setAttribute('transform',
    \`translate(\${pan.x+window.innerWidth/2},\${pan.y+window.innerHeight/2}) scale(\${zoom})\`);
}

let hidden = new Set();
function render() {
  for(const {el:line,s,t} of edgeEls) {
    const a=simMap.get(s), b=simMap.get(t);
    if(!a||!b) continue;
    if(hidden.has(s)||hidden.has(t)) { line.style.display='none'; continue; }
    line.style.display='';
    line.setAttribute('x1',a.x); line.setAttribute('y1',a.y);
    line.setAttribute('x2',b.x); line.setAttribute('y2',b.y);
  }
  for(const [id,{g}] of nodeEls) {
    const s=simMap.get(id);
    if(!s) continue;
    if(hidden.has(id)) { g.style.display='none'; continue; }
    g.style.display='';
    g.setAttribute('transform',\`translate(\${s.x},\${s.y})\`);
  }
  applyTransform();
}

const WARMUP=200;
function loop() {
  if(simRunning) { step(); tick++; if(tick>=WARMUP) simRunning=false; }
  render();
  requestAnimationFrame(loop);
}
applyTransform();
loop();

document.getElementById('stats').textContent =
  \`\${DATA.nodes.length} files · \${DATA.edges.length} edges\`;

// ── Search ────────────────────────────────────────────────
document.getElementById('search').addEventListener('input', function(){
  const q = this.value.toLowerCase().trim();
  if(!q) { hidden=new Set(); return; }
  hidden = new Set(DATA.nodes.filter(n => !n.label.toLowerCase().includes(q)).map(n=>n.id));
});

// ── Pan/Zoom ───────────────────────────────────────────────
const wrap = document.getElementById('canvas-wrap');
wrap.addEventListener('wheel', e => {
  e.preventDefault();
  zoom = Math.max(0.2, Math.min(5, zoom * (e.deltaY < 0 ? 1.1 : 0.9)));
}, {passive:false});
wrap.addEventListener('pointerdown', e => {
  if(e.target.closest('.node')) return;
  dragging='pan'; lastPointer={x:e.clientX,y:e.clientY};
  wrap.classList.add('grabbing');
});
window.addEventListener('pointermove', e => {
  if(dragging==='pan') {
    pan.x += e.clientX - lastPointer.x;
    pan.y += e.clientY - lastPointer.y;
    lastPointer={x:e.clientX,y:e.clientY};
  }
});
window.addEventListener('pointerup', () => {
  dragging=null; wrap.classList.remove('grabbing');
});

// ── Tooltip ───────────────────────────────────────────────
const tooltip = document.getElementById('tooltip');
gNodes.addEventListener('mouseover', e => {
  const g = e.target.closest('.node');
  if(!g) return;
  const n = nodeMap.get(g.dataset.id);
  if(!n) return;
  tooltip.innerHTML = \`<strong>\${n.label}</strong><br>
    Rating: \${n.rating}/10 · LOC: \${n.loc||'?'}<br>
    In-degree: \${(adjIn.get(n.id)||[]).length} · Out: \${(adjOut.get(n.id)||[]).length}\`;
  tooltip.classList.add('show');
});
gNodes.addEventListener('mousemove', e => {
  tooltip.style.left = (e.clientX+14)+'px';
  tooltip.style.top  = (e.clientY-10)+'px';
});
gNodes.addEventListener('mouseleave', () => tooltip.classList.remove('show'));

// ── Detail panel ──────────────────────────────────────────
let selected = null;
gNodes.addEventListener('click', e => {
  const g = e.target.closest('.node');
  if(!g) return;
  const id = g.dataset.id;
  if(selected) nodeEls.get(selected)?.g.classList.remove('selected');
  selected = id;
  g.classList.add('selected');
  openPanel(id);
});
document.getElementById('close-panel').addEventListener('click', () => {
  document.getElementById('panel').classList.remove('open');
  if(selected) { nodeEls.get(selected)?.g.classList.remove('selected'); selected=null; }
});

function openPanel(id) {
  const n = nodeMap.get(id);
  if(!n) return;
  const ins  = (adjIn.get(id)||[]).map(x=>nodeMap.get(x)?.label||x);
  const outs = (adjOut.get(id)||[]).map(x=>nodeMap.get(x)?.label||x);
  const rc = r => r>=8?'':r>=6?'warn':'bad';
  document.getElementById('panel-inner').innerHTML = \`
    <h2>\${n.label}</h2>
    <div class="metric"><span>Rating</span><span class="val \${rc(n.rating)}">\${n.rating}/10</span></div>
    <div class="metric"><span>Lines of code</span><span class="val">\${n.loc||'?'}</span></div>
    <div class="metric"><span>Complexity</span><span class="val \${n.complexity>10?'bad':n.complexity>5?'warn':''}">\${n.complexity||'?'}</span></div>
    <div class="metric"><span>Imports</span><span class="val">\${n.imports||0}</span></div>
    <div class="metric"><span>Errors / Warnings</span><span class="val \${n.errors?'bad':''}">\${n.errors} / \${n.warnings}</span></div>
    <div class="metric"><span>In-degree</span><span class="val">\${ins.length}</span></div>
    <div class="metric"><span>Out-degree</span><span class="val">\${outs.length}</span></div>
    \${ins.length?'<p style="font-size:11px;margin-top:10px;color:#6c7086">Imported by:</p><p style="font-size:11px">'+ins.slice(0,8).join(', ')+(ins.length>8?'…':'')+'</p>':''}
    \${outs.length?'<p style="font-size:11px;margin-top:8px;color:#6c7086">Imports:</p><p style="font-size:11px">'+outs.slice(0,8).join(', ')+(outs.length>8?'…':'')+'</p>':''}
  \`;
  document.getElementById('panel').classList.add('open');
}

})();
</script>
</body>
</html>`;
}

function htmlEsc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
