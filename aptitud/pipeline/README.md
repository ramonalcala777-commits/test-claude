# Cómo se generan los datos del simulador de aptitud

Estos programas producen `aptitud/grid/meta.json` y `aptitud/grid/celdas/*.bin.gz`. No se ejecutan desde la web: se usan una vez al año para añadir la campaña nueva.

## Fuentes
- **Temperatura horaria**: ERA5-Land (Copernicus Climate Data Store, licencia CC-BY 4.0), recuadro 41,4 N · 5,5 O · 38,0 N · 0,9 O, celdas de 0,1° (35 × 47 = 1.645). Un fichero NetCDF por semestre en `nc/AAAA-MM.nc` (desde 1995-07).
- **Geopotencial** (`geo.nc`, variable `z`) para la altitud de cada celda: `elev = z / 9,80665`.
- **Estaciones SIAR** (Ministerio de Agricultura): Tmin/Tmax diarias (`siar_dl.py`, carpeta `siar/`) y humedad, viento y lluvia (`siar_dl2.py`, carpeta `siar2/`). Lista de estaciones en `datos/estaciones*.json`. Las descargas usan el formulario público del SIAR (máximo unos 5 años por petición).

## Pasos para añadir datos nuevos
1. **Copernicus**: en una pestaña de cds.climate.copernicus.eu con sesión iniciada, pegar `cds_peticiones.js` en la consola (editando los semestres). Cuando terminen, `__rutas()` da las rutas; guardarlas en un fichero «clave ruta» y ejecutar `bash bajar.sh < rutas.txt` (descarga a `nc/`).
2. **SIAR**: ejecutar `siar_dl.py` y `siar_dl2.py` para el periodo nuevo.
3. **Ingesta y correcciones**:
   `python3 -c "import pipeline, datetime as d; pipeline.ingest('nc', d.datetime(AAAA, MM, 1)); pipeline.station_tables(5)"`
   - `ingest` crea `grid/t2m.npy` (temperatura horaria en centésimas de °C) hasta la fecha indicada.
   - `station_tables` calcula `grid/correcciones.json`: mapeo de cuantiles de Tmin por mes (9 cuantiles) y sesgo medio de Tmax para cada estación SIAR.
4. **Celdas**: `python3 proceso.py` corrige las mínimas de cada celda (3 estaciones más cercanas, peso 1/max(d,3 km)²), calcula porciones de frío (Modelo Dinámico, reinicio el 1 de septiembre), GDH Anderson y Richardson, Utah, GDD 7,2, horas ≥ 15 °C e interpola HR, lluvia y viento SIAR; escribe `grid/celdas/{n}.bin.gz` y `grid/meta.json`.
5. Añadir `elev` (de `geo.nc`) a `meta.json`, cambiar el parámetro `?d=` de las URL de datos en `app.js` para que los navegadores no usen la caché, y subir `grid/` al repositorio.

## Formato de cada celda
Int16, 11 filas × `nd` días desde `meta.d0`: tmin×10, tmax×10, porciones de frío×100, GDH Anderson, GDH Richardson, Utah×2, GDD7,2×10, horas ≥ 15 °C, HR×10, lluvia×10, viento×10 (−1 = sin dato).

## Otros ficheros
- `datos/regresion_relieve.json`, `relieve_estaciones.json`, `relieve50.json`: datos de la regresión del relieve (posición de cada estación SIAR en el MDT del IGN frente a su sesgo de mínimas); los coeficientes resultantes están en `aptitud/relieve.js`.
- `datos/sitios.json`: celdas de los sitios de calibración (Caravaca, Castilla y León, Villarrobledo, La Vega, Albacete).
- `obs/`: observaciones de floración, cosecha y heladas recopiladas para calibrar (`obs_cal.json` son los objetivos usados).
- `comprobaciones/`: scripts de comprobación usados al calibrar (Node, cargan `config.js` y `motor.js`): Ciudad Real 2001/2004/2011 (`cr2.js`), datos de 2026 (`c26.js`), heladas del almendro documentadas (`alm.js`), tope de frío en Caravaca (`cap.js`), ventanas de helada del pistacho (`stg.js`), validación cruzada de la corrección por estaciones (`qmtest.py`). Las rutas dentro de los scripts apuntan a la carpeta de trabajo original y hay que ajustarlas.
- Las descargas en bruto del SIAR (unos 100 MB) y los NetCDF de Copernicus (unos 850 MB) no se guardan aquí: se vuelven a bajar con los pasos anteriores.
