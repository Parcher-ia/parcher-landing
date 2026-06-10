#!/usr/bin/env bash
# Fetch del catálogo canónico desde catalog.parcher.co al repo del landing.
#
# El landing es un sitio estático puro (sin Next/Vite/etc.), entonces el
# "build-time bake" se hace así: bajamos catalog.json (+ catalog.css cuando
# esté disponible) a assets/catalog/ y lo versionamos. El sitio servido vía
# CloudFront referencia esos archivos locales, no hace runtime fetch al CDN
# de catálogo desde el browser → cero dependencia de uptime cruzado.
#
# Si el CDN está caído al momento de correr este script:
#   - Falla con exit 1 (NO degrada silenciosamente)
#   - El deploy queda pinned a la versión last-known-good versionada en git
#
# Uso:
#   bash scripts/fetch-catalog.sh
#
# Variables overridables:
#   CATALOG_BASE_URL   default: https://catalog.parcher.co/v1
#   CATALOG_DEST_DIR   default: assets/catalog
#
# Decisiones cerradas (ADR 004):
#   - Catálogo SSOT en catalog.parcher.co/v1/
#   - No duplicar tokens en el repo del landing — solo el snapshot bajado.

set -euo pipefail

CATALOG_BASE_URL="${CATALOG_BASE_URL:-https://catalog.parcher.co/v1}"

cd "$(dirname "$0")/.."
DEST_DIR="${CATALOG_DEST_DIR:-assets/catalog}"
mkdir -p "$DEST_DIR"

JSON_URL="$CATALOG_BASE_URL/catalog.json"
CSS_URL="$CATALOG_BASE_URL/catalog.css"
JSON_OUT="$DEST_DIR/catalog.json"
CSS_OUT="$DEST_DIR/catalog.css"

# ── catalog.json (OBLIGATORIO) ─────────────────────────────────────────────
echo "→ fetch $JSON_URL"
TMP_JSON="$(mktemp)"
HTTP_CODE=$(curl -sS -o "$TMP_JSON" -w "%{http_code}" "$JSON_URL" || echo "000")

if [ "$HTTP_CODE" != "200" ]; then
  echo "✗ catalog.json fetch failed: HTTP $HTTP_CODE"
  echo "  CDN no disponible. El deploy queda pinned a $JSON_OUT versionado en git."
  rm -f "$TMP_JSON"
  exit 1
fi

# Validar que es JSON parseable
if ! python3 -c "import json,sys; json.load(open('$TMP_JSON'))" 2>/dev/null; then
  echo "✗ catalog.json descargado no es JSON válido"
  rm -f "$TMP_JSON"
  exit 1
fi

# Validar metadata mínima esperada
VERSION=$(python3 -c "import json; d=json.load(open('$TMP_JSON')); print(d.get('\$metadata',{}).get('version','?'))")
CHECKSUM=$(python3 -c "import json; d=json.load(open('$TMP_JSON')); print(d.get('\$metadata',{}).get('checksum_sha256','?'))")
echo "  version=$VERSION  checksum=${CHECKSUM:0:12}…"

mv "$TMP_JSON" "$JSON_OUT"
echo "✓ $JSON_OUT actualizado"

# ── catalog.css (OPCIONAL por ahora — workspace todavía no lo subió) ───────
echo "→ fetch $CSS_URL"
TMP_CSS="$(mktemp)"
HTTP_CODE=$(curl -sS -o "$TMP_CSS" -w "%{http_code}" "$CSS_URL" || echo "000")

if [ "$HTTP_CODE" = "200" ]; then
  mv "$TMP_CSS" "$CSS_OUT"
  echo "✓ $CSS_OUT actualizado"
else
  echo "⚠ catalog.css HTTP $HTTP_CODE — todavía no publicado en el CDN"
  echo "  bloque B (paleta v3) queda pendiente hasta que workspace lo suba"
  rm -f "$TMP_CSS"
  # No fallar — el CSS aún no es bloqueante.
fi

echo ""
echo "snapshot del catálogo listo. revisar diff con:  git diff -- $DEST_DIR/"
