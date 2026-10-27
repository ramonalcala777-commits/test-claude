// Criterios de aptitud. Cada uno devuelve {id, nombre, valor (texto), nivel 0 sin limitación / 1 condiciona / 2 excluye, motivo}.
// Umbrales en CONFIG.crit (editables). Las series de HR, lluvia y viento vienen de estaciones SIAR (desde 2000).
(function (G) {
  const DAY = 864e5;
  const idx = (d0, y, m, d) => Math.round((Date.UTC(y, m - 1, d) - d0) / DAY);
  const iOfDoy = (d0, y, doy) => idx(d0, y, 1, 1) + doy - 1;
  const ok = v => v >= 0;
  const f1 = x => x.toLocaleString('es-ES', { maximumFractionDigits: 1 });
  const pc = x => Math.round(x * 100) + ' %';
  function lvl(v, c, e, higherWorse = true) { if (higherWorse) return v > e ? 2 : v > c ? 1 : 0; return v < e ? 2 : v < c ? 1 : 0; }

  function seasonVals(c, d0, years, fn) { return years.map(y => fn(y)).filter(v => v != null && !isNaN(v)); }
  const mean = a => a.length ? a.reduce((s, x) => s + x, 0) / a.length : NaN;

  function rainDays(c, a, b, mm = 2) { let n = 0, has = 0; for (let i = a; i <= b; i++) { const r = c.rain[i]; if (r < 0) continue; has++; if (r / 10 >= mm) n++; } return has >= (b - a + 1) * .7 ? n : null; }
  function rainSum(c, a, b) { let s = 0, has = 0; for (let i = a; i <= b; i++) { const r = c.rain[i]; if (r < 0) continue; has++; s += r / 10; } return has >= (b - a + 1) * .7 ? s : null; }
  function meanOf(arr, a, b, sc) { let s = 0, n = 0; for (let i = a; i <= b; i++) { if (arr[i] < 0) continue; s += arr[i] / sc; n++; } return n >= (b - a + 1) * .7 ? s / n : null; }

  // ---------- pistacho ----------
  function pist(c, d0, r, all, K) {
    const out = []; const rows = r.rows.filter(Boolean); const n = rows.length; const ys = rows.map(x => x.y);
    out.push({ id: 'helada', nombre: 'Heladas en floración y cuajado', valor: `pérdida media ${Math.round(r.ml)} % · ${r.bad} de ${n} años con más de la mitad`, nivel: r.ml > K.loss[1] || r.bad > K.bad[1] ? 2 : r.ml > K.loss[0] || r.bad > K.bad[0] ? 1 : 0, motivo: 'Las heladas en racimo, flor o fruto recién cuajado se llevan la cosecha.' });
    const cf = r.chillFail / n; out.push({ id: 'frio', nombre: 'Frío invernal', valor: `${r.chillFail} de ${n} inviernos sin frío suficiente`, nivel: lvl(cf, K.chill[0], K.chill[1]), motivo: 'Sin el frío de la variedad la brotación es irregular y la floración de hembra y macho no coincide.' });
    const vlate = rows.filter(x => x.harv < 0 || x.harv > K.veryLateDoy).length;
    out.push({ id: 'cosecha', nombre: 'Calor para madurar el fruto', valor: `cosecha mediana ${r.mhTxt} · ${r.late} de ${n} años después del 15 oct · ${vlate} después del 1 nov`, nivel: lvl(vlate / n, K.veryLate[0], K.veryLate[1]), motivo: 'Si el verano no da el calor que necesita la variedad, la cosecha se va a noviembre, el fruto llena peor y aumentan los vacíos y los no abiertos, además del riesgo de lluvias y heladas de otoño.' });
    out.push({ id: 'otono', nombre: 'Helada antes de la cosecha', valor: `${r.autN} de ${n} años`, nivel: lvl(r.autN / n, K.autumn[0], 9), motivo: 'Una helada de −2 °C antes de cosechar daña fruto y hoja y la madera agosta mal.' });
    if (r.v.males) out.push({ id: 'macho', nombre: 'Coincidencia con el macho', valor: `${r.v.males.map(m => [m, r.ov[m] || 0]).sort((a, b) => b[1] - a[1]).map(([m, o]) => `${m} ${pc(o)}`).join(' · ')} de la floración cubierta`, nivel: lvl(r.best[1], K.overlap[0], K.overlap[1], false), motivo: 'La hembra solo cuaja si hay polen en el aire mientras está receptiva.' });
    // lluvia y viento en floración
    const rb = rows.map(x => rainDays(c, iOfDoy(d0, x.y, x.fb) - 5, iOfDoy(d0, x.y, x.fb) + 5)).filter(v => v != null);
    if (rb.length >= 8) { const fr = rb.filter(v => v >= K.rainBloomDays).length / rb.length; out.push({ id: 'lluviaflor', nombre: 'Lluvia en floración', valor: `${pc(fr)} de los años con ${K.rainBloomDays} o más días de lluvia (≥ 2 mm) en floración`, nivel: lvl(fr, K.rainBloom[0], K.rainBloom[1]), motivo: 'El polen del pistacho viaja por el aire; la lluvia lo lava y baja el cuajado.' }); }
    const wb = rows.map(x => meanOf(c.wind, iOfDoy(d0, x.y, x.fb) - 5, iOfDoy(d0, x.y, x.fb) + 5, 10)).filter(v => v != null);
    if (wb.length >= 8) { const w = mean(wb); out.push({ id: 'viento', nombre: 'Viento en floración', valor: `${f1(w)} m/s de media`, nivel: w < K.windLow ? 1 : w > K.windHigh ? 1 : 0, motivo: w < K.windLow ? 'Con poco viento el polen no llega bien a las hembras: cuidar la colocación de los machos.' : 'Con viento fuerte la flor se deseca y el polen se dispersa mal.' }); }
    // humedad de verano
    const years = [...new Set(ys)];
    const hr = seasonVals(c, d0, years, y => meanOf(c.rh, idx(d0, y, 6, 1), idx(d0, y, 9, 30), 10));
    if (hr.length >= 8) { const h = mean(hr); out.push({ id: 'hr', nombre: 'Humedad relativa en verano', valor: `${Math.round(h)} % de media (junio a septiembre, día y noche)`, nivel: lvl(h, K.hr[0], K.hr[1]), motivo: 'Humedad media de verano (día y noche). Por encima del 58 % aumenta claramente la presión de Alternaria y Botryosphaeria y conviene reforzar los tratamientos.' }); }
    // lluvia en precosecha
    const pre = rows.map(x => x.harv > 0 ? rainSum(c, idx(d0, x.y, 8, 15), iOfDoy(d0, x.y, x.harv)) : null).filter(v => v != null);
    if (pre.length >= 8) { const fr = pre.filter(v => v > K.preRainMm).length / pre.length; out.push({ id: 'lluviacosecha', nombre: 'Lluvia en precosecha (15 ago – cosecha)', valor: `${pc(fr)} de los años con más de ${K.preRainMm} mm`, nivel: lvl(fr, K.preRain[0], K.preRain[1]), motivo: 'La lluvia con el fruto abierto mancha la cáscara, favorece Aspergillus (aflatoxinas) y complica el secado.' }); }
    // Botryosphaeria
    const bot = years.map(y => { let n = 0, has = 0; for (let i = idx(d0, y, 4, 1); i <= idx(d0, y, 9, 30); i++) { if (c.rain[i] < 0) continue; has++; if (c.rain[i] / 10 >= 2 && (c.tmin[i] + c.tmax[i]) / 20 >= 15) n++; } return has > 120 ? n : null; }).filter(v => v != null);
    if (bot.length >= 8) { const m = mean(bot); out.push({ id: 'boty', nombre: 'Periodos de infección de Botryosphaeria', valor: `${f1(m)} días al año con lluvia y más de 15 °C (abril a septiembre)`, nivel: lvl(m, K.boty[0], K.boty[1]), motivo: 'El hongo entra con lluvia y temperatura templada; cuantas más ocasiones, más tratamientos y más riesgo.' }); }
    // golpes de calor
    const hot = years.map(y => { let n = 0; for (let i = idx(d0, y, 6, 1); i <= idx(d0, y, 8, 31); i++) if (c.tmax[i] / 10 >= 40) n++; return n; });
    const hm = mean(hot); out.push({ id: 'calor', nombre: 'Golpes de calor (≥ 40 °C)', valor: `${f1(hm)} días al año de junio a agosto`, nivel: lvl(hm, K.hot[0], 99), motivo: 'Los golpes de calor en el llenado aumentan los frutos vacíos.' });
    // calor en floración (±7 días de la plena flor de la variedad)
    const bh = rows.map(x => { const i = iOfDoy(d0, x.y, x.fb); let k = 0; for (let j = i - 7; j <= i + 7; j++) if (c.tmax[j] / 10 >= K.bloomHotT) k++; return k; });
    const fbh = bh.filter(v => v >= K.bloomHotDays).length / bh.length;
    out.push({ id: 'calorflor', nombre: 'Calor en floración', valor: `${pc(fbh)} de los años con ${K.bloomHotDays} o más días ≥ ${K.bloomHotT} °C en floración`, nivel: lvl(fbh, K.bloomHot[0], K.bloomHot[1]), motivo: 'Con más de 30 °C en floración el polen pierde viabilidad y el estigma se seca antes de tiempo: peor cuajado y más frutos vacíos.' });
    // frío extremo
    const w = all.W.map(x => x.t); const f12 = w.filter(x => x <= -12).length / w.length, f20 = w.filter(x => x <= -20).length / w.length;
    out.push({ id: 'invierno', nombre: 'Frío extremo de invierno', valor: `${w.filter(x => x <= -12).length} de ${w.length} inviernos ≤ −12 °C · mínima ${f1(Math.min(...w))} °C`, nivel: f20 > K.w20 ? 2 : f12 > K.w12 ? 1 : 0, motivo: 'Por debajo de −12 °C sufren los plantones; por debajo de −20 °C también la madera de los adultos.' });
    return out;
  }

  // ---------- almendro ----------
  function alm(c, d0, r, all, K) {
    const out = []; const rows = r.rows.filter(Boolean); const n = rows.length; const years = [...new Set(rows.map(x => x.y))];
    out.push({ id: 'helada', nombre: 'Heladas en floración y cuajado', valor: `pérdida media ${Math.round(r.ml)} % · ${r.bad} de ${n} años con más de la mitad`, nivel: r.ml > K.loss[1] || r.bad > K.bad[1] ? 2 : r.ml > K.loss[0] || r.bad > K.bad[0] ? 1 : 0, motivo: 'La helada en flor abierta o en fruto recién cuajado es el principal riesgo del almendro.' });
    const bee = rows.map(x => { const a = iOfDoy(d0, x.y, x.fb) - 5, b = iOfDoy(d0, x.y, x.fb) + 5; let h = 0, has = 0; for (let i = a; i <= b; i++) { if (c.rain[i] < 0 || c.wind[i] < 0) continue; has++; if (c.rain[i] / 10 < 1 && c.wind[i] / 10 < K.beeWind) h += c.h15[i]; } return has >= 8 ? h : null; }).filter(v => v != null);
    if (bee.length >= 8) { const m = mean(bee); out.push({ id: 'abejas', nombre: 'Horas de vuelo de abejas en floración', valor: `${Math.round(m)} horas de media (≥ 15 °C, sin lluvia, poco viento)`, nivel: lvl(m, K.bee[0], K.bee[1], false), motivo: 'Aunque la variedad sea autofértil, las abejas mejoran mucho el cuajado; con frío, lluvia o viento no vuelan.' }); }
    const rb = rows.map(x => rainDays(c, iOfDoy(d0, x.y, x.fb) - 3, iOfDoy(d0, x.y, x.fb) + 10)).filter(v => v != null);
    if (rb.length >= 8) { const fr = rb.filter(v => v >= K.moniliaDays).length / rb.length; out.push({ id: 'monilia', nombre: 'Lluvia en floración (Monilia)', valor: `${pc(fr)} de los años con ${K.moniliaDays} o más días de lluvia (≥ 2 mm) en floración`, nivel: lvl(fr, K.monilia[0], K.monilia[1]), motivo: 'La flor mojada se infecta de Monilia y poliniza peor.' }); }
    const sp = years.map(y => rainDays(c, idx(d0, y, 4, 1), idx(d0, y, 6, 30))).filter(v => v != null);
    if (sp.length >= 8) { const m = mean(sp); out.push({ id: 'primavera', nombre: 'Lluvia en primavera (abril a junio)', valor: `${f1(m)} días de lluvia (≥ 2 mm) de media`, nivel: lvl(m, K.spring[0], K.spring[1]), motivo: 'Primaveras lluviosas: mancha ocre, cribado y Fusicoccum; más tratamientos.' }); }
    const hv = years.map(y => rainSum(c, idx(d0, y, 8, 15), idx(d0, y, 9, 30))).filter(v => v != null);
    if (hv.length >= 8) { const fr = hv.filter(v => v > K.harvRainMm).length / hv.length; out.push({ id: 'lluviacosecha', nombre: 'Lluvia en cosecha (15 ago – 30 sep)', valor: `${pc(fr)} de los años con más de ${K.harvRainMm} mm`, nivel: lvl(fr, K.harvRain[0], K.harvRain[1]), motivo: 'La lluvia en cosecha retrasa el secado y favorece hongos en la almendra.' }); }
    const w = all.W.map(x => x.t); const f15 = w.filter(x => x <= -15).length / w.length;
    out.push({ id: 'invierno', nombre: 'Frío extremo de invierno', valor: `${w.filter(x => x <= -15).length} de ${w.length} inviernos ≤ −15 °C`, nivel: lvl(f15, K.w15alm, 9), motivo: 'Por debajo de −15 °C puede haber daños en madera y yemas.' });
    return out;
  }

  function verdict(list) {
    const ex = list.filter(x => x.nivel === 2), co = list.filter(x => x.nivel === 1);
    return { cls: ex.length ? 'bad' : co.length ? 'warn' : 'ok', ex, co };
  }
  G.Criterios = { pist, alm, verdict };
})(window);
