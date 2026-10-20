# Genera las 10 texturas de "3D La vega" con Codex (imagegen).
# Uso (PowerShell en tu PC):  powershell -ExecutionPolicy Bypass -File .\generar-texturas.ps1

$dest = "C:\Users\Ramón Alcalá\Desktop\3D La vega\texturas"
New-Item -ItemType Directory -Force -Path $dest | Out-Null

$light   = "Soft diffuse overcast daylight, no hard shadows, no specular highlights or glare, even exposure, neutral white balance, photorealistic, high detail, sharp focus across the whole frame."
$tile    = "The image MUST be a seamless tileable texture: it must repeat without any visible seams on all four edges (left-right and top-bottom), with no vignetting, no perspective, uniform lighting and evenly distributed detail with no single dominant feature."
$isolate = "Isolated on a pure flat white background (#FFFFFF), no ground, no cast shadow, no reflection, clean edges, the subject fully inside the frame with a small margin."

$imgs = [ordered]@{
  "suelo-seco.png"   = "Perfectly top-down (orthographic, camera pointing straight down) photograph of dry clay-loam soil in a Spanish pistachio orchard in La Mancha. Ochre-tan colour, fine irregular shrinkage cracks only in some patches (not everywhere), small soil clods and tiny scattered pebbles, natural granular surface. No plants, no weeds, no debris, no footprints. $light $tile"
  "camino.png"       = "Perfectly top-down (orthographic) photograph of a compacted dirt farm track surface. Light tan compacted earth with fine gravel and small grit, very subtle faint tire marks barely visible. No plants, no weeds, no stones larger than a few millimetres. $light $tile"
  "suelo-humedo.png" = "Perfectly top-down (orthographic) photograph of clay-loam orchard soil from La Mancha freshly wetted by drip irrigation. Uniformly darker moist brown, smooth slightly compacted surface, fine granular texture, no cracks, no puddles, no standing water reflections. No plants. $light $tile"
  "corteza.png"      = "Perfectly frontal, flat close-up photograph of young pistachio tree (Pistacia vera) bark filling the whole frame. Smooth light grey-white bark with fine horizontal lenticels and slight brownish patches, subtle natural variation. No branches, no trunk edges visible, no curvature. $light $tile"
  "hoja.png"         = "Perfectly top-down photograph of a single pistachio compound leaf (Pistacia vera) with 3 to 5 broad oval leathery leaflets on a short rachis, dark glossy green upper side, realistic veins, centred in the frame. Shadowless even lighting, no glare. $isolate"
  "hoja-joven.png"   = "Perfectly top-down photograph of a single young spring pistachio compound leaf (Pistacia vera) with 3 to 5 broad oval leaflets, bronze-reddish colour of new growth, soft slightly tender texture, realistic veins, centred in the frame. Shadowless even lighting, no glare. $isolate"
  "chopo.png"        = "Frontal side-view photograph of a single tall narrow Lombardy poplar tree (Populus nigra 'Italica'), full tree visible from base of trunk to tip, columnar shape, dense green summer foliage, centred in the frame. Soft diffuse overcast light. $isolate"
  "carrizo.png"      = "Side-view photograph of a clump of common reed (Phragmites australis): many upright stems with long narrow green-grey leaves and feathery brownish-purple seed plumes at the tops, full clump visible, centred. Soft diffuse overcast light. $isolate"
  "amapola.png"      = "Side-view photograph of a single red corn poppy (Papaver rhoeas) flower with its thin hairy green stem and one closed nodding bud on a second stem, vivid red petals with a dark centre, centred in the frame. Soft diffuse light. $isolate"
  "teja.png"         = "Perfectly frontal (orthographic, viewed straight on from above the roof plane) photograph of an old Spanish clay roof made of curved Arabic tiles (teja árabe) in regular overlapping rows and columns. Weathered orange-brown terracotta with subtle lichen spots and colour variation. $light $tile"
}

$i = 0
foreach ($name in $imgs.Keys) {
  $i++
  Write-Host "[$i/10] $name ..."
  $prompt = "Use your image generation tool (imagegen) to create ONE square image of exactly 1024x1024 pixels and save it as PNG in the current working directory with the exact filename '$name' (overwrite if it exists). Do not create any other files. Image prompt: $($imgs[$name])"
  codex exec --skip-git-repo-check --sandbox workspace-write -C "$dest" "$prompt"
  if (Test-Path (Join-Path $dest $name)) { Write-Host "   OK" } else { Write-Host "   FALTA $name" -ForegroundColor Red }
}

Write-Host "`nTerminado. Carpeta: $dest"
Invoke-Item $dest
