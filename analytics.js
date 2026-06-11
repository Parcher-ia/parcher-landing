/* parcher landing · analytics.js
   Plumbing GA4 mínimo + helpers tipados para eventos custom.
   Se carga en index.html, event.html y 404.html (NO en shortcode.html
   que es redirect sub-200ms · no vale la pena cargar gtag ahí).

   Config: window.PARCHER_GA4_ID se setea en cada HTML que carga este
   script · si el ID no está configurado, todos los hooks son no-op
   (cero crashes en dev sin GA4).

   Uso:
     <script>window.PARCHER_GA4_ID='G-XXXXXXXXXX';</script>
     <script src="/analytics.js" async></script>

   Después en cualquier site de click:
     window.parcherTrack('click_get_tickets', { event_id: '...', provider: '...' });
*/

(function () {
  'use strict';

  var GA4_ID = window.PARCHER_GA4_ID || '';

  // No-op rápido si no hay ID configurado.
  if (!GA4_ID) {
    window.parcherTrack = function () {};
    return;
  }

  // Inyecta el script de gtag (async).
  var s = document.createElement('script');
  s.async = true;
  s.src = 'https://www.googletagmanager.com/gtag/js?id=' + encodeURIComponent(GA4_ID);
  document.head.appendChild(s);

  // Buffer hasta que gtag.js termine de cargar.
  window.dataLayer = window.dataLayer || [];
  function gtag() { window.dataLayer.push(arguments); }
  window.gtag = gtag;

  gtag('js', new Date());
  // Default config · page_view se manda automático en cada page load.
  gtag('config', GA4_ID, {
    // anonymize_ip está deprecated en GA4 (lo hace por default).
    send_page_view: true,
  });

  /**
   * Wrapper de tracking custom · params son atributos opcionales del evento.
   * Filtra nulls/undefined para no ensuciar el reporte de GA4.
   */
  window.parcherTrack = function (eventName, params) {
    if (!eventName) return;
    var clean = {};
    if (params && typeof params === 'object') {
      Object.keys(params).forEach(function (k) {
        var v = params[k];
        if (v !== null && v !== undefined && v !== '') clean[k] = v;
      });
    }
    try {
      gtag('event', eventName, clean);
    } catch (e) {
      // GA4 caído / blocker activo · cero impacto en UX.
    }
  };

  /**
   * Delegación global de clicks · cualquier elemento con data-track="event_name"
   * dispara parcherTrack al click. Los atributos data-track-X se transforman a
   * params snake_case (data-track-event-id → event_id).
   *
   *   <a data-track="click_get_tickets"
   *      data-track-event-id="abc"
   *      data-track-provider="qrboletos">…</a>
   *
   * Esto cubre HTML estático Y el HTML dinámico que renderea event.js · cero
   * acoplamiento entre el render y el plumbing de analytics.
   */
  function paramsFromDataset(ds) {
    var params = {};
    Object.keys(ds).forEach(function (key) {
      if (key === 'track' || key.indexOf('track') !== 0) return;
      // 'trackEventId' → 'event_id' (snake_case con prefijo "track" removido)
      var name = key
        .slice(5)
        .replace(/[A-Z]/g, function (m) { return '_' + m.toLowerCase(); });
      params[name] = ds[key];
    });
    return params;
  }
  document.addEventListener('click', function (e) {
    var target = e.target && e.target.closest && e.target.closest('[data-track]');
    if (!target) return;
    window.parcherTrack(target.dataset.track, paramsFromDataset(target.dataset));
  }, true);
})();
