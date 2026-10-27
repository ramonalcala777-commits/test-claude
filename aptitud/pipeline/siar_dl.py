import requests,re,json,sys,time,os
from html.parser import HTMLParser
B='https://servicio.mapa.gob.es/siarweb/'
s=requests.Session()
h=s.get(B+'consultaDatos/inicio',timeout=60).text
csrf=re.search(r'name="_csrf" value="([^"]+)"',h).group(1)
def stations(provs):
    out=[]
    for p in provs:
        for e in s.get(B+'consultaDatos/cargarEstaciones',params={'idProvincia':p},timeout=60).json():
            if e['idProvincia']==p: out.append(dict(id=f"{p}-{e['idEstacion']}",mun=e['municipio'],lat=e['coordenadas']['lat'],lon=e['coordenadas']['lng'],alt=e['altitud'],baja=e.get('fechaBaja'),inst=e.get('fechaInstalacion')))
    return out
class T(HTMLParser):
    def __init__(s):super().__init__();s.tables=[];s.row=None;s.cell=None
    def handle_starttag(s,t,a):
        if t=='table':s.tables.append([])
        elif t=='tr' and s.tables:s.row=[]
        elif t in('td','th') and s.row is not None:s.cell=''
    def handle_endtag(s,t):
        if t in('td','th') and s.cell is not None:s.row.append(s.cell.strip());s.cell=None
        elif t=='tr' and s.row is not None:s.tables[-1].append(s.row);s.row=None
    def handle_data(s,d):
        if s.cell is not None:s.cell+=d
def query(est,a,b):
    f={'_csrf':csrf,'variablesSeleccionadas':'10,12','idEstaciones':est,'accionHidden':'consultaDatos','fechaInicial':a,'fechaFinal':b,'tipoCalculo':'2','tipoFiltroEstaciones':'provincias','consultaPersonalizada':'false','peticion.id':'','peticion.idTipoPeticion':'','tipoFiltro':'provincias','idCCAA':'','idProvs':'','idComRegantes':'','estacion.sEstacionCorto':'','checkbox':'on','tipoDatosPeticion':'2'}
    v=s.post(B+'consultaDatosRest/validarResultadoDatos',data=f,headers={'X-XSRF-TOKEN':csrf},timeout=120).json()
    if not v.get('validated'):return None,v
    p=T();p.feed(s.post(B+'consultaDatos/consultaDatos',data=f,timeout=300).text)
    rows=[r for t in p.tables[2:3] for r in t if len(r)==3 and '/' in r[0]]
    return rows,None
if __name__=='__main__':
    provs=[int(x) for x in sys.argv[1].split(',')]
    st=stations(provs); json.dump(st,open('siar/estaciones_'+sys.argv[2]+'.json','w'),ensure_ascii=False)
    chunks=[('2000-01-01','2004-12-31'),('2005-01-01','2009-12-31'),('2010-01-01','2014-12-31'),('2015-01-01','2019-12-31'),('2020-01-01','2024-12-31'),('2025-01-01','2026-10-20')]
    for e in st:
        fn=f"siar/{e['id']}.csv"
        if os.path.exists(fn):continue
        rows=[]
        for a,b in chunks:
            r,err=query(e['id'],a,b)
            if r is None: print(e['id'],a,'ERR',err);continue
            rows+=r
        open(fn,'w').write('\n'.join(';'.join(r) for r in rows))
        print(e['id'],e['mun'],len(rows),flush=True)
