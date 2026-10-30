(function () {
  const $ = id => document.getElementById(id);
  const DEF = JSON.parse(JSON.stringify(window.CONFIG));
  const KEY = window.AptitudCore.PARAMS_KEY;
  let CFG = DEF;
  try { const s = localStorage.getItem(KEY); if (s) CFG = Object.assign(JSON.parse(JSON.stringify(DEF)), JSON.parse(s)); } catch (e) {}
  let META = null, current = null, state = { sp: 'p', sel: null, yy: new Set() };
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


  const reliefClass = q => AptitudCore.reliefClass(q);

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
    let prep;
    try { prep = await AptitudCore.prepare(f, { onStatus: status }); } catch (e) { status(e.code === 'fuera' ? e.message : 'No se pudo cargar el clima de la celda. Inténtalo de nuevo.'); return; }
    current = Object.assign(prep, { code: [String(p[0]).padStart(2, '0'), String(p[1]).padStart(3, '0'), p[2], p[3], p[4], p[5], p[6]].join(':'), pr });
    state.sel = null; status(''); compute(); $('results').hidden = false;
  }

  const LBL = { ok: 'Apta', warn: 'Apta con condiciones', bad: 'No apta' };

  function compute() { Object.assign(current, AptitudCore.compute(current, CFG)); render(); }

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
    const why = r => { const L = [...r.vd.ex.map(x => x.nombre), ...r.vd.co.map(x => x.nombre)]; return (L.length ? L.join(' · ') : 'Sin limitaciones climáticas') + (r.clsTodo && r.clsTodo !== r.cls ? ` <em>· toda la serie: ${LBL[r.clsTodo].toLowerCase()}</em>` : ''); };
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
    document.querySelectorAll('#sideChart .vrow').forEach(b => b.onclick = () => { state.sel = b.dataset.nm; render(); });
  }

  // ---------- «Año a año» de cada criterio: una ficha como la de heladas, en su desplegable ----------
  const NVL = ['Sin limitación', 'Condiciona', 'Excluye'], KCLS = ['ok', 'warn', 'bad'];
  // lo común de una serie: años con dato, raya que pasa cada año, medias y textos
  function yyStats(s) {
    const y0 = current.W[0].y, n = current.yMax - y0 + 1, lims = s.lim.filter(l => l[0] != null && isFinite(l[0]));
    const P = s.ys.map((y, k) => ({ y, i: y - y0, v: s.v[k], w: s.w ? s.w[k] : null, x: s.ex ? s.ex[k] : null })).filter(p => p.i >= 0 && p.i < n);
    const neg = p => s.neg && p.v != null && p.v < 0;
    const hit = (v, l, k) => { const d = s.dir === 0 ? (k === 0 ? -1 : 1) : s.dir, ge = l[3] != null ? l[3] : s.ge; return d > 0 ? (ge ? v >= l[0] : v > l[0]) : (ge ? v <= l[0] : v < l[0]); };
    const kind = p => { if (neg(p)) return 'bad'; if (p.x) return ''; if (p.v == null) return null; let w = ''; lims.forEach((l, k) => { if (hit(p.v, l, k)) w = l[1] === 'bad' || w === 'bad' ? 'bad' : 'warn'; }); return w; };
    const bad = p => { if (neg(p)) return Infinity; if (p.v == null) return -Infinity; if (s.dir === 0 && lims.length > 1) return Math.max(lims[0][0] - p.v, p.v - lims[1][0]); return (s.dir || 1) * p.v; };
    const su = (s.u.match(/\((°C|%|mm|m\/s)\)/) || [])[1] || (/^Días/.test(s.u) ? 'días' : /^Horas/.test(s.u) ? 'h' : /^Porciones/.test(s.u) ? 'porciones' : '');
    const fv = v => s.fmt === 'doy' ? fdate(v) : fmt(v, s.fmt === 'pct' ? 0 : su === '°C' || (Math.abs(v) < 10 && v % 1) ? 1 : 0).replace(/^-/, '−') + (su ? (su === '%' ? ' %' : ' ' + su) : s.fmt === 'pct' ? ' %' : '');
    const val = p => neg(p) ? s.neg : p.x ? p.x : p.v == null ? 'sin dato' : fv(p.v);
    const med = a => { const v = a.slice().sort((x, y) => x - y); return v.length ? (v.length % 2 ? v[(v.length - 1) / 2] : (v[v.length / 2 - 1] + v[v.length / 2]) / 2) : null; };
    const grp = ys => { const q = P.filter(p => ys(p.y) && (p.v != null || neg(p) || p.x)), ok = q.filter(p => !neg(p) && p.v != null).map(p => p.v);
      const m = s.fmt === 'doy' ? med(ok) : ok.length ? ok.reduce((a, b) => a + b, 0) / ok.length : null;
      return { n: q.length, w: q.filter(p => kind(p)).length, b: q.filter(p => kind(p) === 'bad').length, m, y0: q.length ? q[0].y : '', y1: q.length ? q[q.length - 1].y : '' }; };
    const A = grp(() => true), R = grp(y => y >= current.yR);
    const c10 = (k, n) => n ? (k / n * 10).toLocaleString('es-ES', { maximumFractionDigits: 1 }) : '—';
    const hasBad = lims.some(l => l[1] === 'bad') || !!s.neg, two = s.dir === 0, hasWarn = two || lims.some(l => l[1] === 'warn');
    return { y0, n, P, lims, neg, hit, kind, bad, fv, val, A, R, c10, hasBad, hasWarn, two };
  }
  // contexto de un año: ventana de fechas de la variedad o periodo fijo
  function yyWhen(s, p) {
    if (s.inv) return `Invierno ${p.y - 1}–${String(p.y).slice(-2)}`;
    if (s.per) return s.per;
    if (s.wf && p.w) return s.wf.split(' · ').filter(q => p.w[1] != null || !q.includes('{b}')).join(' · ').replace(/ \(\{b\}\)| \{b\}/g, m => p.w[1] != null ? m.replace('{b}', fdate(p.w[1])) : '').replace('{a}', fdate(p.w[0])).replace('{f}', fdate(p.w[2]));
    return '';
  }
  function yyPanel(x, r, rows, box) {
    const s = x.serie, S = yyStats(s), { y0, n, P, lims, A, R } = S;
    if (!P.some(p => p.v != null)) { box.innerHTML = '<p class="note">Sin datos para esta parcela.</p>'; return; }
    const sel = (state.yySel = state.yySel || {})[x.id];
    const W = 580, ml = 46, mr = 104, iw = W - ml - mr, bw = iw / n, cx = i => ml + i * bw + bw / 2, xR = ml + (current.yR - y0) * bw;
    const ok = P.filter(p => p.v != null && !S.neg(p));
    const all = [...ok.map(p => p.v), ...lims.map(l => l[0])];
    let lo = Math.min(...all), hi = Math.max(...all); if (!s.pt) { lo = Math.min(lo, 0); hi = Math.max(hi, 0); }
    const pad = (hi - lo || 1) * .1; if (s.pt || lo < 0) lo -= pad; if (s.pt || hi > 0) hi += pad;
    const H = 262, t = 30, h = 176, inv = s.fmt === 'doy', Y = v => t + (inv ? v - lo : hi - v) / (hi - lo) * h;
    const col = k => k === 'bad' ? 'var(--bad)' : k === 'warn' ? 'var(--warn)' : 'var(--frost)';
    const step = (() => { const q = (hi - lo) / 5, p = Math.pow(10, Math.floor(Math.log10(q))), m = q / p; return (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * p; })();
    let g = `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="${x.nombre} de ${r.nm}, año a año">`;
    g += `<rect x="${xR}" y="${t - 18}" width="${W - mr - xR}" height="${h + 18}" fill="var(--frost)" opacity=".07"/><text x="${xR + 4}" y="${t - 6}" style="font-size:10.5px">últimos 10 años</text>`;
    g += `<text x="${ml - 6}" y="${t - 6}" text-anchor="end" style="font-size:10.5px">${s.fmt === 'doy' ? 'Fecha' : (s.u.match(/\(([^)]*)\)\s*$/) || [, ''])[1] || (/^Días/.test(s.u) ? 'días' : /^Horas/.test(s.u) ? 'horas' : /^Porciones/.test(s.u) ? 'porciones' : '')}</text>`;
    for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) g += `<line x1="${ml}" x2="${W - mr}" y1="${Y(v)}" y2="${Y(v)}" stroke="var(--line)"/><text x="${ml - 6}" y="${Y(v) + 4}" text-anchor="end">${s.fmt === 'doy' ? fdate(v) : fmt(Math.abs(v) < 1e-9 ? 0 : v, step < 1 ? 1 : 0).replace(/^-/, '−')}</text>`;
    const z = Y(Math.min(Math.max(0, lo), hi));
    ok.forEach(p => { const k = S.kind(p), c = col(k);
      if (s.pt) g += `<circle cx="${cx(p.i)}" cy="${Y(p.v)}" r="${k ? 4.2 : 3.6}" fill="${c}"${k ? '' : ' opacity=".8"'}/>`;
      else { const a = Y(p.v), y = Math.min(a, z), hh = Math.max(1.5, Math.abs(a - z)); g += `<rect x="${ml + p.i * bw + 2}" y="${y}" width="${bw - 4}" height="${hh}" rx="2" fill="${c}"${k ? '' : ' opacity=".55"'}/>`; } });
    P.filter(S.neg).forEach(p => { const yy = inv ? t + h - 6 : t + 6; g += `<path d="M${cx(p.i) - 4},${yy - 4}L${cx(p.i) + 4},${yy + 4}M${cx(p.i) - 4},${yy + 4}L${cx(p.i) + 4},${yy - 4}" stroke="var(--bad)" stroke-width="1.8"/>`; });
    P.filter(p => p.x && !S.neg(p)).forEach(p => { g += `<line x1="${cx(p.i) - 4}" x2="${cx(p.i) + 4}" y1="${z}" y2="${z}" stroke="var(--muted)" stroke-width="2"/>`; });
    P.filter(p => p.v == null && !S.neg(p) && !p.x).forEach(p => { g += `<text x="${cx(p.i)}" y="${z - 3}" text-anchor="middle" style="font-size:9px;opacity:.6">·</text>`; });
    lims.forEach(l => { const y = Y(l[0]), c = l[1] === 'bad' ? 'var(--bad)' : 'var(--warn)'; g += `<line x1="${ml}" x2="${W - mr}" y1="${y}" y2="${y}" stroke="${c}" stroke-dasharray="4 3" opacity=".85"/><text x="${W - mr + 6}" y="${y + 4}" style="font-size:10.5px;fill:${c}">${l[2]}</text>`; });
    if (A.m != null) g += `<line x1="${ml}" x2="${W - mr}" y1="${Y(A.m)}" y2="${Y(A.m)}" stroke="var(--ink)" stroke-dasharray="1 3" opacity=".55"/>`;
    if (R.m != null) g += `<line x1="${xR}" x2="${W - mr}" y1="${Y(R.m)}" y2="${Y(R.m)}" stroke="var(--ink)" stroke-width="1.6" opacity=".7"/>`;
    for (let i = 0; i < n; i++) if (i % 5 === 0 || i === n - 1) g += `<text x="${cx(i)}" y="${H - 24}" text-anchor="middle">${y0 + i}</text>`;
    // leyenda dentro del gráfico
    const ly = H - 7; let lx = ml;
    const li = (sym, txt) => { const o = `${sym(lx)}<text x="${lx + 14}" y="${ly + 4}" style="font-size:10.5px">${txt}</text>`; lx += 22 + txt.length * 5.3; return o; };
    g += li(x0 => s.pt ? `<circle cx="${x0 + 4}" cy="${ly}" r="3.5" fill="var(--frost)"/>` : `<rect x="${x0}" y="${ly - 5}" width="8" height="10" rx="2" fill="var(--frost)" opacity=".55"/>`, 'dato de cada año');
    if (A.m != null) g += li(x0 => `<line x1="${x0 - 2}" x2="${x0 + 10}" y1="${ly}" y2="${ly}" stroke="var(--ink)" stroke-dasharray="1 3" opacity=".7"/>`, `${s.fmt === 'doy' ? 'mediana' : 'media'} ${A.y0}–${A.y1}: ${S.fv(A.m)}`);
    if (R.m != null) g += li(x0 => `<line x1="${x0 - 2}" x2="${x0 + 10}" y1="${ly}" y2="${ly}" stroke="var(--ink)" stroke-width="1.6" opacity=".8"/>`, `últimos 10 años: ${S.fv(R.m)}`);
    if (s.neg) g += li(x0 => `<path d="M${x0},${ly - 4}L${x0 + 8},${ly + 4}M${x0},${ly + 4}L${x0 + 8},${ly - 4}" stroke="var(--bad)" stroke-width="1.8"/>`, s.neg);
    g += '</svg>';
    const lw = S.two ? 'quedan fuera de las rayas' : 'pasan la raya ámbar', lb = s.neg && !lims.some(l => l[1] === 'bad') ? s.neg : 'pasan la raya roja';
    const bTxt = s.neg && !lims.some(l => l[1] === 'bad') ? 'No completan el calor' : 'Pasan la raya roja';
    const sum = `<div class="ysum">${S.hasWarn ? `${S.two ? 'Fuera de las rayas' : 'Pasan la raya ámbar'} <b>${A.w} de ${A.n}</b> años (${S.c10(A.w, A.n)} de cada 10)${S.hasBad ? ` · ${bTxt.replace(/^Pasan la raya roja$/, 'la roja').toLowerCase()} <b>${A.b}</b> (${S.c10(A.b, A.n)} de cada 10)` : ''}. Últimos 10 años: ${R.w} de ${R.n}${S.hasBad ? `, ${R.b} en rojo` : ''}.` : `${bTxt} <b>${A.b} de ${A.n}</b> años (${S.c10(A.b, A.n)} de cada 10). Últimos 10 años: ${R.b} de ${R.n}.`}</div>`;
    const hits = `<div class="yhits">${P.map(p => `<button class="yhit" data-y="${p.y}" style="left:${(ml + p.i * bw) / W * 100}%;width:${bw / W * 100}%" aria-label="Ver ${p.y}"></button>`).join('')}</div>`;
    // columna derecha: toda la serie frente a los últimos 10 años, variedades y peores años
    const tbl = `<div class="frostbox"><div class="eyebrow">${x.nombre} · ${r.nm}</div><table class="ft"><thead><tr><th>Periodo</th>${S.hasWarn ? `<th>Años que ${lw}</th>` : ''}${S.hasBad ? `<th>Años que ${lb === s.neg ? 'no completan el calor' : 'pasan la roja'}</th>` : ''}<th>${s.fmt === 'doy' ? 'Mediana' : 'Media'}</th></tr></thead><tbody>`
      + [[`Todo el registro (${A.y0}–${A.y1})`, A], [`Últimos 10 años (${R.y0}–${R.y1})`, R]].map(([tt, o]) => `<tr><td>${tt}</td>${S.hasWarn ? `<td><b>${o.w}</b> de ${o.n}<br><small>${S.c10(o.w, o.n)} de cada 10 años</small></td>` : ''}${S.hasBad ? `<td><b>${o.b}</b> de ${o.n}<br><small>${S.c10(o.b, o.n)} de cada 10 años</small></td>` : ''}<td style="white-space:nowrap"><b>${o.m == null ? '—' : S.fv(o.m)}</b></td></tr>`).join('') + '</tbody></table></div>';
    const fem = rows.filter(q => !q.male), same = q => { const c = (q.critTodo || q.crit).find(z => z.id === x.id); return c && c.serie ? c.serie : null; };
    const varies = fem.some(q => { const o = same(q); return o && JSON.stringify(o.v) !== JSON.stringify(s.v); });
    let side = tbl;
    if (varies) {
      const its = fem.map(q => ({ q, s2: same(q) })).filter(o => o.s2).map(o => ({ ...o, st: yyStats(o.s2) })).sort((a, b) => a.q.mb - b.q.mb);
      side += `<div class="eyebrow" style="margin:14px 0 6px">Por variedades, de la más temprana a la más tardía</div><div class="vleg">${S.hasBad ? `<span><i style="background:var(--bad)"></i>${s.neg && !lims.some(l => l[1] === 'bad') ? 'No completa el calor' : 'Pasa la raya roja'}</span>` : ''}${S.hasWarn ? `<span><i style="background:var(--warn)"></i>${S.two ? 'Fuera de las rayas' : 'Pasa la raya ámbar'}</span>` : ''}<span><i style="background:var(--line)"></i>Año normal</span></div><div class="vcmp">`
        + its.map(({ q, st }) => { const wq = st.A.n ? st.A.w / st.A.n * 100 : 0, bq = st.A.n ? st.A.b / st.A.n * 100 : 0;
          return `<button class="vrow${q.nm === r.nm ? ' on' : ''}" data-nm="${q.nm}"><span class="vn">${q.nm}<small>flor ${fdate(q.mb)}</small></span><span class="vb"><i class="g" style="width:${bq}%"></i><i class="d" style="left:${bq}%;width:${wq - bq}%"></i></span><span class="vv">${S.hasWarn ? `<b class="vd">${st.c10(st.A.w, st.A.n)}</b> de cada 10${S.hasBad ? `<br><b>${st.c10(st.A.b, st.A.n)}</b> en rojo` : ''}` : `<b>${st.c10(st.A.b, st.A.n)}</b> de cada 10 en rojo`}<br>${s.fmt === 'doy' ? 'mediana' : 'media'} ${st.A.m == null ? '—' : st.fv(st.A.m)}</span></button>`; }).join('') + '</div>';
    }
    const worst = P.filter(p => p.v != null || S.neg(p)).sort((a, b) => S.bad(b) - S.bad(a)).slice(0, 6);
    const okv = ok.map(p => p.v), mn = Math.min(...okv), mx = Math.max(...okv), am = Math.max(...okv.map(Math.abs)) || 1, bar = v => s.pt ? .08 + .92 * (s.dir === -1 ? mx - v : v - mn) / ((mx - mn) || 1) : Math.abs(v) / am;
    const wl = `<div class="eyebrow" style="margin:14px 0 6px">Los peores años</div><div class="vcmp">` + worst.map(p => { const k = S.kind(p), wd = S.neg(p) ? 100 : Math.max(3, bar(p.v) * 100);
      return `<button class="vrow yw" data-y="${p.y}"><span class="vn">${p.y}<small>${yyWhen(s, p) || '&nbsp;'}</small></span><span class="vb"><i style="width:${wd}%;background:${col(k)}${k ? '' : ';opacity:.55'}"></i></span><span class="vv">${S.val(p)}</span></button>`; }).join('') + '</div>';
    const rule = `<b>Cómo cuenta para la aptitud.</b> ${x.motivo} Resultado con los últimos 10 años: <b>${NVL[x.nivel].toLowerCase()}</b> (${x.valor})${r.critTodo && r.crit !== r.critTodo ? (() => { const t2 = r.critTodo.find(z => z.id === x.id); return t2 ? `; con toda la serie: <b>${NVL[t2.nivel].toLowerCase()}</b> (${t2.valor})` : ''; })() : ''}.`;
    box.innerHTML = `<div class="detail-grid"><div class="chart">${sum}<div class="ywrap">${g}${hits}</div><div class="ycard yyv" aria-live="polite"></div>${wl}</div><div class="chart">${side}</div></div><p class="note" style="margin-top:10px">${s.nota} ${rule}</p>`;
    const pick = y => { const p = P.find(q => q.y === y); if (!p) return; state.yySel[x.id] = y; const k = S.kind(p);
      const all2 = P.filter(q => q.v != null || S.neg(q)), pos = all2.filter(q => S.bad(q) > S.bad(p)).length + 1, ties = all2.filter(q => S.bad(q) === S.bad(p)).length - 1;
      const tag = p.x ? 'no cuenta' : p.v == null && !S.neg(p) ? 'sin dato' : k === 'bad' ? (S.neg(p) ? 'no completa el calor' : 'pasa la raya roja') : k === 'warn' ? (S.two ? 'fuera de las rayas' : 'pasa la raya ámbar') : 'año normal';
      const which = k && !S.neg(p) ? lims.filter((l, j) => S.hit(p.v, l, j)).map(l => '«' + l[2] + '»').join(' y ') : '';
      const vsm = p.v != null && !S.neg(p) && A.m != null && s.fmt !== 'doy' ? ` · ${p.v >= A.m ? 'por encima' : 'por debajo'} de la media (${S.fv(A.m)})` : '';
      box.querySelector('.yyv').innerHTML = `<div class="yc-h"><b>${p.y}</b><span class="chip ${k || 'ok'}">${S.neg(p) || p.x ? S.val(p) : `${S.val(p)} · ${tag}`}</span></div>${yyWhen(s, p) ? `<div>${yyWhen(s, p)}</div>` : ''}<div>${which ? `Pasa la raya de ${which}.` : ''}${S.neg(p) ? ` Uno de los ${ties + 1} años de ${all2.length} en que no completa el calor.` : p.v != null ? ` Puesto ${pos} de ${all2.length}${P.some(q => q.x) ? ' años que cuentan' : ''} (1 = el peor año)${ties ? `, empatado con ${ties} ${ties === 1 ? 'año' : 'años'} más` : ''}${vsm}.` : ''}</div>`;
      box.querySelectorAll('.yhit').forEach(e => e.classList.toggle('on', +e.dataset.y === y)); };
    box.querySelectorAll('.yhit, .yw').forEach(b => b.onclick = () => pick(+b.dataset.y));
    box.querySelectorAll('.vrow[data-nm]').forEach(b => b.onclick = () => { state.sel = b.dataset.nm; render(); });
    const last = P.filter(p => p.v != null || S.neg(p)).pop();
    pick(sel && P.find(p => p.y === sel) ? sel : last.y);
  }
  function yyBox(r, rows) {
    const box = $('yyBox'); if (!box) return;
    const L = r.crit.filter(x => x.serie).slice().sort((a, b) => b.nivel - a.nivel);
    box.innerHTML = `<div class="panel-head"><h2>${r.nm}: cada criterio, año a año</h2><div class="legend"><span style="--c:var(--frost)">Año normal</span><span style="--c:var(--warn)">Pasa la raya ámbar</span><span style="--c:var(--bad)">Pasa la raya roja</span></div></div>`
      + `<p class="note">Abre un criterio para ver su dato de cada campaña, con sus umbrales, las medias de toda la serie y de los últimos 10 años, la comparación entre variedades y los peores años. Toca un año para ver su ficha.</p><div class="yylist">`
      + L.map(x => `<details class="yyd" data-id="${x.id}"${state.yy.has(x.id) ? ' open' : ''}><summary><span class="chip ${KCLS[x.nivel]}">${NVL[x.nivel]}</span><span class="yyn">${x.nombre}</span><span class="yys">${x.valor}</span></summary><div class="yyb"></div></details>`).join('') + '</div>';
    box.querySelectorAll('.yyd').forEach(d => { const x = r.crit.find(z => z.id === d.dataset.id), b = d.querySelector('.yyb');
      const go = () => { if (d.open) { state.yy.add(x.id); if (!b.dataset.done) { b.dataset.done = 1; yyPanel(x, r, rows, b); } } else state.yy.delete(x.id); };
      d.addEventListener('toggle', go); if (d.open) go(); });
  }

  function detail(r, rows) {
    const y0 = current.W[0].y, n = r.l.length;
    const NV = ['Sin limitación', 'Condiciona', 'Excluye'], yr = `${current.yR}–${current.yMax}`;
    const fr = (ys) => { const v = r.rows.filter(q => q && ys(q.y)); const n = v.length, d = v.filter(q => q.loss >= 10).length, g = v.filter(q => q.loss > 50).length;
      const c10 = k => n ? (k / n * 10).toLocaleString('es-ES', { maximumFractionDigits: 1 }) : '—';
      return { n, d, g, c10d: c10(d), c10g: c10(g), y0: v.length ? v[0].y : '', y1: v.length ? v[v.length - 1].y : '' }; };
    const A = fr(() => true), R = fr(y => y >= current.yR);
    const frost = `<div class="frostbox"><div class="eyebrow">Heladas de primavera · ${r.nm}</div><table class="ft"><thead><tr><th>Periodo</th><th>Años con daño<br><small>pérdida ≥ 10 %</small></th><th>Años con daño grave<br><small>pérdida &gt; 50 %</small></th></tr></thead><tbody>`
      + [[`Todo el registro (${A.y0}–${A.y1})`, A], [`Últimos 10 años (${R.y0}–${R.y1})`, R]].map(([t, o]) => `<tr><td>${t}</td><td><b>${o.d}</b> de ${o.n}<br><small>${o.c10d} de cada 10 años</small></td><td><b>${o.g}</b> de ${o.n}<br><small>${o.c10g} de cada 10 años</small></td></tr>`).join('')
      + `</tbody></table></div>`;
    // el resultado que manda (últimos 10 años; sucesos raros con toda la serie) y, debajo, el de toda la serie si cambia el nivel
    const yA = `${y0}–${current.yMax}`, comb = r.critTodo && r.crit !== r.critTodo;
    const per = x => comb && !x.soloTodo ? `Últimos 10 años (${yr})` : `Toda la serie (${yA})`;
    const todo = x => { if (!comb || x.soloTodo) return ''; const t = r.critTodo.find(z => z.id === x.id); return t && (t.nivel !== x.nivel || x.porSerie) ? `<div class="ctodo">Toda la serie (${yA}): <b>${NV[t.nivel].toLowerCase()}</b> · ${t.valor}</div>` : ''; };
    const head = comb ? `<p class="note">El veredicto se basa en los últimos 10 años; heladas y frío extremo tienen en cuenta toda la serie.${r.clsTodo && r.clsTodo !== r.cls ? ` Con toda la serie (${yA}) saldría <b>${LBL[r.clsTodo].toLowerCase()}</b>.` : ''}</p>` : `<p class="note">No hay suficientes campañas recientes: el veredicto usa toda la serie (${yA}).</p>`;
    const yy = x => x.serie ? `<button class="yylink" type="button" data-id="${x.id}">Año a año ↓</button>` : '';
    $('crit').innerHTML = `<h2>${r.nm}: ${LBL[r.cls].toLowerCase()}</h2>${head}${frost}<div class="critlist">` + r.crit.slice().sort((a, b) => b.nivel - a.nivel).map(x => `<div class="crit l${x.nivel}"><span class="chip ${['ok', 'warn', 'bad'][x.nivel]}">${NV[x.nivel]}</span><div><b>${x.nombre}</b><div class="cper">${per(x)}</div><div class="cv">${x.valor}</div>${x.nivel ? `<div class="cm">${x.motivo}</div>` : ''}${x.porSerie ? '<div class="recent warn">Se mantiene en condiciona por lo ocurrido en la serie completa</div>' : ''}${todo(x)}${yy(x)}</div></div>`).join('') + '</div>';
    yyBox(r, rows);
    document.querySelectorAll('#crit .yylink').forEach(b => b.onclick = () => { const d = document.querySelector(`#yyBox .yyd[data-id="${b.dataset.id}"]`); if (!d) return; d.open = true; d.scrollIntoView({ behavior: 'smooth', block: 'start' }); });
    $('detTitle').textContent = `${r.nm}: heladas y floración, año a año`;
    $('detLegend').innerHTML = '<span style="--c:var(--line)">Menos del 10 %</span><span style="--c:var(--warn)">Daño (10–50 %)</span><span style="--c:var(--bad)">Daño grave (&gt; 50 %)</span>';
    const SN = (state.sp === 'p' ? CFG.pist : CFG.alm).stageNames || [];
    const yrs = r.rows.map((q, i) => ({ q, y: y0 + i, i })).filter(o => o.q);
    const W = 640, ml = 46, mr = 14, iw = W - ml - mr, bw = iw / n, cx = i => ml + i * bw + bw / 2;
    const col = v => v > 50 ? 'var(--bad)' : v >= 10 ? 'var(--warn)' : 'var(--line)';
    const xR = ml + (current.yR - y0) * bw;
    // --- panel 1: pérdida ---
    const H1 = 170, t1 = 26, h1 = 120, y1 = v => t1 + h1 - v / 100 * h1;
    let s = `<svg viewBox="0 0 ${W} ${H1}" width="100%" role="img" aria-label="Pérdida por helada de ${r.nm} por año">`;
    s += `<rect x="${xR}" y="${t1 - 18}" width="${W - mr - xR}" height="${h1 + 18}" fill="var(--frost)" opacity=".07"/><text x="${xR + 4}" y="${t1 - 6}" style="font-size:10.5px">últimos 10 años</text>`;
    for (const v of [0, 50, 100]) s += `<line x1="${ml}" x2="${W - mr}" y1="${y1(v)}" y2="${y1(v)}" stroke="var(--line)"/><text x="${ml - 6}" y="${y1(v) + 4}" text-anchor="end">${v}%</text>`;
    s += `<line x1="${ml}" x2="${W - mr}" y1="${y1(10)}" y2="${y1(10)}" stroke="var(--warn)" stroke-dasharray="3 3" opacity=".7"/><line x1="${ml}" x2="${W - mr}" y1="${y1(50)}" y2="${y1(50)}" stroke="var(--bad)" stroke-dasharray="3 3" opacity=".7"/>`;
    yrs.forEach(({ q, i }) => { const v = q.loss, h = Math.max(1.5, v / 100 * h1); s += `<rect x="${ml + i * bw + 2}" y="${t1 + h1 - h}" width="${bw - 4}" height="${h}" rx="2" fill="${col(v)}"/>`; });
    s += `<text x="${ml - 6}" y="${t1 - 6}" text-anchor="end" style="font-size:10.5px">Pérdida</text></svg>`;
    // --- panel 2: calendario (flor, helada, cosecha) ---
    const ds = []; yrs.forEach(({ q }) => { ds.push(q.fb); if (q.fz && q.fz.kill > 0) ds.push(q.fz.doy); });
    const dlo = Math.min(...ds) - 4, dhi = Math.max(...ds) + 4, H2 = 190, t2 = 8, h2 = 130, y2 = d => t2 + (d - dlo) / (dhi - dlo) * h2;
    s += `<svg viewBox="0 0 ${W} ${H2}" width="100%" role="img" aria-label="Fecha de plena flor y de la helada dañina de ${r.nm} por año">`;
    s += `<rect x="${xR}" y="${t2}" width="${W - mr - xR}" height="${h2}" fill="var(--frost)" opacity=".07"/>`;
    for (let d = Math.ceil(dlo / 10) * 10; d <= dhi; d += 10) s += `<line x1="${ml}" x2="${W - mr}" y1="${y2(d)}" y2="${y2(d)}" stroke="var(--line)"/><text x="${ml - 6}" y="${y2(d) + 4}" text-anchor="end">${fdate(d)}</text>`;
    yrs.forEach(({ q, i }) => { const x = cx(i);
      if (q.fz && q.fz.kill > 0) { s += `<line x1="${x}" x2="${x}" y1="${y2(q.fb)}" y2="${y2(q.fz.doy)}" stroke="${col(q.loss)}" stroke-width="1.5" opacity=".6"/>`;
        const yy = y2(q.fz.doy); s += `<path d="M${x - 4},${yy}L${x + 4},${yy}M${x},${yy - 4}L${x},${yy + 4}M${x - 3},${yy - 3}L${x + 3},${yy + 3}M${x - 3},${yy + 3}L${x + 3},${yy - 3}" stroke="${col(q.loss)}" stroke-width="1.6"/>`; }
      s += `<circle cx="${x}" cy="${y2(q.fb)}" r="3.2" fill="var(--flor)"/>`; });
    yrs.forEach(({ y, i }) => { if (i % 5 === 0 || i === n - 1) s += `<text x="${cx(i)}" y="${H2 - 8}" text-anchor="middle">${y}</text>`; });
    s += `<circle cx="${ml + 4}" cy="${H2 - 26}" r="3" fill="var(--flor)"/><text x="${ml + 11}" y="${H2 - 22}" style="font-size:10.5px">plena flor</text><text x="${ml + 74}" y="${H2 - 21}" style="font-size:13px;fill:var(--bad)">✱</text><text x="${ml + 86}" y="${H2 - 22}" style="font-size:10.5px">helada que hizo el daño (su color, la gravedad)</text>`;
    s += `</svg>`;
    // --- panel 3 (pistacho): cosecha ---
    if (state.sp === 'p') { const hv = yrs.map(o => o.q.harv).filter(h => h > 0); if (hv.length) { const hlo = Math.min(...hv, 236) - 3, hhi = Math.max(...hv, 288) + 3, H3 = 112, t3 = 8, h3 = 92, y3 = d => t3 + (d - hlo) / (hhi - hlo) * h3;
      s += `<svg viewBox="0 0 ${W} ${H3}" width="100%" role="img" aria-label="Fecha de cosecha prevista de ${r.nm} por año"><text x="${ml + 4}" y="${t3 + 8}" style="font-size:10.5px">Cosecha prevista (la línea discontinua es el 15 de octubre · aspa: no completa el calor)</text>`;
      for (const d of [244, 258, 274, 288]) if (d >= hlo && d <= hhi) s += `<line x1="${ml}" x2="${W - mr}" y1="${y3(d)}" y2="${y3(d)}" stroke="${d === 288 ? 'var(--warn)' : 'var(--line)'}" ${d === 288 ? 'stroke-dasharray="3 3"' : ''}/><text x="${ml - 6}" y="${y3(d) + 4}" text-anchor="end">${fdate(d)}</text>`;
      yrs.forEach(({ q, i }) => { if (q.harv > 0) s += `<circle cx="${cx(i)}" cy="${y3(q.harv)}" r="3" fill="${q.harv > 288 ? 'var(--warn)' : 'var(--pist)'}"/>`; else s += `<text x="${cx(i)}" y="${t3 + h3}" text-anchor="middle" style="fill:var(--bad)">×</text>`; });
      s += `</svg>`; } }
    // zonas táctiles por año (sobre todo el bloque)
    const pick = i => { state.yr = i; const o = yrs.find(z => z.i === i); if (!o) return; const q = o.q, f = q.fz;
      const sev = q.loss > 50 ? 'daño grave' : q.loss >= 10 ? 'daño' : 'sin daño apreciable';
      const rel = f ? (f.d === 0 ? 'el mismo día de la plena flor' : f.d < 0 ? `${-f.d} días antes de la plena flor` : `${f.d} días después de la plena flor`) : '';
      const fr = f && f.kill > 0 ? `<b>Peor helada:</b> ${fdate(f.doy)}, ${fmt(f.t, 1)} °C, con el árbol en <b>${SN[f.st] || 'estado ' + f.st}</b> (${rel}).` : f ? `Ninguna helada dañina alrededor de la floración. La mínima más baja fue ${fmt(f.t, 1)} °C el ${fdate(f.doy)}, en ${SN[f.st] || ''}.` : '';
      const hv = state.sp === 'p' ? ` · <b>Cosecha prevista:</b> ${q.harv > 0 ? fdate(q.harv) : 'no completa el calor que necesita: cosecha muy tardía y llenado incompleto'}` : '';
      $('yearCard').innerHTML = `<div class="yc-h"><b>${o.y}</b><span class="chip ${q.loss > 50 ? 'bad' : q.loss >= 10 ? 'warn' : 'ok'}">${q.loss} % · ${sev}</span></div><div><b>Plena flor:</b> ${fdate(q.fb)}${hv}</div><div>${fr}</div>`;
      document.querySelectorAll('#yearChart .yhit').forEach(e => e.classList.toggle('on', +e.dataset.i === i)); };
    const blocks = s;
    $('yearChart').innerHTML = `<div class="ysum">Daño en <b>${A.d} de ${A.n}</b> años (${A.c10d} de cada 10) · grave en <b>${A.g}</b> (${A.c10g} de cada 10). Últimos 10 años: daño en ${R.d}, grave en ${R.g}.</div>`
      + `<div class="ywrap">${blocks}<div class="yhits">${yrs.map(({ i, y }) => `<button class="yhit" data-i="${i}" style="left:${(ml + i * bw) / W * 100}%;width:${bw / W * 100}%" aria-label="Ver ${y}"></button>`).join('')}</div></div>`
      + `<div id="yearCard" class="ycard" aria-live="polite"></div>`;
    document.querySelectorAll('#yearChart .yhit').forEach(b => b.onclick = () => pick(+b.dataset.i));
    pick(state.yr != null && yrs.find(z => z.i === state.yr) ? state.yr : yrs[yrs.length - 1].i);
    // --- comparación de variedades ---
    const fem = rows.filter(x => !x.male).slice().sort((a, b) => a.mb - b.mb);
    const pc = q => { const v = q.rows.filter(Boolean); return [v.filter(z => z.loss >= 10).length / v.length * 100, v.filter(z => z.loss > 50).length / v.length * 100]; };
    const c10v = x => (Math.round(x / 10 * 10) / 10).toLocaleString('es-ES', { maximumFractionDigits: 1 });
    const cmp = `<div class="eyebrow" style="margin:4px 0 6px">Años con helada dañina, de la variedad más temprana a la más tardía</div>`
      + `<div class="vleg"><span><i style="background:var(--bad)"></i>Daño grave (&gt; 50 %)</span><span><i style="background:var(--warn)"></i>Daño moderado (10–50 %)</span><span><i style="background:var(--line)"></i>Sin daño</span></div><div class="vcmp">` + fem.map(it => { const [d, g] = pc(it);
      return `<button class="vrow${it.nm === r.nm ? ' on' : ''}" data-nm="${it.nm}"><span class="vn">${it.nm}<small>flor ${fdate(it.mb)}</small></span><span class="vb"><i class="g" style="width:${g}%"></i><i class="d" style="left:${g}%;width:${d - g}%"></i></span><span class="vv"><b class="vd">${c10v(d)}</b> de cada 10 con daño<br><b>${c10v(g)}</b> de cada 10 graves</span></button>`; }).join('')
      + `</div><p class="note" style="margin-top:6px">Toca una variedad para ver su gráfico.</p>`;
    if (state.sp === 'p') {
      const ms = rows.filter(x => x.male), items = [r, ...ms]; const all = items.flatMap(x => [x.p10 - 6, x.p90 + 6]); const lo = Math.min(...all), hi = Math.max(...all);
      const W2 = 380, rowH = 34, H2 = items.length * rowH + 40, l2 = 92, r2 = 12, iw2 = W2 - l2 - r2, x = d => l2 + (d - lo) / (hi - lo) * iw2;
      let g = `<svg viewBox="0 0 ${W2} ${H2}" width="100%" style="max-width:480px" role="img" aria-label="Floración de ${r.nm} y machos">`;
      for (let d = Math.ceil(lo / 7) * 7; d <= hi; d += 7) g += `<line x1="${x(d)}" x2="${x(d)}" y1="8" y2="${H2 - 26}" stroke="var(--line)"/><text x="${x(d)}" y="${H2 - 10}" text-anchor="middle">${fdate(d)}</text>`;
      items.forEach((it, i) => { const y = 12 + i * rowH, half = it.male ? 6 : 5, col = it.male ? 'var(--pist)' : 'var(--flor)';
        g += `<text x="0" y="${y + 15}" style="fill:var(--ink)">${it.nm}</text><rect x="${x(it.p10 - half)}" y="${y + 4}" width="${x(it.p90 + half) - x(it.p10 - half)}" height="16" rx="3" fill="${col}" opacity=".22"/><rect x="${x(it.mb - half)}" y="${y + 4}" width="${x(it.mb + half) - x(it.mb - half)}" height="16" rx="3" fill="${col}"/>`;
        if (it.male) g += `<text x="${W2 - r2}" y="${y + 16}" text-anchor="end" style="fill:var(--ink);font-weight:600">${fmt(r.ov[it.nm] * 100)}%</text>`; });
      $('sideChart').innerHTML = '<div class="eyebrow" style="margin-bottom:6px">Coincidencia de floración con los machos</div>' + g + '</svg>' + cmp;
      $('detNote').textContent = `Banda oscura: ventana media (hembra receptiva ±5 días, macho emitiendo polen ±6 días); banda clara: rango entre años. Machos recomendados para ${r.nm}: ${(r.v.males || []).join(', ')}. Helada de otoño antes de la cosecha: ${r.autN} de ${n} años. En el gráfico de la izquierda: pérdida por helada, plena flor (punto rosa), helada dañina (asterisco) y cosecha prevista; toca un año para ver su ficha.`;
    } else {
      $('sideChart').innerHTML = cmp;
      $('detNote').textContent = 'Arriba, la flor o el fruto perdido por helada cada año. Abajo, la plena flor (punto rosa) y la helada que hizo el daño (asterisco, en su fecha). Toca un año para ver su ficha.';
    }
  }

  // ---------- parámetros ----------
  const PF = [['pist.ref.cp', 'Kerman: frío (porciones)'], ['pist.ref.gdh', 'Kerman: calor hasta flor (GDH)'], ['pist.stages.2.2', 'Pistacho: flor, T 10 % daño (°C)'], ['pist.stages.2.3', 'Pistacho: flor, T 90 % daño (°C)'], ['pist.stages.3.2', 'Pistacho: fruto cuajado, T 10 % (°C)'],
    ['alm.ref.cu', 'Guara: frío (unidades Utah)'], ['alm.ref.gdh', 'Guara: calor hasta flor (GDH)'], ['alm.stages.2.2', 'Almendro: flor abierta, T 10 % (°C)'], ['alm.stages.2.3', 'Almendro: flor abierta, T 90 % (°C)'], ['alm.stages.4.2', 'Almendro: fruto cuajado, T 10 % (°C)'],
    ['verdict.okLoss', 'Apta: pérdida media máx. (%)'], ['verdict.warnLoss', 'Con riesgo: pérdida media máx. (%)']];
  const getp = (o, p) => p.split('.').reduce((a, k) => a[k], o); const setp = (o, p, v) => { const ks = p.split('.'); const last = ks.pop(); ks.reduce((a, k) => a[k], o)[last] = v; };
  $('params').innerHTML = PF.map(([p, l]) => `<label>${l}<input id="p-${p.replace(/\./g, '_')}" data-p="${p}" type="number" step="any" value="${getp(CFG, p)}"></label>`).join('');
  $('recalc').onclick = () => { document.querySelectorAll('[data-p]').forEach(i => setp(CFG, i.dataset.p, parseFloat(i.value))); try { localStorage.setItem(KEY, JSON.stringify(CFG)); } catch (e) {} if (current) compute(); };
  $('reset').onclick = () => { CFG = JSON.parse(JSON.stringify(DEF)); try { localStorage.removeItem(KEY); } catch (e) {} document.querySelectorAll('[data-p]').forEach(i => i.value = getp(CFG, i.dataset.p)); if (current) compute(); };

  $('calib').innerHTML = (window.CALIB && window.CALIB.html) || '';
  $('method').innerHTML = (window.CALIB && window.CALIB.method) || '';
  const q = new URLSearchParams(location.search).get('r'); if (q) { $('code').value = q; analyse(q); }
})();
