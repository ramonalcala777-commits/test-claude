const fs=require('fs'),zlib=require('zlib');globalThis.window=globalThis;
require('/home/claude/simulador/web/config.js');require('/home/claude/simulador/web/motor.js');
const CFG=globalThis.CONFIG;const M=JSON.parse(fs.readFileSync('/home/claude/simulador/grid/meta.json'));const d0=Date.parse(M.d0);
function near(la,lo){const i=M.lat.reduce((b,v,k)=>Math.abs(v-la)<Math.abs(M.lat[b]-la)?k:b,0);const j=M.lon.reduce((b,v,k)=>Math.abs(v-lo)<Math.abs(M.lon[b]-lo)?k:b,0);return i*M.lon.length+j}
function load(c){const b=zlib.gunzipSync(fs.readFileSync(`/home/claude/simulador/grid/celdas/${c}.bin.gz`));return Motor.cellArrays(b.buffer.slice(b.byteOffset,b.byteOffset+b.length),M.nd)}
const sites={Albacete:[38.95,-1.86],Barrax:[39.05,-2.20],Balazote:[38.89,-2.14],Villarrobledo:[39.27,-2.60],Montiel:[38.69,-2.70],Yebenes:[39.58,-3.87],Manchuela:[39.30,-1.55]};
const alt=JSON.parse(process.argv[2]||'null');
const A=JSON.parse(JSON.stringify(CFG.alm)); if(alt) A.stages=alt;
const vs=(process.argv[3]||'Guara,Lauranne (Avijor),Penta').split(',');
const yrs=[2003,2004,2017,2019,2021,2022];
for(const [n,[la,lo]] of Object.entries(sites)){const c=load(near(la,lo));const r=Motor.almond(c,d0,A).res;
 for(const v of vs){const rows=r[v].rows.filter(Boolean);const m=Object.fromEntries(rows.map(x=>[x.y,x]));
  const mean=rows.reduce((s,x)=>s+x.loss,0)/rows.length; const ev=yrs.map(y=>m[y]?m[y].loss:'-');
  const others=rows.filter(x=>!yrs.includes(x.y)).map(x=>x.loss); const om=others.reduce((a,b)=>a+b,0)/others.length;
  console.log(n.padEnd(13),v.padEnd(18),'media',mean.toFixed(0).padStart(3),'| eventos',yrs.map((y,i)=>y+':'+ev[i]).join(' '),'| resto media',om.toFixed(0), '| años>50%',others.filter(x=>x>50).length+'/'+others.length);}}
