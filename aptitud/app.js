(function () {
  const $ = id => document.getElementById(id);
  const DEF = JSON.parse(JSON.stringify(window.CONFIG));
  let CFG = DEF;
  try { const s = localStorage.getItem('aptitud-params-v5'); if (s) CFG = Object.assign(JSON.parse(JSON.stringify(DEF)), JSON.parse(s)); } catch (e) {}
  let META = null, current = null, state = { sp: 'p', sel: null };
  const MES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  const fdate = doy => { if (doy == null || doy < 0) return '—'; const d = new Date(Date.UTC(2021, 0, 1) + (Math.round(doy) - 1) * 864e5); return d.getUTCDate() + ' ' + MES[d.getUTCMonth()]; };
  const fmt = (x, d = 0) => x == null || isNaN(x) ? '—' : x.toLocaleString('es-ES', { maximumFractionDigits: d, minimumFractionDigits: d });
  const mean = a => { const v = a.filter(x => x != null && x >= 0); return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null; };
  const pct = (a, q) => { const v = a.filter(x => x != null && x >= 0).sort((x, y) => x - y); return v.length ? v[Math.min(v.length - 1, Math.floor(q * (v.length - 1)))] : null; };
  const status = t => $('status').textContent = t;

  // ---------- mapa ----------
  const map = L.map('map', { zoomControl: true }).setView([39.3, -2.9], 8);
  L.tileLayer('https://www.ign.es/wmts/pnoa-ma?request=GetTile&service=WMTS&VERSION=1.0.0&Layer=OI.OrthoimageCoverage&Style=default&Format=image/jpeg&TileMatrixSet=GoogleMapsCompatible&TileMatrix={z}&TileRow={y}&TileCol={x}', { attribution: 'PNOA © IGN', maxZoom: 19 }).addTo(map);
  L.tileLayer.wms('https://wms.mapa.gob.es/sigpac/wms', { layers: 'recinto', format: 'image/png', transparent: true, minZoom: 15, attribution: 'SIGPAC © FEGA' }).addTo(map);
  setTimeout(() => map.invalidateSize(), 400); window.addEventListener('load', () => map.invalidateSize());
  let poly = null;
  map.on('click', async e => {
    status('Buscando el recinto…');
    try {
      const r = await (await fetch(`https://sigpac-hubcloud.es/servicioconsultassigpac/query/recinfobypoint/4258/${e.latlng.lng.toFixed(6)}/${e.latlng.lat.toFixed(6)}.json`)).json();
      if (!r || !r.length) { status('No hay recinto SIGPAC en ese punto.'); return; }
      const x = r[0]; const code = [x.provincia, x.municipio, x.agregado, x.zona, x.poligono, x.parcela, x.recinto].join(':');
      $('code').value = code; analyse(code);
    } catch (err) { status('No se pudo consultar el SIGPAC. Inténtalo de nuevo.'); }
  });
  $('form').addEventListener('submit', e => { e.preventDefault(); analyse($('code').value.trim()); });


  // ---------- relieve (MDT 25 m del IGN, servicio WCS) ----------
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
  function loadGeoTIFF() { if (window.GeoTIFF) return Promise.resolve(); if (!geotiffReady) geotiffReady = new Promise((res, rej) => { const sc = document.createElement('script'); sc.src = 'https://cdn.jsdelivr.net/npm/geotiff@2.1.3/dist-browser/geotiff.js'; sc.onload = res; sc.onerror = rej; document.head.appendChild(sc); }); return geotiffReady; }
  async function relief(feature, center) {
    await loadGeoTIFF();
    const [cx, cy] = toUTM30(center.lat, center.lng), H = 2500, R = 25;
    const u = `https://servicios.idee.es/wcs-inspire/mdt?SERVICE=WCS&VERSION=2.0.1&REQUEST=GetCoverage&COVERAGEID=Elevacion25830_25&FORMAT=image/tiff&SUBSET=x(${Math.round(cx - H)},${Math.round(cx + H)})&SUBSET=y(${Math.round(cy - H)},${Math.round(cy + H)})`;
    const t = await GeoTIFF.fromArrayBuffer(await (await fetch(u)).arrayBuffer()); const im = await t.getImage();
    const w = im.getWidth(), h = im.getHeight(), [z] = await im.readRasters(), res = 2 * H / w;
    // imagen integral para medias de ventana
    const I = new Float64Array((w + 1) * (h + 1)), Nn = new Float64Array((w + 1) * (h + 1));
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) { const v = z[j * w + i], ok = v > -100; const k = (j + 1) * (w + 1) + i + 1; I[k] = (ok ? v : 0) + I[k - 1] + I[k - w - 1] - I[k - w - 2]; Nn[k] = (ok ? 1 : 0) + Nn[k - 1] + Nn[k - w - 1] - Nn[k - w - 2]; }
    const boxMean = (i, j, r) => { const x0 = Math.max(0, i - r), x1 = Math.min(w, i + r + 1), y0 = Math.max(0, j - r), y1 = Math.min(h, j + r + 1); const S = (A, a, b) => A[b * (w + 1) + a]; const s = S(I, x1, y1) - S(I, x0, y1) - S(I, x1, y0) + S(I, x0, y0), n = S(Nn, x1, y1) - S(Nn, x0, y1) - S(Nn, x1, y0) + S(Nn, x0, y0); return s / n; };
    const r5 = Math.round(500 / res), r20 = Math.round(2000 / res);
    const at = (i, j) => { const v = z[j * w + i]; return { z: v, t5: v - boxMean(i, j, r5), t20: v - boxMean(i, j, r20) }; };
    // píxeles del recinto
    const ring = (feature.geometry.type === 'Polygon' ? feature.geometry.coordinates[0] : feature.geometry.coordinates[0][0]).map(([lo, la]) => { const [x, y] = toUTM30(la, lo); return [(x - (cx - H)) / res, ((cy + H) - y) / res]; });
    const inside = (px, py) => { let c = false; for (let a = 0, b = ring.length - 1; a < ring.length; b = a++) { const [xa, ya] = ring[a], [xb, yb] = ring[b]; if ((ya > py) !== (yb > py) && px < (xb - xa) * (py - ya) / (yb - ya) + xa) c = !c; } return c; };
    let n = 0, s5 = 0, s20 = 0, sz = 0, low = null;
    for (let j = 0; j < h; j += 1) for (let i = 0; i < w; i += 1) { if (!inside(i + .5, j + .5)) continue; const p = at(i, j); if (!(p.z > -100)) continue; n++; s5 += p.t5; s20 += p.t20; sz += p.z; if (!low || p.z < low.z) low = p; }
    const mid = at(Math.floor(w / 2), Math.floor(h / 2));
    const par = n ? { z: sz / n, t5: s5 / n, t20: s20 / n } : mid;
    if (!low) low = mid;
    // escala de 5 km (MDT 200 m): fracción del terreno que queda por debajo
    const H5 = 5600, u5 = `https://servicios.idee.es/wcs-inspire/mdt?SERVICE=WCS&VERSION=2.0.1&REQUEST=GetCoverage&COVERAGEID=Elevacion25830_200&FORMAT=image/tiff&SUBSET=x(${Math.round(cx - H5)},${Math.round(cx + H5)})&SUBSET=y(${Math.round(cy - H5)},${Math.round(cy + H5)})`;
    try {
      const t5k = await GeoTIFF.fromArrayBuffer(await (await fetch(u5)).arrayBuffer()); const im5 = await t5k.getImage();
      const w5 = im5.getWidth(), h5 = im5.getHeight(), [r5k] = await im5.readRasters(), res5 = 2 * H5 / w5, k5 = 5000 / res5;
      const pctOf = z0 => { let n5 = 0, lo = 0; for (let j = 0; j < h5; j++) for (let i = 0; i < w5; i++) { const dx = i + .5 - w5 / 2, dy = j + .5 - h5 / 2; if (dx * dx + dy * dy > k5 * k5) continue; const v = r5k[j * w5 + i]; if (v < -100) continue; n5++; if (v < z0) lo++; } return lo / n5; };
      par.pct = pctOf(par.z); low.pct = pctOf(low.z);
    } catch (e) { par.pct = low.pct = null; }
    return { par, low, n };
  }
  function reliefDelta(p, elevCell, info) {
    const RL = window.RELIEVE; const f = q => RL.b5 * q.t5 + RL.b20 * q.t20 + (q.pct != null ? RL.bp * q.pct : RL.bp * 0.4) + RL.c * (q.z - elevCell);
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

  async function loadMeta() { if (!META) META = await (await fetch('grid/meta.json')).json(); return META; }

  async function analyse(code) {
    const p = code.split(/[:.\-\s\/]+/).map(Number);
    if (p.length !== 7 || p.some(isNaN)) { status('El código debe tener 7 números: provincia, municipio, agregado, zona, polígono, parcela y recinto.'); return; }
    status('Consultando el recinto en el SIGPAC…');
    let gj;
    try { gj = await (await fetch(`https://sigpac-hubcloud.es/servicioconsultassigpac/query/recinfo/${p.join('/')}.geojson`)).json(); } catch (e) { status('No se pudo consultar el SIGPAC.'); return; }
    if (!gj.features || !gj.features.length) { status('Ese recinto no existe en el SIGPAC. Revisa el código.'); return; }
    const f = gj.features[0]; const pr = f.properties;
    if (poly) map.removeLayer(poly);
    poly = L.geoJSON(f, { style: { color: '#ffd23f', weight: 3, fillOpacity: .08 } }).addTo(map); map.invalidateSize(); map.fitBounds(poly.getBounds(), { maxZoom: 16 });
    const c = poly.getBounds().getCenter();
    const M = await loadMeta();
    const lat = M.lat, lon = M.lon;
    const i = lat.reduce((b, v, k) => Math.abs(v - c.lat) < Math.abs(lat[b] - c.lat) ? k : b, 0);
    const j = lon.reduce((b, v, k) => Math.abs(v - c.lng) < Math.abs(lon[b] - c.lng) ? k : b, 0);
    const idx = i * lon.length + j;
    if (!M.cells[idx]) { status('Ese recinto queda fuera de la zona calculada (Castilla-La Mancha y bordes).'); return; }
    status('Cargando 31 campañas de clima de la celda…');
    const resp = await fetch(`grid/celdas/${idx}.bin.gz`);
    const buf = await new Response(resp.body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
    let cell = Motor.cellArrays(buf, M.nd);
    let rel = null;
    try { status('Leyendo el relieve de la parcela (IGN)…'); rel = await relief(f, c); } catch (e) { rel = null; }
    const elevCell = M.elev ? M.elev[idx] : null;
    if (rel && elevCell != null) { rel.delta = reliefDelta(rel.par, elevCell, M.cells[idx]); rel.deltaLow = reliefDelta(rel.low, elevCell, M.cells[idx]); cell = adjustTmin(cell, rel.delta); }
    current = { rel, code: [String(p[0]).padStart(2, '0'), String(p[1]).padStart(3, '0'), p[2], p[3], p[4], p[5], p[6]].join(':'), pr, c, idx, cell, info: M.cells[idx], elev: M.elev ? M.elev[idx] : null, d0: Date.parse(M.d0 + 'T00:00:00Z') };
    state.sel = null; status(''); compute(); $('results').hidden = false;
  }

  function overlap(fb, mb) { let t = 0, n = 0; for (let k = 0; k < fb.length; k++) { if (fb[k] == null || mb[k] == null) continue; const a = Math.max(fb[k] - 5, mb[k] - 6), b = Math.min(fb[k] + 5, mb[k] + 6); t += Math.max(0, b - a + 1) / 11; n++; } return n ? t / n : 0; }

  function classify(ml, bad) { const V = CFG.verdict; return ml <= V.okLoss && bad <= V.okBad ? 'ok' : ml <= V.warnLoss && bad <= V.warnBad ? 'warn' : 'bad'; }
  const LBL = { ok: 'Apta', warn: 'Apta con condiciones', bad: 'No apta' };

  function compute() {
    const { cell, d0 } = current;
    const P = Motor.pistachio(cell, d0, CFG.pist), A = Motor.almond(cell, d0, CFG.alm);
    // sensibilidad: floración ±5 días (en calor equivalente)
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
      return { nm: n, rows: o.rows, fb, l, ml, bad, total: l.filter(x => x >= 90).length, cls: classify(ml, bad), mb: mean(fb), p10: pct(fb, .1), p90: pct(fb, .9) }; });
    const p = sumP(P), pm = sumP(Pm), pp = sumP(Pp), a = sumA(A), am = sumA(Am), ap = sumA(Ap);
    const robust = (base, m, pl) => base.forEach(r => { if (r.male) return; const c1 = m.find(x => x.nm === r.nm).cls, c2 = pl.find(x => x.nm === r.nm).cls; r.robust = c1 === r.cls && c2 === r.cls; r.alt = [c1, c2]; });
    robust(p, pm, pp); robust(a, am, ap);
    current.P = p; current.A = a; current.W = Motor.winterMin(cell, d0); current.y0 = (P.res.Kerman.rows.find(r => r) || {}).y;
    // criterios completos y veredicto razonado
    for (const r of p) { if (r.male) continue; r.mhTxt = fdate(r.mh); r.crit = Criterios.pist(cell, d0, r, current, CFG.crit.pist); const v = Criterios.verdict(r.crit); r.cls = v.cls; r.vd = v; }
    for (const r of a) { r.crit = Criterios.alm(cell, d0, r, current, CFG.crit.alm); const v = Criterios.verdict(r.crit); r.cls = v.cls; r.vd = v; }
    // mismos criterios con las 10 últimas campañas (el veredicto sigue saliendo de toda la serie)
    const yMax = Math.max(...current.W.map(x => x.y)), yR = yMax - 9; current.yR = yR; current.yMax = yMax;
    const cut = R => { const o = { res: {}, gpd: R.gpd }; for (const [n, v] of Object.entries(R.res)) o.res[n] = { v: v.v, rows: v.rows.map(x => x && x.y >= yR ? x : null) }; return o; };
    const curR = Object.assign({}, current, { W: current.W.filter(x => x.y >= yR) });
    const scl = (K, nR, nF) => Object.assign({}, K, { bad: K.bad.map(b => b * nR / nF) });
    const pR = sumP(cut(P)), aR = sumA(cut(A));
    for (const r of p) { if (r.male) continue; const q = pR.find(x => x.nm === r.nm); q.mhTxt = fdate(q.mh); const nR = q.rows.filter(Boolean).length, nF = r.rows.filter(Boolean).length;
      if (nR >= 8) { r.critR = Criterios.pist(cell, d0, q, curR, scl(CFG.crit.pist, nR, nF)); r.clsR = Criterios.verdict(r.critR).cls; } }
    for (const r of a) { const q = aR.find(x => x.nm === r.nm); const nR = q.rows.filter(Boolean).length, nF = r.rows.filter(Boolean).length;
      if (nR >= 8) { r.critR = Criterios.alm(cell, d0, q, curR, scl(CFG.crit.alm, nR, nF)); r.clsR = Criterios.verdict(r.critR).cls; } }
    render();
  }

  function render() {
    const C = current, pr = C.pr;
    $('pname').textContent = `Recinto ${C.code}`;
    const w = C.W.map(x => x.t), n = w.length;
    const st = C.info.map(s => `${s[1]} (${fmt(s[2])} km)`).join(' · ');
    $('facts').innerHTML = [['Recinto SIGPAC', C.code, 1], ['Superficie', fmt(pr.superficie, 2) + ' ha'], ['Altitud', (pr.altitud != null ? fmt(pr.altitud) + ' m' : '—') + (C.elev != null ? ` · celda ${fmt(C.elev)} m` : '')],
      ['Pendiente', fmt(pr.pendiente_media, 1) + ' %'],
      ['Relieve', C.rel ? `${reliefClass(C.rel.par)}${C.rel.par.pct != null ? ` (el ${Math.round((1 - C.rel.par.pct) * 100)} % del terreno en 5 km está más alto)` : ''} · noches de helada ${C.rel.delta >= 0 ? '+' : '−'}${fmt(Math.abs(C.rel.delta), 1)} °C respecto a la celda${C.rel.deltaLow < C.rel.delta - 0.3 ? ` · zona más baja del recinto ${C.rel.deltaLow >= 0 ? '+' : '−'}${fmt(Math.abs(C.rel.deltaLow), 1)} °C` : ''}` : 'no disponible (sin ajuste)'], ['Uso SIGPAC', pr.uso_sigpac || '—'], ['Estaciones de corrección', st], ['Campañas', `${C.W[0].y}–${C.W[n - 1].y} (${n})`],
      ['Inviernos ≤ −12 °C', `${w.filter(x => x <= -12).length} de ${n} · mín. ${fmt(Math.min(...w), 1)} °C`]]
      .map(([k, v, code]) => `<div class="fact"><div class="k">${k}</div><div class="v${code ? ' code' : ''}">${v}</div></div>`).join('');
    document.querySelectorAll('[data-sp]').forEach(b => { b.setAttribute('aria-pressed', state.sp === b.dataset.sp); b.onclick = () => { state.sp = b.dataset.sp; state.sel = null; render(); }; });
    const rows = state.sp === 'p' ? C.P : C.A; const fem = rows.filter(r => !r.male).sort((a, b) => a.ml - b.ml);
    if (!state.sel || !rows.find(r => r.nm === state.sel)) state.sel = fem[0].nm;
    const spn = state.sp === 'p' ? 'pistacho' : 'almendro';
    const ok = fem.filter(r => r.cls === 'ok').map(r => r.nm), wa = fem.filter(r => r.cls === 'warn').map(r => r.nm);
    $('rankTitle').textContent = state.sp === 'p' ? 'Variedades de pistacho' : 'Variedades de almendro (autofértiles)';
    $('verdict').textContent = ok.length ? `${ok.length === 1 ? 'Variedad apta' : 'Variedades aptas'} de ${spn}: ${ok.join(', ')}.${wa.length ? ' Aptas con condiciones: ' + wa.join(', ') + '.' : ''}` : wa.length ? `Ninguna variedad de ${spn} sale apta sin condiciones. Aptas con condiciones: ${wa.join(', ')}.` : `Zona no apta para ${spn}: todas las variedades tienen algún criterio que las excluye.`;
    const chip = r => `<span class="chip ${r.cls}">${LBL[r.cls]}</span>`;
    const why = r => { const L = [...r.vd.ex.map(x => x.nombre), ...r.vd.co.map(x => x.nombre)]; return (L.length ? L.join(' · ') : 'Sin limitaciones climáticas') + (r.clsR && r.clsR !== r.cls ? ` <em>· últimos 10 años: ${LBL[r.clsR].toLowerCase()}</em>` : ''); };
    let head, body;
    if (state.sp === 'a') {
      head = '<tr><th>Variedad</th><th>Veredicto</th><th>Motivos</th><th>Plena flor media</th><th>Pérdida por helada</th></tr>';
      body = fem.map(r => `<tr class="row" tabindex="0" data-nm="${r.nm}" aria-selected="${state.sel === r.nm}"><td class="vname">${r.nm}</td><td>${chip(r)}</td><td class="why">${why(r)}</td><td>${fdate(r.mb)}</td><td>${fmt(r.ml)} %<span class="mini"><i style="width:${Math.min(100, r.ml)}%"></i></span></td></tr>`).join('');
      $('rankNote').textContent = 'Toca una variedad para ver todos los criterios con sus datos. Humedad, lluvia y viento se calculan con las estaciones SIAR desde 2000; las temperaturas, con Copernicus desde 1995.';
    } else {
      head = '<tr><th>Variedad</th><th>Veredicto</th><th>Motivos</th><th>Plena flor media</th><th>Pérdida por helada</th><th>Cosecha mediana</th></tr>';
      body = fem.map(r => `<tr class="row" tabindex="0" data-nm="${r.nm}" aria-selected="${state.sel === r.nm}"><td class="vname">${r.nm}</td><td>${chip(r)}</td><td class="why">${why(r)}</td><td>${fdate(r.mb)}</td><td>${fmt(r.ml)} %<span class="mini"><i style="width:${Math.min(100, r.ml)}%"></i></span></td><td>${fdate(r.mh)}</td></tr>`).join('')
        + rows.filter(r => r.male).map(r => `<tr><td class="vname">${r.nm}<span class="sex">macho</span></td><td><span class="chip na">Polinizador</span></td><td class="why">—</td><td>${fdate(r.mb)}</td><td colspan="2"></td></tr>`).join('');
      $('rankNote').textContent = 'Toca una variedad para ver todos los criterios con sus datos. Humedad, lluvia y viento se calculan con las estaciones SIAR desde 2000; las temperaturas, con Copernicus desde 1995.';
    }
    $('rank').innerHTML = `<thead>${head}</thead><tbody>${body}</tbody>`;
    document.querySelectorAll('#rank .row').forEach(tr => { const go = () => { state.sel = tr.dataset.nm; render(); }; tr.onclick = go; tr.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } }; });
    detail(rows.find(r => r.nm === state.sel), rows);
  }

  function detail(r, rows) {
    const y0 = current.W[0].y, n = r.l.length;
    const NV = ['Sin limitación', 'Condiciona', 'Excluye'], yr = `${current.yR}–${current.yMax}`;
    const rec = x => { const y = (r.critR || []).find(z => z.id === x.id); return y && y.nivel !== x.nivel ? `<div class="recent ${['ok', 'warn', 'bad'][y.nivel]}">Últimos 10 años (${yr}): <b>${NV[y.nivel].toLowerCase()}</b> · ${y.valor}</div>` : ''; };
    const head = r.clsR && r.clsR !== r.cls ? `<p class="note">Con toda la serie sale <b>${LBL[r.cls].toLowerCase()}</b>; con solo los últimos 10 años (${yr}) saldría <b>${LBL[r.clsR].toLowerCase()}</b>. El veredicto usa toda la serie; la diferencia indica hacia dónde va el clima.</p>` : r.clsR ? `<p class="note">Con solo los últimos 10 años (${yr}) el veredicto es el mismo.</p>` : '';
    $('crit').innerHTML = `<h2>${r.nm}: ${LBL[r.cls].toLowerCase()}</h2>${head}<div class="critlist">` + r.crit.slice().sort((a, b) => b.nivel - a.nivel).map(x => `<div class="crit l${x.nivel}"><span class="chip ${['ok', 'warn', 'bad'][x.nivel]}">${NV[x.nivel]}</span><div><b>${x.nombre}</b><div class="cv">${x.valor}</div>${x.nivel ? `<div class="cm">${x.motivo}</div>` : ''}${rec(x)}</div></div>`).join('') + '</div>';
    $('detTitle').textContent = `${r.nm}: pérdida por helada y fecha de floración, año a año`;
    $('detLegend').innerHTML = '<span style="--c:var(--frost)">Pérdida por helada</span><span style="--c:var(--flor)">Plena flor prevista</span>';
    const W = 620, H = 250, ml = 40, mr = 46, mt = 12, mb = 34, iw = W - ml - mr, ih = H - mt - mb, bw = iw / n;
    const fbv = r.fb.filter(x => x != null); const bmin = Math.min(...fbv) - 4, bmax = Math.max(...fbv) + 4; const yb = d => mt + ih - (d - bmin) / (bmax - bmin) * ih;
    let s = `<svg viewBox="0 0 ${W} ${H}" width="100%" style="min-width:520px" role="img" aria-label="Pérdida por helada y floración de ${r.nm}">`;
    for (const v of [0, 25, 50, 75, 100]) { const y = mt + ih - v / 100 * ih; s += `<line x1="${ml}" x2="${W - mr}" y1="${y}" y2="${y}" stroke="var(--line)"/><text x="${ml - 6}" y="${y + 4}" text-anchor="end">${v}%</text>`; }
    for (let d = Math.ceil(bmin / 10) * 10; d <= bmax; d += 10) s += `<text x="${W - mr + 6}" y="${yb(d) + 4}">${fdate(d)}</text>`;
    r.l.forEach((v, i) => { if (v == null) return; const h = v / 100 * ih; const rw = r.rows[i]; s += `<rect x="${ml + i * bw + 1.5}" y="${mt + ih - h}" width="${bw - 3}" height="${h}" fill="var(--frost)" opacity="${v >= 50 ? 1 : .55}"><title>${y0 + i}: ${v} % de pérdida · mín. ${rw ? fmt(rw.tminBloom, 1) : '—'} °C en floración</title></rect>`; if (i % 5 === 0 || i === n - 1) s += `<text x="${ml + i * bw + bw / 2}" y="${H - mb + 16}" text-anchor="middle">${y0 + i}</text>`; });
    let path = ''; r.fb.forEach((d, i) => { if (d == null) return; path += (path ? 'L' : 'M') + (ml + i * bw + bw / 2).toFixed(1) + ',' + yb(d).toFixed(1); });
    s += `<path d="${path}" fill="none" stroke="var(--flor)" stroke-width="1.8"/>`;
    r.fb.forEach((d, i) => { if (d != null) s += `<circle cx="${ml + i * bw + bw / 2}" cy="${yb(d)}" r="2.6" fill="var(--flor)"><title>${y0 + i}: plena flor ${fdate(d)}</title></circle>`; });
    s += `<line x1="${ml}" x2="${W - mr}" y1="${mt + ih}" y2="${mt + ih}" stroke="var(--muted)"/></svg>`;
    $('yearChart').innerHTML = s;
    if (state.sp === 'p') {
      const ms = rows.filter(x => x.male), items = [r, ...ms]; const all = items.flatMap(x => [x.p10 - 6, x.p90 + 6]); const lo = Math.min(...all), hi = Math.max(...all);
      const W2 = 380, rowH = 34, H2 = items.length * rowH + 40, l2 = 92, r2 = 12, iw2 = W2 - l2 - r2, x = d => l2 + (d - lo) / (hi - lo) * iw2;
      let g = `<svg viewBox="0 0 ${W2} ${H2}" width="100%" role="img" aria-label="Floración de ${r.nm} y machos">`;
      for (let d = Math.ceil(lo / 7) * 7; d <= hi; d += 7) g += `<line x1="${x(d)}" x2="${x(d)}" y1="8" y2="${H2 - 26}" stroke="var(--line)"/><text x="${x(d)}" y="${H2 - 10}" text-anchor="middle">${fdate(d)}</text>`;
      items.forEach((it, i) => { const y = 12 + i * rowH, half = it.male ? 6 : 5, col = it.male ? 'var(--pist)' : 'var(--flor)';
        g += `<text x="0" y="${y + 15}" style="fill:var(--ink)">${it.nm}</text><rect x="${x(it.p10 - half)}" y="${y + 4}" width="${x(it.p90 + half) - x(it.p10 - half)}" height="16" rx="3" fill="${col}" opacity=".22"/><rect x="${x(it.mb - half)}" y="${y + 4}" width="${x(it.mb + half) - x(it.mb - half)}" height="16" rx="3" fill="${col}"/>`;
        if (it.male) g += `<text x="${W2 - r2}" y="${y + 16}" text-anchor="end" style="fill:var(--ink);font-weight:600">${fmt(r.ov[it.nm] * 100)}%</text>`; });
      $('sideChart').innerHTML = '<div class="eyebrow" style="margin-bottom:6px">Coincidencia de floración con los machos</div>' + g + '</svg>';
      $('detNote').textContent = `Banda oscura: ventana media (hembra receptiva ±5 días, macho emitiendo polen ±6 días); banda clara: rango entre años. Machos recomendados para ${r.nm}: ${(r.v.males || []).join(', ')}. Helada de otoño antes de la cosecha: ${r.autN} de ${n} años.`;
    } else {
      const order = rows.slice().sort((a, b) => a.mb - b.mb); const W2 = 380, rowH = 22, H2 = order.length * rowH + 30, l2 = 118, iw2 = W2 - l2 - 50, x = v => l2 + v / 100 * iw2;
      let g = `<svg viewBox="0 0 ${W2} ${H2}" width="100%" role="img" aria-label="Pérdida media por variedad">`;
      order.forEach((it, i) => { const y = 6 + i * rowH, me = it.nm === r.nm; g += `<text x="0" y="${y + 13}" style="fill:${me ? 'var(--ink)' : 'var(--muted)'};font-weight:${me ? 600 : 400}">${it.nm}</text><rect x="${l2}" y="${y + 3}" width="${Math.max(0, x(it.ml) - l2)}" height="13" rx="2" fill="var(--frost)" opacity="${me ? 1 : .45}"/><text x="${x(it.ml) + 5}" y="${y + 13}">${fmt(it.ml)}%</text>`; });
      $('sideChart').innerHTML = '<div class="eyebrow" style="margin-bottom:6px">Pérdida media, de la más temprana a la más tardía</div>' + g + '</svg>';
      $('detNote').textContent = 'Cada barra es la flor o el fruto perdido por helada ese año; la línea rosa, la fecha de plena flor prevista. Pasa el dedo por una barra para ver la mínima en floración.';
    }
  }

  // ---------- parámetros ----------
  const PF = [['pist.ref.cp', 'Kerman: frío (porciones)'], ['pist.ref.gdh', 'Kerman: calor hasta flor (GDH)'], ['pist.stages.2.2', 'Pistacho: flor, T 10 % daño (°C)'], ['pist.stages.2.3', 'Pistacho: flor, T 90 % daño (°C)'], ['pist.stages.3.2', 'Pistacho: fruto cuajado, T 10 % (°C)'],
    ['alm.ref.cu', 'Guara: frío (unidades Utah)'], ['alm.ref.gdh', 'Guara: calor hasta flor (GDH)'], ['alm.stages.2.2', 'Almendro: flor abierta, T 10 % (°C)'], ['alm.stages.2.3', 'Almendro: flor abierta, T 90 % (°C)'], ['alm.stages.4.2', 'Almendro: fruto cuajado, T 10 % (°C)'],
    ['verdict.okLoss', 'Apta: pérdida media máx. (%)'], ['verdict.warnLoss', 'Con riesgo: pérdida media máx. (%)']];
  const getp = (o, p) => p.split('.').reduce((a, k) => a[k], o); const setp = (o, p, v) => { const ks = p.split('.'); const last = ks.pop(); ks.reduce((a, k) => a[k], o)[last] = v; };
  $('params').innerHTML = PF.map(([p, l]) => `<label>${l}<input id="p-${p.replace(/\./g, '_')}" data-p="${p}" type="number" step="any" value="${getp(CFG, p)}"></label>`).join('');
  $('recalc').onclick = () => { document.querySelectorAll('[data-p]').forEach(i => setp(CFG, i.dataset.p, parseFloat(i.value))); try { localStorage.setItem('aptitud-params-v5', JSON.stringify(CFG)); } catch (e) {} if (current) compute(); };
  $('reset').onclick = () => { CFG = JSON.parse(JSON.stringify(DEF)); try { localStorage.removeItem('aptitud-params-v5'); } catch (e) {} document.querySelectorAll('[data-p]').forEach(i => i.value = getp(CFG, i.dataset.p)); if (current) compute(); };

  $('calib').innerHTML = (window.CALIB && window.CALIB.html) || '';
  $('method').innerHTML = (window.CALIB && window.CALIB.method) || '';
  const q = new URLSearchParams(location.search).get('r'); if (q) { $('code').value = q; analyse(q); }
})();
