/* FARO — demo estática: búsqueda, filtros y paginación en el navegador.
   Sin recursos externos: solo datos locales (static/sites.json). */
(function () {
  'use strict';

  var SITES = null;

  function norm(s) {
    return (s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  }

  function timeago(iso) {
    if (!iso) return 'nunca';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return 'nunca';
    var s = Math.floor((Date.now() - d.getTime()) / 1000);
    if (s < 0) s = 0;
    if (s < 60) return 'hace instantes';
    if (s < 3600) return 'hace ' + Math.floor(s / 60) + ' min';
    if (s < 86400) return 'hace ' + Math.floor(s / 3600) + ' h';
    return 'hace ' + Math.floor(s / 86400) + ' d';
  }

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  }

  function card(r) {
    var a = el('a', 'result');
    a.href = '/sitio/' + r.domain + '/';
    a.appendChild(el('h3', null, r.title || r.domain));
    a.appendChild(el('div', 'url', r.domain));
    if (r.description) a.appendChild(el('p', 'desc', r.description));
    var meta = el('div', 'meta');
    var badge = el('span', 'badge ' + (r.online ? 'online' : 'offline'));
    badge.appendChild(el('span', r.online ? 'dot-up' : 'dot-down'));
    badge.appendChild(document.createTextNode(r.online ? 'en línea' : 'caído'));
    meta.appendChild(badge);
    if (r.category) meta.appendChild(el('span', 'badge cat', r.category));
    if (r.is_mirror) meta.appendChild(el('span', 'badge mirror', 'espejo'));
    var up = el('span');
    var uptime = el('span', 'uptime');
    var bar = el('span', 'uptime-bar');
    var fill = el('span');
    var pct = Math.round((r.uptime_ratio || 0) * 100);
    fill.style.width = pct + '%';
    bar.appendChild(fill);
    uptime.appendChild(bar);
    uptime.appendChild(document.createTextNode(pct + '%'));
    up.appendChild(uptime);
    meta.appendChild(up);
    if (r.avg_response_time) meta.appendChild(el('span', null, r.avg_response_time.toFixed(2) + ' s'));
    meta.appendChild(el('span', null, 'verificado ' + timeago(r.last_checked)));
    a.appendChild(meta);
    return a;
  }

  function emptyBlock(msg) {
    var d = el('div', 'empty');
    d.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5" stroke-linecap="round"/></svg>';
    d.appendChild(el('h3', null, 'Sin señal para esa búsqueda'));
    var p = el('p');
    p.appendChild(document.createTextNode(msg || 'Probá con menos palabras o revisá el '));
    var a = el('a', null, 'directorio');
    a.href = '/directorio/';
    p.appendChild(a);
    p.appendChild(document.createTextNode('.'));
    d.appendChild(p);
    return d;
  }

  function loadSites(cb) {
    if (SITES) return cb(SITES);
    fetch('/static/sites.json')
      .then(function (r) { return r.json(); })
      .then(function (list) { SITES = list; cb(list); })
      .catch(function () { cb([]); });
  }

  function toast(msg) {
    var t = el('div');
    t.setAttribute('role', 'status');
    t.style.cssText = 'position:fixed;left:50%;bottom:22px;transform:translateX(-50%);z-index:99;' +
      'background:#241a08;color:#ffe6b0;border:1px solid rgba(255,196,92,.35);border-radius:10px;' +
      'padding:10px 16px;font-size:.9rem;box-shadow:0 8px 30px rgba(0,0,0,.45);max-width:90vw';
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(function () { t.remove(); }, 4200);
  }

  /* ---------- /search : resultados en el navegador ---------- */
  function runSearch() {
    var form = document.getElementById('filtros');
    if (!form) return;
    var params = new URLSearchParams(location.search);
    var q = (params.get('q') || '').trim();
    var category = params.get('category') || '';
    var status = params.get('status') || 'todos';
    var sort = params.get('sort') || 'relevancia';
    var page = Math.max(1, parseInt(params.get('page') || '1', 10) || 1);
    var PER = 10;

    loadSites(function (sites) {
      var started = performance.now();
      var nq = norm(q);
      var hits = sites.filter(function (r) {
        if (category && (r.category || '') !== category) return false;
        if (status === 'online' && !r.online) return false;
        if (status === 'offline' && r.online) return false;
        if (!nq) return true;
        var hay = norm(r.title) + ' ' + norm(r.description) + ' ' + norm(r.domain) + ' ' + norm(r.category);
        return nq.split(/\s+/).every(function (tok) { return hay.indexOf(tok) !== -1; });
      });

      if (sort === 'uptime') {
        hits.sort(function (a, b) { return (b.uptime_ratio || 0) - (a.uptime_ratio || 0); });
      } else if (sort === 'latencia') {
        hits.sort(function (a, b) {
          var x = a.avg_response_time, y = b.avg_response_time;
          return (x == null ? 9e9 : x) - (y == null ? 9e9 : y);
        });
      } else if (sort === 'reciente') {
        hits.sort(function (a, b) { return new Date(b.last_checked || 0) - new Date(a.last_checked || 0); });
      } else {
        hits.sort(function (a, b) {
          var ta = norm(a.title), tb = norm(b.title);
          var pa = nq && ta.indexOf(nq) === 0, pb = nq && tb.indexOf(nq) === 0;
          if (pa !== pb) return pa ? -1 : 1;
          if (a.online !== b.online) return a.online ? -1 : 1;
          return (b.uptime_ratio || 0) - (a.uptime_ratio || 0);
        });
      }

      var total = hits.length;
      var pages = Math.max(1, Math.ceil(total / PER));
      if (page > pages) page = pages;
      var slice = hits.slice((page - 1) * PER, page * PER);
      var elapsed = Math.max(1, Math.round(performance.now() - started));

      // titular y contador
      var h1 = document.querySelector('.crumbs') && document.querySelector('.crumbs').parentElement.querySelector('h1');
      if (h1) h1.textContent = q ? '«' + q + '»' : 'Todo el índice';
      var counter = h1 && h1.parentElement.querySelector('p.small');
      if (counter) {
        counter.textContent = total + ' resultado' + (total === 1 ? '' : 's') +
          ' · motor local (demo) · ' + elapsed + ' ms';
      }

      // reemplazar resultados / pager / vacío
      var container = form.parentElement;
      var old = container.querySelectorAll('.result-list, .empty, .pager');
      for (var i = 0; i < old.length; i++) old[i].remove();

      if (!slice.length) {
        container.appendChild(emptyBlock());
        return;
      }
      var list = el('div', 'result-list');
      slice.forEach(function (r) { list.appendChild(card(r)); });
      container.appendChild(list);

      if (pages > 1) {
        var pager = el('nav', 'pager');
        function qs(p) {
          var s = new URLSearchParams();
          if (q) s.set('q', q);
          if (category) s.set('category', category);
          s.set('status', status);
          s.set('sort', sort);
          s.set('page', String(p));
          return '/search?' + s.toString();
        }
        if (page > 1) {
          var prev = el('a', null, '← Anterior'); prev.href = qs(page - 1); pager.appendChild(prev);
        } else {
          pager.appendChild(el('span', 'disabled', '← Anterior'));
        }
        pager.appendChild(el('span', 'current', 'página ' + page + ' de ' + pages));
        if (page < pages) {
          var next = el('a', null, 'Siguiente →'); next.href = qs(page + 1); pager.appendChild(next);
        } else {
          pager.appendChild(el('span', 'disabled', 'Siguiente →'));
        }
        container.appendChild(pager);
      }
    });
  }

  /* ---------- /directorio : filtro por categoría ---------- */
  function runDirectorio() {
    if (!/^\/directorio\/?$/.test(location.pathname)) return;
    var category = new URLSearchParams(location.search).get('category') || '';
    var chips = document.querySelectorAll('.filters .chip');
    if (!chips.length) return;
    var found = !category;
    document.querySelectorAll('main section.section').forEach(function (sec) {
      var h2 = sec.querySelector('h2');
      var match = !category || (h2 && h2.textContent.trim() === category);
      sec.style.display = match ? '' : 'none';
      if (match && category) found = true;
    });
    chips.forEach(function (chip) {
      var href = chip.getAttribute('href') || '';
      var active = category ? href === '/directorio?category=' + encodeURIComponent(category) : href === '/directorio';
      chip.classList.toggle('active', active);
    });
    if (!found) toast('No hay nodos en «' + category + '» en esta demo.');
  }

  /* ---------- formularios y enlaces que necesitan servidor ---------- */
  function guardServerOnly() {
    document.querySelectorAll('a[href^="/admin"]').forEach(function (a) {
      a.addEventListener('click', function (e) {
        e.preventDefault();
        toast('El centro de mando necesita el portal real (Docker / Fly.io).');
      });
    });
    document.querySelectorAll('form').forEach(function (f) {
      var action = f.getAttribute('action') || '';
      if (action === '/search') return; // la búsqueda sí funciona
      f.addEventListener('submit', function (e) {
        e.preventDefault();
        toast('Este formulario necesita el portal real (Docker / Fly.io).');
      });
    });
  }

  document.addEventListener('DOMContentLoaded', function () {
    runSearch();
    runDirectorio();
    guardServerOnly();
  });
})();
