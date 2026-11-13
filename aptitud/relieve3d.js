/* El terreno del recinto: escena 3D (three.js) y plano con curvas de nivel.
   Usa el modelo digital del terreno de 25 m del IGN que ya lee el núcleo para el relieve (rel.dem, 5 × 5 km)
   y la ortofoto PNOA del IGN. «Aire frío»: en azul, el terreno más bajo que el recinto (hacia ahí baja el aire frío
   en las noches de helada). Nada de esto se guarda: se dibuja al abrir el recinto.
   window.AptitudRelieve = { show(cur), hide(), has(cur), images(cur) } */
(function () {
  'use strict';
  const G = window, $ = id => document.getElementById(id);
  const THREE_URL = 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js';
  const ESC = { cerca: 1000, lejos: 2500 };            // media anchura de la vista (m)
  const MOBILE = Math.min(screen.width, screen.height) < 700;
  const fmtN = v => String(Math.round(v)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  let threeP = null;
  const loadScript = src => new Promise((ok, ko) => { const s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = ko; document.head.appendChild(s); });
  const loadThree = () => G.THREE ? Promise.resolve(G.THREE) : (threeP = threeP || loadScript(THREE_URL).then(() => G.THREE).catch(e => { threeP = null; throw e; }));
  const webgl = (() => { let r = null; return () => { if (r == null) { try { const c = document.createElement('canvas'); r = !!(c.getContext('webgl') || c.getContext('experimental-webgl')); } catch (e) { r = false; } } return r; }; })();

  // ---------- la rejilla: recorte alrededor del recinto ----------
  function crop(dem, half) {
    const { w, h, res } = dem; let a = Infinity, b = -Infinity, c = Infinity, d = -Infinity;
    for (const rg of dem.rings) for (const [x, y] of rg) { a = Math.min(a, x); b = Math.max(b, x); c = Math.min(c, y); d = Math.max(d, y); }
    if (!isFinite(a)) { a = b = w / 2; c = d = h / 2; }
    const cx = (a + b) / 2, cy = (c + d) / 2, ext = Math.max(b - a, d - c) * res;
    const hp = Math.min(Math.max(half, ext * 0.9 + 300), w * res / 2) / res;
    const i0 = Math.max(0, Math.round(cx - hp)), i1 = Math.min(w, Math.max(i0 + 3, Math.round(cx + hp)));
    const j0 = Math.max(0, Math.round(cy - hp)), j1 = Math.min(h, Math.max(j0 + 3, Math.round(cy + hp)));
    const W = i1 - i0, H = j1 - j0, z = new Float32Array(W * H);
    let zmin = Infinity, zmax = -Infinity, s = 0, n = 0;
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) { const v = dem.z[(j + j0) * w + i + i0]; if (v > -100) { zmin = Math.min(zmin, v); zmax = Math.max(zmax, v); s += v; n++; } }
    const fill = n ? s / n : 0;
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) { const v = dem.z[(j + j0) * w + i + i0]; z[j * W + i] = v > -100 ? v : fill; }
    if (!isFinite(zmin)) { zmin = zmax = fill; }
    return { z, w: W, h: H, res, x0: dem.x0 + i0 * res, y0: dem.y0 - j0 * res, x1: dem.x0 + i1 * res, y1: dem.y0 - j1 * res,
      rings: dem.rings.map(rg => rg.map(([x, y]) => [x - i0, y - j0])), zPar: dem.zPar != null ? dem.zPar : fill, zmin, zmax };
  }
  // altura en un punto (coordenadas de la rejilla, centro de la celda en +0,5)
  function zAt(g, x, y) {
    x = Math.max(0, Math.min(g.w - 1, x - 0.5)); y = Math.max(0, Math.min(g.h - 1, y - 0.5));
    const i = Math.min(g.w - 2, Math.floor(x)), j = Math.min(g.h - 2, Math.floor(y)), fx = x - i, fy = y - j, Z = g.z, W = g.w;
    if (g.w < 2 || g.h < 2) return Z[0];
    return (Z[j * W + i] * (1 - fx) + Z[j * W + i + 1] * fx) * (1 - fy) + (Z[(j + 1) * W + i] * (1 - fx) + Z[(j + 1) * W + i + 1] * fx) * fy;
  }
  // altura exagerada según lo llano que sea: en La Mancha, con ×1 no se ve nada
  function exOf(g) { const r = (g.zmax - g.zmin) / (Math.max(g.w, g.h) * g.res); return r < 0.035 ? 5 : r < 0.1 ? 3 : 1; }
  function stepOf(g) { const r = g.zmax - g.zmin; for (const s of [1, 2, 5, 10, 20, 25, 50, 100]) if (r / s <= 22) return s; return 200; }

  // ---------- curvas de nivel (cuadrados en marcha) ----------
  function smooth(g) { if (g.zs) return g.zs; const { z, w, h } = g, o = new Float32Array(z.length);
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) { let s = 0, n = 0; for (let b = -1; b <= 1; b++) for (let a = -1; a <= 1; a++) { const x = i + a, y = j + b; if (x < 0 || y < 0 || x >= w || y >= h) continue; const k = a === 0 && b === 0 ? 4 : a === 0 || b === 0 ? 2 : 1; s += z[y * w + x] * k; n += k; } o[j * w + i] = s / n; }
    return (g.zs = o); }
  function contours(g, step) {
    const z = smooth(g), { w, h } = g, out = [];
    for (let lv = Math.ceil(g.zmin / step) * step; lv <= g.zmax; lv += step) {
      const S = [];
      for (let j = 0; j < h - 1; j++) for (let i = 0; i < w - 1; i++) {
        const a = z[j * w + i], b = z[j * w + i + 1], c = z[(j + 1) * w + i + 1], d = z[(j + 1) * w + i];
        const k = (a >= lv ? 8 : 0) | (b >= lv ? 4 : 0) | (c >= lv ? 2 : 0) | (d >= lv ? 1 : 0); if (k === 0 || k === 15) continue;
        const T = () => [i + (lv - a) / (b - a), j], R = () => [i + 1, j + (lv - b) / (c - b)], B = () => [i + (lv - d) / (c - d), j + 1], L = () => [i, j + (lv - a) / (d - a)];
        const P = { 1: [L, B], 2: [B, R], 3: [L, R], 4: [T, R], 5: [T, R, L, B], 6: [T, B], 7: [L, T], 8: [L, T], 9: [T, B], 10: [L, T, B, R], 11: [T, R], 12: [L, R], 13: [B, R], 14: [L, B] }[k];
        for (let q = 0; q < P.length; q += 2) { const p1 = P[q](), p2 = P[q + 1](); S.push(p1[0] + 0.5, p1[1] + 0.5, p2[0] + 0.5, p2[1] + 0.5); }
      }
      out.push({ lv, s: S, idx: Math.round(lv / step) % 5 === 0 });
    }
    return out;
  }

  // ---------- colores: altitud con sombreado (luz del noroeste) ----------
  const RAMP = [[0, [156, 186, 120]], [0.35, [214, 214, 156]], [0.65, [205, 170, 118]], [0.85, [176, 140, 104]], [1, [232, 226, 214]]];
  function tint(t) { t = Math.max(0, Math.min(1, t)); for (let k = 1; k < RAMP.length; k++) if (t <= RAMP[k][0]) { const [t0, c0] = RAMP[k - 1], [t1, c1] = RAMP[k], f = (t - t0) / (t1 - t0); return c0.map((v, m) => v + (c1[m] - v) * f); } return RAMP[RAMP.length - 1][1]; }
  const LX = -0.62, LY = 0.62, LZ = 0.48; // hacia la luz: oeste, norte, arriba
  function shadeAt(g, x, y, ex) { const e = 0.5, dzx = (zAt(g, x + e, y) - zAt(g, x - e, y)) / (2 * e * g.res) * ex, dzn = -(zAt(g, x, y + e) - zAt(g, x, y - e)) / (2 * e * g.res) * ex;
    const nx = -dzx, ny = -dzn, nz = 1, nl = Math.hypot(nx, ny, nz); return Math.max(0, (nx * LX + ny * LY + nz * LZ) / nl / Math.hypot(LX, LY, LZ)); }
  const FRIO = [47, 111, 163];
  function coldA(g, zz) { const dz = g.zPar - zz; if (dz <= 1) return 0; return Math.min(0.62, 0.16 + 0.46 * Math.min(1, dz / Math.max(12, g.zPar - g.zmin))); }

  // fondo de altitud y sombra (el plano, y la escena 3D si no hay ortofoto), con el aire frío encima
  function paintBase(ctx, g, W, H, { ortho = null, frio = true, shade = true } = {}) {
    const im = ctx.createImageData(W, H), D = im.data, sx = g.w / W, sy = g.h / H, rg = Math.max(1, g.zmax - g.zmin);
    let od = null; if (ortho) { ctx.drawImage(ortho, 0, 0, W, H); od = ctx.getImageData(0, 0, W, H).data; }
    for (let py = 0; py < H; py++) for (let px = 0; px < W; px++) {
      const x = (px + 0.5) * sx, y = (py + 0.5) * sy, zz = zAt(g, x, y), k = (py * W + px) * 4;
      let c;
      if (od) c = [od[k], od[k + 1], od[k + 2]];
      else { const t = tint((zz - g.zmin) / rg), s = shade ? 0.5 + 0.75 * shadeAt(g, x, y, 2.2) : 1; c = t.map(v => v * s); }
      if (frio) { const a = coldA(g, zz); if (a) c = c.map((v, m) => v * (1 - a) + FRIO[m] * a); }
      D[k] = c[0]; D[k + 1] = c[1]; D[k + 2] = c[2]; D[k + 3] = 255;
    }
    ctx.putImageData(im, 0, 0);
  }
  function strokeContours(ctx, g, W, H, cs, { light = false, lw = 1 } = {}) {
    const sx = W / g.w, sy = H / g.h;
    for (const pass of [false, true]) for (const c of cs) { if (c.idx !== pass) continue;
      ctx.strokeStyle = light ? (c.idx ? 'rgba(255,255,255,.85)' : 'rgba(255,255,255,.5)') : (c.idx ? 'rgba(70,48,28,.9)' : 'rgba(70,48,28,.5)');
      ctx.lineWidth = (c.idx ? 1.9 : 0.9) * lw; ctx.beginPath();
      for (let q = 0; q < c.s.length; q += 4) { ctx.moveTo(c.s[q] * sx, c.s[q + 1] * sy); ctx.lineTo(c.s[q + 2] * sx, c.s[q + 3] * sy); }
      ctx.stroke(); }
  }
  function strokeRings(ctx, g, W, H, lw = 1) {
    const sx = W / g.w, sy = H / g.h; ctx.beginPath();
    for (const rg of g.rings) rg.forEach(([x, y], k) => k ? ctx.lineTo(x * sx, y * sy) : ctx.moveTo(x * sx, y * sy));
    ctx.closePath(); ctx.fillStyle = 'rgba(242,194,48,.16)'; ctx.fill('evenodd');
    ctx.lineJoin = 'round'; ctx.strokeStyle = 'rgba(0,0,0,.55)'; ctx.lineWidth = 5 * lw; ctx.stroke();
    ctx.strokeStyle = '#F2C230'; ctx.lineWidth = 2.6 * lw; ctx.stroke();
  }
  function labelContours(ctx, g, W, H, cs, lw = 1) {
    const sx = W / g.w, sy = H / g.h, put = [], minD = 150 * lw, fs = Math.round(11 * lw);
    ctx.font = `600 ${fs}px "IBM Plex Sans Condensed", Arial, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (const c of cs) { if (!c.idx) continue; let n = 0;
      for (let q = 0; q < c.s.length && n < 3; q += 4 * 7) { const x = (c.s[q] + c.s[q + 2]) / 2 * sx, y = (c.s[q + 1] + c.s[q + 3]) / 2 * sy;
        if (x < 30 * lw || y < 18 * lw || x > W - 30 * lw || y > H - 40 * lw) continue; if (put.some(([a, b]) => Math.hypot(a - x, b - y) < minD)) continue;
        put.push([x, y]); n++; const t = fmtN(c.lv);
        ctx.lineWidth = 3.5 * lw; ctx.strokeStyle = 'rgba(255,255,255,.92)'; ctx.strokeText(t, x, y); ctx.fillStyle = '#46301C'; ctx.fillText(t, x, y); } }
  }
  function decorPlan(ctx, g, W, H, lw = 1) {
    // escala
    const mpp = g.res * g.w / W, target = W * 0.22 * mpp, nice = [100, 200, 250, 500, 1000, 2000].reduce((a, b) => Math.abs(b - target) < Math.abs(a - target) ? b : a), L = nice / mpp;
    const x = 14 * lw, y = H - 16 * lw; ctx.fillStyle = 'rgba(255,255,255,.85)'; ctx.fillRect(x - 6 * lw, y - 18 * lw, L + 12 * lw + 40 * lw, 26 * lw);
    ctx.fillStyle = '#1D2420'; ctx.fillRect(x, y - 3 * lw, L, 4 * lw); ctx.font = `600 ${Math.round(11 * lw)}px "IBM Plex Sans Condensed", Arial, sans-serif`; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    ctx.fillText(nice >= 1000 ? `${nice / 1000} km` : `${nice} m`, x + L + 6 * lw, y + 1 * lw);
    // norte
    const nx = W - 22 * lw, ny = 26 * lw; ctx.fillStyle = 'rgba(255,255,255,.85)'; ctx.beginPath(); ctx.arc(nx, ny, 15 * lw, 0, 7); ctx.fill();
    ctx.fillStyle = '#1D2420'; ctx.beginPath(); ctx.moveTo(nx, ny - 11 * lw); ctx.lineTo(nx + 6 * lw, ny + 7 * lw); ctx.lineTo(nx, ny + 3 * lw); ctx.lineTo(nx - 6 * lw, ny + 7 * lw); ctx.closePath(); ctx.fill();
    ctx.font = `700 ${Math.round(10 * lw)}px Arial, sans-serif`; ctx.textAlign = 'center'; ctx.fillText('N', nx, ny + 26 * lw);
  }
  function drawPlan(cv, g, opt) {
    const W = cv.width, H = cv.height, ctx = cv.getContext('2d'), lw = opt.lw || 1, cs = contours(g, opt.step);
    paintBase(ctx, g, W, H, { frio: opt.frio });
    if (opt.curvas) { strokeContours(ctx, g, W, H, cs, { lw }); }
    strokeRings(ctx, g, W, H, lw);
    if (opt.curvas) labelContours(ctx, g, W, H, cs, lw);
    decorPlan(ctx, g, W, H, lw);
  }
  // la imagen que se pone encima del terreno en 3D
  function drawTexture(g, ortho, opt) {
    const max = ortho ? (opt.max || (MOBILE ? 1536 : 2048)) : 1024, r = g.w / g.h, W = r >= 1 ? max : Math.round(max * r), H = r >= 1 ? Math.round(max / r) : max;
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H; const ctx = cv.getContext('2d'), lw = W / 900;
    paintBase(ctx, g, W, H, { ortho, frio: opt.frio });
    if (opt.curvas) strokeContours(ctx, g, W, H, contours(g, opt.step), { light: !!ortho, lw });
    strokeRings(ctx, g, W, H, lw * 1.2);
    return cv;
  }

  // ---------- ortofoto PNOA del IGN (WMS en ETRS89 / UTM 30, el mismo recuadro que el terreno) ----------
  const orthoCache = new Map();
  function loadOrtho(g) {
    const px = MOBILE ? 1536 : 2048, r = g.w / g.h, W = r >= 1 ? px : Math.round(px * r), H = r >= 1 ? Math.round(px / r) : px;
    const u = `https://www.ign.es/wms-inspire/pnoa-ma?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&LAYERS=OI.OrthoimageCoverage&STYLES=&CRS=EPSG:25830&BBOX=${Math.round(g.x0)},${Math.round(g.y1)},${Math.round(g.x1)},${Math.round(g.y0)}&WIDTH=${W}&HEIGHT=${H}&FORMAT=image/jpeg`;
    if (orthoCache.has(u)) return orthoCache.get(u);
    const p = new Promise(ok => { const im = new Image(); im.crossOrigin = 'anonymous'; let t = setTimeout(() => { t = 0; ok(null); }, 20000);
      im.onload = () => { if (!t) return; clearTimeout(t); try { const c = document.createElement('canvas'); c.width = c.height = 4; c.getContext('2d').drawImage(im, 0, 0, 4, 4); c.getContext('2d').getImageData(0, 0, 1, 1); ok(im); } catch (e) { ok(null); } };
      im.onerror = () => { if (t) clearTimeout(t); ok(null); }; im.src = u; });
    p.then(v => { if (!v) orthoCache.delete(u); }); orthoCache.set(u, p); return p;
  }

  // ---------- escena 3D ----------
  function buildMesh(T, g, tex, ex) {
    const { w, h, res } = g, n = w * h, pos = new Float32Array(n * 3), uv = new Float32Array(n * 2), z0 = g.zmin;
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) { const k = j * w + i; pos[3 * k] = (i + 0.5 - w / 2) * res; pos[3 * k + 1] = (g.z[k] - z0) * ex; pos[3 * k + 2] = (j + 0.5 - h / 2) * res; uv[2 * k] = (i + 0.5) / w; uv[2 * k + 1] = 1 - (j + 0.5) / h; }
    const idx = []; for (let j = 0; j < h - 1; j++) for (let i = 0; i < w - 1; i++) { const a = j * w + i, b = a + 1, c = a + w, d = c + 1; idx.push(a, c, b, b, c, d); }
    const geo = new T.BufferGeometry(); geo.setAttribute('position', new T.BufferAttribute(pos, 3)); geo.setAttribute('uv', new T.BufferAttribute(uv, 2)); geo.setIndex(idx); geo.computeVertexNormals();
    const top = new T.Mesh(geo, new T.MeshLambertMaterial({ map: tex }));
    // paredes del bloque (como una maqueta)
    const base = -Math.max(40, 0.3 * (g.zmax - g.zmin)) * ex, sp = [], si = [];
    const edge = list => { const o = sp.length / 3; list.forEach(k => { sp.push(pos[3 * k], pos[3 * k + 1], pos[3 * k + 2], pos[3 * k], base, pos[3 * k + 2]); });
      for (let q = 0; q < list.length - 1; q++) { const a = o + 2 * q, b = a + 1, c = a + 2, d = a + 3; si.push(a, b, c, c, b, d); } };
    const R = (a, b, s) => { const r = []; for (let q = a; s > 0 ? q <= b : q >= b; q += s) r.push(q); return r; };
    edge(R(0, w - 1, 1)); edge(R((h - 1) * w, n - 1, 1)); edge(R(0, (h - 1) * w, w)); edge(R(w - 1, n - 1, w));
    const sg = new T.BufferGeometry(); sg.setAttribute('position', new T.Float32BufferAttribute(sp, 3)); sg.setIndex(si); sg.computeVertexNormals();
    const side = new T.Mesh(sg, new T.MeshLambertMaterial({ color: 0x8A6E4B, side: T.DoubleSide }));
    const grp = new T.Group(); grp.add(top); grp.add(side); return grp;
  }
  function centroid(g) { let sx = 0, sy = 0, n = 0; for (const rg of g.rings) for (const [x, y] of rg) { sx += x; sy += y; n++; } return n ? [sx / n, sy / n] : [g.w / 2, g.h / 2]; }
  function Scene(host, g, tex, opt) {
    const T = G.THREE, W = opt.W, H = opt.H;
    const ren = new T.WebGLRenderer({ antialias: true, preserveDrawingBuffer: !!opt.snap, canvas: opt.canvas });
    ren.setPixelRatio(opt.snap ? 1 : Math.min(2, G.devicePixelRatio || 1)); ren.setSize(W, H, !opt.snap);
    if (T.sRGBEncoding) { ren.outputEncoding = T.sRGBEncoding; tex.encoding = T.sRGBEncoding; }
    tex.anisotropy = Math.min(8, ren.capabilities.getMaxAnisotropy()); tex.needsUpdate = true;
    const sc = new T.Scene(); sc.background = new T.Color(opt.bg || 0xDCE6EC);
    sc.add(new T.AmbientLight(0xffffff, 0.62)); const dl = new T.DirectionalLight(0xffffff, 0.62); dl.position.set(-1, 1.4, -1); sc.add(dl);
    const cam = new T.PerspectiveCamera(38, W / H, 5, 60000);
    const [cxp, cyp] = centroid(g), tgt = new T.Vector3((cxp - g.w / 2) * g.res, 0, (cyp - g.h / 2) * g.res);
    const ext = Math.max(g.w, g.h) * g.res;
    const st = { az: opt.az != null ? opt.az : -0.55, el: opt.el != null ? opt.el : 0.62, dist: ext * (opt.far || 1.3), ex: opt.ex || 3 };
    let mesh = null, raf = 0;
    const setMesh = () => { if (mesh) { sc.remove(mesh); mesh.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); }); } mesh = buildMesh(T, g, tex, st.ex); sc.add(mesh);
      tgt.y = (zAt(g, cxp, cyp) - g.zmin) * st.ex; };
    const place = () => { const ce = Math.cos(st.el); cam.position.set(tgt.x + Math.sin(st.az) * ce * st.dist, tgt.y + Math.sin(st.el) * st.dist, tgt.z + Math.cos(st.az) * ce * st.dist); cam.lookAt(tgt); };
    const draw = () => { raf = 0; place(); ren.render(sc, cam); if (opt.onView) opt.onView(st); };
    const req = () => { if (!raf) raf = requestAnimationFrame(draw); };
    setMesh();
    const api = { st, el: ren.domElement, req, render: () => { place(); ren.render(sc, cam); },
      setEx(v) { st.ex = v; setMesh(); req(); }, setTex(t) { tex.dispose(); tex = t; if (T.sRGBEncoding) tex.encoding = T.sRGBEncoding; tex.anisotropy = Math.min(8, ren.capabilities.getMaxAnisotropy()); mesh.children[0].material.map = t; mesh.children[0].material.needsUpdate = true; req(); },
      resize(w2, h2) { cam.aspect = w2 / h2; cam.updateProjectionMatrix(); ren.setSize(w2, h2); req(); },
      zoom(f) { st.dist = Math.max(ext * 0.18, Math.min(ext * 2.6, st.dist * f)); req(); },
      turn(da, de) { st.az += da; st.el = Math.max(0.12, Math.min(1.45, st.el + de)); req(); },
      reset() { st.az = -0.55; st.el = 0.62; st.dist = ext * (opt.far || 1.3); req(); },
      dispose() { cancelAnimationFrame(raf); if (mesh) mesh.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); }); tex.dispose(); ren.dispose(); try { ren.forceContextLoss(); } catch (e) {} } };
    if (!opt.snap) {
      const cv = ren.domElement, P = new Map(); let pd = 0;
      cv.style.touchAction = 'none';
      cv.addEventListener('pointerdown', e => { cv.setPointerCapture(e.pointerId); P.set(e.pointerId, [e.clientX, e.clientY]); if (P.size === 2) { const [a, b] = [...P.values()]; pd = Math.hypot(a[0] - b[0], a[1] - b[1]); } });
      cv.addEventListener('pointermove', e => { if (!P.has(e.pointerId)) return; const [x0, y0] = P.get(e.pointerId);
        if (P.size === 1) api.turn(-(e.clientX - x0) * 0.008, (e.clientY - y0) * 0.006);
        P.set(e.pointerId, [e.clientX, e.clientY]);
        if (P.size === 2) { const [a, b] = [...P.values()], d = Math.hypot(a[0] - b[0], a[1] - b[1]); if (pd) api.zoom(pd / d); pd = d; } });
      const up = e => { P.delete(e.pointerId); pd = 0; }; cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
      cv.addEventListener('wheel', e => { e.preventDefault(); api.zoom(Math.exp(e.deltaY * 0.0012)); }, { passive: false });
    }
    draw(); return api;
  }

  // ---------- el panel ----------
  const S = { cur: null, key: '', vista: '3d', esc: 'cerca', curvas: true, frio: true, ex: 0, scene: null, ortho: undefined, io: null, tok: 0 };
  const has = cur => !!(cur && cur.rel && cur.rel.dem && cur.rel.dem.w > 4);
  function hide() { const p = $('terreno'); if (p) p.hidden = true; if (S.scene) { S.scene.dispose(); S.scene = null; } S.cur = null; S.key = ''; }
  function grid() { if (!S.g || S.g.esc !== S.esc) { S.g = crop(S.cur.rel.dem, ESC[S.esc]); S.g.esc = S.esc; S.g.step = stepOf(S.g); } return S.g; }
  function show(cur) {
    const p = $('terreno'); if (!p) return;
    if (!has(cur)) { hide(); return; }
    const key = cur.code + '|' + cur.rel.dem.x0 + '|' + cur.rel.dem.y0;
    p.hidden = false; if (key === S.key) return;
    if (S.scene) { S.scene.dispose(); S.scene = null; }
    S.cur = cur; S.key = key; S.g = null; S.ortho = undefined; S.tok++; S.ex = exOf(grid());
    if (!webgl()) S.vista = 'plano';
    wire(); paint();
  }
  function wire() {
    const p = $('terreno');
    p.querySelectorAll('[data-tv]').forEach(b => { b.disabled = b.dataset.tv === '3d' && !webgl(); b.onclick = () => { if (S.vista === b.dataset.tv) return; S.vista = b.dataset.tv; paint(); }; });
    p.querySelectorAll('[data-te]').forEach(b => b.onclick = () => { if (S.esc === b.dataset.te) return; S.esc = b.dataset.te; S.g = null; S.ortho = undefined; if (S.scene) { S.scene.dispose(); S.scene = null; } paint(); });
    p.querySelectorAll('[data-tx]').forEach(b => b.onclick = () => { const v = +b.dataset.tx; if (S.ex === v) return; S.ex = v; if (S.scene) S.scene.setEx(v); bar(); });
    $('terCurvas').onclick = () => { S.curvas = !S.curvas; retex(); };
    $('terFrio').onclick = () => { S.frio = !S.frio; retex(); };
    p.querySelectorAll('[data-tz]').forEach(b => b.onclick = () => { if (!S.scene) return; const k = b.dataset.tz; if (k === '+') S.scene.zoom(0.8); else if (k === '-') S.scene.zoom(1.25); else if (k === 'l') S.scene.turn(0.35, 0); else if (k === 'r') S.scene.turn(-0.35, 0); else S.scene.reset(); });
  }
  function bar() {
    const p = $('terreno');
    p.querySelectorAll('[data-tv]').forEach(b => b.setAttribute('aria-pressed', S.vista === b.dataset.tv));
    p.querySelectorAll('[data-te]').forEach(b => b.setAttribute('aria-pressed', S.esc === b.dataset.te));
    p.querySelectorAll('[data-tx]').forEach(b => b.setAttribute('aria-pressed', S.ex === +b.dataset.tx));
    $('terCurvas').setAttribute('aria-pressed', S.curvas); $('terFrio').setAttribute('aria-pressed', S.frio);
    $('terEx').hidden = S.vista !== '3d'; $('terNav').hidden = S.vista !== '3d' || !S.scene;
    const g = grid();
    $('terLegend').innerHTML = `<span><i class="tsw" style="background:#F2C230;outline:1.5px solid #333"></i>Recinto</span>`
      + (S.curvas ? `<span><i class="tsw tl"></i>Curvas cada ${g.step} m (gruesas cada ${5 * g.step} m)</span>` : '')
      + (S.frio ? `<span><i class="tsw" style="background:rgba(47,111,163,.6)"></i>Más bajo que el recinto: hacia ahí baja el aire frío en las noches de helada</span>` : '');
    const lado = (g.w * g.res / 1000), r = S.cur.rel;
    $('terNote').textContent = `Vista de ${lado.toLocaleString('es-ES', { maximumFractionDigits: 1 })} × ${(g.h * g.res / 1000).toLocaleString('es-ES', { maximumFractionDigits: 1 })} km. El recinto está a ${fmtN(g.zPar)} m de media y el terreno de la vista va de ${fmtN(g.zmin)} a ${fmtN(g.zmax)} m`
      + (r && r.delta != null ? `; con este relieve, en las noches de helada el recinto queda ${G.AptitudCore && G.AptitudCore.reliefEffect ? G.AptitudCore.reliefEffect(r.delta) : ''} (${r.delta >= 0 ? '+' : '−'}${Math.abs(r.delta).toLocaleString('es-ES', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} °C).` : '.')
      + (S.vista === '3d' ? ` En 3D la altura se ve ×${S.ex} para que se note. Arrastra para girar; con la rueda o pellizcando, acerca y aleja.` : '')
      + ` Terreno: modelo digital del IGN (25 m)${S.vista === '3d' ? (S.ortho ? ' · ortofoto PNOA (IGN)' : S.ortho === null ? ' · sin ortofoto (el IGN no la ha servido): colores por altitud' : '') : ''}.`;
  }
  function paint() {
    const v = $('terView'), g = grid(); bar();
    if (S.vista === 'plano' || !webgl()) {
      if (S.scene) { S.scene.dispose(); S.scene = null; }
      const W = Math.min(900, v.clientWidth || 600), sc = Math.min(2, G.devicePixelRatio || 1), H = Math.round(W * g.h / g.w);
      const cv = document.createElement('canvas'); cv.width = Math.round(W * sc); cv.height = Math.round(H * sc); cv.style.width = W + 'px'; cv.style.maxWidth = '100%'; cv.style.height = 'auto';
      cv.setAttribute('role', 'img'); cv.setAttribute('aria-label', 'Plano del terreno del recinto con curvas de nivel');
      drawPlan(cv, g, { curvas: S.curvas, frio: S.frio, step: g.step, lw: sc });
      v.replaceChildren(cv); bar(); return;
    }
    if (S.scene) { S.scene.req(); return; }
    const tok = S.tok; v.replaceChildren(Object.assign(document.createElement('div'), { className: 'tload', textContent: 'Cargando la escena 3D…' }));
    const start = () => {
      Promise.all([loadThree(), S.ortho !== undefined ? Promise.resolve(S.ortho) : loadOrtho(g)]).then(([T, im]) => {
        if (tok !== S.tok || S.vista !== '3d' || g !== grid()) return;
        S.ortho = im; const W = v.clientWidth || 600, H = Math.round(Math.max(260, Math.min(560, W * 0.66)));
        const tex = new T.CanvasTexture(drawTexture(g, im, { curvas: S.curvas, frio: S.frio, step: g.step }));
        const box = document.createElement('div'); box.className = 'tbox';
        const comp = Object.assign(document.createElement('div'), { className: 'tcomp', innerHTML: '<svg viewBox="0 0 34 34" width="34" height="34" aria-hidden="true"><path d="M17 4 L22.5 19 L17 16 L11.5 19 Z" fill="#B23A35"/><path d="M17 30 L22.5 19 L17 22 L11.5 19 Z" fill="#9AA59E"/><text x="17" y="32.5" text-anchor="middle" font-size="7" font-weight="700" fill="#1D2420" font-family="Arial">N</text></svg>' }); comp.title = 'Norte';
        try { S.scene = Scene(box, g, tex, { W, H, ex: S.ex, onView: st => { comp.style.transform = `rotate(${st.az}rad)`; } }); }
        catch (e) { S.vista = 'plano'; paint(); return; }
        S.scene.el.setAttribute('aria-label', 'Escena 3D del terreno del recinto: arrastra para girar'); S.scene.el.setAttribute('role', 'img');
        box.append(S.scene.el, comp); v.replaceChildren(box); bar();
      }).catch(() => { if (tok !== S.tok) return; S.vista = 'plano'; paint(); });
    };
    // la escena (y three.js) solo se carga cuando el panel se ve
    if (S.io) S.io.disconnect();
    if ('IntersectionObserver' in G) { S.io = new IntersectionObserver(es => { if (es.some(e => e.isIntersecting)) { S.io.disconnect(); S.io = null; start(); } }, { rootMargin: '200px' }); S.io.observe(v); }
    else start();
  }
  function retex() {
    bar();
    if (S.vista === 'plano' || !S.scene) { paint(); return; }
    S.scene.setTex(new G.THREE.CanvasTexture(drawTexture(grid(), S.ortho, { curvas: S.curvas, frio: S.frio, step: grid().step })));
  }
  let rzT = 0, rzW = 0;
  G.addEventListener('resize', () => { clearTimeout(rzT); rzT = setTimeout(() => { const v = $('terView'); if (!v || !S.cur || $('terreno').hidden) return; const W = v.clientWidth; if (Math.abs(W - rzW) < 30) return; rzW = W;
    if (S.scene) S.scene.resize(W, Math.round(Math.max(260, Math.min(560, W * 0.66)))); else paint(); }, 250); });

  // ---------- imágenes para el informe PDF (siempre las mismas vistas: 3D desde el suroeste y plano) ----------
  async function images(cur) {
    if (!has(cur)) return null;
    const g = crop(cur.rel.dem, ESC.cerca); g.step = stepOf(g);
    const out = { g, step: g.step, ex: exOf(g) };
    const pc = document.createElement('canvas'), PW = 1100, PH = Math.round(PW * g.h / g.w); pc.width = PW; pc.height = PH;
    drawPlan(pc, g, { curvas: true, frio: true, step: g.step, lw: PW / 650 }); out.plano = { url: pc.toDataURL('image/jpeg', 0.88), w: PW, h: PH };
    if (webgl()) {
      try {
        const [T, im] = await Promise.all([loadThree(), loadOrtho(g)]); out.ortho = !!im;
        const W = 1500, H = 950, cv = document.createElement('canvas'); cv.width = W; cv.height = H;
        const sc = Scene(null, g, new T.CanvasTexture(drawTexture(g, im, { curvas: true, frio: true, step: g.step, max: 2048 })), { W, H, ex: out.ex, snap: true, canvas: cv, bg: 0xFFFFFF, el: 0.58, far: 1.45 });
        sc.render(); out.d3 = { url: cv.toDataURL('image/jpeg', 0.88), w: W, h: H }; sc.dispose();
      } catch (e) { out.d3 = null; }
    }
    return out;
  }

  G.AptitudRelieve = { show, hide, has, images, _crop: crop, _contours: contours, _stepOf: stepOf, _state: S };
})();
