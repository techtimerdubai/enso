/* 無限紙 Mugengami — infinite-canvas drawing engine
   Strokes are stored in WORLD coordinates so pan/zoom stay crisp forever. */
(() => {
  'use strict';

  const canvas = document.getElementById('paper');
  const ctx = canvas.getContext('2d');

  // ---- Camera: maps world -> screen.  screen = (world + offset) * scale ----
  const cam = { x: 0, y: 0, scale: 1 };
  let dpr = Math.max(1, window.devicePixelRatio || 1);

  // ---- Document state ----
  let strokes = [];          // committed strokes {tool,color,size,pts:[{x,y,p}]}
  let redoStack = [];
  let live = null;           // stroke currently being drawn

  // ---- Tool / brush state ----
  const state = {
    tool: 'pen',
    color: '#20242e',
    size: 4,
    theme: 'light',          // light | dark paper
    grid: true,
  };

  const PALETTE = ['#20242e','#e5484d','#f5a623','#2fb457','#3b82f6','#8b5cf6','#ec4899','#ffffff'];

  /* ---------------- persistence ---------------- */
  const SAVE_KEY = 'mugengami.doc.v1';
  function save() {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify({ strokes, cam, state:{theme:state.theme,grid:state.grid} }));
    } catch (e) {/* quota — ignore */}
  }
  function load() {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return;
      const d = JSON.parse(raw);
      if (Array.isArray(d.strokes)) strokes = d.strokes;
      if (d.cam) Object.assign(cam, d.cam);
      if (d.state) { state.theme = d.state.theme || state.theme; state.grid = d.state.grid !== false; }
    } catch (e) {/* corrupt — start fresh */}
  }
  const saveSoon = debounce(save, 400);

  /* ---------------- sizing ---------------- */
  function resize() {
    dpr = Math.max(1, window.devicePixelRatio || 1);
    canvas.width = Math.floor(innerWidth * dpr);
    canvas.height = Math.floor(innerHeight * dpr);
    canvas.style.width = innerWidth + 'px';
    canvas.style.height = innerHeight + 'px';
    render();
  }

  /* ---------------- coordinate transforms ---------------- */
  function toWorld(sx, sy) {
    return { x: sx / cam.scale - cam.x, y: sy / cam.scale - cam.y };
  }

  /* ---------------- rendering ---------------- */
  let needsRender = false;
  function requestRender() { if (!needsRender) { needsRender = true; requestAnimationFrame(render); } }

  function render() {
    needsRender = false;
    const paper = state.theme === 'dark' ? '#15161a' : '#f6f3ec';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = paper;
    ctx.fillRect(0, 0, innerWidth, innerHeight);

    if (state.grid) drawGrid();

    // world transform
    ctx.setTransform(cam.scale * dpr, 0, 0, cam.scale * dpr, cam.x * cam.scale * dpr, cam.y * cam.scale * dpr);

    for (const s of strokes) drawStroke(s);
    if (live) drawStroke(live);
  }

  function drawGrid() {
    // dotted grid in screen space, spacing scales with zoom
    const base = 32;
    let step = base * cam.scale;
    while (step < 18) step *= 4;         // keep dots from getting too dense when zoomed out
    while (step > 160) step /= 4;
    const ox = ((cam.x * cam.scale) % step + step) % step;
    const oy = ((cam.y * cam.scale) % step + step) % step;
    ctx.fillStyle = state.theme === 'dark' ? 'rgba(255,255,255,.07)' : 'rgba(0,0,0,.07)';
    const r = Math.max(0.6, Math.min(1.4, cam.scale));
    for (let x = ox; x < innerWidth; x += step)
      for (let y = oy; y < innerHeight; y += step)
        ctx.fillRect(x - r/2, y - r/2, r, r);
  }

  function drawStroke(s) {
    const pts = s.pts;
    if (!pts.length) return;

    if (s.tool === 'eraser') { ctx.globalCompositeOperation = 'destination-out'; ctx.globalAlpha = 1; }
    else if (s.tool === 'marker') { ctx.globalCompositeOperation = 'multiply'; ctx.globalAlpha = 0.4; }
    else { ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1; }

    ctx.strokeStyle = s.color;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    if (pts.length === 1) {
      const w = strokeWidth(s, pts[0].p);
      ctx.fillStyle = s.color;
      ctx.beginPath();
      ctx.arc(pts[0].x, pts[0].y, w / 2, 0, Math.PI * 2);
      ctx.fill();
    } else {
      // pressure-varying width: draw per-segment with smoothing
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1], b = pts[i];
        ctx.lineWidth = strokeWidth(s, (a.p + b.p) / 2);
        ctx.beginPath();
        const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
        if (i === 1) ctx.moveTo(a.x, a.y); else ctx.moveTo(pts[i-2] ? (pts[i-2].x+a.x)/2 : a.x, pts[i-2] ? (pts[i-2].y+a.y)/2 : a.y);
        ctx.quadraticCurveTo(a.x, a.y, mx, my);
        ctx.stroke();
      }
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
  }

  function strokeWidth(s, p) {
    const mult = s.tool === 'marker' ? 2.4 : 1;
    // pressure ranges 0.15..1 mapped so light touch is thinner
    return s.size * mult * (0.35 + 0.65 * (p || 0.5));
  }

  /* ---------------- pointer / drawing ---------------- */
  const pointers = new Map();   // active pointers for pinch
  let drawingId = null;
  let panLast = null;
  let pinch = null;
  let spaceDown = false;

  function isPanMode() { return state.tool === 'pan' || spaceDown; }

  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pointers.size === 2) {           // start pinch — abort any in-progress stroke
      startPinch();
      if (live) { live = null; drawingId = null; requestRender(); }
      return;
    }

    if (isPanMode()) {
      panLast = { x: e.clientX, y: e.clientY };
      document.body.classList.add('panning');
      return;
    }

    // begin stroke
    drawingId = e.pointerId;
    redoStack = [];
    const w = toWorld(e.clientX, e.clientY);
    live = { tool: state.tool, color: state.color, size: state.size, pts: [{ x: w.x, y: w.y, p: pressure(e) }] };
    requestRender();
    hideHint();
  });

  canvas.addEventListener('pointermove', (e) => {
    if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pinch && pointers.size >= 2) { updatePinch(); return; }

    if (panLast && isPanMode()) {
      cam.x += (e.clientX - panLast.x) / cam.scale;
      cam.y += (e.clientY - panLast.y) / cam.scale;
      panLast = { x: e.clientX, y: e.clientY };
      requestRender(); saveSoon();
      return;
    }

    if (drawingId === e.pointerId && live) {
      // coalesced events give smoother, higher-rate strokes on Android/stylus
      const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
      for (const ev of (evs.length ? evs : [e])) {
        const w = toWorld(ev.clientX, ev.clientY);
        const last = live.pts[live.pts.length - 1];
        if (last && Math.hypot(w.x - last.x, w.y - last.y) * cam.scale < 0.6) continue;
        live.pts.push({ x: w.x, y: w.y, p: pressure(ev) });
      }
      requestRender();
    }
  });

  function endPointer(e) {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinch = null;

    if (drawingId === e.pointerId) {
      if (live && live.pts.length) { strokes.push(live); saveSoon(); }
      live = null; drawingId = null;
      requestRender();
    }
    if (panLast) { panLast = null; document.body.classList.remove('panning'); saveSoon(); }
  }
  canvas.addEventListener('pointerup', endPointer);
  canvas.addEventListener('pointercancel', endPointer);
  canvas.addEventListener('pointerleave', (e) => { if (drawingId === e.pointerId) endPointer(e); });

  function pressure(e) {
    if (e.pointerType === 'pen' && e.pressure > 0) return e.pressure;
    if (e.pointerType === 'touch' && e.pressure > 0 && e.pressure !== 0.5) return e.pressure;
    return 0.5; // mouse / no pressure sensor
  }

  /* ---------------- pinch zoom ---------------- */
  function twoPoints() { return [...pointers.values()]; }
  function startPinch() {
    const [a, b] = twoPoints();
    pinch = {
      dist: Math.hypot(a.x - b.x, a.y - b.y),
      cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2,
    };
    panLast = null;
  }
  function updatePinch() {
    const [a, b] = twoPoints();
    const dist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
    const cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
    // zoom about the pinch midpoint
    zoomAt(cx, cy, dist / pinch.dist);
    // pan by midpoint movement
    cam.x += (cx - pinch.cx) / cam.scale;
    cam.y += (cy - pinch.cy) / cam.scale;
    pinch = { dist, cx, cy };
    requestRender(); saveSoon();
  }

  function zoomAt(sx, sy, factor) {
    const before = toWorld(sx, sy);
    cam.scale = clamp(cam.scale * factor, 0.05, 40);
    const after = toWorld(sx, sy);
    cam.x += after.x - before.x;
    cam.y += after.y - before.y;
    updateHud();
  }

  // wheel: zoom (ctrl or plain) / trackpad pan (shift)
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    if (e.ctrlKey || Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
      const factor = Math.exp(-e.deltaY * 0.0016);
      zoomAt(e.clientX, e.clientY, factor);
    } else {
      cam.x -= e.deltaX / cam.scale;
      cam.y -= e.deltaY / cam.scale;
    }
    requestRender(); saveSoon();
  }, { passive: false });

  /* ---------------- UI wiring ---------------- */
  const hud = document.getElementById('hud');
  function updateHud() { hud.textContent = Math.round(cam.scale * 100) + '%'; }

  // swatches
  const sw = document.getElementById('swatches');
  PALETTE.forEach((c, i) => {
    const el = document.createElement('div');
    el.className = 'swatch' + (i === 0 ? ' active' : '');
    el.style.background = c;
    if (c === '#ffffff') el.style.boxShadow = 'inset 0 0 0 1px rgba(0,0,0,.25)';
    el.addEventListener('click', () => {
      state.color = c;
      if (state.tool === 'eraser' || state.tool === 'pan') selectTool('pen');
      [...sw.children].forEach(n => n.classList.remove('active'));
      el.classList.add('active');
    });
    sw.appendChild(el);
  });

  // tools
  document.querySelectorAll('.tool').forEach(btn => {
    btn.addEventListener('click', () => selectTool(btn.dataset.tool));
  });
  function selectTool(tool) {
    state.tool = tool;
    document.querySelectorAll('.tool').forEach(b => b.classList.toggle('active', b.dataset.tool === tool));
    document.body.classList.toggle('pan', tool === 'pan');
  }

  // size
  const sizeRange = document.getElementById('sizeRange');
  sizeRange.addEventListener('input', () => { state.size = +sizeRange.value; });

  // undo / redo
  document.getElementById('undo').addEventListener('click', undo);
  document.getElementById('redo').addEventListener('click', redo);
  function undo() { if (strokes.length) { redoStack.push(strokes.pop()); requestRender(); saveSoon(); } }
  function redo() { if (redoStack.length) { strokes.push(redoStack.pop()); requestRender(); saveSoon(); } }

  // menu
  const menu = document.getElementById('menu');
  document.getElementById('menuBtn').addEventListener('click', (e) => { e.stopPropagation(); menu.classList.toggle('hidden'); });
  document.addEventListener('click', () => menu.classList.add('hidden'));
  menu.addEventListener('click', (e) => e.stopPropagation());
  menu.querySelectorAll('[data-act]').forEach(b => b.addEventListener('click', () => {
    const act = b.dataset.act;
    if (act === 'home') { cam.x = 0; cam.y = 0; cam.scale = 1; updateHud(); requestRender(); saveSoon(); }
    if (act === 'theme') { state.theme = state.theme === 'dark' ? 'light' : 'dark'; requestRender(); saveSoon(); }
    if (act === 'grid') { state.grid = !state.grid; requestRender(); saveSoon(); }
    if (act === 'export') exportPNG();
    if (act === 'clear') { if (confirm('Clear the whole canvas? This cannot be undone.')) { strokes = []; redoStack = []; requestRender(); save(); } }
    menu.classList.add('hidden');
  }));

  /* ---------------- export ---------------- */
  function exportPNG() {
    if (!strokes.length) { alert('Nothing to export yet — draw something first.'); return; }
    // bounding box of all points in world space
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity, maxW = 4;
    for (const s of strokes) { maxW = Math.max(maxW, s.size * (s.tool === 'marker' ? 2.4 : 1));
      for (const p of s.pts) { minX = Math.min(minX, p.x); minY = Math.min(minY, p.y); maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y); } }
    const pad = maxW + 24;
    minX -= pad; minY -= pad; maxX += pad; maxY += pad;
    const w = Math.max(1, maxX - minX), h = Math.max(1, maxY - minY);
    const scale = Math.min(3, 2400 / Math.max(w, h));   // cap output size
    const out = document.createElement('canvas');
    out.width = Math.round(w * scale); out.height = Math.round(h * scale);
    const octx = out.getContext('2d');
    octx.fillStyle = state.theme === 'dark' ? '#15161a' : '#f6f3ec';
    octx.fillRect(0, 0, out.width, out.height);
    octx.setTransform(scale, 0, 0, scale, -minX * scale, -minY * scale);
    drawTo(octx, strokes);
    out.toBlob((blob) => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'mugengami-' + stamp() + '.png';
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    }, 'image/png');
  }
  function drawTo(target, list) {
    for (const s of list) {
      const pts = s.pts; if (!pts.length) continue;
      target.globalCompositeOperation = s.tool === 'eraser' ? 'destination-out' : s.tool === 'marker' ? 'multiply' : 'source-over';
      target.globalAlpha = s.tool === 'marker' ? 0.4 : 1;
      target.strokeStyle = s.color; target.fillStyle = s.color; target.lineCap = 'round'; target.lineJoin = 'round';
      if (pts.length === 1) { target.beginPath(); target.arc(pts[0].x, pts[0].y, strokeWidth(s, pts[0].p)/2, 0, 7); target.fill(); continue; }
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i-1], b = pts[i];
        target.lineWidth = strokeWidth(s, (a.p + b.p)/2);
        const mx = (a.x+b.x)/2, my = (a.y+b.y)/2;
        target.beginPath();
        target.moveTo(pts[i-2] ? (pts[i-2].x+a.x)/2 : a.x, pts[i-2] ? (pts[i-2].y+a.y)/2 : a.y);
        target.quadraticCurveTo(a.x, a.y, mx, my);
        target.stroke();
      }
    }
    target.globalCompositeOperation = 'source-over'; target.globalAlpha = 1;
  }

  /* ---------------- keyboard ---------------- */
  addEventListener('keydown', (e) => {
    if (e.code === 'Space' && !spaceDown) { spaceDown = true; document.body.classList.add('pan'); }
    if (e.ctrlKey || e.metaKey) {
      if (e.key.toLowerCase() === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
      else if ((e.key.toLowerCase() === 'z' && e.shiftKey) || e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); }
      return;
    }
    const k = e.key.toLowerCase();
    if (k === 'p') selectTool('pen');
    else if (k === 'm') selectTool('marker');
    else if (k === 'e') selectTool('eraser');
    else if (k === 'h') selectTool('pan');
  });
  addEventListener('keyup', (e) => {
    if (e.code === 'Space') { spaceDown = false; if (state.tool !== 'pan') document.body.classList.remove('pan'); }
  });

  /* ---------------- helpers ---------------- */
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }
  function stamp() { const d = new Date(); const p = n => String(n).padStart(2,'0');
    return `${d.getFullYear()}${p(d.getMonth()+1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`; }
  let hintTimer = setTimeout(hideHint, 6000);
  function hideHint() { const h = document.getElementById('hint'); if (h) { h.style.opacity = '0'; } clearTimeout(hintTimer); }

  /* ---------------- boot ---------------- */
  load();
  selectTool(state.tool);
  updateHud();
  addEventListener('resize', resize);
  resize();
  addEventListener('beforeunload', save);

  // register service worker for offline / installable PWA
  if ('serviceWorker' in navigator) {
    addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
  }
})();
