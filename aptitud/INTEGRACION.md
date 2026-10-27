# Integrar el simulador de aptitud climática en Mapa de Fincas

## Qué es

Un simulador que, para cualquier recinto SIGPAC de Castilla-La Mancha (y bordes), dice si es **apto, apto con condiciones o no apto** para **pistacho** (Kerman, Sirora, Golden Hills, Lost Hills, Larnaka; machos Peter, Ruso (02-18), Randy, C-Especial) y **almendro autofértil** (Belona, Soleta, Guara, Vairo, Constantí, Lauranne, Marinada, Makako, Penta, Mardía, Tardona), con los motivos.

- Solo clima: 13 criterios en pistacho y 6 en almendro.
- Usa 31 campañas (1996–2026) y el relieve del propio recinto.
- Ya funciona como web independiente: https://ramonalcala777-commits.github.io/test-claude/aptitud/ (para abrir un recinto concreto se añade `?r=02:012:0:0:10:467:38`).

## Dónde está todo

- **Código de la web:** repositorio `ramonalcala777-commits/test-claude`, rama `claude/hola-jt7yk4` (la que sirve GitHub Pages), carpeta `aptitud/`:
  - `config.js`: variedades, requerimientos, umbrales de helada por estado y umbrales de cada criterio.
  - `motor.js`: modelo de floración, heladas y cosecha. Es puro, sin DOM.
  - `criterios.js`: los criterios y el veredicto. También puro.
  - `relieve.js`: coeficientes de la corrección por relieve.
  - `calib.js`: textos de calibración y de «Cómo se calcula».
  - `app.js` + `index.html`: interfaz (mapa, búsqueda SIGPAC, cálculo del relieve con el MDT, tablas y gráficos).
- **Datos:** `aptitud/grid/meta.json` y `aptitud/grid/celdas/{n}.bin.gz`, con 1.645 celdas de 0,1° (unos 185 MB en total; cada recinto descarga solo su celda, unos 110 kB).
  - Formato de cada celda: Int16, 11 filas × `nd` días desde `meta.d0` (1995-07-01). Las filas son: tmin×10, tmax×10, porciones de frío×100, GDH Anderson, GDH Richardson, Utah×2, GDD7,2×10, horas ≥ 15 °C, HR×10, lluvia×10 y viento×10; −1 significa sin dato.
  - Cómo se elige la celda: índice de la latitud más cercana en `meta.lat` × nº de longitudes + índice de la longitud más cercana en `meta.lon`.

## Lo importante para integrarlo

1. **Mismo dominio.** Mapa de Fincas está en `ramonalcala777-commits.github.io/mapa-fincas/` y el simulador en `ramonalcala777-commits.github.io/test-claude/aptitud/`. Al ser el mismo origen, la app puede leer los datos y los .js del simulador directamente (`/test-claude/aptitud/...`), sin problemas de CORS y sin copiar 185 MB al repo de la app.
2. **No duplicar el modelo: usar `aptitud-core.js`.** Todo el cálculo está en un solo fichero, `/test-claude/aptitud/aptitud-core.js`, que ya usa la propia web del simulador. Al cargarlo, trae solo `config.js`, `motor.js`, `criterios.js` y `relieve.js` desde su carpeta. Uso:
   ```js
   // <script src="/test-claude/aptitud/aptitud-core.js"></script>
   const R = await AptitudCore.evaluar(featureGeoJSONdelRecinto, { onStatus: t => mostrarEstado(t) });
   // R.pistacho / R.almendro: una entrada por variedad (machos de pistacho con male: true)
   //   .nm, .cls ('ok' | 'warn' | 'bad'), .clsR (los mismos criterios con los últimos 10 años)
   //   .crit / .critR: criterios {nombre, valor, nivel 0 / 1 / 2, motivo}; .vd = {ex: excluyen, co: condicionan}
   //   .heladas = {todo: {n, dano, grave}, ultimos10: {...}}; .mb = día del año de la plena flor media
   //   .rows: año a año {y, fb, loss, fz: peor helada {doy, t, st, d}, harv (pistacho)}; .ov: coincidencia con cada macho
   // R.relieve: {clase, delta, deltaLow, par, low}; R.campañas: {desde, hasta, ultimos10: [desde, hasta]}
   // R.etiquetas: {ok: 'Apta', warn: 'Apta con condiciones', bad: 'No apta'}; R.estados: nombres de los estados fenológicos
   ```
   Probado desde otra página del mismo dominio: un recinto completo, relieve incluido, tarda unos 2,4 s. Así, cuando se recalibre el simulador, la app se actualiza sola. Mapa de Fincas solo tiene que hacer la parte visual. Para copiar el aspecto, la referencia es `app.js` (funciones `render` y `detail`) y los estilos de `index.html`.
3. **CSP de la app** (entrega 60). Hay que permitir:
   - `connect-src`: `https://servicios.idee.es` (MDT de 25 m y 200 m por WCS, para el relieve) y `https://sigpac-hubcloud.es`. Esto último solo si se usa la geometría por código; la app ya tiene la del recinto.
   - `script-src`: `https://cdn.jsdelivr.net` (geotiff.js 2.1.3), o servir geotiff desde el propio repo.
4. **Entrada natural en la app:** desde la ficha de un recinto (o de una finca) se pulsa un botón «Aptitud climática». La app ya tiene la geometría del recinto, así que se calcula con ella: celda, relieve (MDT) y modelo.
5. **Qué enseñar** (lo que Ramón ha ido aprobando en la web del simulador):
   - Veredicto por variedad y motivos.
   - Lista de criterios con «sin limitación / condiciona / excluye».
   - Comparación con los últimos 10 años.
   - Recuadro de heladas: años con daño (≥ 10 %) y daño grave (> 50 %), en «x de cada 10 años».
   - Gráfico año a año:
     - pérdida coloreada por gravedad;
     - calendario con la plena flor y la helada dañina;
     - cosecha prevista en pistacho;
     - ficha al tocar un año.
   - Comparación de variedades con barras rojo / ámbar / gris y «x de cada 10 con daño · y de cada 10 graves».
   - En pistacho, coincidencia con los machos.
6. **Rendimiento:** el cálculo de un recinto tarda menos de 1 s en el móvil. Lo que más tarda es la descarga del MDT para el relieve (2 peticiones WCS). Conviene guardar en la ficha del recinto el resultado y la fecha de cálculo.

## Decisiones del modelo que no hay que cambiar sin hablarlo

- **Floración:**
  - Pistacho: Kerman con 90 porciones de frío y 6.800 GDH. Si el 16 de marzo no ha completado el frío, empieza igualmente a acumular calor.
  - Almendro: Guara con 850 unidades Utah y 5.500 GDH.
  - Las demás variedades se colocan por su desfase respecto a la de referencia. Calibrado con Caravaca 2018–2023 y comprobado con El Chaparrillo (2001, 2004 y 2011), Castilla y León y Albacete.
- **Heladas en pistacho, por días respecto a la plena flor** (temperatura del 10 % y del 90 % de daño):

  | Estado | Días respecto a la plena flor | 10 % / 90 % de daño |
  |---|---|---|
  | Yema hinchada | de −24 a −17 | −5 / −8 °C |
  | Brácteas o racimo | de −16 a −6 | −3 / −5 °C |
  | Flor | de −5 a +5 | −2 / −4 °C |
  | Fruto cuajado | de +6 a +30 | −1,5 / −3,5 °C |

- **Heladas en almendro:** igual, con la ventana del fruto hasta 40 días después de la flor y diferencias por variedad tomadas del IRTA (Calle et al. 2025).
- **Corrección por relieve:** en noches frías, ±1,8 °C según la posición del recinto (fondo de vega o alto despejado).
- **Veredicto:** se calcula con toda la serie. Los últimos 10 años se muestran aparte.

## Cómo se actualizan los datos

Los programas que bajan Copernicus y el SIAR y generan las celdas están en `aptitud/pipeline/`, con un README que explica los pasos para añadir cada campaña nueva. Al actualizar los datos, se cambia `DATA_V` en `aptitud-core.js` y los navegadores dejan de usar la caché.
