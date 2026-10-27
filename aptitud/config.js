// Parámetros por defecto (editables desde la web). Fuentes en el apartado «Cómo se calcula».
window.CONFIG = {
  pist: {
    ref: { name: 'Kerman', cp: 90, gdh: 6800 },
    chillCapDoy: 75,
    stageNames: ['yema hinchada', 'brácteas separándose o racimo saliendo', 'floración', 'fruto recién cuajado'],   // si el 16 de marzo no se han cubierto las porciones de frío, el calor empieza a contar igualmente (Caravaca 2023)          // calibrado con Caravaca 2018-2023 y Castilla y León 2018-2020
    stages: [[-24, -17, -5, -8], [-16, -6, -3, -5], [-5, 5, -2, -4], [6, 30, -1.5, -3.5]], // yema hinchada B, brácteas separándose y racimo C-D (Couceiro y Guerrero, tabla 10.9, medias 1999-2004), flor, fruto cuajado: [desde, hasta (días respecto a plena flor), T 10 %, T 90 %]
    autumnFrost: -2,
    varieties: [
      { name: 'Kerman', sex: 'H', cp: 90, offset: 0, gdd: 2120, days: 147, males: ['Peter', 'Ruso (02-18)'] },
      { name: 'Sirora', sex: 'H', cp: 59, offset: -4.7, gdd: 2030, days: 142, males: ['Randy', 'C-Especial', 'Peter', 'Ruso (02-18)'] },
      { name: 'Golden Hills', sex: 'H', cp: 45, offset: -8, gdd: 2100, days: 150, males: ['Randy'] },
      { name: 'Lost Hills', sex: 'H', cp: 45, offset: -6, gdd: 2070, days: 147, males: ['Randy'] },
      { name: 'Larnaka', sex: 'H', cp: 48, offset: -10.5, gdd: 1990, days: 144, males: ['C-Especial'] },
      { name: 'Peter', sex: 'M', cp: 69, offset: -1.2 },
      { name: 'Ruso (02-18)', sex: 'M', cp: 69, offset: -2.2 },   // 02-18 de El Chaparrillo: ~1 día antes que Peter (Couceiro y Guerrero, tabla 10.10, medias 1999-2004)
      { name: 'Randy', sex: 'M', cp: 45, offset: -8 },
      { name: 'C-Especial', sex: 'M', cp: 48, offset: -8 }
    ]
  },
  alm: {
    ref: { name: 'Guara', cu: 850, gdh: 5500 },
    stageNames: ['yema (B–C)', 'botón floral (D–E)', 'flor abierta (F)', 'caída de pétalos (G)', 'fruto recién cuajado (H)'],   // calibrado con Caravaca 2018-2020 y 2023; validado con Lauranne en Albacete 2022-2023
    stages: [[-25, -12, -5, -8], [-11, -3, -3.5, -5.5], [-2, 4, -2.5, -4], [5, 10, -2, -3], [11, 40, -1, -2]],
    // frost: [ΔT10, ΔT90] respecto al Guara en flor (IRTA, Calle et al. 2025, cámara); se aplica a los estados de flor (D a G)
    varieties: [
      { name: 'Belona', offset: 0, frost: [0.42, -0.02] }, { name: 'Soleta', offset: 0, frost: [-0.09, -0.16] }, { name: 'Guara', offset: 0, frost: [0, 0] },
      { name: 'Vairo', offset: 2.6, frost: [-0.25, -1.16] }, { name: 'Constantí', offset: 2.6, frost: [-0.01, -0.05] },
      { name: 'Lauranne (Avijor)', offset: 4.3, frost: [-0.28, -0.16] }, { name: 'Marinada', offset: 6.5, frost: [0.02, -0.44] },
      { name: 'Makako', offset: 13, frost: [0, 0] }, { name: 'Penta', offset: 15.6, frost: [0.19, -0.55] },
      { name: 'Mardía', offset: 24, frost: [-0.2, 0.02] }, { name: 'Tardona', offset: 25.3, frost: [0.04, -0.04] }
    ]
  },
  // Umbrales de los criterios: [condiciona, excluye]
  crit: {
    pist: { loss: [10, 25], bad: [3, 6], chill: [0.1, 0.3], veryLate: [0.1, 0.3], veryLateDoy: 305, autumn: [0.15], overlap: [0.7, 0.4],
      rainBloomDays: 3, rainBloom: [0.4, 9], windLow: 1.0, windHigh: 6.0, hr: [58, 65], preRainMm: 50, preRain: [0.3, 0.7],
      boty: [12, 25], hot: [3], w12: 0.25, w20: 0.05, bloomHotT: 30, bloomHotDays: 2, bloomHot: [0.15, 0.4] },
    alm: { loss: [10, 25], bad: [3, 6], bee: [25, 10], beeWind: 4.5, moniliaDays: 4, monilia: [0.4, 9], spring: [18, 30],
      harvRainMm: 50, harvRain: [0.4, 9], w15alm: 0.1 }
  },
  verdict: { okLoss: 10, okBad: 3, warnLoss: 25, warnBad: 6, lateHarvestDoy: 288, lateYears: 3, minOverlap: 0.7 }
};
