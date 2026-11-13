(function () {
  const $ = id => document.getElementById(id);
  const AC = window.AptitudCore;
  // parámetros: los de fábrica y encima solo los cambiados que sean válidos (una casilla vacía o fuera de rango ya no se guarda)
  let CHG = AC.loadParams(), CFG = AC.config(CHG);
  const Q = new URLSearchParams(location.search);
  // tema claro u oscuro: el del aparato, o el que le pase Mapa de Fincas (?tema=light|dark)
  const TEMA = Q.get('tema'); if (TEMA === 'light' || TEMA === 'dark') document.documentElement.setAttribute('data-theme', TEMA);
  let META = null, current = null, state = { sp: Q.get('sp') === 'a' ? 'a' : 'p', sel: null, yy: new Set(), secano: /^sec/i.test(Q.get('riego') || '') };
  const MES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  const fdate = (doy, y = 2021) => { if (doy == null || doy < 0) return '—'; const d = new Date(Date.UTC(y, 0, 1) + (Math.round(doy) - 1) * 864e5); return d.getUTCDate() + ' ' + MES[d.getUTCMonth()]; };
  // números: coma decimal, punto de miles también con 4 cifras (2.070) y signo menos tipográfico (−4,1)
  const fmt = (x, d = 0) => { if (x == null || isNaN(x)) return '—'; const a = Math.abs(x), t = a.toLocaleString('es-ES', { maximumFractionDigits: d, minimumFractionDigits: d, useGrouping: true });
    const g = a >= 1000 && a < 10000 && !/\./.test(t) ? t.replace(/^(\d)(\d{3})/, '$1.$2') : t; return (x < 0 && +t.replace(',', '.') !== 0 ? '−' : '') + g; };
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

  const clearRes = () => { $('results').hidden = true; current = null; $('pname').textContent = 'Aptitud climática de parcelas'; };
  async function analyse(code) {
    const p = code.trim().replace(/^[:.,;\-\s\/]+|[:.,;\-\s\/]+$/g, '').split(/[:.,;\-\s\/]+/).map(Number);
    if (p.length !== 7 || p.some(isNaN)) { clearRes(); status('El código debe tener 7 números: provincia, municipio, agregado, zona, polígono, parcela y recinto.'); return; }
    clearRes();
    status('Consultando el recinto en el SIGPAC…');
    let gj;
    try { gj = await (await fetch(`https://sigpac-hubcloud.es/servicioconsultassigpac/query/recinfo/${p.join('/')}.geojson`)).json(); } catch (e) { status('No se pudo consultar el SIGPAC.'); return; }
    if (!gj.features || !gj.features.length) { status('Ese recinto no existe en el SIGPAC. Revisa el código.'); return; }
    const f = gj.features[0]; const pr = f.properties;
    if (poly) map.removeLayer(poly);
    poly = L.geoJSON(f, { style: { color: '#ffd23f', weight: 3, fillOpacity: .08 } }).addTo(map); map.invalidateSize(); map.fitBounds(poly.getBounds(), { maxZoom: 16 });
    let prep;
    try { prep = await AptitudCore.prepare(f, { onStatus: status }); } catch (e) { status(e.code === 'fuera' ? e.message : typeof DecompressionStream === 'undefined' ? 'Este navegador no puede leer los datos del clima: hace falta iOS 16.4 o posterior (o un navegador actualizado).' : 'No se pudo cargar el clima de la celda. Inténtalo de nuevo.'); return; }
    current = Object.assign(prep, { code: [String(p[0]).padStart(2, '0'), String(p[1]).padStart(3, '0'), p[2], p[3], p[4], p[5], p[6]].join(':'), pr });
    state.sel = null; status(''); $('results').hidden = false; compute();
  }

  window.__aptCur = () => current; // para las pruebas
  const LBL = { ok: 'Apta', warn: 'Apta con condiciones', bad: 'No apta' };

  function compute() { Object.assign(current, AptitudCore.compute(current, CFG, { secano: state.secano })); render(); }

  function render() {
    const C = current, pr = C.pr;
    $('pname').textContent = `Recinto ${C.code}`;
    const w = C.W.map(x => x.t), n = w.length, wl = state.sp === 'p' ? -12 : -15;
    const near = C.info.length ? Math.min(...C.info.map(s => s[2])) : null;
    const st = C.info.map(s => `${s[1]} (${fmt(s[2])} km)`).join(' · ') + (near != null && near > 30 ? ` <span class="warnline">La más cercana está a ${fmt(near)} km: humedad, lluvia y viento son menos fiables aquí${near > ((CFG.verdict && CFG.verdict.farKm) || 40) ? ' y esos criterios pueden condicionar, pero no excluir' : ''}.</span>` : '');
    const rl = C.rel, sg = v => (v >= 0 ? '+' : '−') + fmt(Math.abs(v), 1);
    $('facts').innerHTML = [['Recinto SIGPAC', C.code, 1], ['Superficie', fmt(pr.superficie, 2) + ' ha'], ['Altitud', (pr.altitud != null ? fmt(pr.altitud) + ' m' : '—') + (C.elev != null ? ` · celda ${fmt(C.elev)} m` : '')],
      ['Pendiente', fmt(pr.pendiente_media, 1) + ' %'],
      ['Relieve', rl ? `<b>${AC.reliefEffect(rl.delta)}</b>: noches de helada ${sg(rl.delta)} °C${rl.deltaLow < rl.delta - 0.3 ? ` (zona más baja del recinto ${sg(rl.deltaLow)} °C)` : ''} · terreno: ${rl.forma || reliefClass(rl.par)}${rl.par.pct != null ? `, el ${Math.round((1 - rl.par.pct) * 100)} % del terreno en 5 km está más alto` : ''}` : 'no disponible: el IGN no ha contestado y se calcula sin corregir por el relieve'],
      ['Uso SIGPAC', pr.uso_sigpac || '—'], ['Estaciones SIAR (temperatura, humedad, lluvia y viento)', st], ['Campañas', `${C.W[0].y}–${C.W[n - 1].y} (${n}) · veredicto con ${C.yR}–${C.yMax}`],
      [`Inviernos ≤ ${fmt(wl)} °C`, `${w.filter(x => x <= wl).length} de ${n} · mín. ${fmt(Math.min(...w), 1)} °C`]]
      .map(([k, v, code]) => `<div class="fact"><div class="k">${k}</div><div class="v${code ? ' code' : ''}">${v}</div></div>`).join('');
    document.querySelectorAll('[data-sp]').forEach(b => { b.setAttribute('aria-pressed', state.sp === b.dataset.sp); b.onclick = () => { state.sp = b.dataset.sp; state.sel = null; render(); }; });
    document.querySelectorAll('[data-rg]').forEach(b => { b.setAttribute('aria-pressed', state.secano === (b.dataset.rg === 's')); b.onclick = () => { const v = b.dataset.rg === 's'; if (v === state.secano) return; state.secano = v; compute(); }; });
    const rows = state.sp === 'p' ? C.P : C.A; const fem = rows.filter(r => !r.male).sort((a, b) => (KR[a.cls] - KR[b.cls]) || (a.R.ml - b.R.ml));
    if (!state.sel || !rows.find(r => r.nm === state.sel)) state.sel = fem[0].nm;
    const spn = state.sp === 'p' ? 'pistacho' : 'almendro';
    const ok = fem.filter(r => r.cls === 'ok').map(r => r.nm), wa = fem.filter(r => r.cls === 'warn').map(r => r.nm);
    $('rankTitle').textContent = state.sp === 'p' ? 'Variedades de pistacho' : 'Variedades de almendro (autofértiles)';
    $('verdict').textContent = verdictText(fem, spn);
    $('rgBox').hidden = state.sp !== 'p';
    const chip = r => `<span class="chip ${r.cls}">${LBL[r.cls]}</span>`;
    const why = r => { const L = [...r.vd.ex.map(x => x.nombre), ...r.vd.co.map(x => x.nombre)]; return L.length ? L.join(' · ') : 'Sin limitaciones climáticas'; };
    const yr = `${C.yR}–${C.yMax}`, td = (l, v, c = '') => `<td data-l="${l}"${c ? ` class="${c}"` : ''}>${v}</td>`;
    const loss = r => `${fmt(r.R.ml)} %<span class="mini"><i style="width:${Math.min(100, r.R.ml)}%"></i></span>`;
    let head = `<tr><th>Variedad</th><th>Veredicto</th><th>Motivos</th><th>Plena flor media</th><th>Pérdida por helada</th>${state.sp === 'p' ? '<th>Cosecha mediana</th>' : ''}</tr>`;
    let body = fem.map(r => `<tr class="row" tabindex="0" data-nm="${r.nm}" aria-selected="${state.sel === r.nm}"><td class="vname" data-l="Variedad">${r.nm}</td>${td('Veredicto', chip(r))}${td('Motivos', why(r), 'why')}${td('Plena flor media', fdate(r.R.mb))}${td('Pérdida por helada', loss(r))}${state.sp === 'p' ? td('Cosecha mediana', r.R.mh != null && r.R.mh < 0 ? 'no madura' : fdate(r.R.mh)) : ''}</tr>`).join('');
    if (state.sp === 'p') body += rows.filter(r => r.male).map(r => `<tr class="male"><td class="vname" data-l="Variedad">${r.nm}<span class="sex">macho</span></td>${td('Veredicto', '<span class="chip na">Polinizador</span>')}${td('Motivos', '—', 'why')}${td('Plena flor media', fdate(r.R.mb))}<td colspan="2" class="mt"></td></tr>`).join('');
    $('rank').innerHTML = `<thead>${head}</thead><tbody>${body}</tbody>`;
    $('rankNote').textContent = `Veredicto, flor, pérdida y cosecha con los últimos 10 años (${yr}), como los criterios; heladas, frío extremo y helada antes de la cosecha miran también toda la serie. Toca una variedad para ver todos sus criterios. Humedad, lluvia y viento se calculan con las estaciones SIAR desde 2000; las temperaturas, con Copernicus desde 1995.${state.sp === 'p' ? ` Cosecha calculada para ${state.secano ? 'secano (El Chaparrillo)' : 'regadío (Caravaca)'}.` : ''}`;
    document.querySelectorAll('#rank .row').forEach(tr => { const go = () => { state.sel = tr.dataset.nm; render(); scrollToDetail(); }; tr.onclick = go; tr.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } }; });
    // selector de variedad encima del detalle (en el móvil la tabla queda lejos)
    $('varPick').innerHTML = fem.map(r => `<option value="${r.nm}"${r.nm === state.sel ? ' selected' : ''}>${r.nm} · ${LBL[r.cls].toLowerCase()}</option>`).join('');
    $('varPick').onchange = e => { state.sel = e.target.value; render(); };
    detail(rows.find(r => r.nm === state.sel), rows);
    document.querySelectorAll('#sideChart .vrow').forEach(b => b.onclick = () => { state.sel = b.dataset.nm; render(); });
  }
  const KR = { ok: 0, warn: 1, bad: 2 };
  const verdictText = (fem, spn) => { const ok = fem.filter(r => r.cls === 'ok').map(r => r.nm), wa = fem.filter(r => r.cls === 'warn').map(r => r.nm);
    return ok.length ? `${ok.length === 1 ? 'Variedad apta' : 'Variedades aptas'} de ${spn}: ${ok.join(', ')}.${wa.length ? ' Aptas con condiciones: ' + wa.join(', ') + '.' : ''}` : wa.length ? `Ninguna variedad de ${spn} sale apta sin condiciones. Aptas con condiciones: ${wa.join(', ')}.` : `Zona no apta para ${spn}: todas las variedades tienen algún criterio que las excluye.`; };
  const scrollToDetail = () => { if (window.matchMedia('(max-width:700px)').matches) { const e = $('detBar'); if (e) e.scrollIntoView({ behavior: 'smooth', block: 'start' }); } };
  // ancho de dibujo de las gráficas: en el móvil, el de la pantalla (letras a su tamaño, sin deslizar); en el PDF, fijo
  let PDFW = 0;
  const cw = (el, def) => PDFW || Math.round(Math.max(330, Math.min(def, ((el && el.clientWidth) || def))));

  // botones de año anterior / siguiente (las zonas para tocar cada año son estrechas en el móvil)
  const ynav = (y, ys) => { const L = ys.slice().sort((a, b) => a - b), k = L.indexOf(y), a = L[k - 1], b = L[k + 1];
    return `<div class="ynav"><button type="button" class="btn sm2"${a ? ` data-y="${a}"` : ' disabled'}>‹ ${a || ''}</button><button type="button" class="btn sm2"${b ? ` data-y="${b}"` : ' disabled'}>${b || ''} ›</button></div>`; };
  const lastDay = () => { const M = current && current.d0 != null && current.cell ? new Date(current.d0 + (current.cell.nd - 1) * 864e5) : null; return M ? `${M.getUTCDate()} ${MES[M.getUTCMonth()]} ${M.getUTCFullYear()}` : 'último día'; };
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
    const fv = (v, y) => { if (s.fmt === 'doy') return fdate(v, y); let d = s.fmt === 'pct' ? 0 : su === '°C' || (Math.abs(v) < 10 && v % 1) ? 1 : 0;
      if (lims.some(l => +v.toFixed(d) === l[0] && v !== l[0])) d++; // 57,9 junto a la raya de 58 no se enseña como 58
      return fmt(v, d).replace(/^-/, '−') + (su ? (su === '%' ? ' %' : ' ' + su) : s.fmt === 'pct' ? ' %' : ''); };
    const val = p => neg(p) ? s.neg : p.x ? p.x : p.v == null ? 'sin dato' : fv(p.v, p.y);
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
    if (p.x && s.wf && p.w && p.w[1] != null) return `Cosecha prevista el ${fdate(p.w[1], p.y)}`; // año que no cuenta (cosecha antes de la ventana)
    if (s.wf && p.w) return s.wf.split(' · ').filter(q => p.w[1] != null || !q.includes('{b}')).join(' · ').replace(/ \(\{b\}\)| \{b\}/g, m => p.w[1] != null ? m.replace('{b}', fdate(p.w[1], p.y)) : '').replace('{a}', fdate(p.w[0], p.y)).replace('{f}', fdate(p.w[2], p.y));
    return '';
  }
  function yyPanel(x, r, rows, box) {
    const s = x.serie, S = yyStats(s), { y0, n, P, lims, A, R } = S;
    if (!P.some(p => p.v != null)) { box.innerHTML = '<p class="note">Sin datos para esta parcela.</p>'; return; }
    const sel = (state.yySel = state.yySel || {})[x.id];
    const W = cw(box, 580), nar = W < 500, ml = nar ? 38 : 46, mr = nar ? 8 : 104, iw = W - ml - mr, bw = iw / n, cx = i => ml + i * bw + bw / 2, xR = ml + (current.yR - y0) * bw;
    const ok = P.filter(p => p.v != null && !S.neg(p));
    const all = [...ok.map(p => p.v), ...lims.map(l => l[0])];
    let lo = Math.min(...all), hi = Math.max(...all); if (!s.pt) { lo = Math.min(lo, 0); hi = Math.max(hi, 0); }
    const pad = (hi - lo || 1) * .1; if (s.pt || lo < 0) lo -= pad; if (s.pt || hi > 0) hi += pad;
    const H = 246, t = 36, h = 176, inv = s.fmt === 'doy', Y = v => t + (inv ? v - lo : hi - v) / (hi - lo) * h;
    const col = k => k === 'bad' ? 'var(--bad)' : k === 'warn' ? 'var(--warn)' : 'var(--frost)';
    const step = (() => { const q = (hi - lo) / 5, p = Math.pow(10, Math.floor(Math.log10(q))), m = q / p; return (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * p; })();
    let g = `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="${x.nombre} de ${r.nm}, año a año">`;
    g += `<rect x="${xR}" y="${t - 24}" width="${W - mr - xR}" height="${h + 24}" fill="var(--frost)" opacity=".07"/><text x="${xR + 4}" y="${t - 12}">últimos 10 años</text>`;
    g += `<text x="2" y="${t - 18}">${s.fmt === 'doy' ? 'Fecha' : (s.u.match(/\(([^)]*)\)\s*$/) || [, ''])[1] || (/^Días/.test(s.u) ? 'días' : /^Horas/.test(s.u) ? 'horas' : /^Porciones/.test(s.u) ? 'porciones' : '')}</text>`;
    for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) g += `<line x1="${ml}" x2="${W - mr}" y1="${Y(v)}" y2="${Y(v)}" stroke="var(--line)"/><text x="${ml - 6}" y="${Y(v) + 4}" text-anchor="end">${s.fmt === 'doy' ? fdate(v) : fmt(Math.abs(v) < 1e-9 ? 0 : v, step < 1 ? 1 : 0).replace(/^-/, '−')}</text>`;
    const z = Y(Math.min(Math.max(0, lo), hi));
    ok.forEach(p => { const k = S.kind(p), c = col(k);
      if (s.pt) g += `<circle cx="${cx(p.i)}" cy="${Y(p.v)}" r="${k ? 4.2 : 3.6}" fill="${c}"${k ? '' : ' opacity=".8"'}/>`;
      else { const a = Y(p.v), y = Math.min(a, z), hh = Math.max(1.5, Math.abs(a - z)); g += `<rect x="${ml + p.i * bw + 2}" y="${y}" width="${bw - 4}" height="${hh}" rx="2" fill="${c}"${k ? '' : ' opacity=".55"'}/>`; } });
    P.filter(S.neg).forEach(p => { const yy = inv ? t + h - 6 : t + 6; g += `<path d="M${cx(p.i) - 4},${yy - 4}L${cx(p.i) + 4},${yy + 4}M${cx(p.i) - 4},${yy + 4}L${cx(p.i) + 4},${yy - 4}" stroke="var(--bad)" stroke-width="1.8"/>`; });
    P.filter(p => p.x && !S.neg(p)).forEach(p => { g += `<line x1="${cx(p.i) - 4}" x2="${cx(p.i) + 4}" y1="${z}" y2="${z}" stroke="var(--muted)" stroke-width="2"/>`; });
    P.filter(p => p.v == null && !S.neg(p) && !p.x).forEach(p => { g += `<text x="${cx(p.i)}" y="${z - 3}" text-anchor="middle" style="font-size:9px;opacity:.6">·</text>`; });
    lims.forEach(l => { const y = Y(l[0]), c = l[1] === 'bad' ? 'var(--bad)' : 'var(--warn)'; g += `<line x1="${ml}" x2="${W - mr}" y1="${y}" y2="${y}" stroke="${c}" stroke-dasharray="4 3" opacity=".85"/>` + (nar ? `<text x="${W - mr - 2}" y="${y - 3}" text-anchor="end" style="fill:${c}">${l[2]}</text>` : `<text x="${W - mr + 6}" y="${y + 4}" style="fill:${c}">${l[2]}</text>`); });
    if (A.m != null) g += `<line x1="${ml}" x2="${W - mr}" y1="${Y(A.m)}" y2="${Y(A.m)}" stroke="var(--ink)" stroke-dasharray="1 3" opacity=".55"/>`;
    if (R.m != null) g += `<line x1="${xR}" x2="${W - mr}" y1="${Y(R.m)}" y2="${Y(R.m)}" stroke="var(--ink)" stroke-width="1.6" opacity=".7"/>`;
    for (let i = 0; i < n; i++) if ((i % 5 === 0 && n - 1 - i >= 3) || i === n - 1) g += `<text x="${cx(i)}" y="${H - 8}" text-anchor="middle">${y0 + i}</text>`;
    // leyenda debajo del gráfico (fuera del SVG, para que en el móvil no se corte)
    const ly = 7; let leg = '';
    const li = (sym, txt) => `<span><svg width="16" height="14" viewBox="0 0 16 14" aria-hidden="true">${sym(4)}</svg>${txt}</span>`;
    leg += li(x0 => s.pt ? `<circle cx="${x0 + 4}" cy="${ly}" r="3.5" fill="var(--frost)"/>` : `<rect x="${x0}" y="${ly - 5}" width="8" height="10" rx="2" fill="var(--frost)" opacity=".55"/>`, 'dato de cada año');
    if (A.m != null) leg += li(x0 => `<line x1="${x0 - 2}" x2="${x0 + 10}" y1="${ly}" y2="${ly}" stroke="var(--ink)" stroke-dasharray="1 3" opacity=".7"/>`, `${s.fmt === 'doy' ? 'mediana' : 'media'} ${A.y0}–${A.y1}: ${S.fv(A.m)}`);
    if (R.m != null) leg += li(x0 => `<line x1="${x0 - 2}" x2="${x0 + 10}" y1="${ly}" y2="${ly}" stroke="var(--ink)" stroke-width="1.6" opacity=".8"/>`, `últimos 10 años: ${S.fv(R.m)}`);
    if (s.neg) leg += li(x0 => `<path d="M${x0},${ly - 4}L${x0 + 8},${ly + 4}M${x0},${ly + 4}L${x0 + 8},${ly - 4}" stroke="var(--bad)" stroke-width="1.8"/>`, s.neg);
    g += '</svg>';
    const lw = S.two ? 'quedan fuera de las rayas' : 'pasan la raya ámbar', lb = s.neg && !lims.some(l => l[1] === 'bad') ? s.neg : 'pasan la raya roja';
    const bTxt = s.neg && !lims.some(l => l[1] === 'bad') ? 'No completan el calor' : 'Pasan la raya roja';
    const sum = `<div class="ysum">${S.hasWarn ? `${S.two ? 'Fuera de las rayas' : 'Pasan la raya ámbar'} <b>${A.w} de ${A.n}</b> años (${S.c10(A.w, A.n)} de cada 10)${S.hasBad ? ` · ${bTxt.replace(/^Pasan la raya roja$/, 'la roja').toLowerCase()} <b>${A.b}</b> (${S.c10(A.b, A.n)} de cada 10)` : ''}. Últimos 10 años: ${R.w} de ${R.n}${S.hasBad ? `, ${R.b} en rojo` : ''}.` : `${bTxt} <b>${A.b} de ${A.n}</b> años (${S.c10(A.b, A.n)} de cada 10). Últimos 10 años: ${R.b} de ${R.n}.`}</div>`;
    const hits = `<div class="yhits" style="top:${(t - 24) / H * 100}%;bottom:${(H - t - h - 6) / H * 100}%">${P.map(p => `<button class="yhit" data-y="${p.y}" style="left:${(ml + p.i * bw) / W * 100}%;width:${bw / W * 100}%" aria-label="Ver ${p.y}"></button>`).join('')}</div>`;
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
    const negs = P.filter(S.neg), grpNeg = negs.length > 1;
    const worst = P.filter(p => (p.v != null && !p.x && !S.neg(p)) || (S.neg(p) && !grpNeg)).sort((a, b) => S.bad(b) - S.bad(a)).slice(0, grpNeg ? 5 : 6);
    const okv = ok.map(p => p.v), mn = Math.min(...okv), mx = Math.max(...okv), am = Math.max(...okv.map(Math.abs)) || 1, bar = v => s.pt ? .08 + .92 * (s.dir === -1 ? mx - v : v - mn) / ((mx - mn) || 1) : Math.abs(v) / am;
    const wl = `<div class="eyebrow" style="margin:14px 0 6px">Los peores años</div><div class="vcmp">` + (grpNeg ? `<button class="vrow yw" data-y="${negs[negs.length - 1].y}"><span class="vn">${negs.length} años<small>${negs.map(p => p.y).join(', ')}</small></span><span class="vb"><i style="width:100%;background:var(--bad)"></i></span><span class="vv">${s.neg}</span></button>` : '') + worst.map(p => { const k = S.kind(p), wd = S.neg(p) ? 100 : Math.max(3, bar(p.v) * 100);
      return `<button class="vrow yw" data-y="${p.y}"><span class="vn">${p.y}<small>${yyWhen(s, p) || '&nbsp;'}</small></span><span class="vb"><i style="width:${wd}%;background:${col(k)}${k ? '' : ';opacity:.55'}"></i></span><span class="vv">${S.val(p)}</span></button>`; }).join('') + '</div>';
    const rule = `<b>Cómo cuenta para la aptitud.</b> ${x.motivo} Resultado con los últimos 10 años: <b>${NVL[x.nivel].toLowerCase()}</b>, ${x.valor}${r.critTodo && r.crit !== r.critTodo ? (() => { const t2 = r.critTodo.find(z => z.id === x.id); return t2 ? `; con toda la serie: <b>${NVL[t2.nivel].toLowerCase()}</b>, ${t2.valor}` : ''; })() : ''}.`;
    box.innerHTML = `<div class="detail-grid"><div class="chart">${sum}<div class="yscroll"><div class="ywrap">${g}${hits}</div></div><div class="yleg">${leg}</div><div class="yhint" hidden>← Desliza el gráfico para ver los años anteriores</div><div class="ycard yyv" aria-live="polite"></div>${wl}</div><div class="chart">${side}</div></div><p class="note" style="margin-top:10px">${s.nota} ${rule}</p>`;
    const pick = y => { const p = P.find(q => q.y === y); if (!p) return; state.yySel[x.id] = y; const k = S.kind(p);
      // puestos y empates con el valor tal como se ve (52 % y 52 % empatan)
      const all2 = P.filter(q => q.v != null || S.neg(q)), same = q => S.neg(q) ? S.neg(p) : !S.neg(p) && S.val(q) === S.val(p);
      const pos = all2.filter(q => !same(q) && S.bad(q) > S.bad(p)).length + 1, ties = all2.filter(same).length - 1;
      const tag = p.x ? 'no cuenta' : p.v == null && !S.neg(p) ? 'sin dato' : k === 'bad' ? (S.neg(p) ? 'no completa el calor' : 'pasa la raya roja') : k === 'warn' ? (S.two ? 'fuera de las rayas' : 'pasa la raya ámbar') : 'año normal';
      const which = k && !S.neg(p) ? lims.filter((l, j) => S.hit(p.v, l, j)).map(l => '«' + l[2] + '»').join(' y ') : '';
      const vsm = p.v != null && !S.neg(p) && A.m != null && s.fmt !== 'doy' ? ` · ${S.fv(p.v) === S.fv(A.m) ? 'igual que la media' : p.v > A.m ? 'por encima de la media' : 'por debajo de la media'} (${S.fv(A.m)})` : '';
      box.querySelector('.yyv').innerHTML = ynav(p.y, P.map(q => q.y)) + `<div class="yc-h"><b>${p.y}</b><span class="chip ${k || 'ok'}">${S.neg(p) || p.x || p.v == null ? S.val(p) : `${S.val(p)} · ${tag}`}</span></div>${yyWhen(s, p) ? `<div>${yyWhen(s, p)}</div>` : ''}<div>${which ? `Pasa la raya de ${which}.` : ''}${S.neg(p) ? ` Uno de los ${ties + 1} años de ${all2.length} en que no completa el calor: cuenta como año en rojo.` : p.v != null ? ` Puesto ${pos} de ${all2.length}${P.some(q => q.x) ? ' años que cuentan' : ''} (1 = el peor año)${ties ? `, empatado con ${ties} ${ties === 1 ? 'año' : 'años'} más` : ''}${vsm}.` : ''}</div>`;
      box.querySelectorAll('.yhit').forEach(e => e.classList.toggle('on', +e.dataset.y === y));
      box.querySelectorAll('.yyv .ynav button').forEach(b => b.onclick = () => pick(+b.dataset.y));
      const sc = box.querySelector('.yscroll'), hb = box.querySelector(`.yhit[data-y="${y}"]`);
      if (sc && hb && sc.scrollWidth > sc.clientWidth) { const a = hb.offsetLeft, b = a + hb.offsetWidth; if (a < sc.scrollLeft + 50 || b > sc.scrollLeft + sc.clientWidth - 110) sc.scrollLeft = Math.min(sc.scrollWidth, b + 110 - sc.clientWidth); } };
    box.querySelectorAll('.yhit, .yw').forEach(b => b.onclick = () => pick(+b.dataset.y));
    box.querySelectorAll('.vrow[data-nm]').forEach(b => b.onclick = () => { state.sel = b.dataset.nm; render(); });
    const last = P.filter(p => p.v != null || S.neg(p)).pop(), sc = box.querySelector('.yscroll');
    box._fit = () => { const over = sc.scrollWidth > sc.clientWidth; box.querySelector('.yhint').hidden = !over; if (over) { sc.scrollLeft = sc.scrollWidth; pick(state.yySel[x.id]); } };
    if (sc) requestAnimationFrame(box._fit);
    pick(sel && P.find(p => p.y === sel) ? sel : last.y);
  }
  function yyBox(r, rows) {
    const box = $('yyBox'); if (!box) return;
    const L = r.crit.filter(x => x.serie).slice().sort((a, b) => b.nivel - a.nivel);
    box.innerHTML = `<div class="panel-head"><h2>${r.nm}: cada criterio, año a año</h2><div class="legend"><span style="--c:var(--frost)">Año normal</span><span style="--c:var(--warn)">Pasa la raya ámbar</span><span style="--c:var(--bad)">Pasa la raya roja</span></div></div>`
      + `<p class="note">Abre un criterio para ver su dato de cada campaña, con sus umbrales, las medias de toda la serie y de los últimos 10 años, la comparación entre variedades y los peores años. Toca un año para ver su ficha.</p><div class="yylist">`
      + L.map(x => `<details class="yyd" data-id="${x.id}"${state.yy.has(x.id) ? ' open' : ''}><summary><span class="chip ${KCLS[x.nivel]}">${NVL[x.nivel]}</span><span class="yyn">${x.nombre}</span><span class="yys">${x.valor}</span></summary><div class="yyb"></div></details>`).join('') + '</div>';
    box.querySelectorAll('.yyd').forEach(d => { const x = r.crit.find(z => z.id === d.dataset.id), b = d.querySelector('.yyb');
      const go = () => { if (d.open) { state.yy.add(x.id); if (!b.dataset.done) { b.dataset.done = 1; yyPanel(x, r, rows, b); } else if (b._fit) b._fit(); } else state.yy.delete(x.id); };
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
    const head = comb ? `<p class="note">El veredicto se basa en los últimos 10 años; heladas, frío extremo y helada antes de la cosecha tienen en cuenta toda la serie.${r.clsTodo && r.clsTodo !== r.cls ? ` Con toda la serie (${yA}) saldría <b>${LBL[r.clsTodo].toLowerCase()}</b>.` : ''}</p>` : `<p class="note">No hay suficientes campañas recientes: el veredicto usa toda la serie (${yA}).</p>`;
    const yy = x => x.serie ? `<button class="yylink" type="button" data-id="${x.id}">Año a año ↓</button>` : '';
    $('crit').innerHTML = `<h2>${r.nm}: ${LBL[r.cls].toLowerCase()}</h2>${head}${frost}<div class="critlist">` + r.crit.slice().sort((a, b) => b.nivel - a.nivel).map(x => `<div class="crit l${x.nivel}"><span class="chip ${['ok', 'warn', 'bad'][x.nivel]}">${NV[x.nivel]}</span><div><b>${x.nombre}</b><div class="cper">${per(x)}</div><div class="cv">${x.valor}</div>${x.nivel ? `<div class="cm">${x.motivo}</div>` : ''}${x.porSerie ? '<div class="recent warn">Se mantiene en condiciona por lo ocurrido en la serie completa</div>' : ''}${todo(x)}${yy(x)}</div></div>`).join('') + '</div>';
    yyBox(r, rows);
    document.querySelectorAll('#crit .yylink').forEach(b => b.onclick = () => { const d = document.querySelector(`#yyBox .yyd[data-id="${b.dataset.id}"]`); if (!d) return; d.open = true; d.scrollIntoView({ behavior: 'smooth', block: 'start' }); });
    $('detTitle').textContent = `${r.nm}: heladas y floración, año a año`;
    $('detLegend').innerHTML = '<span style="--c:var(--line)">Menos del 10 %</span><span style="--c:var(--warn)">Daño (10–50 %)</span><span style="--c:var(--bad)">Daño grave (&gt; 50 %)</span>';
    const SN = (state.sp === 'p' ? CFG.pist : CFG.alm).stageNames || [];
    const yrs = r.rows.map((q, i) => ({ q, y: y0 + i, i })).filter(o => o.q);
    const W = cw($('yearChart'), 640), nar = W < 500, ml = nar ? 40 : 46, mr = nar ? 6 : 14, iw = W - ml - mr, bw = iw / n, cx = i => ml + i * bw + bw / 2;
    const col = v => v > 50 ? 'var(--bad)' : v >= 10 ? 'var(--warn)' : 'var(--line)';
    const xR = ml + (current.yR - y0) * bw;
    // --- panel 1: pérdida ---
    const H1 = 170, t1 = 26, h1 = 120, y1 = v => t1 + h1 - v / 100 * h1;
    let s = `<svg viewBox="0 0 ${W} ${H1}" width="100%" role="img" aria-label="Pérdida por helada de ${r.nm} por año">`;
    s += `<rect x="${xR}" y="${t1 - 18}" width="${W - mr - xR}" height="${h1 + 18}" fill="var(--frost)" opacity=".07"/><text x="${xR + 4}" y="${t1 - 6}">últimos 10 años</text>`;
    for (const v of [0, 50, 100]) s += `<line x1="${ml}" x2="${W - mr}" y1="${y1(v)}" y2="${y1(v)}" stroke="var(--line)"/><text x="${ml - 6}" y="${y1(v) + 4}" text-anchor="end">${v} %</text>`;
    s += `<line x1="${ml}" x2="${W - mr}" y1="${y1(10)}" y2="${y1(10)}" stroke="var(--warn)" stroke-dasharray="3 3" opacity=".7"/><line x1="${ml}" x2="${W - mr}" y1="${y1(50)}" y2="${y1(50)}" stroke="var(--bad)" stroke-dasharray="3 3" opacity=".7"/>`;
    yrs.forEach(({ q, i }) => { const v = q.loss, h = Math.max(1.5, v / 100 * h1); s += `<rect x="${ml + i * bw + 2}" y="${t1 + h1 - h}" width="${bw - 4}" height="${h}" rx="2" fill="${col(v)}"/>`; });
    s += `<text x="2" y="${t1 - 6}">Pérdida</text></svg>`;
    // --- panel 2: calendario (flor, helada, cosecha) ---
    const ds = []; yrs.forEach(({ q }) => { ds.push(q.fb); if (q.fz && q.fz.kill > 0) ds.push(q.fz.doy); });
    const dlo = Math.min(...ds) - 4, dhi = Math.max(...ds) + 4, H2 = 164, t2 = 8, h2 = 130, y2 = d => t2 + (d - dlo) / (dhi - dlo) * h2;
    s += `<svg viewBox="0 0 ${W} ${H2}" width="100%" role="img" aria-label="Fecha de plena flor y de la helada dañina de ${r.nm} por año">`;
    s += `<rect x="${xR}" y="${t2}" width="${W - mr - xR}" height="${h2}" fill="var(--frost)" opacity=".07"/>`;
    for (let d = Math.ceil(dlo / 10) * 10; d <= dhi; d += 10) s += `<line x1="${ml}" x2="${W - mr}" y1="${y2(d)}" y2="${y2(d)}" stroke="var(--line)"/><text x="${ml - 6}" y="${y2(d) + 4}" text-anchor="end">${fdate(d)}</text>`;
    yrs.forEach(({ q, i }) => { const x = cx(i);
      if (q.fz && q.fz.kill > 0) { s += `<line x1="${x}" x2="${x}" y1="${y2(q.fb)}" y2="${y2(q.fz.doy)}" stroke="${col(q.loss)}" stroke-width="1.5" opacity=".6"/>`;
        const yy = y2(q.fz.doy); s += `<path d="M${x - 4},${yy}L${x + 4},${yy}M${x},${yy - 4}L${x},${yy + 4}M${x - 3},${yy - 3}L${x + 3},${yy + 3}M${x - 3},${yy + 3}L${x + 3},${yy - 3}" stroke="${col(q.loss)}" stroke-width="1.6"/>`; }
      s += `<circle cx="${x}" cy="${y2(q.fb)}" r="3.2" fill="var(--flor)"/>`; });
    yrs.forEach(({ y, i }) => { if ((i % 5 === 0 && n - 1 - i >= 3) || i === n - 1) s += `<text x="${cx(i)}" y="${H2 - 8}" text-anchor="middle">${y}</text>`; });
    s += `</svg>`;
    const ast = c => `<path d="M0,6L12,6M6,0L6,12M2,2L10,10M2,10L10,2" stroke="${c}" stroke-width="1.6"/>`;
    s += `<div class="yleg"><span><svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><circle cx="6" cy="6" r="3.2" fill="var(--flor)"/></svg>plena flor</span><span><svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">${ast('var(--bad)')}</svg>helada que hizo el daño (su color, la gravedad)</span></div>`;
    // --- panel 3 (pistacho): cosecha ---
    if (state.sp === 'p') { const hv = yrs.map(o => o.q.harv).filter(h => h > 0); if (hv.length) { const hlo = Math.min(...hv, 236) - 3, hhi = Math.max(...hv, 288) + 3, H3 = 112, t3 = 8, h3 = 92, y3 = d => t3 + (d - hlo) / (hhi - hlo) * h3;
      const K = CFG.crit.pist, L1 = K.lateDoy, L2 = K.veryLateDoy, hhi2 = Math.max(hhi, hv.some(h => h > L1) ? L2 + 3 : hhi);
      const y3b = d => t3 + (d - hlo) / (hhi2 - hlo) * h3;
      s += `<svg viewBox="0 0 ${W} ${H3}" width="100%" role="img" aria-label="Fecha de cosecha prevista de ${r.nm} por año">`;
      for (const d of [244, 258, 274, L1, L2]) if (d >= hlo && d <= hhi2) s += `<line x1="${ml}" x2="${W - mr}" y1="${y3b(d)}" y2="${y3b(d)}" stroke="${d === L2 ? 'var(--bad)' : d === L1 ? 'var(--warn)' : 'var(--line)'}" ${d >= L1 ? 'stroke-dasharray="3 3"' : ''}/><text x="${ml - 6}" y="${y3b(d) + 4}" text-anchor="end">${fdate(d)}</text>`;
      yrs.forEach(({ q, i }) => { if (q.harv > 0) s += `<circle cx="${cx(i)}" cy="${y3b(q.harv)}" r="3" fill="${q.harv > L2 ? 'var(--bad)' : q.harv > L1 ? 'var(--warn)' : 'var(--pist)'}"/>`; else if (q.harv != null) s += `<text x="${cx(i)}" y="${t3 + h3}" text-anchor="middle" style="fill:var(--bad)">×</text>`; });
      s += `</svg><div class="yleg"><span>Cosecha prevista (${state.secano ? 'secano' : 'regadío'}): raya ámbar 15 de octubre, roja 1 de noviembre · aspa: no completa el calor${yrs.some(o => o.q.harv == null) ? ' · la campaña en curso, sin dato hasta que acabe' : ''}</span></div>`; } }
    // zonas táctiles por año (sobre todo el bloque)
    const pick = i => { state.yr = i; const o = yrs.find(z => z.i === i); if (!o) return; const q = o.q, f = q.fz;
      const sev = q.loss > 50 ? 'daño grave' : q.loss >= 10 ? 'daño' : 'sin daño apreciable';
      const rel = f ? (f.d === 0 ? 'el mismo día de la plena flor' : f.d < 0 ? `${-f.d} días antes de la plena flor` : `${f.d} días después de la plena flor`) : '';
      const fr = f && f.kill > 0 ? `<b>Peor helada:</b> ${fdate(f.doy, o.y)}, ${fmt(f.t, 1)} °C, con el árbol en <b>${SN[f.st] || 'estado ' + f.st}</b> (${rel}).` : f ? `Ninguna helada dañina alrededor de la floración. La mínima más baja fue ${fmt(f.t, 1)} °C el ${fdate(f.doy)}, en ${SN[f.st] || ''}.` : '';
      const hv = state.sp === 'p' ? ` · <b>Cosecha prevista:</b> ${q.harv == null ? 'campaña sin terminar (los datos llegan hasta el ' + lastDay() + ')' : q.harv > 0 ? fdate(q.harv, o.y) : 'no completa el calor que necesita: cosecha muy tardía y llenado incompleto'}` : '';
      $('yearCard').innerHTML = ynav(o.y, yrs.map(z => z.y)) + `<div class="yc-h"><b>${o.y}</b><span class="chip ${q.loss > 50 ? 'bad' : q.loss >= 10 ? 'warn' : 'ok'}">${q.loss} % · ${sev}</span></div><div><b>Plena flor:</b> ${fdate(q.fb, o.y)}${hv}</div><div>${fr}</div>`;
      document.querySelectorAll('#yearChart .yhit').forEach(e => e.classList.toggle('on', +e.dataset.i === i));
      document.querySelectorAll('#yearCard .ynav button').forEach(b => b.onclick = () => { const z = yrs.find(k => k.y === +b.dataset.y); if (z) pick(z.i); }); };
    const blocks = s;
    $('yearChart').innerHTML = `<div class="ysum">Daño en <b>${A.d} de ${A.n}</b> años (${A.c10d} de cada 10) · grave en <b>${A.g}</b> (${A.c10g} de cada 10). Últimos 10 años: daño en ${R.d}, grave en ${R.g}.</div>`
      + `<div class="ywrap">${blocks}<div class="yhits">${yrs.map(({ i, y }) => `<button class="yhit" data-i="${i}" style="left:${(ml + i * bw) / W * 100}%;width:${bw / W * 100}%" aria-label="Ver ${y}"></button>`).join('')}</div></div>`
      + `<div id="yearCard" class="ycard" aria-live="polite"></div>`;
    document.querySelectorAll('#yearChart .yhit').forEach(b => b.onclick = () => pick(+b.dataset.i));
    pick(state.yr != null && yrs.find(z => z.i === state.yr) ? state.yr : yrs[yrs.length - 1].i);
    // --- comparación de variedades ---
    const fem = rows.filter(x => !x.male).slice().sort((a, b) => a.mb - b.mb);
    // comparación con los últimos 10 años, como el veredicto
    const pc = q => { const v = q.rows.filter(z => z && z.y >= current.yR); return v.length ? [v.filter(z => z.loss >= 10).length / v.length * 100, v.filter(z => z.loss > 50).length / v.length * 100] : [0, 0]; };
    const c10v = x => (Math.round(x / 10 * 10) / 10).toLocaleString('es-ES', { maximumFractionDigits: 1 });
    const cmp = `<div class="eyebrow" style="margin:4px 0 6px">Años con helada dañina en los últimos 10 años (${current.yR}–${current.yMax}), de la variedad más temprana a la más tardía</div>`
      + `<div class="vleg"><span><i style="background:var(--bad)"></i>Daño grave (&gt; 50 %)</span><span><i style="background:var(--warn)"></i>Daño moderado (10–50 %)</span><span><i style="background:var(--line)"></i>Sin daño</span></div><div class="vcmp">` + fem.map(it => { const [d, g] = pc(it);
      return `<button class="vrow${it.nm === r.nm ? ' on' : ''}" data-nm="${it.nm}"><span class="vn">${it.nm}<small>flor ${fdate(it.mb)}</small></span><span class="vb"><i class="g" style="width:${g}%"></i><i class="d" style="left:${g}%;width:${d - g}%"></i></span><span class="vv"><b class="vd">${c10v(d)}</b> de cada 10 con daño<br><b>${c10v(g)}</b> de cada 10 graves</span></button>`; }).join('')
      + `</div><p class="note" style="margin-top:6px">Toca una variedad para ver su gráfico.</p>`;
    if (state.sp === 'p') {
      // floración y coincidencia con los machos en los últimos 10 años (los mismos que el criterio)
      const ms = rows.filter(x => x.male), items = [r, ...ms].map(x => Object.assign({}, x, { mb: x.R.mb, p10: x.R.p10, p90: x.R.p90 })), ovR = r.R.ov || r.ov;
      const all = items.flatMap(x => [x.p10 - 6, x.p90 + 6]); const lo = Math.min(...all), hi = Math.max(...all);
      const W2 = 380, rowH = 34, H2 = items.length * rowH + 40, l2 = 92, r2 = 12, iw2 = W2 - l2 - r2, x = d => l2 + (d - lo) / (hi - lo) * iw2;
      let g = `<svg viewBox="0 0 ${W2} ${H2}" width="100%" style="max-width:480px" role="img" aria-label="Floración de ${r.nm} y machos">`;
      for (let d = Math.ceil(lo / 7) * 7; d <= hi; d += 7) g += `<line x1="${x(d)}" x2="${x(d)}" y1="8" y2="${H2 - 26}" stroke="var(--line)"/><text x="${x(d)}" y="${H2 - 10}" text-anchor="middle">${fdate(d)}</text>`;
      items.forEach((it, i) => { const y = 12 + i * rowH, half = it.male ? 6 : 5, col = it.male ? 'var(--pist)' : 'var(--flor)';
        g += `<text x="0" y="${y + 15}" style="fill:var(--ink)">${it.nm}</text><rect x="${x(it.p10 - half)}" y="${y + 4}" width="${x(it.p90 + half) - x(it.p10 - half)}" height="16" rx="3" fill="${col}" opacity=".22"/><rect x="${x(it.mb - half)}" y="${y + 4}" width="${x(it.mb + half) - x(it.mb - half)}" height="16" rx="3" fill="${col}"/>`;
        if (it.male) g += `<text x="${W2 - r2}" y="${y + 16}" text-anchor="end" style="fill:var(--ink);font-weight:600">${fmt((ovR[it.nm] || 0) * 100)} %</text>`; });
      $('sideChart').innerHTML = `<div class="eyebrow" style="margin-bottom:6px">Coincidencia de floración con los machos · últimos 10 años (${current.yR}–${current.yMax})</div>` + g + '</svg>' + cmp;
      const oc = (r.crit.find(x => x.id === 'otono') || {}).valor || '';
      $('detNote').textContent = `Banda oscura: ventana media (hembra receptiva ±5 días, macho emitiendo polen ±6 días); banda clara: rango entre años. Machos recomendados para ${r.nm}: ${(r.v.males || []).join(', ')}. Helada de otoño antes de la cosecha (últimos 10 años): ${oc}. En el gráfico de heladas y floración: pérdida por helada, plena flor (punto rosa), helada dañina (asterisco) y cosecha prevista; toca un año, o usa los botones de año anterior y siguiente, para ver su ficha.`;
    } else {
      $('sideChart').innerHTML = cmp;
      $('detNote').textContent = 'Arriba, la flor o el fruto perdido por helada cada año. Abajo, la plena flor (punto rosa) y la helada que hizo el daño (asterisco, en su fecha). Toca un año, o usa los botones de año anterior y siguiente, para ver su ficha.';
    }
  }

  // lo que necesita el informe PDF (informe.js)
  window.AptitudApp = { state, cur: () => current, render, yyPanel, setW: w => { PDFW = w; }, KR, NVL, KCLS, lastDay, changed: () => Object.keys(CHG).length };

  // ---------- parámetros ----------
  // solo los que de verdad cambian el cálculo; se comprueba cada casilla y se guardan solo los cambiados
  const fv = v => String(v).replace('.', ',');
  const pRender = () => { $('params').innerHTML = AC.PARAMS.map(([p, l, a, b]) => `<label>${l}<input data-p="${p}" type="text" inputmode="decimal" autocomplete="off" value="${fv(p.split('.').reduce((o, k) => o[k], CFG))}"><small>de ${fv(a)} a ${fv(b)}${CHG[p] != null ? ' · cambiado' : ''}</small></label>`).join(''); };
  pRender();
  $('recalc').onclick = () => {
    const DEF = AC.config({}), ch = {}, err = [];
    document.querySelectorAll('[data-p]').forEach(i => { const p = i.dataset.p, v = AC.checkParam(p, i.value.trim()); i.classList.toggle('bad', typeof v !== 'number');
      if (typeof v !== 'number') err.push(v); else if (v !== p.split('.').reduce((o, k) => o[k], DEF)) ch[p] = v; });
    if (err.length) { $('pmsg').textContent = 'No se ha recalculado: ' + err.join(' · ') + '.'; $('pmsg').className = 'pmsg bad'; return; }
    CHG = ch; CFG = AC.config(CHG); AC.saveParams(CHG); pRender();
    $('pmsg').textContent = Object.keys(CHG).length ? `Recalculado con ${Object.keys(CHG).length} ${Object.keys(CHG).length === 1 ? 'valor cambiado' : 'valores cambiados'} (se guardan solo en este aparato).` : 'Recalculado con los valores por defecto.'; $('pmsg').className = 'pmsg';
    if (current) compute(); };
  $('reset').onclick = () => { CHG = {}; CFG = AC.config(CHG); AC.saveParams(CHG); pRender(); $('pmsg').textContent = 'Vuelven los valores por defecto.'; $('pmsg').className = 'pmsg'; if (current) compute(); };

  $('calib').innerHTML = (window.CALIB && window.CALIB.html) || '';
  $('method').innerHTML = (window.CALIB && window.CALIB.method) || '';
  const q = Q.get('r'); if (q) { $('code').value = q; analyse(q); }
  // al girar el móvil o cambiar el tamaño de la ventana, las gráficas se vuelven a dibujar a su ancho
  let rzW = window.innerWidth, rzT = 0; window.addEventListener('resize', () => { clearTimeout(rzT); rzT = setTimeout(() => { if (Math.abs(window.innerWidth - rzW) > 40 && current && !$('results').hidden) { rzW = window.innerWidth; render(); } }, 250); });
})();
