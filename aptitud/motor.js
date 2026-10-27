// Motor de aptitud (v2). Trabaja con los datos diarios precalculados de una celda ERA5-Land corregida con SIAR.
// Fichero de celda: Int16, 7 filas x nd días: tmin*10, tmax*10, porciones de frío*100, GDH Anderson, GDH Richardson, Utah*2, GDD7,2*10
// Día 0 = META.d0 (día local). Campaña y = del 1 de septiembre de y al 31 de agosto de y+1.
(function (G) {
  const DAY = 864e5;
  function cellArrays(buf, nd) {
    const a = new Int16Array(buf);
    const row = k => a.subarray(k * nd, (k + 1) * nd);
    return { nd, tmin: row(0), tmax: row(1), cp: row(2), gdha: row(3), gdhr: row(4), utah: row(5), gdd7: row(6), h15: row(7), rh: row(8), rain: row(9), wind: row(10) };
  }
  const dayIndex = (d0, y, m, d) => Math.round((Date.UTC(y, m - 1, d) - d0) / DAY);
  const doyOf = (d0, i) => { const t = new Date(d0 + i * DAY); return Math.round((t - Date.UTC(t.getUTCFullYear(), 0, 1)) / DAY) + 1; };

  // Primer día (desde a) en que el acumulado de 'arr*escala' alcanza 'req'; devuelve [índice, acumulado en ese día]
  function reach(arr, scale, a, b, req) { let s = 0; for (let i = a; i < b; i++) { s += arr[i] / scale; if (s >= req) return i; } return -1; }
  function reachUtah(c, a, b, req) { let s = 0; for (let i = a; i < b; i++) { s = Math.max(0, s + c.utah[i] / 2); if (s >= req) return i; } return -1; }
  function sumRange(arr, scale, a, b) { let s = 0; for (let i = a; i < b; i++) s += arr[i] / scale; return s; }
  function minRange(arr, a, b) { let m = 99; for (let i = Math.max(0, a); i < b; i++) { const v = arr[i] / 10; if (v < m) m = v; } return m; }
  const kill = (t, t10, t90) => t >= t10 ? 0 : t <= t90 ? Math.min(1, 0.9 + 0.05 * (t90 - t)) : 0.1 + 0.8 * (t10 - t) / (t10 - t90);

  function seasons(c, d0) {
    const out = []; const y0 = new Date(d0).getUTCFullYear();
    for (let y = y0; y < 2100; y++) {
      const a = dayIndex(d0, y, 9, 1); const b = dayIndex(d0, y + 1, 8, 31) + 1;
      if (a < 0) continue; if (b > c.nd) break;
      out.push({ y: y + 1, a, b, bx: Math.min(c.nd, dayIndex(d0, y + 1, 12, 31) + 1) });
    }
    return out;
  }

  // ---------- Pistacho ----------
  function pistachio(c, d0, P) {
    const S = seasons(c, d0); const ref = P.ref;
    // fin del frío: cuando se cubren las porciones de referencia o, como tarde, en la fecha tope (inviernos pobres en frío)
    const chillEnd = s => { const ic = reach(c.cp, 100, s.a, s.b, ref.cp); const cap = dayIndex(d0, s.y, 1, 1) + (P.chillCapDoy || 999) - 1; return ic < 0 || ic > cap ? cap : ic; };
    // floración del Kerman (referencia)
    const kb = S.map(s => reach(c.gdha, 1, chillEnd(s) + 1, s.b, ref.gdh));
    // GDH medio por día en los 10 días previos a la floración del Kerman (para pasar desfases en días a calor)
    let gs = 0, gn = 0; kb.forEach(i => { if (i > 10) { gs += sumRange(c.gdha, 1, i - 10, i) / 10; gn++; } });
    const gpd = gn ? gs / gn : 300;
    const res = {};
    for (const v of P.varieties) {
      const gReq = ref.gdh + v.offset * gpd;
      const rows = S.map((s, k) => {
        const f = reach(c.gdha, 1, chillEnd(s) + 1, s.b, gReq); if (f < 0) return null;
        const r = { y: s.y, fb: doyOf(d0, f), cpAtBloom: sumRange(c.cp, 100, s.a, f), chillOk: sumRange(c.cp, 100, s.a, f) >= v.cp };
        if (v.sex === 'M') return r;
        let surv = 1, tmb = 99;
        for (const [a, b, t10, t90] of P.stages) { const m = minRange(c.tmin, f + a, f + b + 1); surv *= 1 - kill(m, t10, t90); if (a <= 0 && b >= 0) tmb = m; }
        r.loss = Math.round((1 - surv) * 100); r.tminBloom = tmb;
        const h = reach(c.gdd7, 10, f, s.bx, v.gdd);
        r.harv = h < 0 ? -1 : doyOf(d0, h);
        let af = 0; if (h > 0) { const s9 = dayIndex(d0, s.y, 9, 1); for (let i = s9; i <= h; i++) if (c.tmin[i] / 10 <= P.autumnFrost) { af = 1; break; } }
        r.autumn = af; return r;
      });
      res[v.name] = { v, rows };
    }
    return { res, gpd };
  }

  // ---------- Almendro ----------
  function almond(c, d0, A) {
    const S = seasons(c, d0);
    const ref = S.map(s => { const br = reachUtah(c, s.a, s.b, A.ref.cu); if (br < 0) return null; const f = reach(c.gdhr, 1, br + 1, s.b, A.ref.gdh); return f < 0 ? null : { br, f }; });
    const res = {};
    for (const v of A.varieties) {
      // calor necesario: mediana del GDH acumulado desde la rotura del letargo hasta (floración Guara + desfase)
      const req = []; ref.forEach(r => { if (r && r.f + v.offset < c.nd) req.push(sumRange(c.gdhr, 1, r.br + 1, r.f + v.offset + 1)); }); req.sort((x, y) => x - y);
      const gReq = req[req.length >> 1];
      const rows = S.map((s, k) => {
        const r0 = ref[k]; if (!r0) return null;
        const f = reach(c.gdhr, 1, r0.br + 1, s.b, gReq); if (f < 0) return null;
        let surv = 1, tmb = 99;
        const fd = v.frost || [0, 0];
        A.stages.forEach(([a, b, t10, t90], k) => { const fl = k >= 1 && k <= 3; const m = minRange(c.tmin, f + a, f + b + 1);
          surv *= 1 - kill(m, t10 + (fl ? fd[0] : 0), t90 + (fl ? fd[1] : 0)); if (a <= 0 && b >= 0) tmb = m; });
        return { y: s.y, fb: doyOf(d0, f), loss: Math.round((1 - surv) * 100), tminBloom: tmb };
      });
      res[v.name] = { v, rows };
    }
    return { res };
  }

  function winterMin(c, d0) { return seasons(c, d0).map(s => ({ y: s.y, t: minRange(c.tmin, dayIndex(d0, s.y - 1, 11, 1), dayIndex(d0, s.y, 3, 31) + 1) })); }

  G.Motor = { cellArrays, pistachio, almond, winterMin, seasons, doyOf };
})(typeof window !== 'undefined' ? window : globalThis);
