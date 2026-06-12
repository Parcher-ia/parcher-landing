/* parcher-landing-rewrite — CloudFront Function (viewer-request)
 *
 * v5 (device router · promoción de la app · 2026-06-12):
 *   - /e/<uuid>               → /e/<uuid>.html (prerender del backend)
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
function handler(event) {
  var uri = event.request.uri;
  var headers = event.request.headers;

  // /e/<algo> sin extensión → /e/<algo>.html (prerender)
  if (uri.length > 3 && uri.substring(0, 3) === '/e/' && uri.indexOf('.') === -1) {
    event.request.uri = uri + '.html';
    return event.request;
  }
  // /buy/<algo> sin extensión → /buy/<algo>.html (track + redirect intermediario)
  if (uri.length > 5 && uri.substring(0, 5) === '/buy/' && uri.indexOf('.') === -1) {
    event.request.uri = uri + '.html';
    return event.request;
  }
  // /p/<shortcode> → /shortcode.html (client-side resolve)
  if (uri.length > 3 && uri.substring(0, 3) === '/p/' && uri.indexOf('.') === -1) {
    event.request.uri = '/shortcode.html';
    return event.request;
  }
  // /cali (sin trailing slash) → /cali.html
  if (uri === '/cali' || uri === '/cali/') {
    event.request.uri = '/cali.html';
    return event.request;
  }
  // /cali/<slug> → /cali/<slug>.html
  if (uri.length > 6 && uri.substring(0, 6) === '/cali/' && uri.indexOf('.') === -1) {
    event.request.uri = uri + '.html';
    return event.request;
  }
  // /f/<ocasión> → la app (deep links del feed · desktop también)
  if (uri.substring(0, 3) === '/f/') {
    event.request.uri = '/app-index.html';
    return event.request;
  }
  // Homepage: móvil → app · desktop y bots → landing (SEO)
  if (uri === '/' || uri === '/index.html') {
    var ua = headers['user-agent'] ? headers['user-agent'].value.toLowerCase() : '';
    var isBot = /bot|crawl|spider|slurp|preview|facebookexternalhit|whatsapp|telegram|curl|lighthouse/.test(ua);
    var isMobile = /mobi|android|iphone|ipad|ipod|tablet|silk/.test(ua);
    if (isMobile && !isBot) {
      event.request.uri = '/app-index.html';
    }
  }
  return event.request;
}
