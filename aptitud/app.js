(function () {
  const $ = id => document.getElementById(id);
  const DEF = JSON.parse(JSON.stringify(window.CONFIG));
  let CFG = DEF;
  try { const s = localStorage.getItem('aptitud-params-v9'); if (s) CFG = Object.assign(JSON.parse(JSON.stringify(DEF)), JSON.parse(s)); } catch (e) {}
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
    document.querySelectorAll('#sideChart .vrow').forEach(b => b.onclick = () => { state.sel = b.dataset.nm; render(); });
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
    const rec = x => { const y = (r.critR || []).find(z => z.id === x.id); return y && y.nivel !== x.nivel ? `<div class="recent ${['ok', 'warn', 'bad'][y.nivel]}">Últimos 10 años (${yr}): <b>${NV[y.nivel].toLowerCase()}</b> · ${y.valor}</div>` : ''; };
    const head = r.clsR && r.clsR !== r.cls ? `<p class="note">Con toda la serie sale <b>${LBL[r.cls].toLowerCase()}</b>; con solo los últimos 10 años (${yr}) saldría <b>${LBL[r.clsR].toLowerCase()}</b>. El veredicto usa toda la serie; la diferencia indica hacia dónde va el clima.</p>` : r.clsR ? `<p class="note">Con solo los últimos 10 años (${yr}) el veredicto es el mismo.</p>` : '';
    $('crit').innerHTML = `<h2>${r.nm}: ${LBL[r.cls].toLowerCase()}</h2>${head}${frost}<div class="critlist">` + r.crit.slice().sort((a, b) => b.nivel - a.nivel).map(x => `<div class="crit l${x.nivel}"><span class="chip ${['ok', 'warn', 'bad'][x.nivel]}">${NV[x.nivel]}</span><div><b>${x.nombre}</b><div class="cv">${x.valor}</div>${x.nivel ? `<div class="cm">${x.motivo}</div>` : ''}${rec(x)}</div></div>`).join('') + '</div>';
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
      s += `<svg viewBox="0 0 ${W} ${H3}" width="100%" role="img" aria-label="Fecha de cosecha prevista de ${r.nm} por año"><text x="${ml + 4}" y="${t3 + 8}" style="font-size:10.5px">Cosecha prevista (la línea discontinua es el 15 de octubre)</text>`;
      for (const d of [244, 258, 274, 288]) if (d >= hlo && d <= hhi) s += `<line x1="${ml}" x2="${W - mr}" y1="${y3(d)}" y2="${y3(d)}" stroke="${d === 288 ? 'var(--warn)' : 'var(--line)'}" ${d === 288 ? 'stroke-dasharray="3 3"' : ''}/><text x="${ml - 6}" y="${y3(d) + 4}" text-anchor="end">${fdate(d)}</text>`;
      yrs.forEach(({ q, i }) => { if (q.harv > 0) s += `<circle cx="${cx(i)}" cy="${y3(q.harv)}" r="3" fill="${q.harv > 288 ? 'var(--warn)' : 'var(--pist)'}"/>`; else s += `<text x="${cx(i)}" y="${t3 + h3}" text-anchor="middle" style="fill:var(--bad)">×</text>`; });
      s += `</svg>`; } }
    // zonas táctiles por año (sobre todo el bloque)
    const pick = i => { state.yr = i; const o = yrs.find(z => z.i === i); if (!o) return; const q = o.q, f = q.fz;
      const sev = q.loss > 50 ? 'daño grave' : q.loss >= 10 ? 'daño' : 'sin daño apreciable';
      const rel = f ? (f.d === 0 ? 'el mismo día de la plena flor' : f.d < 0 ? `${-f.d} días antes de la plena flor` : `${f.d} días después de la plena flor`) : '';
      const fr = f && f.kill > 0 ? `<b>Peor helada:</b> ${fdate(f.doy)}, ${fmt(f.t, 1)} °C, con el árbol en <b>${SN[f.st] || 'estado ' + f.st}</b> (${rel}).` : f ? `Ninguna helada dañina alrededor de la floración. La mínima más baja fue ${fmt(f.t, 1)} °C el ${fdate(f.doy)}, en ${SN[f.st] || ''}.` : '';
      const hv = state.sp === 'p' ? ` · <b>Cosecha prevista:</b> ${q.harv > 0 ? fdate(q.harv) : 'no llega a madurar'}` : '';
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
  $('recalc').onclick = () => { document.querySelectorAll('[data-p]').forEach(i => setp(CFG, i.dataset.p, parseFloat(i.value))); try { localStorage.setItem('aptitud-params-v9', JSON.stringify(CFG)); } catch (e) {} if (current) compute(); };
  $('reset').onclick = () => { CFG = JSON.parse(JSON.stringify(DEF)); try { localStorage.removeItem('aptitud-params-v9'); } catch (e) {} document.querySelectorAll('[data-p]').forEach(i => i.value = getp(CFG, i.dataset.p)); if (current) compute(); };

  $('calib').innerHTML = (window.CALIB && window.CALIB.html) || '';
  $('method').innerHTML = (window.CALIB && window.CALIB.method) || '';
  const q = new URLSearchParams(location.search).get('r'); if (q) { $('code').value = q; analyse(q); }
})();
