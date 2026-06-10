/* parcher-landing-rewrite — CloudFront Function (viewer-request)
 *
 * v3 (shortcodes):
 *   - /e/<uuid>           → /e/<uuid>.html (prerender del backend)
 *   - /p/<shortcode>      → /shortcode.html (resolve client-side y redirect)
 *   - Si .html no existe, la CustomErrorResponse 404 de la distribution
 *     sirve /404.html con 200.
 *
 * Cómo se asocia (primera vez):
 *   aws --profile parcher cloudfront create-function \
 *     --name parcher-landing-rewrite \
 *     --function-config Comment="rewrite /e y /p",Runtime=cloudfront-js-2.0 \
 *     --function-code fileb://cloudfront-rewrite.js
 *
 * Update + publish:
 *   ETAG=$(aws --profile parcher cloudfront describe-function \
 *     --name parcher-landing-rewrite --query 'ETag' --output text)
 *   aws --profile parcher cloudfront update-function \
 *     --name parcher-landing-rewrite \
 *     --function-config Comment="rewrite /e y /p",Runtime=cloudfront-js-2.0 \
 *     --function-code fileb://cloudfront-rewrite.js \
 *     --if-match "$ETAG"
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
  // /e/<algo> sin extensión → /e/<algo>.html (prerender)
  if (uri.length > 3 && uri.substring(0, 3) === '/e/' && uri.indexOf('.') === -1) {
    event.request.uri = uri + '.html';
    return event.request;
  }
  // /p/<shortcode> → /shortcode.html (client-side resolve)
  if (uri.length > 3 && uri.substring(0, 3) === '/p/' && uri.indexOf('.') === -1) {
    event.request.uri = '/shortcode.html';
    return event.request;
  }
  return event.request;
}
