(function () {
  const $ = id => document.getElementById(id);
  const DEF = JSON.parse(JSON.stringify(window.CONFIG));
  let CFG = DEF;
  try { const s = localStorage.getItem('aptitud-params'); if (s) CFG = Object.assign(JSON.parse(JSON.stringify(DEF)), JSON.parse(s)); } catch (e) {}
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
    const cell = Motor.cellArrays(buf, M.nd);
    current = { code: [String(p[0]).padStart(2, '0'), String(p[1]).padStart(3, '0'), p[2], p[3], p[4], p[5], p[6]].join(':'), pr, c, idx, cell, info: M.cells[idx], elev: M.elev ? M.elev[idx] : null, d0: Date.parse(M.d0 + 'T00:00:00Z') };
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
    render();
  }

  function render() {
    const C = current, pr = C.pr;
    $('pname').textContent = `Recinto ${C.code}`;
    const w = C.W.map(x => x.t), n = w.length;
    const st = C.info.map(s => `${s[1]} (${fmt(s[2])} km)`).join(' · ');
    $('facts').innerHTML = [['Recinto SIGPAC', C.code, 1], ['Superficie', fmt(pr.superficie, 2) + ' ha'], ['Altitud', (pr.altitud != null ? fmt(pr.altitud) + ' m' : '—') + (C.elev != null ? ` · celda ${fmt(C.elev)} m` : '')],
      ['Pendiente', fmt(pr.pendiente_media, 1) + ' %'], ['Uso SIGPAC', pr.uso_sigpac || '—'], ['Estaciones de corrección', st], ['Campañas', `${C.W[0].y}–${C.W[n - 1].y} (${n})`],
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
    const why = r => { const L = [...r.vd.ex.map(x => x.nombre), ...r.vd.co.map(x => x.nombre)]; return L.length ? L.join(' · ') : 'Sin limitaciones climáticas'; };
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
    $('crit').innerHTML = `<h2>${r.nm}: ${LBL[r.cls].toLowerCase()}</h2><div class="critlist">` + r.crit.slice().sort((a, b) => b.nivel - a.nivel).map(x => `<div class="crit l${x.nivel}"><span class="chip ${['ok', 'warn', 'bad'][x.nivel]}">${['Sin limitación', 'Condiciona', 'Excluye'][x.nivel]}</span><div><b>${x.nombre}</b><div class="cv">${x.valor}</div>${x.nivel ? `<div class="cm">${x.motivo}</div>` : ''}</div></div>`).join('') + '</div>';
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
  const PF = [['pist.ref.cp', 'Kerman: frío (porciones)'], ['pist.ref.gdh', 'Kerman: calor hasta flor (GDH)'], ['pist.stages.1.2', 'Pistacho: flor, T 10 % daño (°C)'], ['pist.stages.1.3', 'Pistacho: flor, T 90 % daño (°C)'], ['pist.stages.2.2', 'Pistacho: fruto cuajado, T 10 % (°C)'],
    ['alm.ref.cu', 'Guara: frío (unidades Utah)'], ['alm.ref.gdh', 'Guara: calor hasta flor (GDH)'], ['alm.stages.2.2', 'Almendro: flor abierta, T 10 % (°C)'], ['alm.stages.2.3', 'Almendro: flor abierta, T 90 % (°C)'], ['alm.stages.4.2', 'Almendro: fruto cuajado, T 10 % (°C)'],
    ['verdict.okLoss', 'Apta: pérdida media máx. (%)'], ['verdict.warnLoss', 'Con riesgo: pérdida media máx. (%)']];
  const getp = (o, p) => p.split('.').reduce((a, k) => a[k], o); const setp = (o, p, v) => { const ks = p.split('.'); const last = ks.pop(); ks.reduce((a, k) => a[k], o)[last] = v; };
  $('params').innerHTML = PF.map(([p, l]) => `<label>${l}<input id="p-${p.replace(/\./g, '_')}" data-p="${p}" type="number" step="any" value="${getp(CFG, p)}"></label>`).join('');
  $('recalc').onclick = () => { document.querySelectorAll('[data-p]').forEach(i => setp(CFG, i.dataset.p, parseFloat(i.value))); try { localStorage.setItem('aptitud-params', JSON.stringify(CFG)); } catch (e) {} if (current) compute(); };
  $('reset').onclick = () => { CFG = JSON.parse(JSON.stringify(DEF)); try { localStorage.removeItem('aptitud-params'); } catch (e) {} document.querySelectorAll('[data-p]').forEach(i => i.value = getp(CFG, i.dataset.p)); if (current) compute(); };

  $('calib').innerHTML = (window.CALIB && window.CALIB.html) || '';
  $('method').innerHTML = (window.CALIB && window.CALIB.method) || '';
  const q = new URLSearchParams(location.search).get('r'); if (q) { $('code').value = q; analyse(q); }
})();
