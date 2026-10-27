"""Procesado vectorizado de toda la malla (todas las celdas a la vez).
Entrada : grid/t2m.npy (horas x celdas, int16 centésimas de °C, UTC desde 1995-07-01 00:00), grid/correcciones.json
Salida  : grid/celdas/<idx>.bin  (int16, 7 x ndías) + grid/meta.json
Días locales = UTC+1 (de 01:00 UTC a 00:00 UTC del día siguiente).
"""
import numpy as np, json, os, datetime as dt, math, sys, gzip
from pipeline import T0, OUT, QS, km

_ST = None
def _load_stations(nd):
    """Series diarias SIAR de HR media, lluvia y viento medio (índice de día desde d0)."""
    global _ST
    if _ST is not None: return _ST
    st = json.load(open(os.path.join(os.path.dirname(OUT), 'siar', 'estaciones.json')))
    d0 = (T0 + dt.timedelta(hours=1)).date(); _ST = []
    for e in st:
        fn = os.path.join(os.path.dirname(OUT), 'siar2', e['id'] + '.csv')
        if not os.path.exists(fn): continue
        a = np.full((3, nd), np.nan)
        for line in open(fn):
            p = line.strip().split(';')
            if len(p) < 7 or '/' not in p[0]: continue
            dd, mm, yy = p[0].split('/'); k = (dt.date(int(yy), int(mm), int(dd)) - d0).days
            if not 0 <= k < nd: continue
            f = lambda s: float(s.replace(',', '.')) if s else np.nan
            hm, ws, pr = f(p[1]), f(p[4]), f(p[6])
            if 5 <= hm <= 100: a[0, k] = hm
            if 0 <= pr < 250: a[1, k] = pr
            if 0 <= ws < 25: a[2, k] = ws
        if np.isfinite(a[0]).sum() > 365 * 3: _ST.append((e['lat'], e['lon'], a))
    return _ST

def station_daily(la, lo, nd, k=3):
    S = _load_stations(nd)
    ds = sorted(((km(la, lo, s[0], s[1]), s[2]) for s in S), key=lambda x: x[0])[:6]
    out = np.full((3, nd), -1.0)
    for v in range(3):
        num = np.zeros(nd); den = np.zeros(nd); used = np.zeros(nd)
        for d, a in ds:
            ok = np.isfinite(a[v]) & (used < k)
            w = 1 / max(d, 3) ** 2
            num[ok] += w * a[v][ok]; den[ok] += w; used[ok] += 1
        m = den > 0; out[v, m] = np.round(num[m] / den[m] * 10)
    return out

def main(test_cells=None):
    g = json.load(open(os.path.join(OUT, 'grid.json')))
    M = np.load(os.path.join(OUT, 't2m.npy'), mmap_mode='r')
    tabs = json.load(open(os.path.join(OUT, 'correcciones.json')))
    lat, lon = np.array(g['lat']), np.array(g['lon'])
    nlat, nlon = lat.size, lon.size
    cells = np.arange(nlat * nlon) if test_cells is None else np.array(test_cells)
    nh = M.shape[0]; nd = (nh - 1) // 24
    d0 = (T0 + dt.timedelta(hours=1)).date()
    months = np.array([(d0 + dt.timedelta(days=i)).month for i in range(nd)])
    # celdas válidas (tierra): sin huecos
    meta = {'d0': d0.isoformat(), 'nd': nd, 'lat': g['lat'], 'lon': g['lon'], 'cells': {}}
    os.makedirs(os.path.join(OUT, 'celdas'), exist_ok=True)
    B = int(os.environ.get("BATCH", 60))
    for b0 in range(0, cells.size, B):
        cb = cells[b0:b0 + B]
        X = M[:, cb].astype(np.float32)
        miss = (X == -32768)
        land = miss.mean(0) < 0.01
        X /= 100
        X[miss] = np.nan
        # rellenar huecos sueltos por interpolación temporal
        for k in np.where(land & miss.any(0))[0]:
            s = X[:, k]; bad = np.isnan(s); s[bad] = np.interp(np.where(bad)[0], np.where(~bad)[0], s[~bad])
        S = X[1:1 + nd * 24].reshape(nd, 24, -1)       # día x hora x celda
        mn = S.min(1); mx = S.max(1)                    # día x celda
        A = np.zeros_like(mn); Bm = np.zeros_like(mn); info = []
        for j, c in enumerate(cb):
            if not land[j]:
                info.append(None); continue
            la, lo = lat[c // nlon], lon[c % nlon]
            ds = sorted(((km(la, lo, t['lat'], t['lon']), t) for t in tabs), key=lambda x: x[0])[:3]
            w = np.array([1 / max(d, 3) ** 2 for d, _ in ds]); w /= w.sum()
            for (dist, t), wi in zip(ds, w):
                for m in range(1, 13):
                    sel = months == m; q = np.array(t['qm'][m - 1])
                    A[sel, j] += wi * np.interp(mn[sel, j], q[:, 0], q[:, 1])
                Bm[:, j] += wi * t['dmax']
            info.append([[t['id'], t['mun'], round(d, 1)] for d, t in ds])
        span = np.where(mx > mn, mx - mn, 1)
        S = S + A[:, None, :] + (Bm - A)[:, None, :] * (S - mn[:, None, :]) / span[:, None, :]
        H = S.reshape(nd * 24, -1).astype(np.float64)
        # Modelo Dinámico vectorizado, reinicio el 1 de septiembre
        e0, e1, a0, a1, slp, tet = 4153.5, 12888.8, 139500, 2.567e18, 1.6, 277
        inc = np.zeros_like(H); inter = np.zeros(H.shape[1])
        resets = set()
        for y in range(1995, 2027):
            h = int((dt.datetime(y, 9, 1) - (T0 + dt.timedelta(hours=1))).total_seconds() // 3600)
            if 0 <= h < H.shape[0]: resets.add(h)
        for i in range(H.shape[0]):
            if i in resets: inter[:] = 0
            TK = H[i] + 273
            xi = 1 / (1 + np.exp(-slp * tet * (TK - tet) / TK))
            xs = (a0 / a1) * np.exp((e1 - e0) / TK)
            E = xs - (xs - inter) * np.exp(-a1 * np.exp(-e1 / TK))
            big = E >= 1
            d = np.where(big, xi * E, 0.0)
            inc[i] = d; inter = E - d
        Tb, Tu, Tc = 4.0, 25.0, 36.0
        ga = np.zeros_like(H)
        m1 = (H > Tb) & (H <= Tu); ga[m1] = (Tu - Tb) / 2 * (1 + np.cos(np.pi + np.pi * (H[m1] - Tb) / (Tu - Tb)))
        m2 = (H > Tu) & (H <= Tc); ga[m2] = (Tu - Tb) * (1 + np.cos(np.pi / 2 + np.pi / 2 * (H[m2] - Tu) / (Tc - Tu)))
        gr = np.clip(np.minimum(H, 25) - 4.5, 0, None)
        ut = np.select([H <= 1.4, H <= 2.4, H <= 9.1, H <= 12.4, H <= 15.9, H <= 18], [0, .5, 1, .5, 0, -.5], -1)
        g7 = np.clip(H - 7.2, 0, None) / 24
        R = lambda Z: Z.reshape(nd, 24, -1).sum(1)
        Sd = H.reshape(nd, 24, -1)
        h15 = (Sd >= 15).sum(1)
        out = np.stack([np.round(Sd.min(1) * 10), np.round(Sd.max(1) * 10), np.round(R(inc) * 100), np.round(R(ga)), np.round(R(gr)), np.round(R(ut) * 2), np.round(R(g7) * 10), h15]).astype(np.float64)
        for j, c in enumerate(cb):
            if info[j] is None: continue
            la, lo = lat[c // nlon], lon[c % nlon]
            ex = station_daily(la, lo, nd)            # 3 x nd: HR media*10, lluvia*10, viento*10 (−1 = sin dato)
            arr = np.vstack([out[:, :, j], ex]).astype(np.int16)
            with gzip.open(os.path.join(OUT, 'celdas', f'{c}.bin.gz'), 'wb', compresslevel=9) as fh:
                fh.write(arr.tobytes())
            meta['cells'][int(c)] = info[j]
        print('bloque', b0, '->', b0 + cb.size, 'tierra', int(land.sum()), flush=True)
    json.dump(meta, open(os.path.join(OUT, 'meta.json'), 'w'), ensure_ascii=False)

if __name__ == '__main__':
    main(None if len(sys.argv) < 2 else [int(x) for x in sys.argv[1].split(',')])
