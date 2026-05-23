/* parcher-landing-rewrite — CloudFront Function (viewer-request)
 *
 * Hace que /e/<uuid> resuelva al archivo estático /event.html sin cambiar
 * la URL visible. El JS del cliente lee el UUID de window.location.pathname.
 *
 * Cómo se asocia:
 *   1) Crear la function:
 *      aws --profile parcher cloudfront create-function \
 *        --name parcher-landing-rewrite \
 *        --function-config Comment="rewrite /e/<id> a /event.html",Runtime=cloudfront-js-2.0 \
 *        --function-code fileb://cloudfront-rewrite.js
 *
 *   2) Publicar:
 *      aws --profile parcher cloudfront publish-function \
 *        --name parcher-landing-rewrite \
 *        --if-match <ETag de la respuesta anterior>
 *
 *   3) Asociar al default behavior de la distribution E24RGSFRFUFZGX
 *      (viewer-request) — vía consola o update-distribution con el JSON
 *      de la distribution editado.
 *
 *   4) Invalidar: aws --profile parcher cloudfront create-invalidation \
 *        --distribution-id E24RGSFRFUFZGX --paths "/*"
 */
function handler(event) {
  var uri = event.request.uri;
  // /e/<anything> → /event.html (sin cambiar la URL visible)
  if (uri.length > 3 && uri.substring(0, 3) === '/e/') {
    event.request.uri = '/event.html';
  }
  return event.request;
}
