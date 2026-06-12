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

  function formatDateRangeCompact(startsAt, isAllDay) {
    // Variante ultra-compacta pa' la lente "Cuándo" · puerto del arquetipo A
    // del publisher (brand-tokens.ts fmtEventDate). Formato:
    //   "vie 26/6 8pm"        ← con hora explícita
    //   "vie 26/6 7:30pm"     ← con minutos != 00
    //   "vie 26/6"            ← all-day o hora TBD
    // En vez del antiguo "vie 5 sept · 7:00 pm" (~19 chars · 2-3 renglones
    // en la lente compacta), este formato da ~12 chars · 1 renglón.
    // TZ: America/Bogota — los eventos de Cali se interpretan localmente.
    if (!startsAt) return '';
    var d = new Date(startsAt);
    if (isNaN(d.getTime())) return '';
    var parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Bogota',
      weekday: 'short',
      day: '2-digit',
      month: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    }).formatToParts(d);
    function get(t) {
      for (var i = 0; i < parts.length; i++) if (parts[i].type === t) return parts[i].value;
      return '';
    }
    var WD = { sun:'dom', mon:'lun', tue:'mar', wed:'mié', thu:'jue', fri:'vie', sat:'sáb' };
    var wd = WD[get('weekday').toLowerCase()] || get('weekday').toLowerCase();
    var dd = String(parseInt(get('day'), 10)); // sin zero-pad pa' look natural
    var m = get('month');
    var dateStr = wd + ' ' + dd + '/' + m;
    if (isAllDay) return dateStr;
    // hora TBD = 00:00:00 UTC (convención backend) → omitir tiempo
    var isTimeTBD =
      d.getUTCHours() === 0 && d.getUTCMinutes() === 0 && d.getUTCSeconds() === 0;
    if (isTimeTBD) return dateStr;
    var h = get('hour');
    var min = get('minute');
    var period = (get('dayPeriod') || '').toLowerCase();
    // Hora fantasma: 12:00am es default cuando el backend no tiene hora real.
    // Si no hay señal de confianza · ocultamos la hora pa' no mostrar mentira.
    if (min === '00' && h === '12' && period === 'am') return dateStr;
    var time = min === '00' ? h + period : h + ':' + min + period;
    return dateStr + ' ' + time;
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
    // Dedupe case-insensitive · "teatro" + "Teatro" colapsan a uno solo
    // (Menor E del handoff Iris · defensive en render mientras se limpia
    // a nivel ingest).
    var seen = Object.create(null);
    return arr
      .filter(function (v) {
        if (v === null || v === undefined) return false;
        var s = String(v).trim();
        if (!s) return false;
        var k = s.toLowerCase();
        if (seen[k]) return false;
        seen[k] = true;
        return true;
      })
      .map(function (v) {
        return chip(String(v).trim(), tone);
      })
      .join('');
  }

  // Title-case defensive · venues como "TEATRO SALAMANDRA" → "Teatro Salamandra".
  // Hallazgo D del handoff Iris · activa solo si el string entero está en MAYÚSCULAS.
  function titleCaseDefensive(s) {
    if (!s) return '';
    var str = String(s).trim();
    if (!str) return '';
    if (str !== str.toUpperCase()) return str;
    var SMALL = { de:1, del:1, y:1, la:1, el:1, las:1, los:1, en:1, al:1, a:1, con:1 };
    return str.toLowerCase().split(/(\s+)/).map(function (part, i) {
      if (!/\S/.test(part)) return part;
      if (i > 0 && SMALL[part]) return part;
      return part.charAt(0).toUpperCase() + part.slice(1);
    }).join('');
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
    // Chip "rango del lugar" en la sección Dónde · referido al LUGAR, no al evento.
    // Símbolo $/$$$/$$$ desde el map único de 3 niveles.
    var info = priceLevelInfo(level);
    if (!info) return '';
    return chip('rango del lugar: ' + info.symbol, 'price');
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

  // ── Escala única de precio (3 niveles) ─────────────────────────────────
  // Vocab canónico: economico | medio | alto (matchea venue_profiles.price_level
  // del backend). Symbol $/$$$/$$$ y label se derivan de este mismo map en los
  // dos render paths del detail: la lente "Cuánto" del hero (ADR 013) y la
  // chip "rango del lugar" en la sección Dónde.
  //
  // Nota cross-vocab: la SSOT catalog.json define lenses.budget con valores
  // free|low_cost|premium · esos son los buckets de FILTRO (catalog-facing).
  // Para el render de un evento puntual la fuente real es venue.price_level
  // o el price_from/to explícito; los buckets del lens son agregadores, no
  // mapping 1-a-1 con el venue. Si Iris quiere unificar el catálogo a
  // economico|medio|alto, es cambio en marca_parcher/tokens.json + ADR.
  // Mientras tanto, el bridge vive acá.
  var PRICE_LEVEL_MAP = {
    economico:  { label: 'Económico', symbol: '$'   },
    'económico':{ label: 'Económico', symbol: '$'   },
    medio:      { label: 'Medio',     symbol: '$$'  },
    alto:       { label: 'Alto',      symbol: '$$$' },
  };
  function priceLevelInfo(level) {
    if (!level) return null;
    return PRICE_LEVEL_MAP[String(level).toLowerCase()] || null;
  }

  function formatLensWhere(data) {
    var vp = data.venue_profile || {};
    var zone = vp.zone || '';
    var city = data.city || vp.city || '';
    if (zone) {
      var zoneLabel = zone.charAt(0).toUpperCase() + zone.slice(1).toLowerCase();
      // "Sur de Cali" / "Norte de Cali" — más natural que "Sur · Cali".
      return city ? zoneLabel + ' de ' + city : zoneLabel;
    }
    return city || 'por confirmar';
  }

  function formatLensBudget(data) {
    // Lente "Cuánto" del hero (ADR 013) · resuelve en este orden:
    //   1. precio explícito del evento (gratis, rango, "desde X")
    //   2. price_level del venue como fallback → label + symbol del map único
    //   3. "Consultar" si no hay nada
    var t = data.event_ticketing || {};
    var f = (data.price_from != null) ? data.price_from : t.price_from;
    var to = (data.price_to != null) ? data.price_to : t.price_to;
    var cur = data.currency || t.currency || 'COP';
    if (f === 0 || t.ticketing_type === 'free') return 'Gratis';
    if (f && to && Number(f) !== Number(to)) return formatPrice(f, to, cur);
    if (f) return formatPrice(f, null, cur);
    var vp = data.venue_profile || {};
    var info = priceLevelInfo(vp.price_level);
    if (info) return info.label + ' · ' + info.symbol;
    return 'Consultar';
  }

  function splitFirstWord(text) {
    // Para acento editorial §6.3 en la descripción: italic --marca en
    // la primera palabra, resto en regular.
    var s = String(text || '').trim();
    if (!s) return { first: '', rest: '' };
    var m = /^(\S+)(\s+)([\s\S]*)$/.exec(s);
    if (!m) return { first: s, rest: '' };
    return { first: m[1], rest: m[3] };
  }

  // Mapping de ocasiones (Set F · ADR 013) · key → label + color token + fg + slug.
  // SSOT: catalog.json $.ocasiones_canonicas + catalog.css aliases --ocasion-*.
  // El slug es para el href hacia category pages (`/cali/<slug>`) · keys ADR 011/012.
  var OCASION_MAP = {
    live_shows:   { label: 'Ver en vivo',         token: 'live-shows',   fg: 'crema', slug: 'ver-en-vivo' },
    with_friends: { label: 'Con el parche',       token: 'with-friends', fg: 'tinta', slug: 'con-el-parche' },
    with_family:  { label: 'Plan en familia',     token: 'with-family',  fg: 'tinta', slug: 'plan-en-familia' },
    with_partner: { label: 'Con la pareja',       token: 'with-partner', fg: 'tinta', slug: 'con-la-pareja' },
    explore_city: { label: 'Descubrir la ciudad', token: 'explore-city', fg: 'crema', slug: 'descubrir-la-ciudad' },
    learn_create: { label: 'Aprender y crear',    token: 'learn-create', fg: 'crema', slug: 'aprender-y-crear' },
    recharge:     { label: 'Recargar',            token: 'recharge',     fg: 'tinta', slug: 'recargar' },
    meet_people:  { label: 'Conocer gente',       token: 'meet-people',  fg: 'crema', slug: 'conocer-gente' },
  };

  // Cities con category pages generadas · MVP: Cali only.
  // Si crece, exponer flag desde backend o derivar del payload.
  var CATEGORY_CITIES = { cali: 'cali' }; // city lowercased → city slug

  function buildOccasionChips(data) {
    var arr = Array.isArray(data.occasions) ? data.occasions : [];
    if (!arr.length) return '';
    var city = String((data && data.city) || (data && data.venue_profile && data.venue_profile.city) || '').toLowerCase();
    var citySlug = CATEGORY_CITIES[city] || '';
    var chips = arr.map(function (key) {
      var k = String(key).toLowerCase();
      var info = OCASION_MAP[k];
      if (!info) return '';
      var style = '--c: var(--ocasion-' + info.token + '); --ct: var(--' + info.fg + ');';
      // Si hay city con categorías → link a /cali/<slug>; sino span fallback.
      if (citySlug) {
        return (
          '<a class="ev-occasion-chip ev-occasion-chip-link" href="/' + citySlug + '/' + info.slug +
          '" style="' + style + '" data-track="click_occasion_chip" data-track-ocasion-key="' + escapeHtml(k) + '">' +
          escapeHtml(info.label) + '</a>'
        );
      }
      return '<span class="ev-occasion-chip" style="' + style + '">' + escapeHtml(info.label) + '</span>';
    }).filter(function (s) { return s; }).join('');
    if (!chips) return '';
    return '<div class="ev-occasions" aria-label="ocasiones del evento">' + chips + '</div>';
  }

  function pickHeroDescription(data, enr, descs) {
    // Hero usa la versión más larga disponible · pull-down ordenado:
    // description_extended → description_enriched → long → medium → short → short_summary.
    return (
      enr.description_extended ||
      enr.description_enriched ||
      descs.long ||
      descs.medium ||
      descs.short ||
      data.short_summary ||
      ''
    );
  }

  function formatRoleLabel(role) {
    if (!role) return '';
    return String(role).replace(/_/g, ' ').toLowerCase().trim();
  }

  function formatScheduledTime(t) {
    if (!t) return '';
    var d = new Date(t);
    if (!isNaN(d.getTime())) {
      return d.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' });
    }
    // fallback: "HH:MM" puro (sin fecha) → AM/PM
    var m = /^(\d{1,2}):(\d{2})/.exec(String(t));
    if (!m) return '';
    var hour = parseInt(m[1], 10);
    var minute = parseInt(m[2], 10);
    if (isNaN(hour) || isNaN(minute)) return '';
    var period = hour >= 12 ? 'pm' : 'am';
    var h12 = hour % 12 || 12;
    return h12 + ':' + (minute < 10 ? '0' + minute : minute) + ' ' + period;
  }

  function buildArtistList(data) {
    // El backend manda lineup como array de {artist, role, scheduled_time, ...}
    // y a veces primary_artist como CSV con TODOS los nombres del array.
    // Construimos una lista deduplicada preservando orden del array + role,
    // marcando isHeadliner=true cuando el nombre aparece en primary_artist.
    var lineupArr = Array.isArray(data.lineup) ? data.lineup : [];
    var primaryRaw = data.primary_artist ? String(data.primary_artist) : '';
    var primaryNames = primaryRaw
      ? primaryRaw.split(/,\s*/).map(function (s) { return s.trim(); }).filter(Boolean)
      : [];
    var primarySet = Object.create(null);
    primaryNames.forEach(function (n) { primarySet[n.toLowerCase()] = true; });

    var seen = Object.create(null);
    var artists = [];

    lineupArr.forEach(function (a) {
      if (!a) return;
      var name = (typeof a === 'string') ? a : a.artist;
      if (!name) return;
      name = String(name).trim();
      var key = name.toLowerCase();
      if (seen[key]) return;
      seen[key] = true;
      artists.push({
        name: name,
        role: (typeof a === 'object' && a.role) ? a.role : '',
        time: (typeof a === 'object' && a.scheduled_time) ? a.scheduled_time : '',
        isHeadliner: !!primarySet[key],
      });
    });

    // Nombres que vinieron sólo en primary_artist (no en lineupArr): siempre headliners.
    primaryNames.forEach(function (name) {
      var key = name.toLowerCase();
      if (seen[key]) return;
      seen[key] = true;
      artists.push({ name: name, role: '', time: '', isHeadliner: true });
    });

    return artists;
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
      '" target="_blank" rel="noopener"' +
      ' data-track="click_dm_cta"' +
      ' data-track-surface="event_detail_error_' + kind + '">' +
      '<span>escribime por DM</span><span class="arrow">→</span></a>' +
      '<div class="cta-secondary">@soyparcher</div>' +
      '</div></section>';
    if (typeof window.parcherTrack === 'function') {
      window.parcherTrack('event_detail_error', { kind: kind });
    }
  }

  function renderEvent(data) {
    var cover = pickCoverUrl(data);
    var primarySource = pickPrimarySource(data.event_sources);
    var vp = data.venue_profile || {};
    // titleCaseDefensive corrige venues como "TEATRO SALAMANDRA" → "Teatro Salamandra".
    var venueName = titleCaseDefensive(data.place_name || vp.canonical_name || '');
    var venueCity = titleCaseDefensive(data.city || vp.city || '');
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
    // Composición (top → bottom):
    //   1. lentes ADR 013 (Cuándo / Dónde / Cuánto) — visibilidad en parte superior
    //   2. cover image
    //   3. fuente mini · texto bajo contraste justo debajo de la imagen
    //   4. título
    //   5. meta row (date · venue clickable · city)
    //   6. descripción larga · primera palabra italic --marca
    //   7. disclaimer corto
    // Esto reemplaza la composición vieja (meta+disclaimer pegados al título)
    // que dejaba la descripción "perdida abajo" en el bloque "detalles".

    // 1 · Lentes (Cuándo/Dónde/Cuánto · ADR 013 · catalog.lenses.{when,where,budget}_labels.co)
    //     formatDateRangeCompact → "vie 5 sept · 7:00 pm" (no full "sábado")
    var whenCompact = formatDateRangeCompact(data.starts_at, data.is_all_day) || 'por confirmar';
    var lentesHtml =
      '<div class="ev-lentes" role="group" aria-label="lentes del evento">' +
        '<div class="ev-lens-chip ev-lens-when">' +
          '<span class="ev-lens-label">Cuándo</span>' +
          '<span class="ev-lens-value">' +
          escapeHtml(whenCompact) +
          '</span>' +
        '</div>' +
        '<div class="ev-lens-chip ev-lens-where">' +
          '<span class="ev-lens-label">Dónde</span>' +
          '<span class="ev-lens-value">' +
          escapeHtml(formatLensWhere(data)) +
          '</span>' +
        '</div>' +
        '<div class="ev-lens-chip ev-lens-budget">' +
          '<span class="ev-lens-label">Cuánto</span>' +
          '<span class="ev-lens-value">' +
          escapeHtml(formatLensBudget(data)) +
          '</span>' +
        '</div>' +
      '</div>';

    // 3 · Fuente mini (low-contrast just below image)
    var sourceMiniHtml = '';
    if (primarySource && primarySource.source_url) {
      var sourceMiniLabel = primarySource.instagram_handle
        ? 'info de @' + primarySource.instagram_handle + ' en Instagram'
        : 'info del post original';
      sourceMiniHtml =
        '<a class="ev-source-mini" href="' +
        escapeHtml(primarySource.source_url) +
        '" target="_blank" rel="noopener"' +
        ' data-track="click_source_post"' +
        ' data-track-event-id="' + escapeHtml(data.id || '') + '"' +
        ' data-track-handle="' + escapeHtml(primarySource.instagram_handle || '') + '">' +
        escapeHtml(sourceMiniLabel) +
        ' <span aria-hidden="true">↗</span></a>';
    }

    // 5 · Venue chip (Maps link reusado)
    var placeChipHtml = '';
    if (venueName) {
      if (mapsUrl) {
        placeChipHtml =
          '<a class="ev-chip ev-chip-place ev-chip-link" href="' +
          escapeHtml(mapsUrl) +
          '" target="_blank" rel="noopener" aria-label="ver ' +
          escapeHtml(venueName) +
          ' en Google Maps" data-track="click_venue_maps" data-track-event-id="' +
          escapeHtml(data.id || '') +
          '" data-track-venue="' + escapeHtml(venueName) + '">' +
          escapeHtml(venueName) +
          ' <span class="ev-chip-arrow" aria-hidden="true">↗</span></a>';
      } else {
        placeChipHtml = chip(venueName, 'place');
      }
    }

    // 6 · Lineup (si existe) · va ENCIMA de la descripción
    //     porque para multi-speaker / festival / concierto, el lineup ES la
    //     razón por la que vas. La descripción elabora después.
    var heroArtists = buildArtistList(data);
    var heroLineupHtml = '';
    if (heroArtists.length) {
      var heroCardsHtml = heroArtists.map(function (a) {
        var roleLabel = formatRoleLabel(a.role);
        var timeLabel = formatScheduledTime(a.time);
        var cls = 'ev-lineup-card' + (a.isHeadliner ? ' is-headliner' : '');
        return (
          '<li class="' + cls + '">' +
            (roleLabel ? '<span class="ev-lineup-role">' + escapeHtml(roleLabel) + '</span>' : '') +
            '<span class="ev-lineup-name">' + escapeHtml(a.name) + '</span>' +
            (timeLabel ? '<span class="ev-lineup-time">' + escapeHtml(timeLabel) + '</span>' : '') +
          '</li>'
        );
      }).join('');
      heroLineupHtml =
        '<div class="ev-lineup">' +
          '<p class="ev-lineup-title">lineup</p>' +
          '<ul class="ev-lineup-list">' + heroCardsHtml + '</ul>' +
        '</div>';
    }

    // 7 · Descripción larga con acento §6.3 (primera palabra italic --marca)
    var heroDescRaw = pickHeroDescription(data, enr, descs);
    var heroDescHtml = '';
    if (heroDescRaw) {
      var parts = splitFirstWord(heroDescRaw);
      heroDescHtml =
        '<p class="ev-description">' +
        '<span class="ev-description-accent">' + escapeHtml(parts.first) + '</span>' +
        (parts.rest ? ' ' + escapeHtml(parts.rest) : '') +
        '</p>';
    }

    // 7 · Disclaimer
    var disclaimerHtml =
      '<p class="ev-disclaimer-top">' +
      'info armada por parcher usando IA — confirmá en la fuente si dudás.' +
      '</p>';

    // 8 · Actions row · subido al hero pa' que las acciones queden arriba,
    //     no enterradas debajo del lineup. Iconos SVG inline:
    //     - WhatsApp: bubble + acento del logo (recognizable a 16px).
    //     - Calendar: outline minimal (head + body + month line).
    //     - Entradas: cta-primary con --marca, sin icono (el botón ya es el call).
    var WA_ICON =
      '<svg class="ev-action-svg" viewBox="0 0 24 24" width="16" height="16" ' +
      'fill="currentColor" aria-hidden="true">' +
      '<path d="M12 2C6.48 2 2 6.48 2 12c0 1.77.46 3.45 1.32 4.95L2 22l5.25-1.31' +
      'C8.65 21.53 10.27 22 12 22c5.52 0 10-4.48 10-10S17.52 2 12 2zm5.07 14.18' +
      'c-.21.59-1.23 1.13-1.7 1.2-.43.07-.99.1-1.6-.1-.37-.12-.84-.27-1.45-.53' +
      '-2.55-1.1-4.21-3.67-4.33-3.85-.13-.17-1.04-1.38-1.04-2.63 0-1.25.66-1.87' +
      '.89-2.12.23-.25.5-.32.67-.32.17 0 .33.01.48.01.15 0 .35-.06.55.42.21.5' +
      '.69 1.74.75 1.87.06.13.1.27.02.45-.08.17-.13.27-.25.42-.13.15-.27.34-.38' +
      '.45-.13.13-.26.27-.11.53.15.27.66 1.09 1.42 1.77.98.87 1.8 1.14 2.07 1.27' +
      '.27.13.43.11.59-.07.16-.18.68-.79.86-1.07.18-.27.36-.23.6-.13.25.1 1.55' +
      '.73 1.82.86.27.13.45.2.51.31.07.11.07.65-.14 1.24z"/></svg>';
    var CAL_ICON =
      '<svg class="ev-action-svg" viewBox="0 0 24 24" width="16" height="16" ' +
      'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" ' +
      'stroke-linejoin="round" aria-hidden="true">' +
      '<rect x="3" y="4" width="18" height="18" rx="2"/>' +
      '<line x1="16" y1="2" x2="16" y2="6"/>' +
      '<line x1="8" y1="2" x2="8" y2="6"/>' +
      '<line x1="3" y1="10" x2="21" y2="10"/></svg>';

    var heroCtas = [];
    // Contacto WhatsApp del organizador · botón verde con icono · va PRIMERO
    // (antes de entradas si hay) para que el usuario pueda contactar
    // directamente al organizador sin pasar por ticketing intermediario.
    // El número viene de ticketing.whatsapp · phone como fallback.
    var heroWaDigits = ticketing.whatsapp
      ? String(ticketing.whatsapp).replace(/\D/g, '')
      : (ticketing.phone ? String(ticketing.phone).replace(/\D/g, '') : '');
    if (heroWaDigits) {
      heroCtas.push(
        '<a class="ev-action ev-action-whatsapp ev-action-contact" href="https://wa.me/' +
          escapeHtml(heroWaDigits) +
          '" target="_blank" rel="noopener"' +
          ' aria-label="abrir WhatsApp con el organizador"' +
          ' data-track="click_whatsapp_contact"' +
          ' data-track-event-id="' + escapeHtml(data.id || '') + '"' +
          ' data-track-surface="hero">' +
          WA_ICON +
          '<span>WhatsApp</span></a>'
      );
    }
    if (ticketing.ticketing_url) {
      var availHtmlHero = availabilityBadge(ticketing.availability_status);
      heroCtas.push(
        '<a class="cta-primary" href="' +
          escapeHtml(ticketing.ticketing_url) +
          '" target="_blank" rel="noopener"' +
          ' data-track="click_get_tickets"' +
          ' data-track-event-id="' + escapeHtml(data.id || '') + '"' +
          ' data-track-provider="' + escapeHtml(ticketing.ticketing_provider || '') + '">' +
          '<span>conseguir entradas</span><span class="arrow">→</span></a>' +
          (availHtmlHero ? availHtmlHero : '')
      );
    }
    var calHrefHero = calendarHref(data);
    if (calHrefHero) {
      heroCtas.push(
        '<a class="ev-action" href="' +
          escapeHtml(calHrefHero) +
          '" target="_blank" rel="noopener" aria-label="agregar al calendario"' +
          ' data-track="click_calendar"' +
          ' data-track-event-id="' + escapeHtml(data.id || '') + '">' +
          CAL_ICON +
          '<span>agregar al calendario</span></a>'
      );
    }
    heroCtas.push(
      '<a class="ev-action ev-action-whatsapp" href="' +
        escapeHtml(whatsappShareHref(data)) +
        '" target="_blank" rel="noopener" aria-label="compartir por WhatsApp"' +
        ' data-track="click_whatsapp_share"' +
        ' data-track-event-id="' + escapeHtml(data.id || '') + '">' +
        WA_ICON +
        '<span>compartir</span></a>'
    );
    var heroCtasHtml =
      heroCtas.length
        ? '<div class="ev-actions-row ev-actions-row-hero">' + heroCtas.join('') + '</div>'
        : '';

    // Opción A: 2-col grid en desktop · cover+source-mini izquierda, title+meta derecha.
    // Mobile stack normal (un solo column). Lentes arriba, lineup/descripción/disclaimer/
    // actions abajo full-width (no caben bien en la columna angosta o necesitan respirar).
    // Meta drop date chip: el lens "Cuándo" arriba ya lo cubre · evitamos redundancia.
    var coverHtmlInner = cover
      ? '<div class="ev-cover"><img src="' +
        escapeHtml(cover) + '" alt="" loading="eager" /></div>'
      : '';
    var heroPosterCol =
      '<div class="ev-hero-poster-col">' +
        coverHtmlInner +
        sourceMiniHtml +
      '</div>';
    var occasionChipsHtml = buildOccasionChips(data);
    var heroInfoCol =
      '<div class="ev-hero-info-col">' +
        '<h1 class="ev-title">' +
        escapeHtml(data.title || 'parche sin título') +
        '</h1>' +
        occasionChipsHtml +
        '<div class="ev-meta">' +
          placeChipHtml +
          (venueCity ? chip(venueCity, 'city') : '') +
        '</div>' +
      '</div>';
    // Layout: TODO el hero (lentes, poster, info, lineup, desc, disclaimer,
    // CTAs) vive dentro del ev-hero-top usando grid-template-areas.
    // Mobile sigue el HTML order natural (1 col), desktop reorganiza:
    //   ┌────────┬──────────────────────┐
    //   │        │ lentes               │
    //   │ poster │ title + meta         │
    //   │        │ CTAs                 │
    //   ├────────┴──────────────────────┤
    //   │ lineup (full-width)           │
    //   │ descripción (full-width)      │
    //   │ disclaimer (full-width)       │
    //   └───────────────────────────────┘
    // Una sola copia del HTML, reposicionamiento 100% CSS.
    var heroHtml =
      '<section class="ev-hero">' +
      '<div class="container">' +
      '<div class="ev-hero-top">' +
        '<div class="ev-hero-lentes-area">' + lentesHtml + '</div>' +
        heroPosterCol +
        heroInfoCol +
        heroLineupHtml +
        heroDescHtml +
        disclaimerHtml +
        heroCtasHtml +
      '</div>' +
      '</div></section>';

    // ─── TAGS / CHIPS (footer del flow) ────────────────────
    // Lineup ya vive en el hero; el "parche section" entero desaparece.
    // Las chips de vibe/tags/audience/activity quedan acá como footprint
    // de discovery (SEO + referencia rápida), entre detalles y CTA final.
    var vibeChips = chipsFrom(data.vibe, 'vibe');
    var tagChips = chipsFrom(data.tags, 'tag');
    var audChips = chipsFrom(data.audience, 'aud');
    var actChips = chipsFrom(data.activity_type, 'tag');
    var tagsHtml = '';
    if (vibeChips || tagChips || audChips || actChips) {
      tagsHtml =
        '<section class="ev-tags">' +
        '<div class="container">' +
        '<p class="ev-tags-eyebrow">etiquetas</p>' +
        '<div class="ev-chiprow">' +
          vibeChips + actChips + tagChips + audChips +
        '</div>' +
        '</div></section>';
    }

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
      // Chips prácticos del lugar · sólo logística del venue.
      // sector_vibe + typical_audience del venue NO van acá: son chips estilo
      // "vibe/aud" que se confunden con las del evento arriba (data.vibe/audience).
      // El venue se distingue por sus datos logísticos: tipo, precio, transporte,
      // parqueo y seguridad. La cantera enriquecedora (sector_vibe/typical_audience)
      // queda en el payload pa' usos futuros (filtros, recomendaciones), pero no
      // entra al detail render porque duplica visualmente con el evento.
      var venueChips = '';
      venueChips += chipsFrom(vp.venue_type, 'venue');
      if (vp.is_outdoor) venueChips += chip('al aire libre', 'venue');
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
    // "el parche" y "más detalles" desaparecen acá: la versión más rica de la
    // descripción ya vive en el hero. Lo que queda son datos estructurados:
    // parent_event, subevents, enlaces, cómo entrar, contacto.
    var detailParts = [];
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
      // Contacto como botón verde de WhatsApp con icono · arranca chat de WA.
      // Phone se renderea como segundo botón sólo si es DIFERENTE al de WA
      // (dedupe contra dato cruzado del backend).
      var contactButtons = [];
      if (waDigits) {
        contactButtons.push(
          '<a class="ev-action ev-action-whatsapp ev-action-contact" href="https://wa.me/' +
          escapeHtml(waDigits) +
          '" target="_blank" rel="noopener" aria-label="abrir WhatsApp con ' +
          escapeHtml(ticketing.whatsapp) +
          '" data-track="click_whatsapp_contact"' +
          ' data-track-event-id="' + escapeHtml(data.id || '') + '">' +
          WA_ICON +
          '<span>WhatsApp · ' + escapeHtml(ticketing.whatsapp) + '</span></a>'
        );
      }
      if (phoneDigits && phoneDigits !== waDigits) {
        contactButtons.push(
          '<a class="ev-action ev-action-whatsapp ev-action-contact" href="https://wa.me/' +
          escapeHtml(phoneDigits) +
          '" target="_blank" rel="noopener" aria-label="abrir WhatsApp con ' +
          escapeHtml(ticketing.phone) +
          '" data-track="click_whatsapp_contact"' +
          ' data-track-event-id="' + escapeHtml(data.id || '') + '">' +
          WA_ICON +
          '<span>WhatsApp · ' + escapeHtml(ticketing.phone) + '</span></a>'
        );
      }
      detailParts.push(
        '<div class="ev-rich"><h3>contacto</h3>' +
        '<div class="ev-contact-buttons">' + contactButtons.join('') + '</div>' +
        '</div>'
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
      '<p class="ev-cta-eyebrow">hay más parches por descubrir</p>' +
      '<a class="cta-primary" href="' +
      DM_URL +
      '" target="_blank" rel="noopener"' +
      ' data-track="click_dm_cta"' +
      ' data-track-surface="event_detail_cta_final"' +
      ' data-track-event-id="' + escapeHtml(data.id || '') + '">' +
      '<span>escribime por DM</span><span class="arrow">→</span></a>' +
      '<div class="cta-secondary">@soyparcher</div>' +
      '</div></section>';

    // Orden: Hero (todo) → Dónde → Detalles → Tags (etiquetas footprint).
    // CTA final NO se renderea acá · vive estático en el prerender HTML
    // entre <aside class="ev-related-categories"> y <footer>, para que
    // related cards aparezcan ANTES del CTA DM (review Iris 2026-06-12).
    root.innerHTML =
      heroHtml + dondeHtml + detailsHtml + tagsHtml;

    if (data.title) {
      document.title = data.title + ' · parcher';
    }

    // GA4 · vista del detail con dimensiones útiles pa' cohortes.
    // window.parcherTrack es no-op si analytics.js no cargó (offline / blocker).
    if (typeof window.parcherTrack === 'function') {
      window.parcherTrack('view_event_detail', {
        event_id: data.id,
        city: data.city || (data.venue_profile && data.venue_profile.city) || '',
        activity_type: data.activity_type || '',
        has_lineup: heroArtists.length > 0 ? 'true' : 'false',
        has_tickets: ticketing.ticketing_url ? 'true' : 'false',
        is_paid: ticketing.ticketing_type === 'paid' ? 'true' : 'false',
      });
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
