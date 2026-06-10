/* parcher landing · shortcode.js
   Resuelve /p/<shortcode> → /e/<event_id> via backend.

   Spec: producto/spec-shortcodes-eventos.md §5
   Backend: GET /api/public/shortcodes/:code → { event_id } | 404 */

(function () {
  'use strict';

  var API_BASE = (window.PARCHER_API_BASE || '').replace(/\/+$/, '');
  // 7 chars base57 (sin 0/O/1/l/I) — coincide con backend ShortcodeService.
  var SHORTCODE_RE = /^[2-9A-HJ-NP-Za-hj-km-z]{7}$/;

  function extractShortcodeFromPath() {
    var parts = window.location.pathname.split('/').filter(Boolean);
    var i = parts.indexOf('p');
    if (i >= 0 && parts[i + 1]) return parts[i + 1];
    return parts[parts.length - 1] || '';
  }

  function go404() {
    // Redirige al not-found genérico del landing (mantiene URL del 404).
    window.location.replace('/404.html');
  }

  function goEvent(eventId) {
    // Replace · no añadimos historial: el shortcode es solo un redirect link.
    window.location.replace('/e/' + encodeURIComponent(eventId));
  }

  function resolve(code) {
    if (!API_BASE) {
      go404();
      return;
    }
    var url = API_BASE + '/api/public/shortcodes/' + encodeURIComponent(code);
    fetch(url, { headers: { Accept: 'application/json' } })
      .then(function (resp) {
        if (!resp.ok) {
          // 404 (invalid_format / not_found) o 5xx → ambos van al 404 page.
          go404();
          return null;
        }
        return resp.json();
      })
      .then(function (data) {
        if (!data || !data.event_id) return;
        goEvent(data.event_id);
      })
      .catch(function (err) {
        console.error('shortcode resolve failed', err);
        go404();
      });
  }

  function load() {
    var code = extractShortcodeFromPath();
    if (!code || !SHORTCODE_RE.test(code)) {
      go404();
      return;
    }
    resolve(code);
  }

  load();
})();
