#!/bin/bash
# uso: bajar.sh < lista (líneas "clave ruta")
cd /home/claude/simulador/nc
while read k p; do
  [ -z "$p" ] && continue
  [ -s "$k.nc" ] && continue
  curl -sS -m 900 -o "$k.nc.part" "https://object-store.os-api.cci2.ecmwf.int$p" && mv "$k.nc.part" "$k.nc" && echo "bajado $k $(stat -c%s $k.nc)"
done
ls *.nc 2>/dev/null | wc -l
