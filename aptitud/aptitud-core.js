// Núcleo de cálculo del simulador de aptitud climática (pistacho y almendro).
// Sin interfaz: se le pasa la geometría GeoJSON de un recinto y devuelve todos los resultados.
// Lo usan la web del simulador (aptitud/index.html) y otras aplicaciones del mismo dominio (p. ej. Mapa de Fincas).
//
// Uso desde otra aplicación:
//   <script src="/test-claude/aptitud/aptitud-core.js"></script>
//   const res = await AptitudCore.evaluar(featureGeoJSON, { onStatus: t => console.log(t) });
// Carga solo, desde su misma carpeta, config.js, motor.js, criterios.js y relieve.js si no están cargados.
// Necesita acceso a servicios.idee.es (MDT del IGN, para el relieve) y a cdn.jsdelivr.net (geotiff.js).
(function (G) {
  const SRC = (document.currentScript && document.currentScript.src) || location.href;
  const BASE = new URL('.', SRC).href;          // carpeta aptitud/
  const DATA_V = '20260929';                     // cambiar al actualizar los datos (evita la caché)
  const MES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  const fdate = doy => { if (doy == null || doy < 0) return '—'; const d = new Date(Date.UTC(2021, 0, 1) + (Math.round(doy) - 1) * 864e5); return d.getUTCDate() + ' ' + MES[d.getUTCMonth()]; };
  const mean = a => { const v = a.filter(x => x != null && x >= 0); return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null; };
  const pct = (a, q) => { const v = a.filter(x => x != null && x >= 0).sort((x, y) => x - y); return v.length ? v[Math.min(v.length - 1, Math.floor(q * (v.length - 1)))] : null; };
  const loadScript = src => new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('No se pudo cargar ' + src)); document.head.appendChild(s); });

  // ---------- dependencias ----------
  let readyP = null;
  function ready() {
    if (!readyP) readyP = (async () => {
      const need = [['CONFIG', 'config.js'], ['RELIEVE', 'relieve.js'], ['Motor', 'motor.js'], ['Criterios', 'criterios.js']];
      for (const [g, f] of need) if (!G[g]) await loadScript(BASE + f + '?d=' + DATA_V);
    })();
    return readyP;
  }

  // ---------- datos de clima ----------
  let META = null;
  async function loadMeta() { if (!META) META = await (await fetch(BASE + 'grid/meta.json?d=' + DATA_V)).json(); return META; }
  function cellIndex(M, lat, lon) {
    const i = M.lat.reduce((b, v, k) => Math.abs(v - lat) < Math.abs(M.lat[b] - lat) ? k : b, 0);
    const j = M.lon.reduce((b, v, k) => Math.abs(v - lon) < Math.abs(M.lon[b] - lon) ? k : b, 0);
    return i * M.lon.length + j;
  }
  async function loadCell(M, idx) {
    const resp = await fetch(BASE + `grid/celdas/${idx}.bin.gz?d=${DATA_V}`);
    if (!resp.ok) throw new Error('No se pudo descargar el clima de la celda ' + idx);
    const buf = await new Response(resp.body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
    return G.Motor.cellArrays(buf, M.nd);
  }

  // ---------- geometría ----------
  function rings(feature) { const g = feature.geometry || feature; return g.type === 'Polygon' ? [g.coordinates[0]] : g.coordinates.map(p => p[0]); }
  function center(feature) { // centro del rectángulo envolvente (igual que Leaflet getBounds().getCenter())
    let a = 90, b = -90, c = 180, d = -180; for (const r of rings(feature)) for (const [lo, la] of r) { a = Math.min(a, la); b = Math.max(b, la); c = Math.min(c, lo); d = Math.max(d, lo); }
    return { lat: (a + b) / 2, lng: (c + d) / 2 };
  }

  // ---------- relieve (MDT 25 m y 200 m del IGN, servicio WCS) ----------
  function toUTM30(lat, lon) {
    const a = 6378137, f = 1 / 298.257223563, k0 = 0.9996, e2 = f * (2 - f), ep2 = e2 / (1 - e2);
    const phi = lat * Math.PI / 180, lam = lon * Math.PI / 180, lam0 = -3 * Math.PI / 180;
    const N = a / Math.sqrt(1 - e2 * Math.sin(phi) ** 2), T = Math.tan(phi) ** 2, C = ep2 * Math.cos(phi) ** 2, A = Math.cos(phi) * (lam - lam0);
    const M = a * ((1 - e2 / 4 - 3 * e2 ** 2 / 64 - 5 * e2 ** 3 / 256) * phi - (3 * e2 / 8 + 3 * e2 ** 2 / 32 + 45 * e2 ** 3 / 1024) * Math.sin(2 * phi) + (15 * e2 ** 2 / 256 + 45 * e2 ** 3 / 1024) * Math.sin(4 * phi) - (35 * e2 ** 3 / 3072) * Math.sin(6 * phi));
    const x = 500000 + k0 * N * (A + (1 - T + C) * A ** 3 / 6 + (5 - 18 * T + T * T + 72 * C - 58 * ep2) * A ** 5 / 120);
    const y = k0 * (M + N * Math.tan(phi) * (A * A / 2 + (5 - T + 9 * C + 4 * C * C) * A ** 4 / 24 + (61 - 58 * T + T * T + 600 * C - 330 * ep2) * A ** 6 / 720));
    return [x, y];
  }
  let geotiffReady = null;
  function loadGeoTIFF() { if (G.GeoTIFF) return Promise.resolve(); if (!geotiffReady) geotiffReady = loadScript('https://cdn.jsdelivr.net/npm/geotiff@2.1.3/dist-browser/geotiff.js'); return geotiffReady; }
  async function relief(feature, c) {
    await loadGeoTIFF();
    const [cx, cy] = toUTM30(c.lat, c.lng), H = 2500;
    const u = `https://servicios.idee.es/wcs-inspire/mdt?SERVICE=WCS&VERSION=2.0.1&REQUEST=GetCoverage&COVERAGEID=Elevacion25830_25&FORMAT=image/tiff&SUBSET=x(${Math.round(cx - H)},${Math.round(cx + H)})&SUBSET=y(${Math.round(cy - H)},${Math.round(cy + H)})`;
    const t = await G.GeoTIFF.fromArrayBuffer(await (await fetch(u)).arrayBuffer()); const im = await t.getImage();
    const w = im.getWidth(), h = im.getHeight(), [z] = await im.readRasters(), res = 2 * H / w;
    const I = new Float64Array((w + 1) * (h + 1)), Nn = new Float64Array((w + 1) * (h + 1));
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) { const v = z[j * w + i], ok = v > -100; const k = (j + 1) * (w + 1) + i + 1; I[k] = (ok ? v : 0) + I[k - 1] + I[k - w - 1] - I[k - w - 2]; Nn[k] = (ok ? 1 : 0) + Nn[k - 1] + Nn[k - w - 1] - Nn[k - w - 2]; }
    const boxMean = (i, j, r) => { const x0 = Math.max(0, i - r), x1 = Math.min(w, i + r + 1), y0 = Math.max(0, j - r), y1 = Math.min(h, j + r + 1); const S = (A, a, b) => A[b * (w + 1) + a]; const s = S(I, x1, y1) - S(I, x0, y1) - S(I, x1, y0) + S(I, x0, y0), n = S(Nn, x1, y1) - S(Nn, x0, y1) - S(Nn, x1, y0) + S(Nn, x0, y0); return s / n; };
    const r5 = Math.round(500 / res), r20 = Math.round(2000 / res);
    const at = (i, j) => { const v = z[j * w + i]; return { z: v, t5: v - boxMean(i, j, r5), t20: v - boxMean(i, j, r20) }; };
    const ring = rings(feature)[0].map(([lo, la]) => { const [x, y] = toUTM30(la, lo); return [(x - (cx - H)) / res, ((cy + H) - y) / res]; });
    const inside = (px, py) => { let cc = false; for (let a = 0, b = ring.length - 1; a < ring.length; b = a++) { const [xa, ya] = ring[a], [xb, yb] = ring[b]; if ((ya > py) !== (yb > py) && px < (xb - xa) * (py - ya) / (yb - ya) + xa) cc = !cc; } return cc; };
    let n = 0, s5 = 0, s20 = 0, sz = 0, low = null;
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) { if (!inside(i + .5, j + .5)) continue; const p = at(i, j); if (!(p.z > -100)) continue; n++; s5 += p.t5; s20 += p.t20; sz += p.z; if (!low || p.z < low.z) low = p; }
    const mid = at(Math.floor(w / 2), Math.floor(h / 2));
    const par = n ? { z: sz / n, t5: s5 / n, t20: s20 / n } : mid;
    if (!low) low = mid;
    const H5 = 5600, u5 = `https://servicios.idee.es/wcs-inspire/mdt?SERVICE=WCS&VERSION=2.0.1&REQUEST=GetCoverage&COVERAGEID=Elevacion25830_200&FORMAT=image/tiff&SUBSET=x(${Math.round(cx - H5)},${Math.round(cx + H5)})&SUBSET=y(${Math.round(cy - H5)},${Math.round(cy + H5)})`;
    try {
      const t5k = await G.GeoTIFF.fromArrayBuffer(await (await fetch(u5)).arrayBuffer()); const im5 = await t5k.getImage();
      const w5 = im5.getWidth(), h5 = im5.getHeight(), [r5k] = await im5.readRasters(), res5 = 2 * H5 / w5, k5 = 5000 / res5;
      const pctOf = z0 => { let n5 = 0, lo = 0; for (let j = 0; j < h5; j++) for (let i = 0; i < w5; i++) { const dx = i + .5 - w5 / 2, dy = j + .5 - h5 / 2; if (dx * dx + dy * dy > k5 * k5) continue; const v = r5k[j * w5 + i]; if (v < -100) continue; n5++; if (v < z0) lo++; } return lo / n5; };
      par.pct = pctOf(par.z); low.pct = pctOf(low.z);
    } catch (e) { par.pct = low.pct = null; }
    return { par, low, n };
  }
  function reliefDelta(p, elevCell, info) {
    const RL = G.RELIEVE; const f = q => RL.b5 * q.t5 + RL.b20 * q.t20 + (q.pct != null ? RL.bp * q.pct : RL.bp * 0.4) + RL.c * (q.z - elevCell);
    const ws = info.map(s => 1 / Math.max(s[2], 3) ** 2), W = ws.reduce((a, b) => a + b, 0);
    const ref = info.reduce((a, s, i) => a + (RL.est[s[0]] || 0) * ws[i] / W, 0);
    return Math.max(-3, Math.min(3, f(p) - ref));
  }
  function adjustTmin(cell, d) {
    const t = new Int16Array(cell.tmin.length);
    for (let i = 0; i < t.length; i++) { const v = cell.tmin[i] / 10; const k = v <= 5 ? 1 : v >= 12 ? 0 : (12 - v) / 7; t[i] = Math.round((v + d * k) * 10); }
    return Object.assign({}, cell, { tmin: t });
  }
  const reliefClass = q => (q.pct != null && q.pct <= 0.15 && Math.abs(q.t5) < 3 && Math.abs(q.t20) < 10) ? 'fondo de vega o valle ancho' : q.t5 <= -5 ? 'fondo de vaguada' : q.t5 <= -2 ? 'zona baja' : q.t5 < 2 ? (q.pct != null && q.pct >= 0.85 ? 'llano alto (páramo)' : 'llano') : q.t5 < 5 ? 'zona alta' : 'loma o cerro';

  // ---------- preparar: celda + relieve ----------
  async function prepare(feature, opts = {}) {
    const st = opts.onStatus || (() => {});
    await ready();
    const c = center(feature), M = await loadMeta(), idx = cellIndex(M, c.lat, c.lng);
    if (!M.cells[idx]) { const e = new Error('Ese recinto queda fuera de la zona calculada (Castilla-La Mancha y bordes).'); e.code = 'fuera'; throw e; }
    st('Cargando 31 campañas de clima de la celda…');
    let cell = await loadCell(M, idx);
    let rel = null;
    if (opts.relieve !== false) { try { st('Leyendo el relieve de la parcela (IGN)…'); rel = await relief(feature, c); } catch (e) { rel = null; } }
    const elevCell = M.elev ? M.elev[idx] : null;
    if (rel && elevCell != null) { rel.delta = reliefDelta(rel.par, elevCell, M.cells[idx]); rel.deltaLow = reliefDelta(rel.low, elevCell, M.cells[idx]); rel.clase = reliefClass(rel.par); cell = adjustTmin(cell, rel.delta); }
    return { rel, c, idx, cell, info: M.cells[idx], elev: elevCell, d0: Date.parse(M.d0 + 'T00:00:00Z') };
  }

  // ---------- calcular: variedades, criterios, últimos 10 años ----------
  function overlap(fb, mb) { let t = 0, n = 0; for (let k = 0; k < fb.length; k++) { if (fb[k] == null || mb[k] == null) continue; const a = Math.max(fb[k] - 5, mb[k] - 6), b = Math.min(fb[k] + 5, mb[k] + 6); t += Math.max(0, b - a + 1) / 11; n++; } return n ? t / n : 0; }
  function compute(prep, CFG) {
    CFG = CFG || G.CONFIG;
    const { Motor, Criterios } = G; const { cell, d0 } = prep;
    const classify = (ml, bad) => { const V = CFG.verdict; return ml <= V.okLoss && bad <= V.okBad ? 'ok' : ml <= V.warnLoss && bad <= V.warnBad ? 'warn' : 'bad'; };
    const P = Motor.pistachio(cell, d0, CFG.pist), A = Motor.almond(cell, d0, CFG.alm);
    const shift = (cfgP, days) => { const c = JSON.parse(JSON.stringify(cfgP)); c.ref.gdh = cfgP.ref.gdh + days * P.gpd; return c; };
    const Pm = Motor.pistachio(cell, d0, shift(CFG.pist, -5)), Pp = Motor.pistachio(cell, d0, shift(CFG.pist, 5));
    const ash = d => { const c = JSON.parse(JSON.stringify(CFG.alm)); c.varieties = c.varieties.map(v => Object.assign({}, v, { offset: v.offset + d })); return c; };
    const Am = Motor.almond(cell, d0, ash(-5)), Ap = Motor.almond(cell, d0, ash(5));
    const sumP = R => { const out = []; const males = {}; for (const [n, o] of Object.entries(R.res)) if (o.v.sex === 'M') males[n] = o.rows.map(r => r ? r.fb : null);
      for (const [n, o] of Object.entries(R.res)) { const fb = o.rows.map(r => r ? r.fb : null);
        if (o.v.sex === 'M') { out.push({ nm: n, male: true, fb, mb: mean(fb), p10: pct(fb, .1), p90: pct(fb, .9) }); continue; }
        const l = o.rows.map(r => r ? r.loss : null), h = o.rows.map(r => r ? r.harv : null);
        const ml = mean(l), bad = l.filter(x => x > 50).length, late = h.filter(x => x != null && (x < 0 || x > CFG.verdict.lateHarvestDoy)).length;
        const ov = Object.fromEntries(Object.entries(males).map(([m, mb]) => [m, overlap(fb, mb)]));
        const best = (o.v.males || []).map(m => [m, ov[m] || 0]).sort((a, b) => b[1] - a[1])[0] || ['—', 0];
        let cls = classify(ml, bad); if (cls === 'ok' && (late > CFG.verdict.lateYears || best[1] < CFG.verdict.minOverlap)) cls = 'warn';
        const chillFail = o.rows.filter(r => r && !r.chillOk).length;
        out.push({ nm: n, v: o.v, rows: o.rows, fb, l, h, ml, bad, late, ov, best, cls, chillFail, autN: o.rows.filter(r => r && r.autumn).length, mb: mean(fb), p10: pct(fb, .1), p90: pct(fb, .9), mh: pct(h, .5) }); }
      return out; };
    const sumA = R => Object.entries(R.res).map(([n, o]) => { const fb = o.rows.map(r => r ? r.fb : null), l = o.rows.map(r => r ? r.loss : null); const ml = mean(l), bad = l.filter(x => x > 50).length;
      return { nm: n, v: o.v, rows: o.rows, fb, l, ml, bad, total: l.filter(x => x >= 90).length, cls: classify(ml, bad), mb: mean(fb), p10: pct(fb, .1), p90: pct(fb, .9) }; });
    const p = sumP(P), pm = sumP(Pm), pp = sumP(Pp), a = sumA(A), am = sumA(Am), ap = sumA(Ap);
    const robust = (base, m, pl) => base.forEach(r => { if (r.male) return; const c1 = m.find(x => x.nm === r.nm).cls, c2 = pl.find(x => x.nm === r.nm).cls; r.robust = c1 === r.cls && c2 === r.cls; r.alt = [c1, c2]; });
    robust(p, pm, pp); robust(a, am, ap);
    const ctx = { W: Motor.winterMin(cell, d0) }; ctx.y0 = (P.res.Kerman.rows.find(r => r) || {}).y;
    for (const r of p) { if (r.male) continue; r.mhTxt = fdate(r.mh); r.crit = Criterios.pist(cell, d0, r, ctx, CFG.crit.pist); const v = Criterios.verdict(r.crit); r.cls = v.cls; r.vd = v; }
    for (const r of a) { r.crit = Criterios.alm(cell, d0, r, ctx, CFG.crit.alm); const v = Criterios.verdict(r.crit); r.cls = v.cls; r.vd = v; }
    // mismos criterios con las 10 últimas campañas (el veredicto sigue saliendo de toda la serie)
    const yMax = Math.max(...ctx.W.map(x => x.y)), yR = yMax - 9;
    const cut = R => { const o = { res: {}, gpd: R.gpd }; for (const [n, v] of Object.entries(R.res)) o.res[n] = { v: v.v, rows: v.rows.map(x => x && x.y >= yR ? x : null) }; return o; };
    const ctxR = { W: ctx.W.filter(x => x.y >= yR) };
    const scl = (K, nR, nF) => Object.assign({}, K, { bad: K.bad.map(b => b * nR / nF) });
    const pR = sumP(cut(P)), aR = sumA(cut(A));
    for (const r of p) { if (r.male) continue; const q = pR.find(x => x.nm === r.nm); q.mhTxt = fdate(q.mh); const nR = q.rows.filter(Boolean).length, nF = r.rows.filter(Boolean).length;
      if (nR >= 8) { r.critR = Criterios.pist(cell, d0, q, ctxR, scl(CFG.crit.pist, nR, nF)); r.clsR = Criterios.verdict(r.critR).cls; } }
    for (const r of a) { const q = aR.find(x => x.nm === r.nm); const nR = q.rows.filter(Boolean).length, nF = r.rows.filter(Boolean).length;
      if (nR >= 8) { r.critR = Criterios.alm(cell, d0, q, ctxR, scl(CFG.crit.alm, nR, nF)); r.clsR = Criterios.verdict(r.critR).cls; } }
    // resumen de heladas por variedad (años con daño ≥ 10 % y daño grave > 50 %), toda la serie y últimos 10 años
    const frost = r => { const f = ys => { const v = r.rows.filter(q => q && ys(q.y)); return { n: v.length, dano: v.filter(q => q.loss >= 10).length, grave: v.filter(q => q.loss > 50).length }; };
      return { todo: f(() => true), ultimos10: f(y => y >= yR) }; };
    for (const r of [...p, ...a]) if (!r.male) r.heladas = frost(r);
    return { P: p, A: a, W: ctx.W, y0: ctx.y0, yR, yMax };
  }

  // ---------- todo en una llamada ----------
  // Devuelve { celda, relieve, pistacho: [...], almendro: [...], campañas: {desde, hasta, ultimos10: [desde, hasta]}, inviernos }
  //  · cada variedad: nm, cls ('ok' | 'warn' | 'bad'), clsR (últimos 10 años), crit / critR (criterios con nivel 0/1/2, valor y motivo),
  //    vd (criterios que excluyen / condicionan), heladas (años con daño y daño grave), rows (año a año: y, fb = día del año de plena flor,
  //    loss = % de pérdida, fz = peor helada {doy, t, st = índice de estado, d = días respecto a la flor}, harv = día de cosecha en pistacho), mb (flor media)
  //  · machos de pistacho: male: true, mb, p10, p90; cada hembra trae ov {macho: fracción de su floración cubierta}
  async function evaluar(feature, opts = {}) {
    const prep = await prepare(feature, opts);
    const r = compute(prep, opts.config);
    const lbl = { ok: 'Apta', warn: 'Apta con condiciones', bad: 'No apta' };
    return {
      version: 'aptitud-core ' + DATA_V,
      celda: { idx: prep.idx, altitud: prep.elev, estaciones: prep.info, centro: prep.c },
      relieve: prep.rel, pistacho: r.P, almendro: r.A, inviernos: r.W,
      campañas: { desde: r.W[0].y, hasta: r.W[r.W.length - 1].y, ultimos10: [r.yR, r.yMax] },
      etiquetas: lbl, estados: { pistacho: (G.CONFIG.pist.stageNames || []), almendro: (G.CONFIG.alm.stageNames || []) },
      _prep: prep
    };
  }

  G.AptitudCore = { evaluar, prepare, compute, ready, reliefClass, fdate, center, DATA_V, BASE };
})(window);
