/* Informe PDF del simulador: se hace en el momento, con todo lo que se ve en pantalla (veredicto, criterios y todas las gráficas)
   de una variedad o de todas, de pistacho, de almendro o de los dos. No se guarda en ningún sitio: se descarga o se comparte. */
(function () {
  const $ = id => document.getElementById(id);
  const APP = () => window.AptitudApp;
  // colores del tema claro (el PDF siempre sale en claro, aunque la pantalla esté en oscuro)
  const LIGHT = { bg: '#EEF0EC', surface: '#FAFBF8', ink: '#1D2420', muted: '#5E6862', line: '#D3D8D2', pist: '#5F7F2E', frost: '#2F6FA3', flor: '#B85C7A',
    ok: '#3E7B3A', warn: '#B07A12', bad: '#B23A35', 'ok-bg': '#E3EFDF', 'warn-bg': '#F6ECD3', 'bad-bg': '#F5DEDC' };
  const rv = s => String(s == null ? '' : s).replace(/var\(--([\w-]+)\)/g, (m, k) => LIGHT[k] || '#888888');
  const hex = h => { h = rv(h).replace('#', ''); if (h.length === 3) h = h.split('').map(c => c + c).join(''); return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]; };
  const mix = (h, a) => hex(h).map(c => Math.round(255 - (255 - c) * a)); // color sobre blanco con opacidad a
  const txt = el => el ? el.innerText.replace(/ /g, ' ').replace(/[ \t]+\n/g, '\n').replace(/\n{2,}/g, '\n').trim() : '';

  // ---------- generador (jsPDF) y letra Barlow: los de Mapa de Fincas ----------
  let LIB = null;
  const addScript = code => { const s = document.createElement('script'); s.textContent = code; document.head.appendChild(s); s.remove(); };
  const loadUrl = u => new Promise((ok, ko) => { const s = document.createElement('script'); s.src = u; s.onload = ok; s.onerror = ko; document.head.appendChild(s); });
  async function lib() {
    if (LIB) return LIB;
    let fonts = null, P = null;
    try { if (window.parent !== window && window.parent.document) P = window.parent; } catch (e) { P = null; }
    const grab = (d, id) => { const e = d && d.getElementById(id); return e && e.textContent.length > 1000 ? e.textContent.replace(/\s+/g, '') : null; };
    // 1) dentro de la app, si ya tiene el generador cargado
    if (P && grab(P.document, 'pdflib') && grab(P.document, 'pdffontr')) {
      if (!(window.jspdf && window.jspdf.jsPDF)) addScript(P.document.getElementById('pdflib').textContent);
      fonts = { r: grab(P.document, 'pdffontr'), b: grab(P.document, 'pdffontb'), cr: grab(P.document, 'pdffontcr'), cb: grab(P.document, 'pdffontcb') };
    }
    // 2) el paquete de la app en la misma web
    if (!(window.jspdf && window.jspdf.jsPDF) || !fonts) {
      try { const j = await (await fetch('/mapa-fincas/pdf.json', { cache: 'force-cache' })).json();
        if (!(window.jspdf && window.jspdf.jsPDF)) addScript(j.pdflib);
        fonts = { r: j.pdffontr, b: j.pdffontb, cr: j.pdffontcr, cb: j.pdffontcb }; } catch (e) { fonts = null; }
    }
    // 3) último recurso: jsPDF de cdnjs con la letra estándar
    if (!(window.jspdf && window.jspdf.jsPDF)) await loadUrl('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js');
    if (!(window.jspdf && window.jspdf.jsPDF)) throw new Error('sin generador');
    LIB = { jsPDF: window.jspdf.jsPDF, fonts: fonts && fonts.r && fonts.b ? fonts : null };
    return LIB;
  }

  // ---------- gráficas: SVG de la pantalla → imagen en colores claros ----------
  function svgImg(svg, scale = 2) {
    const vb = svg.viewBox && svg.viewBox.baseVal, W = vb && vb.width ? vb.width : svg.clientWidth, H = vb && vb.height ? vb.height : svg.clientHeight;
    const c = svg.cloneNode(true);
    c.setAttribute('xmlns', 'http://www.w3.org/2000/svg'); const W2 = W + 40; c.setAttribute('width', W2); c.setAttribute('height', H); c.setAttribute('viewBox', `0 0 ${W2} ${H}`); c.removeAttribute('style'); // margen a la derecha: la letra del PDF es más ancha que la de la pantalla
    c.querySelectorAll('*').forEach(e => { for (const a of ['fill', 'stroke', 'style']) if (e.hasAttribute(a)) e.setAttribute(a, rv(e.getAttribute(a)));
      if (e.tagName.toLowerCase() === 'text') { const st = e.getAttribute('style') || ''; e.setAttribute('style', `font-family:Helvetica,Arial,sans-serif;font-size:11.5px;${/fill\s*:/.test(st) || e.hasAttribute('fill') ? '' : 'fill:' + LIGHT.muted + ';'}${st}`); } });
    const xml = new XMLSerializer().serializeToString(c);
    return new Promise((ok, ko) => { const im = new Image(); im.onload = () => { const cv = document.createElement('canvas'); cv.width = Math.round(W2 * scale); cv.height = Math.round(H * scale);
      const g = cv.getContext('2d'); g.fillStyle = '#FFFFFF'; g.fillRect(0, 0, cv.width, cv.height); g.drawImage(im, 0, 0, cv.width, cv.height); ok({ url: cv.toDataURL('image/jpeg', 0.86), W: W2, H }); };
      im.onerror = ko; im.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(xml); });
  }

  // ---------- maquetación ----------
  function Doc(L) {
    const doc = new L.jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait', compress: true });
    let F = 'helvetica', FC = 'helvetica';
    if (L.fonts) { try { doc.addFileToVFS('bw.ttf', L.fonts.r); doc.addFont('bw.ttf', 'Barlow', 'normal', 'Identity-H'); doc.addFileToVFS('bw-b.ttf', L.fonts.b); doc.addFont('bw-b.ttf', 'Barlow', 'bold', 'Identity-H'); F = FC = 'Barlow';
      if (L.fonts.cr && L.fonts.cb) { doc.addFileToVFS('bwc.ttf', L.fonts.cr); doc.addFont('bwc.ttf', 'BarlowC', 'normal', 'Identity-H'); doc.addFileToVFS('bwc-b.ttf', L.fonts.cb); doc.addFont('bwc-b.ttf', 'BarlowC', 'bold', 'Identity-H'); FC = 'BarlowC'; } } catch (e) { F = FC = 'helvetica'; } }
    // con la letra estándar no hay − ≤ ≥ →
    const T = s => { s = String(s == null ? '' : s); return F === 'helvetica' ? s.replace(/−/g, '-').replace(/≤/g, '<=').replace(/≥/g, '>=').replace(/→/g, '->').replace(/[‹›]/g, '') : s; };
    const PW = 210, PH = 297, M = 14, CW = PW - 2 * M, BOT = PH - 16;
    const o = { doc, y: M, M, CW, PH, sec: '' };
    o.page = () => { doc.addPage(); o.y = M; };
    o.need = h => { if (o.y + h > BOT) o.page(); };
    o.font = (sz, b, cond) => { doc.setFont(cond ? FC : F, b ? 'bold' : 'normal'); doc.setFontSize(sz); };
    o.color = c => doc.setTextColor(...hex(c));
    // párrafo con ajuste de línea; **negrita** no: se pasa entero en un estilo
    o.p = (s, { sz = 9.5, b = false, c = LIGHT.ink, x = M, w = CW, lh = 1.32, gap = 1.6, cond = false } = {}) => {
      s = T(s); if (!s) return; o.font(sz, b, cond); o.color(c); const lines = doc.splitTextToSize(s, w), h = sz * 0.3528 * lh;
      for (const ln of lines) { o.need(h); doc.text(ln, x, o.y + h * 0.78); o.y += h; } o.y += gap; };
    o.h1 = s => { o.need(18); o.p(s, { sz: 16, b: true, gap: 2.5 }); };
    o.h2 = s => { o.need(16); o.y += 1.5; o.p(s, { sz: 12.5, b: true, gap: 1.8 }); doc.setDrawColor(...hex(LIGHT.line)); doc.setLineWidth(0.3); doc.line(M, o.y - 0.8, M + CW, o.y - 0.8); o.y += 1.2; };
    o.h3 = s => { o.need(12); o.y += 1; o.p(s, { sz: 10.5, b: true, gap: 1 }); };
    // etiqueta de color (Apta, Condiciona, Excluye…)
    o.chip = (s, k, x, y) => { s = T(s); o.font(8, true); const w = doc.getTextWidth(s) + 4; doc.setFillColor(...hex(LIGHT[k + '-bg'] || '#EEEEEE')); doc.roundedRect(x, y, w, 4.6, 1.2, 1.2, 'F'); o.color(LIGHT[k] || LIGHT.muted); doc.text(s, x + 2, y + 3.35); return w; };
    o.img = async (svg, w = CW) => { if (!svg) return; const im = await svgImg(svg); const h = w * im.H / im.W; o.need(h + 2); doc.addImage(im.url, 'JPEG', M + (CW - w) / 2, o.y, w, h, undefined, 'FAST'); o.y += h + 2; };
    // tabla sencilla: columnas con su ancho relativo; las celdas pueden tener varias líneas
    o.table = (head, rows, rel, { sz = 8.6, cond = true } = {}) => {
      const tot = rel.reduce((a, b) => a + b, 0), ws = rel.map(r => r / tot * CW), pad = 1.4, lh = sz * 0.3528 * 1.28;
      const cellLines = (s, w, b) => { o.font(sz, b, cond); return doc.splitTextToSize(T(s), w - 2 * pad); };
      const row = (cells, b, fill) => { const L = cells.map((s, i) => cellLines(s, ws[i], b)), h = Math.max(...L.map(l => l.length)) * lh + 2 * pad;
        o.need(h); if (fill) { doc.setFillColor(...hex(fill)); doc.rect(M, o.y, CW, h, 'F'); }
        let x = M; L.forEach((l, i) => { o.font(sz, b, cond); o.color(b ? LIGHT.muted : LIGHT.ink); l.forEach((ln, k) => doc.text(ln, x + pad, o.y + pad + lh * (k + 0.78))); x += ws[i]; });
        o.y += h; doc.setDrawColor(...hex(LIGHT.line)); doc.setLineWidth(0.2); doc.line(M, o.y, M + CW, o.y); };
      if (head) row(head, true, '#F2F4F0'); rows.forEach(r => row(r, false)); o.y += 2.5; };
    // barras de comparación (variedades, peores años) tal como salen en pantalla
    o.bars = (el, title) => { if (!el) return; const R = [...el.querySelectorAll('.vrow')]; if (!R.length) return; if (title) o.p(title, { sz: 9, b: true, c: LIGHT.muted, gap: 1 });
      R.forEach(r => { const vn = r.querySelector('.vn'), sm = vn && vn.querySelector('small'), nm = vn ? (vn.firstChild && vn.firstChild.textContent || '').trim() : '', sub = txt(sm), vv = txt(r.querySelector('.vv')).replace(/\n/g, ' · ');
        o.font(8.4, false, true); const vl = doc.splitTextToSize(T(vv), 58), h = Math.max(8, vl.length * 3.6 + 1.5); o.need(h);
        if (r.classList.contains('on')) { doc.setFillColor(...mix(LIGHT.frost, 0.12)); doc.rect(M, o.y, CW, h, 'F'); }
        o.font(9, true, true); o.color(LIGHT.ink); doc.text(T(nm), M + 1.5, o.y + 3.6); if (sub) { o.font(7.6, false, true); o.color(LIGHT.muted); let q = T(sub); if (doc.getTextWidth(q) > 45) { while (q.length > 3 && doc.getTextWidth(q + '…') > 45) q = q.slice(0, -1); q = q.trimEnd() + '…'; } doc.text(q, M + 1.5, o.y + 7); }
        const bx = M + 48, bw = CW - 48 - 62, by = o.y + h / 2 - 1.6; doc.setFillColor(...hex(LIGHT.line)); doc.rect(bx, by, bw, 3.2, 'F');
        r.querySelectorAll('.vb i').forEach(i => { const st = i.getAttribute('style') || '', g = k => { const m = st.match(new RegExp(k + '\\s*:\\s*([\\d.]+)%')); return m ? +m[1] : 0; };
          const bg = (st.match(/background\s*:\s*([^;]+)/) || [])[1] || (i.classList.contains('g') ? 'var(--bad)' : i.classList.contains('d') ? 'var(--warn)' : 'var(--frost)'), op = /opacity\s*:\s*([\d.]+)/.test(st) ? +st.match(/opacity\s*:\s*([\d.]+)/)[1] : 1;
          const l = g('left'), w = Math.max(0, Math.min(100 - l, g('width'))); if (w > 0) { doc.setFillColor(...mix(bg.trim(), op)); doc.rect(bx + bw * l / 100, by, bw * w / 100, 3.2, 'F'); } });
        o.font(8.4, false, true); o.color(LIGHT.muted); vl.forEach((ln, k) => doc.text(ln, M + CW - 1.5, o.y + 3.6 + k * 3.6, { align: 'right' })); o.y += h; });
      o.y += 2; };
    o.tableFrom = (t, rel) => { if (!t) return; const tr = [...t.querySelectorAll('tr')]; if (!tr.length) return; const cells = r => [...r.children].map(c => txt(c).replace(/\n/g, ' · '));
      const head = t.querySelector('thead tr'); o.table(head ? cells(head) : null, tr.filter(r => r !== head).map(cells), rel || cells(tr[0]).map((_, i) => i ? 1 : 1.4)); };
    o.T = T;
    return o;
  }

  // ---------- contenido ----------
  const wait = () => new Promise(r => setTimeout(r, 0));
  async function build(opt, onProg) {
    const A = APP(), C = A.cur(), st = A.state, L = await lib(), o = Doc(L), doc = o.doc;
    const keep = { sp: st.sp, sel: st.sel, yr: st.yr, yySel: st.yySel, yy: new Set(st.yy) };
    const sps = opt.sp === 'b' ? ['p', 'a'] : [opt.sp];
    const spName = { p: 'Pistacho', a: 'Almendro' };
    const lists = sps.map(sp => { const rows = sp === 'p' ? C.P : C.A; const fem = rows.filter(r => !r.male).sort((a, b) => (A.KR[a.cls] - A.KR[b.cls]) || (a.R.ml - b.R.ml));
      return { sp, rows, fem, pick: opt.v && opt.v !== '*' ? fem.filter(r => r.nm === opt.v) : fem }; });
    const total = lists.reduce((a, l) => a + l.pick.length, 0); let done = 0;
    A.setW(640);
    try {
      // portada: el recinto
      const now = new Date(), MES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
      o.h1('Informe de aptitud climática');
      o.p(`Recinto ${C.code}${C.pr && C.pr.uso_sigpac ? ' · ' + C.pr.uso_sigpac : ''}`, { sz: 12, b: true, gap: 1 });
      o.p(`${sps.map(s => spName[s]).join(' y ')} · ${opt.v && opt.v !== '*' ? 'variedad ' + opt.v : 'todas las variedades'}${sps.includes('p') ? ` · cosecha del pistacho para ${st.secano ? 'secano' : 'regadío'}` : ''}`, { sz: 10, c: LIGHT.muted, gap: 1 });
      o.p(`Hecho el ${now.getDate()} de ${MES[now.getMonth()]} de ${now.getFullYear()} a las ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')} · datos de clima hasta el ${A.lastDay()}`, { sz: 9, c: LIGHT.muted, gap: 4 });
      if (A.changed()) o.p(`Calculado con ${A.changed()} ${A.changed() === 1 ? 'parámetro cambiado' : 'parámetros cambiados'} en «Parámetros» (no son los de fábrica).`, { sz: 9, b: true, c: LIGHT.warn, gap: 3 });
      st.sp = lists[0].sp; st.sel = null; A.render(); await wait();
      o.h2('El recinto');
      o.table(null, [...$('facts').querySelectorAll('.fact')].map(f => [txt(f.querySelector('.k')), txt(f.querySelector('.v')).replace(/\n/g, ' ')]), [1, 3], { sz: 8.8 });
      o.p('Cómo leer el informe: el veredicto de cada variedad sale de las 10 últimas campañas; las heladas, el frío extremo y la helada antes de la cosecha miran también toda la serie, y por ellas una variedad puede quedarse en «con condiciones». Cada criterio trae su gráfica año a año, con sus rayas de aviso (ámbar) y de exclusión (roja).', { sz: 8.6, c: LIGHT.muted, gap: 2 });
      for (const li of lists) {
        st.sp = li.sp; st.sel = null; A.render(); await wait();
        o.page(); o.h1(li.sp === 'p' ? 'Pistacho' : 'Almendro (variedades autofértiles)');
        o.p($('verdict').textContent, { sz: 10.5, b: true, gap: 2.5 });
        const hd = li.sp === 'p' ? ['Variedad', 'Veredicto', 'Motivos', 'Plena flor media', 'Pérdida por helada', 'Cosecha mediana'] : ['Variedad', 'Veredicto', 'Motivos', 'Plena flor media', 'Pérdida por helada'];
        const trs = [...$('rank').querySelectorAll('tbody tr')].map(tr => [...tr.children].filter(td => !td.classList.contains('mt')).map(td => txt(td).replace(/\n/g, ' ')));
        o.table(hd, trs.map(r => { while (r.length < hd.length) r.push(''); return r.slice(0, hd.length); }), li.sp === 'p' ? [1.25, 1.35, 2.6, 1, 1, 1] : [1.3, 1.35, 2.8, 1.1, 1.1]);
        o.p($('rankNote').textContent, { sz: 8.4, c: LIGHT.muted, gap: 2 });
        for (const r of li.pick) {
          onProg(`Preparando ${r.nm} (${++done} de ${total})…`); await wait();
          st.sel = r.nm; st.yr = null; st.yySel = {}; A.render(); await wait();
          o.page();
          // veredicto y criterios
          const cr = $('crit'); o.h1(cr.querySelector('h2') ? cr.querySelector('h2').textContent : r.nm);
          const hn = cr.querySelector(':scope > p.note'); if (hn) o.p(txt(hn), { sz: 9, c: LIGHT.muted, gap: 2 });
          o.tableFrom(cr.querySelector('table.ft'), [1.6, 1, 1]);
          o.h2('Criterios');
          for (const k of cr.querySelectorAll('.crit')) {
            const ch = k.querySelector('.chip'), kind = ch ? ([...ch.classList].find(c => ['ok', 'warn', 'bad'].includes(c)) || 'ok') : 'ok', nm = (k.querySelector('b') || {}).textContent || '';
            const lines = [txt(k.querySelector('.cper')), txt(k.querySelector('.cv')), txt(k.querySelector('.cm')), txt(k.querySelector('.recent')), txt(k.querySelector('.ctodo'))].filter(Boolean);
            o.need(12); const y0 = o.y; o.chip(ch ? ch.textContent : '', kind, o.M, y0 + 0.4);
            o.p(nm, { sz: 9.6, b: true, x: o.M + 26, w: o.CW - 26, gap: 0.3 });
            lines.forEach((s, j) => o.p(s, { sz: 8.6, c: j === 0 || j === 4 ? LIGHT.muted : LIGHT.ink, x: o.M + 26, w: o.CW - 26, gap: 0.2, cond: true }));
            o.y += 1.6;
          }
          // heladas y floración
          const yc = $('yearChart'), hh = [...yc.querySelectorAll('.ywrap > svg')].reduce((s, g) => { const v = g.viewBox.baseVal; return s + (v && v.width ? o.CW * v.height / (v.width + 40) + 2 : 0); }, 0);
          o.need(Math.min(250, hh + 34)); o.h2($('detTitle').textContent); o.p(txt(yc.querySelector('.ysum')), { sz: 9, gap: 1.5 });
          for (const s of yc.querySelectorAll('.ywrap > svg')) await o.img(s);
          yc.querySelectorAll('.ywrap > .yleg').forEach(e => o.p(txt(e).replace(/\n/g, ' · '), { sz: 8.2, c: LIGHT.muted, gap: 1 }));
          o.p($('detLegend').innerText.replace(/\n/g, ' · '), { sz: 8.2, c: LIGHT.muted, gap: 2 });
          const sc = $('sideChart'), msvg = sc.querySelector(':scope > svg');
          if (msvg) { o.need(50); o.h3((sc.querySelector('.eyebrow') || {}).textContent || 'Coincidencia con los machos'); await o.img(msvg, 110); }
          const eys = [...sc.querySelectorAll('.eyebrow')]; o.bars(sc.querySelector('.vcmp'), eys.length ? eys[eys.length - 1].textContent : '');
          o.p($('detNote').textContent, { sz: 8.4, c: LIGHT.muted, gap: 2 });
          // cada criterio, año a año
          const box = document.createElement('div'); box.style.cssText = 'position:absolute;left:-10000px;top:0;width:640px'; document.body.appendChild(box);
          const crits = r.crit.filter(x => x.serie).slice().sort((a, b) => b.nivel - a.nivel);
          o.page(); o.h2(`${r.nm}: cada criterio, año a año`);
          o.p('Rayas discontinuas: ámbar, el aviso; roja, la que excluye. Línea de puntos: media (o mediana) de toda la serie; línea continua: la de los últimos 10 años (zona sombreada).', { sz: 8.4, c: LIGHT.muted, gap: 2 });
          for (const x of crits) {
            box.innerHTML = ''; A.yyPanel(x, r, li.rows, box); await wait();
            const gv = box.querySelector('.ywrap > svg'), gb = gv && gv.viewBox.baseVal; o.need(16 + (gb && gb.width ? o.CW * gb.height / (gb.width + 40) : 0)); o.y += 1; const y0 = o.y; const w = o.chip(A.NVL[x.nivel], A.KCLS[x.nivel], o.M, y0 + 0.6);
            o.p(x.nombre, { sz: 10.5, b: true, x: o.M + w + 3, w: o.CW - w - 3, gap: 0.6 });
            o.p(txt(box.querySelector('.ysum')), { sz: 8.8, gap: 1.2 });
            const g = box.querySelector('.ywrap > svg'); if (g) await o.img(g); else o.p('Sin datos para esta parcela.', { sz: 8.8, c: LIGHT.muted });
            const lg = box.querySelector('.yleg'); if (lg) o.p(txt(lg).replace(/\n/g, ' · '), { sz: 8, c: LIGHT.muted, gap: 1.5 });
            o.tableFrom(box.querySelector('table.ft'));
            const vs = [...box.querySelectorAll('.vcmp')], ey = [...box.querySelectorAll('.eyebrow')].map(e => e.textContent);
            vs.forEach((v, j) => o.bars(v, /peores/i.test(ey[ey.length - vs.length + j] || '') ? 'Los peores años' : (ey[ey.length - vs.length + j] || '')));
            const nt = box.querySelector(':scope > p.note'); if (nt) o.p(txt(nt), { sz: 8.2, c: LIGHT.muted, gap: 3 });
          }
          box.remove();
        }
      }
      // pie: recinto y página
      const n = doc.getNumberOfPages();
      for (let i = 1; i <= n; i++) { doc.setPage(i); o.font(7.6, false); o.color(LIGHT.muted); doc.text(o.T(`Aptitud climática · recinto ${C.code}`), o.M, o.PH - 8); doc.text(`${i} / ${n}`, o.M + o.CW, o.PH - 8, { align: 'right' }); }
      return { blob: doc.output('blob'), pages: n };
    } finally {
      A.setW(0); Object.assign(st, keep); A.render();
    }
  }

  // ---------- ventana del informe ----------
  const dlg = () => $('pdfDlg');
  function open() {
    const A = APP(), C = A && A.cur(); if (!C) return;
    const st = A.state, d = dlg();
    const opts = sp => { const rows = sp === 'p' ? C.P : sp === 'a' ? C.A : []; return '<option value="*">Todas las variedades</option>' + rows.filter(r => !r.male).map(r => `<option value="${r.nm}">${r.nm}</option>`).join(''); };
    d.innerHTML = `<div class="pdfbox" role="dialog" aria-modal="true" aria-labelledby="pdfH"><h2 id="pdfH">Informe PDF</h2>
      <p class="note" style="margin:0">Informe completo del recinto ${C.code}: veredicto, criterios y todas las gráficas. Se hace ahora y no se guarda en la app.</p>
      <label>Especie<select id="pdfSp"><option value="p">Pistacho</option><option value="a">Almendro</option><option value="b">Pistacho y almendro</option></select></label>
      <label>Variedad<select id="pdfV"></select></label>
      <div class="pdfst" id="pdfSt" aria-live="polite"></div>
      <div class="acts"><button class="btn" id="pdfGo" type="button">Hacer el informe</button><button class="btn sec" id="pdfX" type="button">Cancelar</button></div></div>`;
    d.hidden = false;
    const sp = $('pdfSp'), v = $('pdfV'); sp.value = st.sp;
    const fill = () => { v.innerHTML = opts(sp.value); v.disabled = sp.value === 'b'; if (sp.value === st.sp && st.sel) v.value = '*'; };
    sp.onchange = fill; fill();
    $('pdfX').onclick = close; d.onclick = e => { if (e.target === d && !busy) close(); };
    $('pdfGo').onclick = () => go({ sp: sp.value, v: sp.value === 'b' ? '*' : v.value });
    $('pdfGo').focus();
  }
  let busy = false;
  const close = () => { if (busy) return; const d = dlg(); d.hidden = true; d.innerHTML = ''; };
  async function go(opt) {
    if (busy) return; busy = true; const s = $('pdfSt'), gb = $('pdfGo'), xb = $('pdfX'); gb.disabled = xb.disabled = true;
    s.textContent = 'Preparando el generador de PDF…';
    let res;
    try { res = await build(opt, t => { s.textContent = t; }); }
    catch (e) { busy = false; gb.disabled = xb.disabled = false; s.textContent = e && e.message === 'sin generador' ? 'No se ha podido cargar el generador de PDF: hace falta conexión. Inténtalo de nuevo.' : 'No se ha podido hacer el informe. Inténtalo de nuevo.'; console.error(e); return; }
    busy = false;
    const C = APP().cur(), sp = { p: 'pistacho', a: 'almendro', b: 'pistacho y almendro' }[opt.sp];
    const name = `Aptitud ${C.code.replace(/:/g, '-')} ${sp}${opt.v && opt.v !== '*' ? ' ' + opt.v : ''}.pdf`;
    // dentro de Mapa de Fincas: su hoja de descarga (Guardar / Enviar…)
    let P = null; try { if (window.parent !== window && typeof window.parent.showDl === 'function') P = window.parent; } catch (e) { P = null; }
    if (P) { close(); P.showDl(res.blob, name, 'Informe de aptitud climática', res.pages + (res.pages === 1 ? ' página' : ' páginas')); return; }
    const url = URL.createObjectURL(res.blob), kb = Math.max(1, Math.round(res.blob.size / 1024));
    const file = typeof File === 'function' ? new File([res.blob], name, { type: 'application/pdf' }) : null;
    const share = file && navigator.canShare && navigator.canShare({ files: [file] });
    dlg().querySelector('.pdfbox').innerHTML = `<h2>Informe listo</h2><p class="note" style="margin:0">${name} · ${res.pages} páginas · ${kb.toLocaleString('es-ES')} KB</p>
      <div class="acts"><a class="btn" id="pdfSave" href="${url}" download="${name}">Guardar</a>${share ? '<button class="btn sec" id="pdfShare" type="button">Enviar…</button>' : ''}<a class="btn sec" href="${url}" target="_blank" rel="noopener">Ver</a><button class="btn sec" id="pdfX" type="button">Cerrar</button></div>`;
    $('pdfX').onclick = () => { close(); setTimeout(() => URL.revokeObjectURL(url), 60000); };
    if (share) $('pdfShare').onclick = () => navigator.share({ files: [file], title: name }).catch(() => {});
  }
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !dlg().hidden) close(); });
  const b = $('pdfBtn'); if (b) b.addEventListener('click', open);
  window.AptitudInforme = { open, build };
})();
