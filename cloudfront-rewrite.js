/* parcher-landing-rewrite — CloudFront Function (viewer-request)
 *
 * v9 (visor /ver · 2026-06-14):
 *   - /ver                     → /app-index.html (feed scrolleable de listas)
 *   - /sorprendeme · /guardados → /app-index.html (la app · todos)
 *   - /buscar                  → /app-index.html (la app · todos)
 *   - /e/<uuid>  móvil → /app-index.html (rail) · desktop/bots → prerender
 *   - /p/<shortcode>          → /shortcode.html (resolve client-side)
 *   - /buy/<uuid>             → /buy/<uuid>.html (track + redirect a ticketing)
 *   - /cali · /cali/<slug>    → .html (categorías · feature flag)
 *   - /f/<ocasión>            → /app-index.html (la app · deep links · todos)
 *   - "/" móvil/tablet        → /app-index.html (la app · puertas)
 *   - "/" desktop y BOTS      → /index.html (landing · SEO intacto)
 *   - Si .html no existe, la CustomErrorResponse 404 sirve /404.html con 200.
 *
 * La detección móvil es por User-Agent (los headers CloudFront-Is-*-Viewer
 * no llegan a esta function con la config legacy de la distro). Los bots
 * SIEMPRE ven la landing en "/" — el SEO del homepage no se toca.
 *
 * Update + publish:
 *   ETAG=$(aws --profile parcher cloudfront describe-function \
 *     --name parcher-landing-rewrite --query 'ETag' --output text)
 *   aws --profile parcher cloudfront update-function \
 *     --name parcher-landing-rewrite \
 *     --function-config Comment="rewrite v5 device router",Runtime=cloudfront-js-2.0 \
 *     --function-code fileb://cloudfront-rewrite.js --if-match "$ETAG"
 *   ETAG=$(aws --profile parcher cloudfront describe-function \
 *     --name parcher-landing-rewrite --query 'ETag' --output text)
 *   aws --profile parcher cloudfront publish-function \
 *     --name parcher-landing-rewrite --if-match "$ETAG"
 *
 * Invalidar:
 *   aws --profile parcher cloudfront create-invalidation \
 *     --distribution-id E24RGSFRFUFZGX --paths "/*"
 */

// Mapa slug de categoría /cali/<slug> → key de ocasión del app (/f/<key>).
// Espejo de OCASION_SLUGS del backend (categoryRenderer). Si drifta, los links
// de /cali en móvil caen al coldstart (no rompen). Mantener en sync con Set F.
var SLUG_TO_KEY = {
  'ver-en-vivo': 'live_shows',
  'con-el-parche': 'with_friends',
  'plan-en-familia': 'with_family',
  'con-la-pareja': 'with_partner',
  'descubrir-la-ciudad': 'explore_city',
  'aprender-y-crear': 'learn_create',
  'recargar': 'recharge',
  'conocer-gente': 'meet_people'
};

function redirect(loc) {
  return { statusCode: 302, statusDescription: 'Found', headers: { 'location': { value: loc } } };
}

function handler(event) {
  var uri = event.request.uri;
  var headers = event.request.headers;
  var ua = headers['user-agent'] ? headers['user-agent'].value.toLowerCase() : '';
  var isBot = /bot|crawl|spider|slurp|preview|facebookexternalhit|whatsapp|telegram|curl|lighthouse/.test(ua);
  var isMobile = /mobi|android|iphone|ipad|ipod|tablet|silk/.test(ua);

  // /e/<algo> sin extensión: móvil → rail de la app (v6 · deep links del
  // bot/captions) · desktop y BOTS → prerender .html (SEO + OG intactos)
  if (uri.length > 3 && uri.substring(0, 3) === '/e/' && uri.indexOf('.') === -1) {
    event.request.uri = isMobile && !isBot ? '/app-index.html' : uri + '.html';
    return event.request;
  }
  // /buy/<algo> sin extensión → /buy/<algo>.html (track + redirect intermediario)
  if (uri.length > 5 && uri.substring(0, 5) === '/buy/' && uri.indexOf('.') === -1) {
    event.request.uri = uri + '.html';
    return event.request;
  }
  // /p/<code>: token de parche de coordinación (10ch base57, no 'PARCHE') → la
  // app EN parcher.co (mismo origin · ADR 021, sin saltar a app.parcher.co).
  // Resto (event shortcode 7ch · OTP-IG 'PARCHE'+4) → shortcode.html (resolve).
  if (uri.length > 3 && uri.substring(0, 3) === '/p/' && uri.indexOf('.') === -1) {
    var pcode = uri.substring(3).replace(/\/$/, '');
    if (pcode.length === 10 && pcode.substring(0, 6) !== 'PARCHE') {
      event.request.uri = '/app-index.html';
    } else {
      event.request.uri = '/shortcode.html';
    }
    return event.request;
  }
  // /cali (sin trailing slash): móvil (no-bot) → 302 al coldstart (la app NO
  // tiene ruta /cali, por eso redirect y no rewrite) · desktop/bots → /cali.html
  // (SEO intacto). Decisión Julián 2026-06-18.
  if (uri === '/cali' || uri === '/cali/') {
    if (isMobile && !isBot) return redirect('/');
    event.request.uri = '/cali.html';
    return event.request;
  }
  // /terms → /terms.html (página legal · ToS · anti-scrape Tier 0)
  if (uri === '/terms' || uri === '/terms/') {
    event.request.uri = '/terms.html';
    return event.request;
  }
  // /cali/<slug>: móvil (no-bot) → 302 al feed de esa ocasión (/f/<key>),
  // preservando la intención del link · slug desconocido → coldstart ·
  // desktop/bots → /cali/<slug>.html (SEO).
  if (uri.length > 6 && uri.substring(0, 6) === '/cali/' && uri.indexOf('.') === -1) {
    if (isMobile && !isBot) {
      var slug = uri.substring(6).replace(/\/$/, '');
      var key = SLUG_TO_KEY[slug];
      return redirect(key ? '/f/' + key : '/');
    }
    event.request.uri = uri + '.html';
    return event.request;
  }
  // /f/<ocasión> · /buscar · /parche/* → la app (deep links del feed · ADR 021)
  if (
    uri.substring(0, 3) === '/f/' ||
    uri.substring(0, 8) === '/parche/' ||
    uri === '/buscar' ||
    uri === '/guardados' ||
    uri === '/sorprendeme' ||
    uri === '/ver' ||
    uri === '/lo-mio' ||
    uri === '/me-gusta' ||
    uri === '/pareja' ||
    uri === '/listo'
  ) {
    event.request.uri = '/app-index.html';
    return event.request;
  }
  // Homepage: móvil → app · desktop y bots → landing (SEO)
  if (uri === '/' || uri === '/index.html') {
    if (isMobile && !isBot) {
      event.request.uri = '/app-index.html';
    }
  }
  return event.request;
}
