# parcher-landing

Landing single-page de parcher.co — única misión: llevar al visitante al DM de `@soyparcher`.

Stack: HTML + CSS plano. Sin framework, sin build step.

## Correr local

```bash
cd /opt/parcher/parcher-landing
python3 -m http.server 8080
# abrir http://localhost:8080
```

## Deploy

Ver `deploy.sh`. Hosting: AWS S3 + CloudFront en cuenta Parcher (458982626937).

Antes del primer deploy hay que crear la infra (ver plan en `/Users/julian/.claude/plans/virtual-dazzling-squirrel.md` §6):

- S3 bucket: `parcher-landing-site`
- CloudFront distribution para `parcher.co` + `www.parcher.co`
- ACM cert en us-east-1
- Route 53 ALIAS records

## Estructura

```
.
├── index.html              # Single page con 6 secciones
├── styles.css              # Design tokens + layout
├── assets/
│   ├── logo/               # SVGs del wordmark/monogram
│   ├── chips/              # 5 fotos de vibes (UGC)
│   ├── favicon.png
│   └── og-image.jpg
├── robots.txt
└── deploy.sh
```

## Fuente de verdad de marca

`/opt/parcher/marca_parcher/parcher-brand-book.md` — cualquier cambio visual o de copy se valida contra el brand book.
