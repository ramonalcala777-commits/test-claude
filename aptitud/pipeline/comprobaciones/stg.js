const fs=require('fs'),zlib=require('zlib');globalThis.window=globalThis;
require('/home/claude/simulador/web/config.js');require('/home/claude/simulador/web/motor.js');
const M=JSON.parse(fs.readFileSync('/home/claude/simulador/grid/meta.json'));const d0=Date.parse(M.d0);
const sets={actual:CONFIG.pist.stages,propuesta:[[-24,-17,-5,-8],[-16,-6,-3,-5],[-5,5,-2,-4],[6,30,-1.5,-3.5]]};
for(const [n,c,rel] of [['La Vega',1209,-0.5],['Villarrobledo',1111,0.2],['Albacete',1068,0],['Ciudad Real',1144,0]]){const b=zlib.gunzipSync(fs.readFileSync(`/home/claude/simulador/grid/celdas/${c}.bin.gz`));const x=Motor.cellArrays(b.buffer.slice(b.byteOffset,b.byteOffset+b.length),M.nd);
 for(let i=0;i<x.nd;i++){const t=x.tmin[i]/10;const f=t<=5?1:t>=12?0:(12-t)/7;x.tmin[i]=Math.round((t+rel*f)*10)}
 for(const [k,st] of Object.entries(sets)){const P=Motor.pistachio(x,d0,Object.assign({},CONFIG.pist,{stages:st})).res;
  console.log(n.padEnd(13),k.padEnd(9),['Larnaka','Sirora','Kerman'].map(v=>{const R=P[v].rows.filter(Boolean);const m=R.reduce((s,q)=>s+q.loss,0)/R.length;const r26=R.find(q=>q.y===2026);return `${v}: media ${m.toFixed(0)}% · daño ${R.filter(q=>q.loss>=10).length} · grave ${R.filter(q=>q.loss>50).length} · 2026 ${r26.loss}%`}).join(' | '))}}
