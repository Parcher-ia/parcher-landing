/* parcher landing · event.js
   Página pública de detalle de evento (parcher.co/e/<uuid>).
   Estrategia de carga (de más rápida a más lenta):
     1) Payload embebido por el prerender (<script id="ev-payload">) → cero red.
     2) JSON estático prerenderizado /api/v1/events/<id>.json (CloudFront cache).
     3) Endpoint Lambda /api/public/events/:id (fallback). */

(function () {
  'use strict';

  var API_BASE = (window.PARCHER_API_BASE || '').replace(/\/+$/, '');
  var DM_URL = 'https://ig.me/m/soyparcher';
  var UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  var root = document.getElementById('ev-root');

  function extractIdFromPath() {
    var parts = window.location.pathname.split('/').filter(Boolean);
    // soporta /e/<uuid> y /e/<uuid>/...
    var i = parts.indexOf('e');
    if (i >= 0 && parts[i + 1]) return parts[i + 1];
    return parts[parts.length - 1] || '';
  }

  function escapeHtml(s) {
    if (s === null || s === undefined) return '';
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function formatDateRange(startsAt, endsAt, isAllDay) {
    if (!startsAt) return '';
    var start = new Date(startsAt);
    if (isNaN(start.getTime())) return '';

    var dayFmt = { weekday: 'long', day: 'numeric', month: 'long' };
    var timeFmt = { hour: '2-digit', minute: '2-digit' };

    var dayStr = start.toLocaleDateString('es-CO', dayFmt);
    if (isAllDay) return dayStr + ' · todo el día';

    // midnight UTC (00:00:00) = hora por confirmar (convención backend)
    var isTimeTBD =
      start.getUTCHours() === 0 &&
      start.getUTCMinutes() === 0 &&
      start.getUTCSeconds() === 0;
    if (isTimeTBD) return dayStr + ' · hora por confirmar';

    var timeStr = start.toLocaleTimeString('es-CO', timeFmt);
    var out = dayStr + ' · ' + timeStr;
    if (endsAt) {
      var end = new Date(endsAt);
      if (!isNaN(end.getTime())) {
        out += ' → ' + end.toLocaleTimeString('es-CO', timeFmt);
      }
    }
    return out;
  }

  function chip(text, tone) {
    if (!text) return '';
    var cls = 'ev-chip' + (tone ? ' ev-chip-' + tone : '');
    return '<span class="' + cls + '">' + escapeHtml(text) + '</span>';
  }

  function chipsFrom(value, tone) {
    if (!value) return '';
    var arr = Array.isArray(value) ? value : [value];
    return arr
      .filter(function (v) {
        return v !== null && v !== undefined && String(v).trim() !== '';
      })
      .map(function (v) {
        return chip(v, tone);
      })
      .join('');
  }

  function mapsHref(vp, fallbackAddress, fallbackName, city) {
    // Preferimos query por nombre+ciudad para que Maps abra la ficha del
    // establecimiento (fotos, reseñas) en vez de un pin en coords sueltas.
    var name = (vp && vp.canonical_name) || fallbackName || '';
    var addr = (vp && vp.address_line_1) || fallbackAddress || '';
    var c = city || (vp && vp.city) || '';
    var parts = [];
    if (name) parts.push(name);
    if (addr && addr !== name) parts.push(addr);
    if (c) parts.push(c);
    var q = parts.join(', ');
    if (!q && vp && vp.lat !== null && vp.lat !== undefined && vp.lng !== null && vp.lng !== undefined) {
      q = vp.lat + ',' + vp.lng;
    }
    if (!q) return '';
    return 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(q);
  }

  function venuePriceChip(level) {
    // Etiquetado explícito: este es el rango típico del LUGAR (venue), no del evento.
    if (!level) return '';
    var map = { economico: '$', económico: '$', medio: '$$', alto: '$$$' };
    var key = String(level).toLowerCase();
    var sym = map[key] || String(level);
    return chip('rango del lugar: ' + sym, 'price');
  }

  function safetyChip(s) {
    if (!s) return '';
    var key = String(s).toLowerCase();
    var labels = {
      segura: 'zona segura',
      safe: 'zona segura',
      mixta: 'seguridad mixta',
      cuidado: 'precaución de noche',
      unsafe: 'precaución de noche',
    };
    return chip(labels[key] || ('seguridad: ' + s), 'safety');
  }

  function availabilityBadge(status) {
    if (!status) return '';
    var key = String(status).toLowerCase();
    var map = {
      sold_out: { label: 'agotado', tone: 'soldout' },
      agotado: { label: 'agotado', tone: 'soldout' },
      low: { label: 'pocas boletas', tone: 'low' },
      pocas: { label: 'pocas boletas', tone: 'low' },
      limited: { label: 'pocas boletas', tone: 'low' },
      available: { label: 'disponibles', tone: 'available' },
      disponible: { label: 'disponibles', tone: 'available' },
    };
    var info = map[key];
    if (!info) return '';
    return (
      '<span class="ev-availability ev-availability-' +
      info.tone +
      '">' +
      escapeHtml(info.label) +
      '</span>'
    );
  }

  function pad(n) { return n < 10 ? '0' + n : '' + n; }

  function toCalendarUtc(d) {
    return (
      d.getUTCFullYear() +
      pad(d.getUTCMonth() + 1) +
      pad(d.getUTCDate()) +
      'T' +
      pad(d.getUTCHours()) +
      pad(d.getUTCMinutes()) +
      pad(d.getUTCSeconds()) +
      'Z'
    );
  }

  function calendarHref(data) {
    if (!data.starts_at) return '';
    var start = new Date(data.starts_at);
    if (isNaN(start.getTime())) return '';
    var end = data.ends_at ? new Date(data.ends_at) : null;
    if (!end || isNaN(end.getTime())) {
      end = new Date(start.getTime() + 2 * 60 * 60 * 1000);
    }
    var vp = data.venue_profile || {};
    var venueName = data.place_name || vp.canonical_name || '';
    var city = data.city || vp.city || '';
    var addr = data.address || vp.address_line_1 || '';
    var loc = [venueName, addr, city]
      .filter(function (v) { return v && String(v).trim(); })
      .join(', ');
    var details = 'via parcher · ' + window.location.href;
    var params = [
      'action=TEMPLATE',
      'text=' + encodeURIComponent(data.title || 'parche'),
      'dates=' + toCalendarUtc(start) + '/' + toCalendarUtc(end),
    ];
    if (loc) params.push('location=' + encodeURIComponent(loc));
    params.push('details=' + encodeURIComponent(details));
    return 'https://www.google.com/calendar/render?' + params.join('&');
  }

  function whatsappShareHref(data) {
    var title = data.title || 'mira este parche';
    var text = title + ' · ' + window.location.href;
    return 'https://wa.me/?text=' + encodeURIComponent(text);
  }

  function parkingChip(p) {
    if (!p) return '';
    var key = String(p).toLowerCase();
    var labels = {
      facil: 'parqueo fácil',
      fácil: 'parqueo fácil',
      dificil: 'parqueo difícil',
      difícil: 'parqueo difícil',
      'no disponible': 'sin parqueo',
    };
    return chip(labels[key] || ('parqueo: ' + p), 'logistic');
  }

  function normalizeLinks(raw) {
    // Acepta array [{label, url}] | array de strings | objeto {label: url}
    if (!raw) return [];
    var out = [];
    if (Array.isArray(raw)) {
      raw.forEach(function (it) {
        if (!it) return;
        if (typeof it === 'string') out.push({ label: it, url: it });
        else if (typeof it === 'object' && it.url) {
          out.push({ label: it.label || it.title || it.url, url: it.url });
        }
      });
    } else if (typeof raw === 'object') {
      Object.keys(raw).forEach(function (k) {
        var v = raw[k];
        if (typeof v === 'string') out.push({ label: k, url: v });
        else if (v && typeof v === 'object' && v.url) {
          out.push({ label: v.label || k, url: v.url });
        }
      });
    }
    return out.filter(function (l) {
      return l.url && /^https?:\/\//i.test(l.url);
    });
  }

  function formatPrice(from, to, currency) {
    var c = currency || 'COP';
    var fmt = function (n) {
      return Number(n).toLocaleString('es-CO');
    };
    if (from && to && Number(from) !== Number(to)) {
      return c + ' ' + fmt(from) + ' – ' + fmt(to);
    }
    if (from) return 'desde ' + c + ' ' + fmt(from);
    if (to) return 'hasta ' + c + ' ' + fmt(to);
    return '';
  }

  function pickPrimarySource(sources) {
    if (!sources || !sources.length) return null;
    var primary = sources.filter(function (s) {
      return s && s.is_primary && s.source_url;
    })[0];
    if (primary) return primary;
    return sources.filter(function (s) {
      return s && s.source_url;
    })[0] || null;
  }

  function pickCoverUrl(data) {
    if (data.cover_image_url) return data.cover_image_url;
    if (data.media && data.media.length) {
      var primary = data.media.filter(function (m) {
        return m.is_primary;
      })[0];
      return (primary || data.media[0]).url || null;
    }
    return null;
  }

  function renderError(kind) {
    var title, body;
    if (kind === '404') {
      title = 'este parche ya no está disponible';
      body =
        'puede que se haya quitado o que el link esté mal copiado.<br />escribime por DM y te paso lo que hay hoy.';
    } else {
      title = 'algo se nos rompió';
      body = 'no pudimos cargar este parche. intenta recargar la página o escribime por DM.';
    }
    root.innerHTML =
      '<section class="ev-state ev-error">' +
      '<div class="container">' +
      '<h1 class="ev-error-title">' +
      escapeHtml(title) +
      '<span class="dot">.</span></h1>' +
      '<p class="ev-error-body">' +
      body +
      '</p>' +
      '<a class="cta-primary" href="' +
      DM_URL +
      '" target="_blank" rel="noopener">' +
      '<span>escribime por DM</span><span class="arrow">→</span></a>' +
      '<div class="cta-secondary">@soyparcher</div>' +
      '</div></section>';
  }

  function renderEvent(data) {
    var cover = pickCoverUrl(data);
    var primarySource = pickPrimarySource(data.event_sources);
    var vp = data.venue_profile || {};
    var venueName = data.place_name || vp.canonical_name || '';
    var venueCity = data.city || vp.city || '';
    var addrLine = data.address || vp.address_line_1 || '';
    var hoodLine = vp.neighborhood || '';
    // mapsUrl computado upfront para reusarlo en el chip del hero y la card "Dónde".
    var mapsUrl = mapsHref(vp, addrLine, venueName, venueCity);
    var whenStr = formatDateRange(data.starts_at, data.ends_at, data.is_all_day);
    var priceStr = formatPrice(data.price_from, data.price_to, data.currency);
    var ticketing = data.event_ticketing || {};
    var enr = data.event_enrichment || {};
    var descs = enr.descriptions || {};

    // ─── HERO ──────────────────────────────────────────────
    var placeChipHtml = '';
    if (venueName) {
      if (mapsUrl) {
        placeChipHtml =
          '<a class="ev-chip ev-chip-place ev-chip-link" href="' +
          escapeHtml(mapsUrl) +
          '" target="_blank" rel="noopener" aria-label="ver ' +
          escapeHtml(venueName) +
          ' en Google Maps">' +
          escapeHtml(venueName) +
          ' <span class="ev-chip-arrow" aria-hidden="true">↗</span></a>';
      } else {
        placeChipHtml = chip(venueName, 'place');
      }
    }
    var heroHtml =
      '<section class="ev-hero">' +
      '<div class="container">' +
      (cover
        ? '<div class="ev-cover"><img src="' +
          escapeHtml(cover) +
          '" alt="" loading="eager" /></div>'
        : '') +
      '<h1 class="ev-title">' +
      escapeHtml(data.title || 'parche sin título') +
      '</h1>' +
      '<div class="ev-meta">' +
      (whenStr ? chip(whenStr, 'date') : '') +
      placeChipHtml +
      (venueCity ? chip(venueCity, 'city') : '') +
      '</div>' +
      // Disclaimer compacto justo debajo de los chips meta · voz parchero.
      // Le decimos al usuario que parcher armó esto leyendo la fuente y que
      // confirme ahí si duda, sin tono burocrático.
      '<p class="ev-disclaimer-top">' +
      (primarySource && primarySource.source_url
        ? 'esta info la armó parcher leyendo el <a href="' +
          escapeHtml(primarySource.source_url) +
          '" target="_blank" rel="noopener">post original</a> — confirmá ahí si dudás.'
        : 'esta info la armó parcher · puede tener errores.') +
      '</p>' +
      '</div></section>';

    // ─── FUENTE ORIGINAL ───────────────────────────────────
    var sourceBlockHtml = '';
    if (primarySource && primarySource.source_url) {
      var handleLabel = primarySource.instagram_handle
        ? '@' + primarySource.instagram_handle + ' en Instagram'
        : 'el post original en Instagram';
      sourceBlockHtml =
        '<section class="ev-source">' +
        '<div class="container">' +
        '<a class="ev-source-card" href="' +
        escapeHtml(primarySource.source_url) +
        '" target="_blank" rel="noopener">' +
        '<div class="ev-source-eyebrow">fuente original</div>' +
        '<div class="ev-source-line">' +
        escapeHtml(handleLabel) +
        ' <span class="arrow">→</span></div>' +
        '</a>' +
        '</div></section>';
    }

    // ─── EL PARCHE (event-focused) ─────────────────────────
    var parcheParts = [];
    var summaryText =
      data.short_summary || descs.short || descs.medium || '';
    if (summaryText) {
      parcheParts.push(
        '<p class="ev-summary">' + escapeHtml(summaryText) + '</p>'
      );
    }
    var vibeChips = chipsFrom(data.vibe, 'vibe');
    var tagChips = chipsFrom(data.tags, 'tag');
    var audChips = chipsFrom(data.audience, 'aud');
    var actChips = chipsFrom(data.activity_type, 'tag');
    if (vibeChips || tagChips || audChips || actChips) {
      parcheParts.push(
        '<div class="ev-chiprow">' +
          vibeChips +
          actChips +
          tagChips +
          audChips +
          '</div>'
      );
    }
    // Lineup / artista principal
    var lineupArr = Array.isArray(data.lineup) ? data.lineup : [];
    if (data.primary_artist || lineupArr.length) {
      var lineupBits = [];
      if (data.primary_artist) {
        lineupBits.push(
          '<strong>' + escapeHtml(data.primary_artist) + '</strong>'
        );
      }
      lineupArr.forEach(function (a) {
        if (a && a !== data.primary_artist) lineupBits.push(escapeHtml(a));
      });
      if (lineupBits.length) {
        parcheParts.push(
          '<div class="ev-lineup"><span class="ev-lineup-label">lineup:</span> ' +
            lineupBits.join(' · ') +
            '</div>'
        );
      }
    }
    // Precio + tier + availability badge
    var priceBits = [];
    if (priceStr) priceBits.push(escapeHtml(priceStr));
    if (ticketing.tier_name) priceBits.push(escapeHtml(ticketing.tier_name));
    var availHtml = availabilityBadge(ticketing.availability_status);
    if (priceBits.length || availHtml) {
      parcheParts.push(
        '<p class="ev-line"><strong>precio:</strong> ' +
          (priceBits.join(' · ') || 'por confirmar') +
          (availHtml ? ' ' + availHtml : '') +
          '</p>'
      );
    }
    // CTAs row: entradas + calendar + WhatsApp share
    var ctasRow = [];
    if (ticketing.ticketing_url) {
      ctasRow.push(
        '<a class="cta-primary" href="' +
          escapeHtml(ticketing.ticketing_url) +
          '" target="_blank" rel="noopener">' +
          '<span>conseguir entradas</span><span class="arrow">→</span></a>'
      );
    }
    var calHref = calendarHref(data);
    if (calHref) {
      ctasRow.push(
        '<a class="ev-action" href="' +
          escapeHtml(calHref) +
          '" target="_blank" rel="noopener">' +
          '<span class="ev-action-ico" aria-hidden="true">▣</span>' +
          '<span>agregar al calendario</span></a>'
      );
    }
    ctasRow.push(
      '<a class="ev-action" href="' +
        escapeHtml(whatsappShareHref(data)) +
        '" target="_blank" rel="noopener">' +
        '<span class="ev-action-ico" aria-hidden="true">↗</span>' +
        '<span>compartir por WhatsApp</span></a>'
    );
    if (ctasRow.length) {
      parcheParts.push(
        '<div class="ev-actions-row">' + ctasRow.join('') + '</div>'
      );
    }
    var parcheHtml =
      '<section class="ev-basic">' +
      '<div class="container">' +
      parcheParts.join('') +
      '</div></section>';

    // ─── DÓNDE (venue-focused, promoted block) ─────────────
    // addrLine / hoodLine / mapsUrl ya computados arriba (reusados desde el hero).
    var hasVenue = !!(venueName || addrLine || hoodLine || mapsUrl);
    var dondeHtml = '';
    if (hasVenue) {
      var venueLines = [];
      if (venueName) {
        venueLines.push(
          '<div class="ev-venue-name">' + escapeHtml(venueName) + '</div>'
        );
      }
      var addrBits = [];
      if (addrLine && addrLine !== venueName) addrBits.push(escapeHtml(addrLine));
      if (hoodLine) addrBits.push(escapeHtml(hoodLine));
      if (venueCity) addrBits.push(escapeHtml(venueCity));
      if (addrBits.length) {
        venueLines.push(
          '<div class="ev-venue-addr">' + addrBits.join(' · ') + '</div>'
        );
      }
      if (vp.instagram_handle) {
        venueLines.push(
          '<div class="ev-venue-ig"><a href="https://instagram.com/' +
            escapeHtml(vp.instagram_handle) +
            '" target="_blank" rel="noopener">@' +
            escapeHtml(vp.instagram_handle) +
            '</a></div>'
        );
      }
      var venueCardInner = venueLines.join('');
      if (mapsUrl) {
        venueCardInner +=
          '<a class="ev-venue-maps" href="' +
          escapeHtml(mapsUrl) +
          '" target="_blank" rel="noopener">' +
          '<span>ver en Maps</span><span class="arrow">→</span></a>';
      }
      // Chips prácticos del lugar
      var venueChips = '';
      venueChips += chipsFrom(vp.venue_type, 'venue');
      if (vp.is_outdoor) venueChips += chip('al aire libre', 'venue');
      venueChips += chipsFrom(vp.sector_vibe, 'vibe');
      venueChips += chipsFrom(vp.typical_audience, 'aud');
      venueChips += venuePriceChip(vp.price_level);
      if (vp.has_transit_nearby)
        venueChips += chip('transporte público cerca', 'logistic');
      venueChips += parkingChip(vp.parking_availability);
      venueChips += safetyChip(vp.safety_perception);

      dondeHtml =
        '<section class="ev-where">' +
        '<div class="container">' +
        '<h2 class="ev-section-title">dónde</h2>' +
        '<div class="ev-venue-card">' +
        venueCardInner +
        '</div>' +
        (venueChips
          ? '<div class="ev-chiprow ev-where-chips">' + venueChips + '</div>'
          : '') +
        '</div></section>';
    }

    // ─── DETALLES (continuous, no accordion) ───────────────
    var elParche = enr.description_enriched || descs.medium || descs.short || '';
    var masDetalles = enr.description_extended || descs.long || '';
    var detailParts = [];
    if (elParche && elParche !== summaryText) {
      detailParts.push(
        '<div class="ev-rich"><h3>el parche</h3><p>' +
          escapeHtml(elParche) +
          '</p></div>'
      );
    }
    if (masDetalles && masDetalles !== elParche && masDetalles !== summaryText) {
      detailParts.push(
        '<div class="ev-rich"><h3>más detalles</h3><p>' +
          escapeHtml(masDetalles) +
          '</p></div>'
      );
    }
    if (data.parent_event && data.parent_event.id) {
      detailParts.push(
        '<div class="ev-rich"><h3>parte de</h3>' +
          '<a class="ev-parent-link" href="/e/' +
          escapeHtml(data.parent_event.id) +
          '">' +
          escapeHtml(data.parent_event.title || 'evento padre') +
          ' <span class="arrow">→</span></a></div>'
      );
    }
    if (data.subevents && data.subevents.length) {
      var subList = data.subevents
        .map(function (s) {
          var when = formatDateRange(s.starts_at, s.ends_at, false);
          return (
            '<li><a href="/e/' +
            escapeHtml(s.id) +
            '"><span class="sub-title">' +
            escapeHtml(s.title || 'sin título') +
            '</span>' +
            (when ? '<span class="sub-when">' + escapeHtml(when) + '</span>' : '') +
            '</a></li>'
          );
        })
        .join('');
      detailParts.push(
        '<div class="ev-rich"><h3>programación</h3><ul class="ev-sublist">' +
          subList +
          '</ul></div>'
      );
    }
    var extLinks = normalizeLinks(enr.external_links);
    if (extLinks.length) {
      var linksHtml = extLinks
        .map(function (l) {
          return (
            '<li><a href="' +
            escapeHtml(l.url) +
            '" target="_blank" rel="noopener">' +
            escapeHtml(l.label) +
            ' <span class="arrow">→</span></a></li>'
          );
        })
        .join('');
      detailParts.push(
        '<div class="ev-rich"><h3>enlaces</h3>' +
          '<ul class="ev-linklist">' +
          linksHtml +
          '</ul></div>'
      );
    }
    if (ticketing.registration_required || ticketing.registration_instructions) {
      detailParts.push(
        '<div class="ev-rich"><h3>cómo entrar</h3><p>' +
          escapeHtml(
            ticketing.registration_instructions || 'requiere registro previo.'
          ) +
          '</p></div>'
      );
    }
    if (ticketing.whatsapp || ticketing.phone) {
      var waDigits = ticketing.whatsapp ? String(ticketing.whatsapp).replace(/\D/g, '') : '';
      var phoneDigits = ticketing.phone ? String(ticketing.phone).replace(/\D/g, '') : '';
      var contactBits = [];
      if (waDigits) {
        contactBits.push(
          'WhatsApp: <a href="https://wa.me/' +
            escapeHtml(waDigits) +
            '" target="_blank" rel="noopener">' +
            escapeHtml(ticketing.whatsapp) +
            '</a>'
        );
      }
      // El teléfono también arranca chat de WhatsApp si está disponible y no
      // es el mismo número que el de WhatsApp (dedupe contra dato cruzado).
      if (phoneDigits && phoneDigits !== waDigits) {
        contactBits.push(
          'Tel: <a href="https://wa.me/' +
            escapeHtml(phoneDigits) +
            '" target="_blank" rel="noopener">' +
            escapeHtml(ticketing.phone) +
            '</a>'
        );
      }
      detailParts.push(
        '<div class="ev-rich"><h3>contacto</h3><p>' +
          contactBits.join(' · ') +
          '</p></div>'
      );
    }
    var detailsHtml = '';
    if (detailParts.length) {
      detailsHtml =
        '<section class="ev-details-block">' +
        '<div class="container">' +
        '<h2 class="ev-section-title">detalles</h2>' +
        detailParts.join('') +
        '</div></section>';
    }

    // ─── CTA FINAL ─────────────────────────────────────────
    var ctaFinalHtml =
      '<section class="ev-cta-final">' +
      '<div class="container">' +
      '<p class="ev-cta-eyebrow">¿no es lo tuyo?</p>' +
      '<a class="cta-primary" href="' +
      DM_URL +
      '" target="_blank" rel="noopener">' +
      '<span>escribime por DM</span><span class="arrow">→</span></a>' +
      '<div class="cta-secondary">@soyparcher</div>' +
      '</div></section>';

    root.innerHTML =
      heroHtml + sourceBlockHtml + parcheHtml + dondeHtml + detailsHtml + ctaFinalHtml;

    if (data.title) {
      document.title = data.title + ' · parcher';
    }
  }

  // 1. Inline payload embedded by the prerender (<script id="ev-payload">).
  //    Avoids the first-paint network round trip when the HTML was prerendered.
  function readInlinePayload() {
    var node = document.getElementById('ev-payload');
    if (!node || !node.textContent) return null;
    try {
      var parsed = JSON.parse(node.textContent);
      return parsed && parsed.id ? parsed : null;
    } catch (e) {
      console.warn('ev-payload JSON parse failed', e);
      return null;
    }
  }

  function renderFromData(data) {
    try {
      renderEvent(data);
    } catch (e) {
      console.error('renderEvent failed', e);
      renderError('error');
    }
  }

  // 2. Static prerendered JSON (same origin, CloudFront-cached).
  // 3. Lambda fallback for missing prerender or direct /event.html visits.
  function fetchEvent(id) {
    var staticUrl = '/api/v1/events/' + encodeURIComponent(id) + '.json';
    var lambdaUrl = API_BASE + '/api/public/events/' + encodeURIComponent(id);

    var tryUrl = function (url) {
      return fetch(url, { headers: { Accept: 'application/json' } }).then(function (resp) {
        if (!resp.ok) {
          var err = new Error('http ' + resp.status);
          err.status = resp.status;
          throw err;
        }
        return resp.json();
      });
    };

    return tryUrl(staticUrl).catch(function (err) {
      // Static JSON missing (event not prerendered yet) → try Lambda.
      // CustomErrorResponse may have served HTML with 200 on a 404; if the
      // body wasn't valid JSON, the .json() call rejects and lands here too.
      if (!API_BASE) {
        throw err;
      }
      return tryUrl(lambdaUrl);
    });
  }

  function load() {
    var id = extractIdFromPath();
    if (!id || !UUID_RE.test(id)) {
      renderError('404');
      return;
    }

    var inline = readInlinePayload();
    if (inline) {
      renderFromData(inline);
      return;
    }

    fetchEvent(id)
      .then(function (data) {
        if (!data) {
          renderError('error');
          return;
        }
        renderFromData(data);
      })
      .catch(function (err) {
        if (err && err.status === 404) {
          renderError('404');
        } else {
          console.error('fetch failed', err);
          renderError('error');
        }
      });
  }

  load();
})();
