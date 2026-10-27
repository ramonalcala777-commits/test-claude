"""Pipeline del simulador de aptitud (v2, Copernicus ERA5-Land + SIAR).

Pasos:
  1. ingest   : ficheros netCDF de ERA5-Land (t2m horaria) -> matriz int16 (horas x celdas), en memoria mapeada
  2. stations : series SIAR + serie ERA5 de la celda más cercana -> tablas de corrección por cuantiles (mes x cuantil)
  3. correct  : corrección de cada celda por IDW de las 3 estaciones más cercanas (mínimas por cuantiles + sesgo de máximas)
  4. daily    : por celda y día: tmin, tmax, porciones de frío (Dinámico), GDH Anderson, GDH Richardson, Utah, GDD 7,2
               -> un fichero binario por celda que la web lee al consultar una parcela
"""
import numpy as np, glob, json, os, datetime as dt, math

ROOT = os.path.dirname(os.path.abspath(__file__))
T0 = dt.datetime(1995, 7, 1)          # primera hora de la serie
OUT = os.path.join(ROOT, 'grid')


def hours_between(a, b):
    return int((b - a).total_seconds() // 3600)


# ---------- 1. ingest ----------
def ingest(nc_dir, t_end=dt.datetime(2026, 10, 1)):
    import netCDF4
    files = sorted(glob.glob(os.path.join(nc_dir, '*.nc')))
    with netCDF4.Dataset(files[0]) as d:
        lat = d['latitude'][:].astype(float); lon = d['longitude'][:].astype(float)
    nh = hours_between(T0, t_end); nc = lat.size * lon.size
    os.makedirs(OUT, exist_ok=True)
    M = np.lib.format.open_memmap(os.path.join(OUT, 't2m.npy'), mode='w+', dtype=np.int16, shape=(nh, nc))
    M[:] = -32768
    for f in files:
        with netCDF4.Dataset(f) as d:
            tv = d['valid_time'] if 'valid_time' in d.variables else d['time']
            times = netCDF4.num2date(tv[:], tv.units, only_use_cftime_datetimes=False)
            t = d['t2m'][:]                      # (time, lat, lon) en K
            arr = np.ma.filled(t.astype(np.float32), np.nan) - 273.15
            idx = np.array([hours_between(T0, dt.datetime(x.year, x.month, x.day, x.hour)) for x in times])
            ok = (idx >= 0) & (idx < nh)
            v = np.round(arr.reshape(arr.shape[0], -1) * 100)
            v[~np.isfinite(v)] = -32768
            M[idx[ok]] = v[ok].astype(np.int16)
        print('ingest', os.path.basename(f), flush=True)
    M.flush()
    json.dump({'lat': lat.tolist(), 'lon': lon.tolist(), 't0': T0.isoformat(), 'nh': nh}, open(os.path.join(OUT, 'grid.json'), 'w'))


def load_grid():
    g = json.load(open(os.path.join(OUT, 'grid.json')))
    M = np.load(os.path.join(OUT, 't2m.npy'), mmap_mode='r')
    return g, M


def nearest_cell(g, la, lo):
    i = int(np.argmin(np.abs(np.array(g['lat']) - la))); j = int(np.argmin(np.abs(np.array(g['lon']) - lo)))
    return i * len(g['lon']) + j


def daily_minmax(series_c):  # series in °C hourly from T0 (UTC). día local ~ UTC+1: usamos día UTC desplazado 1 h
    n = (series_c.size - 1) // 24
    s = series_c[1:1 + n * 24].reshape(n, 24)
    return np.nanmin(s, 1), np.nanmax(s, 1)


QS = np.array([0.01, 0.05, 0.1, 0.2, 0.3, 0.5, 0.7, 0.9, 0.99])


# ---------- 2. stations ----------
def station_tables(min_years=5):
    g, M = load_grid()
    st = json.load(open(os.path.join(ROOT, 'siar', 'estaciones.json')))
    d0 = (T0 + dt.timedelta(hours=1)).date()
    tables = []
    for e in st:
        fn = os.path.join(ROOT, 'siar', e['id'] + '.csv')
        if not os.path.exists(fn):
            continue
        la, lo = e['lat'], e['lon']
        if not (min(g['lat']) - .05 <= la <= max(g['lat']) + .05 and min(g['lon']) - .05 <= lo <= max(g['lon']) + .05):
            continue
        c = nearest_cell(g, la, lo)
        ser = M[:, c].astype(np.float32); ser[ser == -32768] = np.nan; ser /= 100
        emn, emx = daily_minmax(ser)
        smn = {}; smx = {}
        for line in open(fn):
            p = line.strip().split(';')
            if len(p) != 3 or not p[1] or not p[2]:
                continue
            dd, mm, yy = p[0].split('/')
            k = (dt.date(int(yy), int(mm), int(dd)) - d0).days
            if 0 <= k < emn.size:
                mx, mn = float(p[1].replace(',', '.')), float(p[2].replace(',', '.'))
                if -25 < mn < 35 and -15 < mx < 48 and mx >= mn and not (mx == 0 and mn == 0):
                    smn[k] = mn; smx[k] = mx
        if len(smn) < 365 * min_years:
            continue
        ks = np.array(sorted(smn)); months = np.array([(d0 + dt.timedelta(days=int(k))).month for k in ks])
        st_mn = np.array([smn[k] for k in ks]); er_mn = emn[ks]
        good = np.isfinite(er_mn)
        tab = []
        for m in range(1, 13):
            sel = good & (months == m)
            a, b = np.quantile(er_mn[sel], QS), np.quantile(st_mn[sel], QS)
            tab.append([[round(float(x), 2), round(float(y - x), 2)] for x, y in zip(a, b)])
        kx = np.array([k for k in ks if k in smx]); dmax = float(np.nanmean(np.array([smx[k] for k in kx]) - emx[kx]))
        tables.append({'id': e['id'], 'mun': e['mun'], 'lat': la, 'lon': lo, 'alt': e['alt'], 'n': int(good.sum()), 'qm': tab, 'dmax': round(dmax, 2),
                       'bias_tmin': round(float(np.nanmean(st_mn - er_mn)), 2)})
        print('estación', e['id'], e['mun'], len(ks), 'sesgo Tmin', tables[-1]['bias_tmin'], flush=True)
    json.dump(tables, open(os.path.join(OUT, 'correcciones.json'), 'w'), ensure_ascii=False)


def km(a, b, c, d):
    return 6371 * math.acos(min(1, math.sin(math.radians(a)) * math.sin(math.radians(c)) + math.cos(math.radians(a)) * math.cos(math.radians(c)) * math.cos(math.radians(d - b))))


def cell_correction(tabs, la, lo, k=3):
    ds = sorted(((km(la, lo, t['lat'], t['lon']), t) for t in tabs), key=lambda x: x[0])[:k]
    w = np.array([1 / max(d, 3) ** 2 for d, _ in ds]); w /= w.sum()
    # tablas combinadas: misma rejilla de cuantiles; interpolamos el delta en función del valor ERA5
    return ds, w


def apply_correction(series_c, ds, w):
    """series_c: horaria °C desde T0. Devuelve corregida (mínimas por cuantiles, máximas por sesgo medio)."""
    n = (series_c.size - 1) // 24
    s = series_c[1:1 + n * 24].reshape(n, 24).copy()
    mn = s.min(1); mx = s.max(1)
    d0 = (T0 + dt.timedelta(hours=1)).date()
    months = np.array([(d0 + dt.timedelta(days=i)).month for i in range(n)])
    a = np.zeros(n); b = np.zeros(n)
    for (dist, t), wi in zip(ds, w):
        for m in range(1, 13):
            sel = months == m
            q = np.array(t['qm'][m - 1])
            a[sel] += wi * np.interp(mn[sel], q[:, 0], q[:, 1])
        b += wi * t['dmax']
    span = np.where(mx > mn, mx - mn, 1)
    wgt = (s - mn[:, None]) / span[:, None]
    s = s + a[:, None] + (b - a)[:, None] * wgt
    out = series_c.copy(); out[1:1 + n * 24] = s.reshape(-1)
    return out


# ---------- 4. índices diarios ----------
def dynamic_hourly_increments(T):
    e0, e1, a0, a1, slp, tetmlt = 4153.5, 12888.8, 139500, 2.567e18, 1.6, 277
    aa, ee = a0 / a1, e1 - e0
    TK = T + 273
    ftm = slp * tetmlt * (TK - tetmlt) / TK
    xi = 1 / (1 + np.exp(-ftm))
    xs = aa * np.exp(ee / TK)
    ak1 = a1 * np.exp(-e1 / TK)
    ek = np.exp(-ak1)
    inc = np.zeros_like(T); inter = 0.0
    for i in range(T.size):
        E = xs[i] - (xs[i] - inter) * ek[i]
        if E < 1:
            inter = E
        else:
            d = xi[i] * E; inc[i] = d; inter = E - d
    return inc


def gdh_anderson(T):
    Tb, Tu, Tc = 4.0, 25.0, 36.0
    o = np.zeros_like(T)
    m1 = (T > Tb) & (T <= Tu); o[m1] = (Tu - Tb) / 2 * (1 + np.cos(np.pi + np.pi * (T[m1] - Tb) / (Tu - Tb)))
    m2 = (T > Tu) & (T <= Tc); o[m2] = (Tu - Tb) * (1 + np.cos(np.pi / 2 + np.pi / 2 * (T[m2] - Tu) / (Tc - Tu)))
    return o


def utah(T):
    return np.select([T <= 1.4, T <= 2.4, T <= 9.1, T <= 12.4, T <= 15.9, T <= 18], [0, .5, 1, .5, 0, -.5], -1)


def daily_indices(series_c):
    """Devuelve dict de arrays diarios (día local = UTC+1) desde T0+1h."""
    n = (series_c.size - 1) // 24
    s = series_c[1:1 + n * 24]
    # Dinámico: se reinicia cada 1 de septiembre (índice de hora del 1-sep local)
    inc = np.zeros_like(s)
    d0 = (T0 + dt.timedelta(hours=1))
    starts = [hours_between(d0, dt.datetime(y, 9, 1)) for y in range(1995, 2027)]
    starts = [h for h in starts if 0 <= h < s.size] + [s.size]
    if starts[0] > 0:
        starts = [0] + starts
    for a, b in zip(starts[:-1], starts[1:]):
        inc[a:b] = dynamic_hourly_increments(s[a:b].astype(np.float64))
    R = lambda x: x.reshape(n, 24)
    return {
        'tmin': R(s).min(1), 'tmax': R(s).max(1),
        'cp': R(inc).sum(1),
        'gdha': R(gdh_anderson(s)).sum(1),
        'gdhr': R(np.clip(np.minimum(s, 25) - 4.5, 0, None)).sum(1),
        'utah': R(utah(s)).sum(1),
        'gdd7': R(np.clip(s - 7.2, 0, None)).sum(1) / 24,
    }


def pack_cell(ix):
    """int16: tmin*10, tmax*10, cp*100, gdha, gdhr, utah*2, gdd7*10  (7 x ndías)"""
    sc = [10, 10, 100, 1, 1, 2, 10]
    keys = ['tmin', 'tmax', 'cp', 'gdha', 'gdhr', 'utah', 'gdd7']
    return np.stack([np.round(ix[k] * f) for k, f in zip(keys, sc)]).astype(np.int16)
