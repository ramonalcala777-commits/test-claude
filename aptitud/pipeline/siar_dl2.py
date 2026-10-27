import json,os,sys,time
import siar_dl as d
# 14 HumMedia,15 HumMax,17 HumMin,19 VelViento,21 VelVientoMax,24 Precipitacion
VARS='14,15,17,19,21,24'
def query(est,a,b):
    f={'_csrf':d.csrf,'variablesSeleccionadas':VARS,'idEstaciones':est,'accionHidden':'consultaDatos','fechaInicial':a,'fechaFinal':b,'tipoCalculo':'2','tipoFiltroEstaciones':'provincias','consultaPersonalizada':'false','peticion.id':'','peticion.idTipoPeticion':'','tipoFiltro':'provincias','idCCAA':'','idProvs':'','idComRegantes':'','estacion.sEstacionCorto':'','checkbox':'on','tipoDatosPeticion':'2'}
    v=d.s.post(d.B+'consultaDatosRest/validarResultadoDatos',data=f,headers={'X-XSRF-TOKEN':d.csrf},timeout=120).json()
    if not v.get('validated'):return None,v
    p=d.T();p.feed(d.s.post(d.B+'consultaDatos/consultaDatos',data=f,timeout=300).text)
    rows=[r for t in p.tables if t and len(t)>1 for r in t if len(r)>=7 and '/' in r[0]]
    head=[t[0] for t in p.tables if t and t[0] and t[0][0].startswith('Fecha')]
    return rows,head
st=json.load(open('siar/estaciones.json'))
chunks=[('2000-01-01','2004-12-31'),('2005-01-01','2009-12-31'),('2010-01-01','2014-12-31'),('2015-01-01','2019-12-31'),('2020-01-01','2024-12-31'),('2025-01-01','2026-10-20')]
for e in st:
    fn=f"siar2/{e['id']}.csv"
    if os.path.exists(fn):continue
    rows=[];head=None
    for a,b in chunks:
        for k in range(3):
            try:
                r,h=query(e['id'],a,b);break
            except Exception as ex:
                time.sleep(10);r,h=None,str(ex)
        if r is None:print(e['id'],a,'ERR',h,flush=True);continue
        rows+=r;head=head or h
    open(fn,'w').write((';'.join(head[0]) if head else '')+'\n'+'\n'.join(';'.join(x) for x in rows))
    print(e['id'],e['mun'],len(rows),flush=True)
