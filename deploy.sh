#!/usr/bin/env bash
# Deploy de parcher-landing a S3 + CloudFront.
# Cuenta AWS: Parcher (458982626937), profile: parcher (default).
#
# Prerrequisitos (crear ANTES del primer deploy — ver plan §6):
#   1. S3 bucket: parcher-landing-site (static website hosting)
#   2. CloudFront distribution para parcher.co + www.parcher.co
#   3. ACM certificate us-east-1 para parcher.co + *.parcher.co
#   4. Route 53 ALIAS records → CloudFront
#   5. IAM policy con s3:PutObject + cloudfront:CreateInvalidation

set -euo pipefail

BUCKET="${PARCHER_LANDING_BUCKET:-parcher-landing-site}"
DISTRIBUTION_ID="${PARCHER_LANDING_DISTRO:-TODO_DISTRIBUTION_ID}"

if [[ "$DISTRIBUTION_ID" == "TODO_DISTRIBUTION_ID" ]]; then
  echo "ERROR: setea PARCHER_LANDING_DISTRO con el ID de CloudFront antes de correr."
  exit 1
fi

cd "$(dirname "$0")"

echo "→ sync a s3://$BUCKET/"
aws s3 sync . "s3://$BUCKET/" \
  --delete \
  --exclude ".git/*" \
  --exclude "*.md" \
  --exclude "deploy.sh" \
  --exclude ".gitignore" \
  --exclude ".DS_Store"

echo "→ invalidando CloudFront ($DISTRIBUTION_ID)"
INV_ID=$(aws cloudfront create-invalidation \
  --distribution-id "$DISTRIBUTION_ID" \
  --paths "/*" \
  --query 'Invalidation.Id' --output text)

echo "✓ invalidación creada: $INV_ID"
echo "  status: aws cloudfront get-invalidation --distribution-id $DISTRIBUTION_ID --id $INV_ID"
