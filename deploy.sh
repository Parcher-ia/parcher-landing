#!/usr/bin/env bash
# Deploy de parcher-landing a S3 + CloudFront.
#
# Stack en cuenta AWS Parcher (458982626937):
#   - S3 bucket:                parcher-landing-site (us-east-1, OAC-only)
#   - CloudFront distribution:  E24RGSFRFUFZGX  (d27jwgf7l2eby6.cloudfront.net)
#   - ACM cert (us-east-1):     parcher.co + www.parcher.co
#
# Hosted zone parcher.co vive en cuenta Parcher (Z00126392W650WGAFFQMH).
# Registro del dominio sigue en cuenta sugarvalley (058264274774); solo NS apuntan a Parcher.
#
# Override de variables si hace falta:
#   PARCHER_LANDING_BUCKET, PARCHER_LANDING_DISTRO, PARCHER_AWS_PROFILE

set -euo pipefail

BUCKET="${PARCHER_LANDING_BUCKET:-parcher-landing-site}"
DISTRIBUTION_ID="${PARCHER_LANDING_DISTRO:-E24RGSFRFUFZGX}"
PROFILE="${PARCHER_AWS_PROFILE:-parcher}"

cd "$(dirname "$0")"

# Pre-step obligatorio: refrescar snapshot del catálogo desde catalog.parcher.co.
# Si el CDN está caído, fetch-catalog.sh falla con exit 1 y aborta el deploy.
# El landing queda pinned a la versión versionada en assets/catalog/ que
# acabamos de chequear, así que es safe pinear si quisiéramos forzar (no se hace).
echo "→ refrescando snapshot del catálogo desde el CDN"
bash scripts/fetch-catalog.sh

# Minificar styles.css antes del sync (saves ~16KB · ~300ms LCP en mobile).
# El minified queda en /tmp y se sube con aws cp; el repo conserva el source
# legible. Si csso falla, fallback al CSS sin minificar (no bloquea deploy).
MIN_CSS="/tmp/parcher-styles.min.css"
echo "→ minificando styles.css"
if npx --yes csso-cli styles.css --output "$MIN_CSS" 2>&1 | grep -qE 'error|fail'; then
  echo "⚠ csso falló · subiendo styles.css sin minificar"
  cp styles.css "$MIN_CSS"
fi

echo "→ sync a s3://$BUCKET/ (profile=$PROFILE)"
# ────────────────────────────────────────────────────────────────────────────
# ⚠️  BLINDAJE PRERENDER — NO QUITAR LOS --exclude DE "e/*" Y "api/*"
# El backend escribe HTMLs prerenderizados por evento en /e/<uuid>.html y
# payloads JSON en /api/v1/events/<uuid>.json sobre ESTE MISMO BUCKET.
# Como abajo usamos --delete, un sync sin estos excludes BORRARÍA los 15k+
# prerenders en cada deploy del landing. Si necesitas limpiar prerenders,
# hacelo explícito desde el script de backfill del backend, NUNCA desde acá.
# Tracking: github.com/Parcher-ia/parcher-ia-backend (prerender feature).
# ────────────────────────────────────────────────────────────────────────────
aws --profile "$PROFILE" s3 sync . "s3://$BUCKET/" \
  --delete \
  --exclude ".git/*" \
  --exclude "*.md" \
  --exclude "deploy.sh" \
  --exclude "cloudfront-rewrite.js" \
  --exclude ".gitignore" \
  --exclude "*.DS_Store" \
  --exclude "scripts/*" \
  --exclude "styles.css" \
  --exclude "e/*" \
  --exclude "api/*" \
  --exclude "buy/*" \
  --exclude "cali/*" \
  --exclude "cali.html" \
  --exclude "sitemap.xml" \
  --cache-control "public, max-age=60"

# styles.css minificado se sube por separado (con Content-Type explícito).
aws --profile "$PROFILE" s3 cp "$MIN_CSS" "s3://$BUCKET/styles.css" \
  --content-type "text/css; charset=utf-8" \
  --cache-control "public, max-age=60" \
  --no-progress
# max-age=60 deja que el browser revalide cada minuto vía etag (cheap 304s).
# Sin esto, los navegadores cachean event.js/styles.css por horas con su
# heurística propia, y la invalidación de CloudFront no los limpia. Ya nos
# pasó: deploy nuevo + invalidation completed pero "lo veo igual" porque
# el JS viejo seguía vivo en el browser.

echo "→ invalidando CloudFront ($DISTRIBUTION_ID)"
INV_ID=$(aws --profile "$PROFILE" cloudfront create-invalidation \
  --distribution-id "$DISTRIBUTION_ID" \
  --paths "/*" \
  --query 'Invalidation.Id' --output text)

echo "✓ invalidación creada: $INV_ID"
echo "  status: aws --profile $PROFILE cloudfront get-invalidation --distribution-id $DISTRIBUTION_ID --id $INV_ID"
echo ""
echo "URLs:"
echo "  https://parcher.co"
echo "  https://www.parcher.co"
echo "  https://d27jwgf7l2eby6.cloudfront.net  (origen CloudFront directo)"
