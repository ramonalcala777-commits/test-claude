// Parámetros por defecto (editables desde la web). Fuentes en el apartado «Cómo se calcula».
window.CONFIG = {
  pist: {
    ref: { name: 'Kerman', cp: 80, gdh: 8800 },          // calibrado con Caravaca 2018 y Valladolid 2018-2020
    stages: [[-20, -6, -3, -5], [-5, 5, -2, -4], [6, 30, -1.5, -3.5]], // [desde, hasta (días respecto a plena flor), T 10 %, T 90 %]
    autumnFrost: -2,
    varieties: [
      { name: 'Kerman', sex: 'H', cp: 80, offset: 0, gdd: 2100, males: ['Peter'] },
      { name: 'Sirora', sex: 'H', cp: 59, offset: -7, gdd: 1970, males: ['Randy', 'C-Especial', 'Peter'] },
      { name: 'Golden Hills', sex: 'H', cp: 45, offset: -8, gdd: 2080, males: ['Randy'] },
      { name: 'Lost Hills', sex: 'H', cp: 45, offset: -6, gdd: 1990, males: ['Randy'] },
      { name: 'Larnaka', sex: 'H', cp: 48, offset: -9, gdd: 2000, males: ['C-Especial'] },
      { name: 'Peter', sex: 'M', cp: 69, offset: -1 },
      { name: 'Randy', sex: 'M', cp: 45, offset: -8 },
      { name: 'C-Especial', sex: 'M', cp: 48, offset: -10 }
    ]
  },
  alm: {
    ref: { name: 'Guara', cu: 340, gdh: 8159 },
    stages: [[-25, -12, -5, -8], [-11, -3, -3.5, -5.5], [-2, 4, -2.5, -4], [5, 10, -2, -3], [11, 30, -1, -2]],
    varieties: [
      { name: 'Belona', offset: -2 }, { name: 'Soleta', offset: -2 }, { name: 'Guara', offset: 0 }, { name: 'Vairo', offset: 0 },
      { name: 'Constantí', offset: 1 }, { name: 'Lauranne (Avijor)', offset: 5 }, { name: 'Marinada', offset: 8 },
      { name: 'Makako', offset: 14 }, { name: 'Penta', offset: 16 }, { name: 'Mardía', offset: 21 }, { name: 'Tardona', offset: 26 }
    ]
  },
  // Umbrales de los criterios: [condiciona, excluye]
  crit: {
    pist: { loss: [10, 25], bad: [3, 6], chill: [0.1, 0.3], late: [0.2], veryLate: 0.2, veryLateDoy: 305, autumn: [0.15], overlap: [0.7, 0.4],
      rainBloomDays: 3, rainBloom: [0.4, 9], windLow: 1.0, windHigh: 6.0, hr: [50, 60], preRainMm: 50, preRain: [0.3, 0.7],
      boty: [12, 25], hot: [3], w12: 0.25, w20: 0.05 },
    alm: { loss: [10, 25], bad: [3, 6], bee: [25, 10], beeWind: 4.5, moniliaDays: 4, monilia: [0.4, 9], spring: [18, 30],
      harvRainMm: 50, harvRain: [0.4, 9], w15alm: 0.1 }
  },
  verdict: { okLoss: 10, okBad: 3, warnLoss: 25, warnBad: 6, lateHarvestDoy: 288, lateYears: 3, minOverlap: 0.7 }
};
