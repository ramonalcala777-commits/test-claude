// Pedir a Copernicus (CDS) los semestres de ERA5-Land que falten.
// Se pega en la consola de una pestaña de https://cds.climate.copernicus.eu con la sesión iniciada
// (licencia ERA5-Land aceptada). El token se lee dentro de la página; no sale de ella.
// Copernicus admite pocas peticiones a la vez: el gestor manda como mucho 2 y reintenta cada 90 s.
// Los trabajos se guardan en localStorage.__aptitud_jobs ({'2026-07': jobID, ...}).
(function () {
  const pad = n => String(n).padStart(2, '0');
  const mk = (y, ms) => ({ variable: ['2m_temperature'], year: [String(y)], month: ms.map(pad), day: Array.from({ length: 31 }, (_, i) => pad(i + 1)),
    time: Array.from({ length: 24 }, (_, i) => pad(i) + ':00'), data_format: 'netcdf', download_format: 'unarchived', area: [41.4, -5.5, 38, -0.9] });
  // EDITAR: semestres que se quieren pedir. Clave = año-mes de inicio; meses del semestre (el último, solo los meses ya publicados).
  window.__cola = [['2026-07', mk(2026, [7, 8, 9, 10, 11, 12])]];
  async function H() { const t = await fetch('/api/auth/session').then(r => r.json()); return { Authorization: 'Bearer ' + (t.accessToken || t.access_token || (t.user && t.user.accessToken)), 'Content-Type': 'application/json' }; }
  window.__tick2 = async () => { try { const h = await H(); const j = JSON.parse(localStorage.getItem('__aptitud_jobs') || '{}'); let act = 0;
    for (const id of Object.values(j)) { const s = (await fetch('/api/retrieve/v1/jobs/' + id, { headers: h }).then(r => r.json())).status; if (s === 'accepted' || s === 'running') act++; }
    while (act < 2 && __cola.length) { const [k, req] = __cola[0]; const r = await fetch('/api/retrieve/v1/processes/reanalysis-era5-land/execution', { method: 'POST', headers: h, body: JSON.stringify({ inputs: req }) });
      const x = await r.json(); if (!x.jobID) { window.__last = 'error ' + r.status; break; } j[k] = x.jobID; localStorage.setItem('__aptitud_jobs', JSON.stringify(j)); __cola.shift(); act++; }
    window.__last = 'ok ' + new Date().toISOString().slice(11, 19) + ' activos ' + act + ' en cola ' + __cola.length; } catch (e) { window.__last = 'excepción ' + e; } };
  if (window.__iv2) clearInterval(window.__iv2); window.__iv2 = setInterval(__tick2, 90000); __tick2();
  // Para listar los resultados (ruta de descarga de cada semestre terminado), en la misma pestaña:
  window.__rutas = async () => { const h = await H(); const j = JSON.parse(localStorage.getItem('__aptitud_jobs') || '{}'); const o = [];
    for (const [k, id] of Object.entries(j)) { const d = await fetch('/api/retrieve/v1/jobs/' + id, { headers: h }).then(r => r.json());
      if (d.status === 'successful') { const x = await fetch('/api/retrieve/v1/jobs/' + id + '/results', { headers: h }).then(r => r.json()); o.push(k + ' ' + new URL(x.asset.value.href).pathname); } }
    return o.join('\n'); };
})();
