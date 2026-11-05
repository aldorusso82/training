/* TRAIN.ALDO — app */
(function () {
  'use strict';

  var APP_VERSION = '1.13.0';
  var IMG_BASE = 'img/';
  var state = { program: null, plan: null, days: [], day: 0, variant: {} };

  var $ = function (id) { return document.getElementById(id); };

  // Atleta: ?atleta=nome nel link; poi resta ricordato sul dispositivo. Senza nome = Aldo.
  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  var ATHLETE = (function () {
    var m = location.search.match(/[?&]atleta=([a-z0-9-]+)/i);
    var id = m ? m[1].toLowerCase() : (lsGet('trainaldo-athlete') || 'aldo');
    if (m) lsSet('trainaldo-athlete', id);
    if (id === 'aldo') lsSet('trainaldo-coach', '1');
    return id;
  })();
  // Aldo mantiene le chiavi di sempre; gli altri atleti hanno uno spazio separato
  var NS = ATHLETE === 'aldo' ? 'trainaldo.' : 'trainaldo.@' + ATHLETE + '.';
  var store = {
    get: function (k, d) { try { var v = localStorage.getItem(NS + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
    set: function (k, v) { try { localStorage.setItem(NS + k, JSON.stringify(v)); } catch (e) {} }
  };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function fmtRest(sec) {
    if (sec >= 60 && sec % 60 === 0) return (sec / 60) + "'";
    return sec + "''";
  }
  function fmtClock(sec) {
    sec = Math.max(0, Math.ceil(sec));
    var m = Math.floor(sec / 60), s = sec % 60;
    return m + ':' + (s < 10 ? '0' : '') + s;
  }
  function kindOf(sec) {
    if (sec.kind) return sec.kind;
    var n = sec.items.length;
    return n === 1 ? 'Serie' : n === 2 ? 'Superset' : n === 3 ? 'Triset' : 'Circuito';
  }
  function isoDate(d) { return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }
  function photoSrc(ex, n) { return IMG_BASE + ex.img + '/' + n + '.jpg'; }
  function ytThumb(id) { return 'https://i.ytimg.com/vi/' + id + '/mqdefault.jpg'; }


  /* ---------- Cassaforte (file cifrati AES-GCM, chiave da passphrase) ---------- */
  // Formato file: 'BV1' + salt(16) + iv(12) + testo cifrato. La passphrase resta solo su questo telefono.
  var keyCache = {};
  function hex(u) { return Array.prototype.map.call(u, function (b) { return ('0' + b.toString(16)).slice(-2); }).join(''); }
  function vaultDecrypt(buf, pass) {
    var u = new Uint8Array(buf), salt = u.slice(3, 19), iv = u.slice(19, 31), ct = u.slice(31), ck = pass + hex(salt);
    var kp = keyCache[ck] || (keyCache[ck] = crypto.subtle.importKey('raw', new TextEncoder().encode(pass), 'PBKDF2', false, ['deriveKey'])
      .then(function (m) { return crypto.subtle.deriveKey({ name: 'PBKDF2', salt: salt, iterations: 600000, hash: 'SHA-256' }, m, { name: 'AES-GCM', length: 256 }, false, ['decrypt']); }));
    return kp.then(function (k) { return crypto.subtle.decrypt({ name: 'AES-GCM', iv: iv }, k, ct); });
  }
  function askPass(wrong, cancelable) {
    return new Promise(function (res, rej) {
      var o = document.createElement('div'); o.className = 'vault-ov';
      o.innerHTML = '<form class="vault-box"><b>Contenuto riservato</b><p>Inserisci la passphrase per aprirlo.</p>' +
        '<input type="password" id="vpw" autocomplete="off" autocapitalize="off" placeholder="Passphrase">' +
        (wrong ? '<p class="vault-err">Passphrase errata. Riprova.</p>' : '') +
        '<button class="btn-big btn-red" type="submit">Apri</button>' + (cancelable ? '<button class="btn-big" type="button" id="vno">Annulla</button>' : '') + '</form>';
      document.body.appendChild(o);
      var f = o.querySelector('form'), i = o.querySelector('#vpw'); i.focus();
      f.onsubmit = function (e) { e.preventDefault(); var v = i.value.trim(); if (!v) return; o.remove(); res(v); };
      if (cancelable) o.querySelector('#vno').onclick = function () { o.remove(); rej(new Error('annullato')); };
    });
  }
  function vaultFetch(url, mandatory) {
    return fetch(url).then(function (r) { if (!r.ok) throw new Error('non trovato'); return r.arrayBuffer(); }).then(function (buf) {
      function attempt(wrong) {
        var saved = wrong ? null : lsGet('trainaldo-vp');
        return (saved ? Promise.resolve(saved) : askPass(wrong, !mandatory)).then(function (pw) {
          return vaultDecrypt(buf, pw).then(function (out) { lsSet('trainaldo-vp', pw); return out; }, function () { lsSet('trainaldo-vp', ''); return attempt(true); });
        });
      }
      return attempt(false);
    });
  }
  function openVaultDoc(file, title) {
    vaultFetch(file, false).then(function (buf) {
      var url = URL.createObjectURL(new Blob([buf], { type: 'application/pdf' }));
      var o = document.createElement('div'); o.className = 'vault-view';
      o.innerHTML = '<div class="vault-bar"><b>' + esc(title) + '</b><a href="' + url + '" target="_blank" rel="noopener">Apri a schermo intero</a><button type="button">Chiudi</button></div><iframe src="' + url + '" title="' + esc(title) + '"></iframe>';
      o.querySelector('button').onclick = function () { o.remove(); URL.revokeObjectURL(url); };
      document.body.appendChild(o);
    }).catch(function () {});
  }

  /* ---------- Caricamento ---------- */
  fetch('data/program.json', { cache: 'no-cache' })
    .then(function (r) { return r.json(); })
    .then(function (p) {
      if (ATHLETE === 'aldo') return p;
      return fetch('data/athletes/' + ATHLETE + '.json', { cache: 'no-cache' })
        .then(function (r) {
          if (r.ok) return r.json();
          // profilo riservato: file cifrato, si apre con la passphrase
          return vaultFetch('data/athletes/' + ATHLETE + '.enc', true)
            .then(function (buf) { return JSON.parse(new TextDecoder().decode(buf)); })
            .catch(function () { throw new Error('atleta'); });
        })
        .then(function (a) {
          p.plans = a.plans;
          p.athleteName = a.name;
          if (a.theme) p.theme = a.theme;
          if (a.rehab) p.rehab = a.rehab;
          if (a.docs) p.docs = a.docs;
          if (a.exercises) for (var k in a.exercises) p.exercises[k] = a.exercises[k];
          if (a.yoga === false) delete p.yoga;
          if (a.cooldown === false) delete p.cooldowns;
          return p;
        });
    })
    .then(function (p) {
      (p.rehab || []).forEach(function (r) { if (r.days) p.plans.push({ id: 'rehab-' + r.id, name: 'Rehab · ' + r.title, kind: 'rehab', months: [], weeks: r.weeks || 0, days: r.days }); });
      state.program = p;
      document.title = 'TRAIN.BEYOND';
      $('athlete').textContent = p.athleteName || 'Aldo'; $('athlete').hidden = false;
      var mt = document.querySelector('meta[name="apple-mobile-web-app-title"]'); if (mt) mt.content = 'TRAIN.BEYOND';
      if (p.theme) {   // tema colori del profilo (es. Fisio Hub): {primary, dark, soft}
        var rs = document.documentElement.style;
        if (p.theme.primary) { rs.setProperty('--red', p.theme.primary); var tc = document.querySelector('meta[name="theme-color"]'); if (tc) tc.content = p.theme.primary; }
        if (p.theme.dark) rs.setProperty('--red-dark', p.theme.dark);
        if (p.theme.soft) rs.setProperty('--red-soft', p.theme.soft);
      }
      state.variant = store.get('variant', {});
      $('version').textContent = 'v' + APP_VERSION + ' · schede aggiornate al ' + (p.updated || '—');
      selectPlan(pickPlan(), false);
    })
    .catch(function (err) {
      if (err && err.message === 'atleta') {
        lsSet('trainaldo-athlete', 'aldo');
        $('main').innerHTML = '<p class="loading">Atleta «' + esc(ATHLETE) + '» non trovato. Controlla il link ricevuto.</p>';
        return;
      }
      $('main').innerHTML = '<p class="loading">Impossibile caricare la scheda. Controlla la connessione e riapri l\'app.</p>';
    });

  /* ---------- Schede (piani) ---------- */
  function thisMonth() { return new Date().getMonth() + 1; }
  // Scheda automatica di oggi: prima le schede con from/until (date ISO, es. Ottobre esteso fino a fine settimana), poi quelle per mese
  function planForMonth(m) {
    var plans = state.program.plans, today = isoDate(new Date());
    for (var j = 0; j < plans.length; j++) {
      var p = plans[j];
      if ((p.from || p.until) && (!p.from || today >= p.from) && (!p.until || today <= p.until)) return p;
    }
    for (var i = 0; i < plans.length; i++) if (!plans[i].from && !plans[i].until && (plans[i].months || []).indexOf(m) >= 0) return plans[i];
    return null;
  }
  // Scelta manuale valida solo nel mese in cui è stata fatta; poi torna alla scheda del mese
  function pickPlan() {
    var plans = state.program.plans;
    var saved = store.get('plan', null);
    var auto = planForMonth(thisMonth());
    if (saved && auto && saved.auto === auto.id) {
      var hit = plans.filter(function (x) { return x.id === saved.id; })[0];
      if (hit) return hit;
    }
    return planForMonth(thisMonth()) || plans[plans.length - 1];
  }
  function resolveDays(plan) {
    return plan.days.map(function (d) {
      if (!d.same) return d;
      var src = state.program.plans.filter(function (x) { return x.id === d.same.plan; })[0];
      var sd = src && src.days.filter(function (x) { return x.id === d.same.day; })[0];
      if (!sd) return d;
      var copy = {}; for (var k in sd) copy[k] = sd[k];
      copy.tab = d.tab || sd.tab;
      copy.sameAs = src.name;
      return copy;
    });
  }
  // Ordine dei giorni scelto dall'atleta (per invertirli); il nome resta "Day 2" ecc.
  function orderDays(plan, days) {
    var ord = store.get('order.' + plan.id, null);
    if (!ord) return days;
    var byId = {}; days.forEach(function (d) { byId[d.id] = d; });
    var out = ord.filter(function (id) { return byId[id]; }).map(function (id) { return byId[id]; });
    days.forEach(function (d) { if (out.indexOf(d) < 0) out.push(d); });
    return out;
  }
  // Prossimo giorno: quello dopo l'ultimo registrato (padel, corsa, stop non fanno avanzare)
  function nextDayIndex() {
    var log = getLog(), last = null;
    for (var i = log.length - 1; i >= 0; i--) { var di = entryDayId(log[i]); if (di) { last = di; break; } }
    var train = state.days.filter(function (d) { return d.id !== 'yoga' && !d.optional; });
    if (!train.length) return 0;
    var k = 0;
    if (last) { var j = train.map(function (d) { return d.id; }).indexOf(last); k = j < 0 ? 0 : (j + 1) % train.length; }
    // salta i giorni già fatti questa settimana (se sono tutti fatti, resta il successivo)
    for (var n = 0; n < train.length; n++) { var c = train[(k + n) % train.length]; if (!doneThisWeek(c.id)) return state.days.indexOf(c); }
    return state.days.indexOf(train[k]);
  }
  function selectPlan(plan, manual) {
    state.plan = plan;
    state.days = orderDays(plan, resolveDays(plan));
    if (state.program.yoga) state.days.push(buildYogaDay());
    var today = isoDate(new Date());
    if (manual) { store.set('plan', { id: plan.id, auto: (planForMonth(thisMonth()) || {}).id }); state.day = nextDayIndex(); }
    else if (store.get('lastOpen', '') !== today) state.day = nextDayIndex();
    else state.day = Math.min(store.get('day', 0), state.days.length - 1);
    store.set('lastOpen', today);
    store.set('day', state.day);
    $('planName').textContent = plan.name + ' - impostazioni';
    renderTabs();
    renderDay();
    window.scrollTo(0, 0);
  }
  function openPlans() {
    var cur = planForMonth(thisMonth());
    $('sheetTitle').textContent = 'Plan';
    $('sheetBody').innerHTML = '<div class="sheet-inner plan-list"><h3 class="coach-h">Scheda</h3><select class="plan-sel" id="planSel" aria-label="Scheda">' + state.program.plans.map(function (pl) {
      return '<option value="' + esc(pl.id) + '"' + (pl.id === state.plan.id ? ' selected' : '') + '>' + esc(pl.name) + (cur && cur.id === pl.id ? ' · questo mese' : '') + '</option>';
    }).join('') + '</select><p class="plan-hint">All\'inizio di ogni mese l\'app apre da sola la scheda del mese.</p>' +
      '<h3 class="coach-h">La mia settimana inizia di</h3><div class="chips wsrow" id="wsChips">' +
      [1, 2, 3, 4, 5, 6, 0].map(function (g) { return '<button type="button" data-ws="' + g + '" aria-pressed="' + (g === weekStartDay()) + '">' + ['Dom', 'Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab'][g] + '</button>'; }).join('') +
      '</div><p class="plan-hint">Es. se giochi il venerdì e riparti la domenica, scegli Dom. Cambia il conteggio «Settimana N di 4» e le statistiche settimanali.</p>' +
      '<h3 class="coach-h">Ordine dei giorni · ' + esc(state.plan.name) + '</h3><div id="ordList" class="ord-list"></div>' +
      '<button class="btn-ghost-dark" id="ordReset">Ripristina ordine originale</button>' +
      '<h3 class="coach-h">Timer</h3>' + chips('tmode', ['A tutto schermo', 'Banner in basso'], store.get('timerMode', 'full') === 'banner' ? 'Banner in basso' : 'A tutto schermo') +
      '<p class="plan-hint">Con il banner puoi consultare gli esercizi mentre il recupero scorre. Puoi anche ridurre il timer mentre è aperto.</p>' +
      (lsGet('trainaldo-coach') ? '<h3 class="coach-h">Atleta (solo per l\'allenatore)</h3><div class="plan-list" id="athList"></div>' : '') + '</div>';
    showSheet();
    var drawOrd = function () {
      var list = state.days.filter(function (d) { return d.id !== 'yoga'; });
      $('ordList').innerHTML = list.map(function (d, i) {
        return '<div class="ord-row"><span>' + (i + 1) + '. <b>' + esc(d.tab) + '</b>' + (d.title ? ' · ' + esc(d.title) : '') + '</span>' +
          '<button data-mv="-1" data-i="' + i + '" aria-label="Su"' + (i === 0 ? ' disabled' : '') + '>▲</button>' +
          '<button data-mv="1" data-i="' + i + '" aria-label="Giù"' + (i === list.length - 1 ? ' disabled' : '') + '>▼</button></div>';
      }).join('');
    };
    drawOrd();
    var tm = $('sheetBody').querySelector('.chips[data-name="tmode"]');
    tm.onclick = function (ev) {
      var b = ev.target.closest('button'); if (!b) return;
      tm.querySelectorAll('button').forEach(function (x) { x.setAttribute('aria-pressed', x === b); });
      store.set('timerMode', b.dataset.v === 'Banner in basso' ? 'banner' : 'full');
    };
    $('wsChips').onclick = function (ev) {
      var b = ev.target.closest('[data-ws]'); if (!b) return;
      store.set('weekStart', +b.dataset.ws);
      $('wsChips').querySelectorAll('button').forEach(function (x) { x.setAttribute('aria-pressed', x === b); });
      renderTabs(); renderDay();
    };
    $('ordList').onclick = function (ev) {
      var b = ev.target.closest('[data-mv]'); if (!b) return;
      var list = state.days.filter(function (d) { return d.id !== 'yoga'; }).map(function (d) { return d.id; });
      var i = +b.dataset.i, j = i + (+b.dataset.mv), t = list[i]; list[i] = list[j]; list[j] = t;
      store.set('order.' + state.plan.id, list);
      var curId = state.days[state.day] && state.days[state.day].id;
      state.days = orderDays(state.plan, resolveDays(state.plan));
      if (state.program.yoga) state.days.push(buildYogaDay());
      state.day = Math.max(0, state.days.map(function (d) { return d.id; }).indexOf(curId));
      renderTabs(); renderDay(); drawOrd();
    };
    $('ordReset').onclick = function () {
      store.set('order.' + state.plan.id, null);
      state.days = resolveDays(state.plan); if (state.program.yoga) state.days.push(buildYogaDay());
      renderTabs(); renderDay(); drawOrd();
    };
    if (lsGet('trainaldo-coach')) {
      fetch('data/athletes/index.json', { cache: 'no-cache' }).then(function (r) { return r.json(); }).then(function (list) {
        var el = $('athList'); if (!el) return;
        el.innerHTML = [{ id: 'aldo', name: 'Aldo' }, { id: 'arnese', name: 'Fisio Hub · profilo test' }].concat(list).map(function (a) {
          return '<button class="plan-item' + (a.id === ATHLETE ? ' on' : '') + '" data-ath="' + esc(a.id) + '"><span class="plan-n">' + esc(a.name) + '</span>' + (a.id === ATHLETE ? '<span class="plan-check">✓</span>' : '') + '</button>';
        }).join('');
        el.onclick = function (ev) { var b = ev.target.closest('[data-ath]'); if (b) location.href = location.pathname + '?atleta=' + b.dataset.ath; };
      }).catch(function () {});
    }
    $('planSel').onchange = function () {
      var pl = state.program.plans.filter(function (x) { return x.id === $('planSel').value; })[0];
      closeSheet(false);
      if (pl) selectPlan(pl, true);
    };
  }
  (function () {   // header fisso: lo spazio sotto segue l'altezza reale (cambia con le tab e con le sezioni)
    var top = document.querySelector('.top'), setH = function () { document.documentElement.style.setProperty('--hdr', top.offsetHeight + 'px'); };
    setH(); if (window.ResizeObserver) new ResizeObserver(setH).observe(top); window.addEventListener('resize', setH);
  })();
  document.querySelector('.top .brand .bn').onclick = function () { closeSheet(false); window.scrollTo(0, 0); };
  $('planBtn').onclick = function () { if (state.program) openPlans(); };

  /* ---------- Settimana della scheda e allenamenti fatti ---------- */
  // Inizio della «mia settimana»: di default lunedì, ma l'atleta può sceglierlo (es. domenica se gioca il venerdì)
  function weekStartDay() { return +store.get('weekStart', 1); }   // 0 = domenica … 6 = sabato
  function mondayOf(d) { var x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); x.setDate(x.getDate() - ((x.getDay() - weekStartDay() + 7) % 7)); return x; }
  function planStart(plan) {
    if (plan.start) return new Date(plan.start + 'T12:00');
    if (plan.months && plan.months.length && plan.months.length < 12) return new Date(new Date().getFullYear(), plan.months[0] - 1, 1);
    var log = getLog();
    for (var i = 0; i < log.length; i++) if (log[i].planId === plan.id) return new Date(log[i].when.slice(0, 10) + 'T12:00');
    var saved = store.get('start.' + plan.id, '');
    if (!saved) { saved = isoDate(new Date()); store.set('start.' + plan.id, saved); }
    return new Date(saved + 'T12:00');
  }
  // Schede mensili: blocchi di 4 settimane (lun–dom) dal primo lunedì del mese; i giorni prima contano come settimana 1.
  // Programmi a durata (plan.weeks, es. Viviana): settimane dal primo allenamento.
  function planWeek(plan) {
    var today = mondayOf(new Date());
    if (plan.months && plan.months.length && plan.months.length < 12) {
      var st = planStart(plan), m0 = mondayOf(st);
      if (m0 < st) m0 = new Date(m0.getFullYear(), m0.getMonth(), m0.getDate() + 7);
      var w = today < m0 ? 1 : Math.floor((today - m0) / (7 * DAY_MS)) + 1;
      var tot = plan.weeks || 4;
      return { n: ((w - 1) % tot) + 1, tot: tot };
    }
    var w2 = Math.floor((today - mondayOf(planStart(plan))) / (7 * DAY_MS)) + 1;
    return { n: Math.max(1, w2), tot: plan.weeks || 0 };
  }
  var ACTIVE_DAY = ['Allenamento', 'Padel', 'Corsa'];   // registrati da un giorno della scheda: il giorno risulta fatto
  // Giorno della scheda a cui si riferisce una registrazione (anche quelle vecchie senza dayId, dal testo «Ottobre · Day 1»)
  function entryDayId(x) {
    if (ACTIVE_DAY.indexOf(x.type) < 0) return null;
    if (x.dayId) return x.planId === state.plan.id ? x.dayId : null;
    var lab = x.label || '';
    if (lab.indexOf(state.plan.name) < 0) return null;
    for (var i = 0; i < state.days.length; i++) {
      var t = state.days[i].tab;
      if (new RegExp('(^|\\W)' + t.replace(/\s+/g, '\\s*') + '(\\W|$)', 'i').test(lab)) return state.days[i].id;
    }
    return null;
  }
  // Ultima volta che un giorno è stato fatto (registrato da «Registra allenamento»)
  function lastDone(dayId) {
    var log = getLog();
    for (var i = log.length - 1; i >= 0; i--) if (entryDayId(log[i]) === dayId) return log[i];
    return null;
  }
  // Giro in corso: gli allenamenti dall'inizio del giro attuale. Un giro si chiude quando hai fatto tutti i giorni
  // della scheda o quando rifai un giorno già fatto (indipendente dalle date: puoi invertire i giorni o saltare per il padel).
  function currentRound() {
    var train = state.days.filter(function (d) { return d.id !== 'yoga' && !d.optional; }).length;
    var round = {};
    var wk0 = isoDate(mondayOf(new Date()));   // reset automatico: i ✓ valgono solo per la settimana in corso
    getLog().forEach(function (x) {
      if (x.when.slice(0, 10) < wk0) return;
      var id = entryDayId(x); if (!id) return;
      if (round[id] || Object.keys(round).length >= train) round = {};
      round[id] = x;
    });
    return round;
  }
  function doneThisWeek(dayId) { return currentRound()[dayId] || null; }
  function swapDays(a, b) {
    var list = state.days.filter(function (d) { return d.id !== 'yoga'; }).map(function (d) { return d.id; });
    var i = list.indexOf(a), j = list.indexOf(b); if (i < 0 || j < 0) return;
    list[i] = b; list[j] = a;
    store.set('order.' + state.plan.id, list);
    var curId = state.days[state.day] && state.days[state.day].id;
    state.days = orderDays(state.plan, resolveDays(state.plan));
    if (state.program.yoga) state.days.push(buildYogaDay());
    state.day = Math.max(0, state.days.map(function (d) { return d.id; }).indexOf(curId));
    store.set('day', state.day);
    renderTabs(); renderDay();
  }

  /* ---------- Tab ---------- */
  // Con plan.weekSlots {train:[…], optional:[…], yoga:[…]} l'header è la settimana a 7 caselle, a partire dal giorno scelto dall'atleta:
  // i Day vanno nelle caselle indicate (es. se la settimana parte di martedì, il Day 1 cade di martedì)
  var WD = ['Dom', 'Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab'];
  function weekCells() {
    var ws = state.plan.weekSlots; if (!ws) return null;
    var cells = [], tr = 0, op = 0;
    for (var k = 0; k < 7; k++) cells.push({ wd: (weekStartDay() + k) % 7, i: -1 });
    state.days.forEach(function (d, i) {
      var slot;
      if (d.id === 'yoga') slot = (ws.yoga || [])[0];
      else if (d.optional) slot = (ws.optional || [])[op++];
      else slot = (ws.train || [])[tr++];
      if (slot != null && cells[slot] && cells[slot].i < 0) cells[slot].i = i;
    });
    return cells;
  }
  // Icone a penna (tratto = colore del testo)
  var SK = function (p) { return '<svg class="sk" viewBox="0 0 40 40" aria-hidden="true">' + p + '</svg>'; };
  var ICONS = {
    leg: SK('<path d="M14 4c-1 8-1 14 1 20l-3 10c3 2 8 2 11 0l-1-9c4-6 4-14 3-21"/><path d="M16 11h8M16 15h8"/>'),
    power: SK('<path d="M23 3L9 23h9l-3 14 15-21h-9z"/>'),
    strength: SK('<path d="M5 24c4-3 6-8 8-14 4 2 5 6 4 9 4-1 9 0 12 4 3 4 0 10-6 9-6 0-12-1-18-8z"/><path d="M18 22c2 1 4 1 6 0"/>'),
    time: SK('<circle cx="20" cy="23" r="12"/><path d="M16 5h8M20 5v6M20 23l5-6"/>'),
    yoga: SK('<circle cx="20" cy="7" r="3.5"/><path d="M20 11v13M10 4l10 9 10-9M20 24l-8 10M20 24l8 10"/>'),
    rehab: SK('<path d="M20 34C8 25 5 17 9 11c4-4 9-2 11 2 2-4 7-6 11-2 4 6 1 14-11 23z"/><path d="M10 21h6l3-5 4 9 3-4h5"/>'),
    padel: SK('<ellipse cx="17" cy="15" rx="10" ry="12"/><path d="M17 27v10M11 12h12M11 18h12"/><circle cx="33" cy="30" r="3"/>'),
    box: SK('<path d="M9 14c0-6 5-9 11-9s11 3 11 10v8c0 4-3 8-8 8h-6c-5 0-8-3-8-8z"/><path d="M13 31h14M13 20h14"/>')
  };
  function dayIcon(d) {
    if (d.ico) return ICONS[d.ico] || '';
    var rules = [[/yoga/, 'yoga'], [/gamb/, 'leg'], [/conditioning|emom|hiit/, 'time'], [/potenza|power|circuit|metabolic|cardio|reatt/, 'power'],
      [/forza|trazion|stacco|upper|spinta|petto|schiena/, 'strength'], [/box|corsa|run/, 'box'], [/fase|rehab/, 'rehab'], [/padel/, 'padel']];
    var pick = function (t) { for (var i = 0; i < rules.length; i++) if (rules[i][0].test(t)) return ICONS[rules[i][1]]; return ''; };
    return pick(((d.title || '') + ' ' + (d.tab || '') + ' ' + (d.id || '')).toLowerCase()) || pick(String(d.desc || '').toLowerCase());
  }
  function tabHtml(d, i, nxt, lbl) {
    return '<button class="tab' + (d.optional ? ' opt-tab' : '') + (i === nxt ? ' next' : '') + '" role="tab" data-i="' + i + '" aria-selected="' + (i === state.day) + '">' +
      (lbl ? '<small>' + lbl + '</small>' : '') + (d.id !== 'yoga' && doneThisWeek(d.id) ? '<span class="chk">✓</span>' : '') + '<span class="t-ico" aria-hidden="true">' + dayIcon(d) + '</span><span class="t-lbl">' + esc(d.tab) + '</span></button>';
  }
  function renderTabs() {
    var nav = $('tabs'), nxt = nextDayIndex(), cells = null;   // i giorni della settimana stanno nel Diary
    nav.className = 'tabs' + (cells ? ' wk' : '');
    nav.innerHTML = cells ? cells.map(function (c) {
      return c.i < 0 ? '<div class="tab rest" aria-hidden="true"><small>' + WD[c.wd] + '</small>–</div>' : tabHtml(state.days[c.i], c.i, nxt, WD[c.wd]);
    }).join('') : state.days.map(function (d, i) { return tabHtml(d, i, nxt, ''); }).join('');
    nav.onclick = function (e) {
      var b = e.target.closest('.tab'); if (!b || b.dataset.i == null) return;
      state.day = +b.dataset.i; store.set('day', state.day);
      Array.prototype.forEach.call(nav.children, function (t) { t.setAttribute('aria-selected', t.dataset.i != null && +t.dataset.i === state.day); });
      renderDay();
      window.scrollTo(0, 0);
    };
  }

  /* ---------- Giorno ---------- */
  function currentSections(day) {
    if (!day.variants) return { sections: day.sections, note: day.note };
    var vid = state.variant[state.plan.id + '/' + day.id] || state.variant[day.id] || day.variants[0].id;
    var v = day.variants.filter(function (x) { return x.id === vid; })[0] || day.variants[0];
    return v;
  }

  /* ---------- Rotazione yoga ---------- */
  var DAY_MS = 864e5;
  function utcDay(d) { return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()); }
  function rotStart() {
    var r = (state.program.rotation && state.program.rotation.start || '2026-09-21').split('-');
    return Date.UTC(+r[0], +r[1] - 1, +r[2]);
  }
  function weekIndex() { return Math.max(0, Math.floor((utcDay(new Date()) - rotStart()) / (7 * DAY_MS))); }
  function fmtDate(ms) { var d = new Date(ms); return d.getUTCDate() + '/' + (d.getUTCMonth() + 1); }

  // Defaticamento: stessa sequenza per N settimane (default 2), poi la successiva
  function currentCooldown() {
    var list = state.program.cooldowns; if (!list || !list.length) return null;
    var per = (state.program.rotation && state.program.rotation.cooldownWeeks) || 2;
    var k = Math.floor(weekIndex() / per);
    var c = list[k % list.length], nx = list[(k + 1) % list.length];
    var from = rotStart() + k * per * 7 * DAY_MS, to = from + (per * 7 - 1) * DAY_MS;
    var tot = 0; c.items.forEach(function (it) { if (it.sec) tot += it.sec * (it.sides || 1); });
    return { type: 'cooldown', label: 'Defaticamento yoga · ' + c.name, items: c.items,
      sub: tot / 60 + "' guidati · dal " + fmtDate(from) + ' al ' + fmtDate(to) + ', poi: ' + nx.name };
  }

  // Pratica libera: un video diverso ogni settimana, alternando Flexibility e Forza
  function buildYogaDay() {
    var y = state.program.yoga, ex = state.program.exercises;
    var order = [];
    for (var i = 0; i < Math.max(y.flex.length, y.forza.length); i++) {
      if (y.flex[i]) order.push(y.flex[i]);
      if (y.forza[i]) order.push(y.forza[i]);
    }
    var pick = order[weekIndex() % order.length];
    var isFlex = y.flex.indexOf(pick) >= 0;
    var nextMon = rotStart() + (weekIndex() + 1) * 7 * DAY_MS;
    function list(keys) { return keys.map(function (k) { return { ex: k, reps: ex[k].dur || '' }; }); }
    return { id: y.id, tab: y.tab, title: y.title, noCooldown: true, sections: [
      { type: 'list', badge: 'SETT', label: 'Questa settimana · ' + (isFlex ? 'Flexibility' : 'Forza'), sub: 'Cambia lunedì ' + fmtDate(nextMon), items: list([pick]) },
      { type: 'note', label: 'Oppure', text: 'scegli tu una pratica su Nike Training Club (livello intermedio). Per i video serve internet.' },
      { type: 'list', badge: 'FLEX', label: 'Flexibility', sub: 'Mobilità di anche, femorali e schiena', items: list(y.flex) },
      { type: 'list', badge: 'FORZA', label: 'Forza', sub: 'Power yoga: core, spalle, gambe', items: list(y.forza) }
    ] };
  }

  // Sezioni del giorno + defaticamento yoga aggiunto sempre in fondo
  function daySections(day) {
    var secs = currentSections(day).sections.slice();
    var cd = currentCooldown();
    if (cd && !day.noCooldown) secs.push(cd);
    return secs;
  }

  // Inizio allenamento: salva l'orario di partenza; a «Fine» il Registra si compila con ora e minuti
  function getSession() { return store.get('session', null); }
  function sessMin(s) { return Math.max(1, Math.round((Date.now() - s.start) / 60000)); }
  function sessionHtml(day) {
    var ss = getSession();
    if (ss && ss.start && Date.now() - ss.start > 12 * 3600000) { store.set('session', null); ss = null; }
    if (!ss) {
      return '<div class="sess"><button class="btn-sess" id="sessStart">▶ Inizia allenamento</button></div>';
    }
    var t = new Date(ss.start);
    return '<div class="sess on"><div><b>● In corso</b> · ' + esc(ss.label || '') + '<br><small>iniziato alle ' + ('0' + t.getHours()).slice(-2) + ':' + ('0' + t.getMinutes()).slice(-2) +
      ' · <span id="sessEl">' + sessMin(ss) + "'</span></small></div>" +
      '<button class="btn-sess end" id="sessEnd">■ Fine</button><button class="btn-sess x" id="sessCancel" aria-label="Annulla allenamento in corso">✕</button></div>';
  }
  var sessTick = 0;
  function bindSession(day, cur) {
    clearInterval(sessTick);
    if ($('sessStart')) $('sessStart').onclick = function () {
      store.set('session', { start: Date.now(), planId: state.plan.id, dayId: day.id, yoga: day.id === 'yoga',
        label: (day.id === 'yoga' ? 'Yoga' : state.plan.name + ' · ' + day.tab + (day.variants ? ' · ' + cur.label : '')) });
      renderDay();
    };
    if ($('sessCancel')) $('sessCancel').onclick = function () {
      if (confirm('Annullare l\'allenamento in corso?')) { store.set('session', null); renderDay(); }
    };
    if ($('sessEnd')) {
      $('sessEnd').onclick = function () {
        var ss = getSession(); if (!ss) return;
        openLogForm(ss.yoga ? 'Yoga' : 'Allenamento', ss.label, ss.yoga ? null : { planId: ss.planId, dayId: ss.dayId }, { dur: sessMin(ss), when: localDT(new Date(ss.start)), sess: true });
      };
      sessTick = setInterval(function () { var ss = getSession(), el = $('sessEl'); if (ss && el) el.textContent = sessMin(ss) + "'"; }, 20000);
    }
  }

  // Riepilogo «Questa settimana» sotto la card del giorno
  function weekStatsHtml() {
    var wStart = isoDate(mondayOf(new Date()));
    var w = getLog().filter(function (x) { return x.when.slice(0, 10) >= wStart && ACTIVE.indexOf(x.type) >= 0; });
    var min = w.reduce(function (a, x) { return a + (x.dur || 0); }, 0), kc = w.reduce(function (a, x) { return a + (x.kcal || 0); }, 0);
    var train = state.days.filter(function (d) { return d.id !== 'yoga' && !d.optional; }).length;
    return '<button type="button" class="wk-stats" id="wkStats" aria-label="Apri lo storico degli allenamenti"><div><b>' + w.length + '</b><small>fatti' + (train ? ' su ' + train : '') + '</small></div>' +
      '<div><b>' + (min >= 60 ? Math.floor(min / 60) + 'h ' + ('0' + (min % 60)).slice(-2) : min + "'") + '</b><small>tempo</small></div>' +
      '<div><b>' + kc + '</b><small>kcal</small></div><span class="wk-hint">Storico ›</span></button>';
  }
  function renderDay() {
    var day = state.days[state.day];
    var cur = currentSections(day);
    var wk = planWeek(state.plan);
    $('athlete').textContent = (state.program.athleteName || 'Aldo') + ' · ' + (state.plan.kind === 'rehab' ? 'Settimana ' + wk.n + (wk.tot ? ' di ' + wk.tot : '') : state.plan.name);
    var desc0 = cur.desc || day.desc;
    var h = '<div class="hero"><h1 class="day-title"><small>' + esc(day.id === 'yoga' ? 'Sempre disponibile' : state.plan.name + ' · Settimana ' + wk.n + (wk.tot ? ' di ' + wk.tot : '')) + '</small>' + esc(day.tab) + (day.title ? ' — ' + esc(day.title) : '') +
      (day.optional ? ' <span class="opt">opzionale</span>' : '') +
      (state.days.indexOf(day) === nextDayIndex() && day.id !== 'yoga' ? ' <span class="opt nxt">prossimo</span>' : '') + '</h1>' + (desc0 ? '<p class="hero-desc">' + esc(desc0) + '</p>' : '') + sessionHtml(day) + '</div>' + (day.id !== 'yoga' ? weekStatsHtml() : '');
    if (day.id !== 'yoga') {
      var dn = lastDone(day.id), dw = doneThisWeek(day.id);
      var others = state.days.filter(function (d) { return d.id !== 'yoga' && d.id !== day.id; });
      h += '<div class="day-tools">' +
        (dw ? '<span class="done-flag">✓ Fatto ' + esc(fmtWhen(dw.when)) + '</span>' : dn ? '<span class="done-last">Ultima volta: ' + esc(fmtWhen(dn.when)) + '</span>' : '') +
        '<span class="tools-right"><button class="timer-ico" id="freeTimerBtn" aria-label="Timer">' + ICONS.time + '</button>' +
        (others.length ? '<button class="timer-ico" id="swapBtn" aria-label="Inverti con un altro giorno">⇄</button>' : '') + '</span></div>' +
        '<div class="swap-row" id="swapRow" hidden><small>Scambia il ' + esc(day.tab) + ' con:</small><div class="chips">' +
        others.map(function (d) { return '<button type="button" data-swap="' + esc(d.id) + '">' + esc(d.tab) + '</button>'; }).join('') + '</div></div>';
    } else {
      h += '<div class="day-tools"><span class="tools-right"><button class="timer-ico" id="freeTimerBtn" aria-label="Timer">' + ICONS.time + '</button></span></div>';
    }
    h += reminderHtml();
    if (state.plan.note && day.id !== 'yoga') h += '<div class="note-box"><b>Regole</b> · ' + esc(state.plan.note) + '</div>';

    if (day.variants) {
      h += '<div class="switch" role="group" aria-label="Variante">' + day.variants.map(function (v) {
        return '<button data-v="' + esc(v.id) + '" aria-pressed="' + (v.id === cur.id) + '">' + esc(v.label) + '</button>';
      }).join('') + '</div>';
    }
    if (cur.note) h += '<div class="note-box"><b>Nota</b> · ' + esc(cur.note) + '</div>';

    daySections(day).forEach(function (sec, si) {
      if (sec.type === 'note') {
        h += '<div class="note-box"><b>' + esc(sec.label) + '</b>' + (sec.text ? ' · ' + esc(sec.text) : '') + '</div>';
      } else if (sec.type === 'intervals') {
        h += renderIntervals(sec, si);
      } else if (sec.type === 'protocol') {
        var pp = (state.program.rehab || []).filter(function (x) { return x.id === sec.ref; })[0];
        if (pp) h += '<section class="block">' + protocolHtml(pp, true) + '</section>';
      } else if (sec.type === 'run' || sec.type === 'timer') {
        h += renderSolo(sec, si);
      } else {
        h += renderBlock(sec, si);
      }
    });

    var dnk = state.plan.id + '.' + day.id, dn = store.get('daynote.' + dnk, null);
    h += (day.id !== 'yoga' ? '<div class="day-note"><label class="f-l" for="dayNote">📝 Nota per il coach su questo allenamento</label>' +
      '<textarea class="f-in" id="dayNote" data-daynote="' + esc(dnk) + '" rows="3" placeholder="una nota unica: come è andata, dolori, carichi, dubbi…">' + esc(dn ? dn.t : '') + '</textarea></div>' : '');
    h += '<div class="log-cta"><button class="btn-log" id="logBtn">✓ Registra allenamento</button>' +
      (day.id !== 'yoga' ? '<button class="btn-wa" id="waBtn">💬 Invia sensazioni al coach (WhatsApp)</button>' : '') +
      (day.id !== 'yoga' ? '<div class="alt-row"><small>Oggi ho fatto altro:</small><div class="chips">' +
        (state.plan.kind === 'rehab' ? ['Stop'] : ['Padel', 'Corsa', 'Stop']).map(function (t) { return '<button type="button" data-alt="' + t + '">' + (t === 'Stop' ? 'Stop / riposo' : t) + '</button>'; }).join('') +
        '</div><small class="muted">Il ' + esc(day.tab) + ' resta il prossimo da fare.</small></div>' : '') + '</div>';

    var main = $('main');
    main.innerHTML = h;
    main.querySelectorAll('.sets').forEach(function (row) {
      row.onclick = function (ev) {
        var b = ev.target.closest('.set-sq'); if (!b) return;
        var n = +b.dataset.n, cur0 = setsDone(row.dataset.sk), nv = n === cur0 ? n - 1 : n;
        store.set(row.dataset.sk, { d: isoDate(new Date()), n: nv });
        row.querySelectorAll('.set-sq').forEach(function (x) { var on = +x.dataset.n <= nv; x.classList.toggle('on', on); x.setAttribute('aria-pressed', on); });
        buzz(15);
      };
    });
    if ($('wkStats')) $('wkStats').onclick = function () { openDiary(); };
    $('freeTimerBtn').onclick = function () { openFreeTimer(); };
    if ($('waBtn')) $('waBtn').onclick = function () { openCoachMessage(day, cur); };
    $('logBtn').onclick = function () {
      var v = day.variants ? ' · ' + cur.label : '';
      openLogForm(day.id === 'yoga' ? 'Yoga' : 'Allenamento', day.id === 'yoga' ? 'Yoga' : state.plan.name + ' · ' + day.tab + v,
        day.id === 'yoga' ? null : { planId: state.plan.id, dayId: day.id });
    };
    main.querySelectorAll('[data-alt]').forEach(function (b) {
      b.onclick = function () { openLogForm(b.dataset.alt, b.dataset.alt === 'Stop' ? '' : b.dataset.alt, b.dataset.alt === 'Stop' ? null : { planId: state.plan.id, dayId: day.id }); };
    });
    bindReminder();
    bindSession(day, cur);
    if ($('swapBtn')) {
      $('swapBtn').onclick = function () { $('swapRow').hidden = !$('swapRow').hidden; };
      $('swapRow').onclick = function (ev) { var b = ev.target.closest('[data-swap]'); if (b) swapDays(day.id, b.dataset.swap); };
    }

    main.querySelectorAll('.alt-pick').forEach(function (ap) {
      ap.onclick = function (ev) {
        var b = ev.target.closest('[data-alt]'); if (!b) return;
        store.set('alt.' + state.plan.id + '/' + day.id + '.' + ap.dataset.altk, b.dataset.alt);
        var y = window.scrollY; renderDay(); window.scrollTo(0, y);
      };
    });
    var sw = main.querySelector('.switch');
    if (sw) sw.onclick = function (e) {
      var b = e.target.closest('button'); if (!b) return;
      state.variant[state.plan.id + '/' + day.id] = b.dataset.v; store.set('variant', state.variant);
      renderDay();
    };
  }

  // Serie fatte: quadrati numerati, valgono per la giornata e si azzerano al Registra
  function setsKey(si) {
    var d = state.days[state.day];
    return 'sets.' + state.plan.id + '.' + d.id + '.' + (state.variant[state.plan.id + '/' + d.id] || '') + '.' + si;
  }
  function setsDone(k) { var v = store.get(k, null); return v && v.d === isoDate(new Date()) ? v.n : 0; }
  function clearSets(planId, dayId) {
    try {
      var pre = NS + 'sets.' + planId + '.' + dayId + '.', del = [];
      for (var i = 0; i < localStorage.length; i++) { var kk = localStorage.key(i); if (kk.indexOf(pre) === 0) del.push(kk); }
      del.forEach(function (kk) { localStorage.removeItem(kk); });
    } catch (e) {}
  }

  function renderBlock(sec, si) {
    var ex = state.program.exercises;
    var mob = sec.type === 'mobility' || sec.type === 'list';
    var guided = sec.type === 'hiit' || sec.type === 'cooldown' || sec.type === 'emom';
    var badge = sec.badge || (sec.type === 'hiit' ? 'HIIT' : sec.type === 'cooldown' ? 'YOGA' : sec.type === 'emom' ? 'EMOM' : 'MOB');
    var sub = sec.sub || (sec.type === 'mobility' ? 'Attivazione' : '');
    if (sec.type === 'hiit') {
      var tot = sec.rounds * (sec.items.length * sec.work + (sec.items.length - 1) * sec.rest) + (sec.rounds - 1) * (sec.roundRest || 0);
      sub = fmtRest(sec.work) + ' lavoro · ' + fmtRest(sec.rest) + ' recupero · ' + sec.rounds + ' giri · circa ' + Math.round(tot / 60) + "'";
    }
    if (sec.type === 'emom') {
      var n = sec.items.length, full = Math.floor(sec.minutes / n), extra = sec.minutes % n;
      sub = sec.minutes + "' · " + n + ' stazioni · ' + full + ' giri completi' + (extra ? ' + ' + extra + ' minut' + (extra > 1 ? 'i' : 'o') : '');
    }
    var head = (mob || guided)
      ? '<div class="letter sm">' + esc(badge) + '</div><div class="block-meta"><div class="block-kind">' + esc(sec.label) + '</div><div class="block-sub">' + esc(sub) + '</div></div>'
      : '<div class="letter">' + esc(sec.letter) + '</div><div class="block-meta"><div class="block-kind">' + kindOf(sec) + ' ×' + sec.sets + '</div><div class="block-sub">' + sec.sets + ' serie' + (sec.rest ? ' · recupero ' + fmtRest(sec.rest) : sec.rest === 0 ? ' · senza recupero' : '') + '</div></div>';
    if (sec.type === 'block' && sec.items.length > 1) {
      head += '<div class="flow">' + sec.items.map(function (it) { return esc(it.code || ''); }).join(' → subito ') +
        (sec.rest ? ' → recupero ' + fmtRest(sec.rest) : sec.rest === 0 ? ' → riparti' : ' → recupero a scelta') + '</div>';
    }
    if (sec.info) head += '<div class="flow info">' + esc(sec.info) + '</div>';

    var altKey = state.plan.id + '/' + state.days[state.day].id;
    var rows = sec.items.map(function (it0) {
      var it = it0, altsHtml = '';
      if (it0.alts) {
        var opts = [it0.ex].concat(it0.alts), sel = store.get('alt.' + altKey + '.' + it0.code, it0.ex);
        if (opts.indexOf(sel) < 0) sel = it0.ex;
        it = {}; for (var kk in it0) it[kk] = it0[kk]; it.ex = sel; delete it.name;
        altsHtml = '<div class="alt-pick" data-altk="' + esc(it0.code) + '"><small>Variante ' + esc(it0.code) + '</small><div class="chips">' + opts.map(function (o) {
          return '<button type="button" data-alt="' + esc(o) + '" aria-pressed="' + (o === sel) + '">' + esc((ex[o] || {}).short || (ex[o] || {}).name || o) + '</button>';
        }).join('') + '</div></div>';
      }
      var e = ex[it.ex] || { name: it.ex };
      var name = it.name || e.name;
      var reps = it.reps || (it.time ? it.time + "''" : sec.type === 'hiit' ? fmtRest(sec.work) : it.sec ? fmtRest(it.sec) + ((it.sides || 1) > 1 ? ' per lato' : '') : e.dur || '');
      var hasMedia = e.equip !== 'Corsa';
      var thumb = e.img ? '<img src="' + photoSrc(e, 0) + '" alt="" loading="lazy">'
        : e.video ? '<img src="' + ytThumb(e.video) + '" alt="" loading="lazy">'
        : e.equip === 'Corsa' ? 'RUN' : '';
      var side = it.time
        ? '<button class="btn-work" data-work="' + it.time + '" data-label="' + esc(name) + '">▶ ' + it.time + "''</button>"
        : it.editable
        ? '<div class="kg"><input type="text" inputmode="numeric" enterkeyhint="done" data-repsin="' + esc(it.ex) + '" value="' + esc(store.get('reps.' + it.ex, '')) + '" placeholder="?" aria-label="Ripetizioni ' + esc(name) + '"><label>reps</label></div>'
        : '';
      var kg = side ? side : e.kg
        ? '<div class="kg"><input type="text" inputmode="decimal" enterkeyhint="done" data-kg="' + esc(it.ex) + '" value="' + esc(store.get('kg.' + it.ex, '')) + '" placeholder="–" aria-label="Kg ' + esc(name) + '"><label>kg</label></div>'
        : '';
      return '<div class="ex' + (hasMedia ? '' : ' static') + '" data-ex="' + esc(it.ex) + '" data-reps="' + esc(reps) + '" data-name="' + esc(name) + '"' + (hasMedia ? ' role="button" tabindex="0"' : '') + '>' +
        '<div class="thumb">' + thumb + '</div>' +
        '<div class="ex-main">' + (it.code ? '<div class="ex-code">' + esc(it.code) + '</div>' : '') +
        '<div class="ex-name">' + esc(name) + (store.get('exnote.' + it.ex, null) ? ' <span class="has-note" title="nota per il coach">📝</span>' : '') + '</div>' +
        '<div class="ex-info"><b>' + esc(it.editable && !reps ? 'reps da definire' : reps) + '</b>' + (it.note ? ' <b>' + esc(it.note) + '</b>' : '') + ' · ' + esc(e.equip || '') + '</div></div>' + kg + '</div>' + altsHtml;
    }).join('');

    var lbl = 'Recupero blocco ' + esc(sec.letter);
    var rest = mob || sec.rest === 0 ? '' : guided
      ? '<div class="rest"><div class="rest-txt">Timer guidato<span>' + (sec.type === 'hiit' ? 'lavoro / recupero con segnale' : sec.type === 'emom' ? 'nuovo minuto con segnale' : 'cambio posizione con segnale') + '</span></div>' +
        '<button class="btn-start" data-guided="' + si + '">Avvia</button></div>'
      : sec.rest
      ? '<div class="rest"><div class="rest-txt">Rest ' + fmtRest(sec.rest) + '<span>tra un giro e l\'altro</span></div>' +
        '<button class="btn-start" data-rest="' + sec.rest + '" data-label="' + lbl + '">Avvia</button></div>'
      : '<div class="rest rest-free"><div class="rest-txt">Rest</div><div class="rest-chips">' +
        [60, 75, 90, 120].map(function (r) { return '<button class="btn-start chip" data-rest="' + r + '" data-label="' + lbl + '">' + fmtRest(r) + '</button>'; }).join('') + '</div></div>';

    var setsHtml = '';
    if (!mob && !guided && sec.sets > 0) {
      var sk = setsKey(si), dn = setsDone(sk), sq = '';
      for (var q = 1; q <= sec.sets; q++) sq += '<button type="button" class="set-sq' + (q <= dn ? ' on' : '') + '" data-n="' + q + '" aria-pressed="' + (q <= dn) + '" aria-label="Serie ' + q + '">' + q + '</button>';
      setsHtml = '<div class="sets" data-sk="' + esc(sk) + '"><span class="sets-l">Serie fatte</span>' + sq + '</div>';
    }
    return '<section class="block' + (mob ? ' mob' : '') + (sec.type === 'cooldown' ? ' yoga' : '') + '"><div class="block-head">' + head + '</div>' + rows + setsHtml + rest + '</section>';
  }

  // Card singola con timer: corsa (durata fissa) o timer libero (durata impostabile)
  function renderSolo(sec, si) {
    var run = sec.type === 'run';
    var body = run
      ? '<div class="solo"><div class="solo-big">' + sec.minutes + "'</div><div><b>Ritmo " + esc(sec.pace) + '</b><br>' + esc(sec.note || '') + '</div></div>'
      : '<div class="solo"><label class="solo-in">Durata <input type="number" inputmode="numeric" min="1" max="120" data-tmin="' + esc(sec.id) + '" value="' + esc(store.get('tmin.' + sec.id, '') || sec.minutes) + '"> minuti</label><div>' + esc(sec.note || '') + '</div></div>';
    return '<section class="block' + (run ? '' : ' yoga') + '"><div class="block-head"><div class="letter sm">' + (run ? 'RUN' : 'YOGA') + '</div><div class="block-meta">' +
      '<div class="block-kind">' + esc(sec.label) + (sec.optional ? ' <span class="opt">facoltativa</span>' : '') + '</div><div class="block-sub">' + esc(sec.sub || '') + '</div></div></div>' + body +
      '<div class="rest"><div class="rest-txt">Timer<span>' + (run ? 'segnale a fine corsa' : 'imposta i minuti e avvia') + '</span></div>' +
      '<button class="btn-start" data-guided="' + si + '">Avvia</button></div></section>';
  }

  function renderIntervals(sec, si) {
    var max = 0, totalMin = 0;
    sec.steps.forEach(function (s) { max = Math.max(max, s[0] + s[1]); totalMin += s[0] + s[1]; });
    var rows = sec.steps.map(function (s, i) {
      return '<div class="iv-row"><div class="iv-n">' + (i + 1) + '</div><div class="iv-bars">' +
        '<div class="iv-run" style="width:' + (s[0] / max * 100) + '%">' + s[0] + '\'</div>' +
        '<div class="iv-rec" style="width:' + (s[1] / max * 100) + '%">' + s[1] + '\'</div>' +
        '</div><div class="iv-lbl">' + s[0] + ':' + s[1] + '</div></div>';
    }).join('');
    return '<section class="block"><div class="block-head"><div class="letter sm">RUN</div><div class="block-meta">' +
      '<div class="block-kind">' + esc(sec.label) + '</div><div class="block-sub">Passo corsa ' + esc(sec.pace) + ' · ' + totalMin + ' min in totale</div></div></div>' +
      '<div class="iv-grid">' + rows + '</div>' +
      '<div class="iv-legend"><span><i style="background:var(--red)"></i>Corsa (min)</span><span><i style="background:#e8dcd0"></i>Recupero (min)</span></div>' +
      '<div class="rest"><div class="rest-txt">Timer guidato<span>corsa / recupero con segnale</span></div>' +
      '<button class="btn-start" data-guided="' + si + '">Avvia</button></div></section>';
  }

  /* ---------- Eventi lista ---------- */
  var main = $('main');
  main.addEventListener('click', function (e) {
    if (e.target.closest('.kg') || e.target.closest('.solo-in')) return;
    var wk = e.target.closest('.btn-work');
    if (wk) { unlockAudio(); startTimer(+wk.dataset.work, wk.dataset.label, true); return; }
    var st = e.target.closest('.btn-start');
    if (st) {
      unlockAudio();
      if (st.dataset.guided) startGuided(+st.dataset.guided);
      else startTimer(+st.dataset.rest, st.dataset.label);
      return;
    }
    var row = e.target.closest('.ex');
    if (row && !row.classList.contains('static')) openSheet(row.dataset.ex, row.dataset.reps, row.dataset.name, row);
  });
  main.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && e.target.classList.contains('ex')) e.target.click();
  });
  document.addEventListener('input', function (e) {
    var dk = e.target.dataset && e.target.dataset.daynote;
    if (dk) { var dt = e.target.value; store.set('daynote.' + dk, dt.trim() ? { t: dt, d: isoDate(new Date()) } : null); return; }
    var nk = e.target.dataset && e.target.dataset.exnote;
    if (nk) { var t = e.target.value; store.set('exnote.' + nk, t.trim() ? { t: t, d: isoDate(new Date()) } : null); return; }
    var rk = e.target.dataset && e.target.dataset.repsin;
    if (rk) { store.set('reps.' + rk, e.target.value.replace(/[^0-9]/g, '')); return; }
    var tk = e.target.dataset && e.target.dataset.tmin;
    if (tk) { store.set('tmin.' + tk, e.target.value.replace(/[^0-9]/g, '')); return; }
    var k = e.target.dataset && e.target.dataset.kg;
    if (!k) return;
    var v = e.target.value.replace(',', '.').replace(/[^0-9.]/g, '');
    store.set('kg.' + k, v);
    if (v) {
      var hist = store.get('kgh.' + k, []), today = isoDate(new Date());
      if (hist.length && hist[hist.length - 1].d === today) hist[hist.length - 1].v = v;
      else hist.push({ d: today, v: v });
      store.set('kgh.' + k, hist);
    }
    document.querySelectorAll('[data-kg="' + k + '"]').forEach(function (inp) { if (inp !== e.target) inp.value = v; });
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && e.target.dataset && e.target.dataset.kg) e.target.blur();
  });

  /* ---------- Scheda esercizio ---------- */
  var sheet = $('sheet');
  var sheetAnim = 0, ignorePop = false;
  var sheetNav = null;
  function openSheet(key, reps, name, el) {
    var e = state.program.exercises[key]; if (!e) return;
    if (el) {
      var list = Array.prototype.slice.call(document.querySelectorAll('#main .ex:not(.static)'));
      sheetNav = { list: list, i: list.indexOf(el) };
    }
    name = name || e.name;
    $('sheetTitle').textContent = name;
    var h = '<div class="sheet-inner">';

    if (e.video) {
      h += navigator.onLine
        ? '<div class="video"><iframe src="https://www.youtube-nocookie.com/embed/' + esc(e.video) + '?rel=0&playsinline=1&modestbranding=1" title="Video ' + esc(e.name) + '" allow="accelerometer; encrypted-media; gyroscope; picture-in-picture; fullscreen" allowfullscreen></iframe></div>'
        : '<div class="video video-off">Video non disponibile offline.</div>';
    }
    if (e.img) {
      h += '<div class="photos" id="photos">' +
        '<figure class="on"><img src="' + photoSrc(e, 0) + '" alt="' + esc(e.name) + ' — inizio"><figcaption>INIZIO</figcaption></figure>' +
        '<figure><img src="' + photoSrc(e, 1) + '" alt="' + esc(e.name) + ' — fine"><figcaption>FINE</figcaption></figure></div>' +
        '<div class="dots" id="dots"><button aria-pressed="false" data-p="0">Inizio</button><button aria-pressed="false" data-p="1">Fine</button><button aria-pressed="true" data-p="anim">▶ Movimento</button></div>';
    }

    h += '<div class="facts"><div class="fact"><small>Reps</small><b>' + esc(reps || '—') + '</b></div>' +
      '<div class="fact"><small>Attrezzo</small><b>' + esc(e.equip || '—') + '</b></div>' +
      (e.kg ? '<div class="fact"><small>Kg</small><input type="text" inputmode="decimal" enterkeyhint="done" data-kg="' + esc(key) + '" value="' + esc(store.get('kg.' + key, '')) + '" placeholder="–"></div>' : '') +
      '</div>';
    if (e.cue) h += '<div class="cue">' + esc(e.cue) + '</div>';
    var en = store.get('exnote.' + key, null);
    h += '<label class="f-l" for="exNote">📝 Nota per il coach</label>' +
      '<textarea class="f-in ex-note" id="exNote" data-exnote="' + esc(key) + '" rows="2" placeholder="es. dolore spalla all\'ultima serie, carico facile…">' + esc(en ? en.t : '') + '</textarea>' +
      (en && en.t ? '<p class="muted small">Scritta il ' + esc(en.d.split('-').reverse().slice(0, 2).join('/')) + '. Finisce nel messaggio WhatsApp al coach.</p>' : '<p class="muted small">Finisce nel messaggio WhatsApp al coach.</p>');
    var yt = e.video ? 'https://www.youtube.com/watch?v=' + encodeURIComponent(e.video)
      : 'https://www.youtube.com/results?search_query=' + encodeURIComponent(e.q || (e.name + ' exercise tutorial'));
    h += '<a class="yt-link" href="' + yt + '" target="_blank" rel="noopener">▶ ' + (e.video ? 'Apri il video su YouTube' : 'Cerca il video su YouTube') + '</a>';

    if (!e.img) {
      h += '<div class="own"><img id="ownImg" src="img/mie/' + esc(key) + '.jpg" alt="Foto di Aldo" hidden>' +
        '<b>Foto tua</b>: fotografati in palestra e salva il file come <code>img/mie/' + esc(key) + '.jpg</code> nel repository. Apparirà qui.</div>';
    }
    h += '</div>';

    $('sheetBody').innerHTML = h;
    showSheet();

    var own = $('ownImg');
    if (own) {
      own.onload = function () { own.hidden = false; };
      own.onerror = function () { own.remove(); };
    }
    var photos = $('photos');
    if (photos) {
      var show = function (p) {
        photos.children[0].classList.toggle('on', p === 0);
        photos.children[1].classList.toggle('on', p === 1);
        if (!sheetAnim) {
          $('dots').children[0].setAttribute('aria-pressed', p === 0);
          $('dots').children[1].setAttribute('aria-pressed', p === 1);
        }
      };
      // Animazione: alterna inizio/fine per far vedere il movimento
      var cur = 0;
      var anim = function (on) {
        clearInterval(sheetAnim); sheetAnim = 0;
        $('dots').children[2].setAttribute('aria-pressed', on);
        if (on) sheetAnim = setInterval(function () { cur = 1 - cur; show(cur); }, 1600);
      };
      var pick = function (p) { anim(false); cur = p; show(cur); };
      show(0); $('dots').children[0].setAttribute('aria-pressed', false); anim(true);
      photos.onclick = function () { if (sheetAnim) pick(cur); else anim(true); };
      $('dots').onclick = function (ev) {
        var b = ev.target.closest('button'); if (!b) return;
        if (b.dataset.p === 'anim') anim(!sheetAnim); else pick(+b.dataset.p);
      };
    }
  }
  function navMark(id) {
    Array.prototype.forEach.call(document.querySelectorAll('.vault-view'), function (v) { v.remove(); });
    Array.prototype.forEach.call(document.querySelectorAll('.bnav button'), function (b) { b.classList.toggle('on', b.id === id); });
  }
  function showSheet() {
    var was = !sheet.hidden;
    $('sheetBody').scrollTop = 0;
    sheet.hidden = false;
    document.body.classList.add('sheet-open'); window.scrollTo(0, 0);
    document.documentElement.style.setProperty('--hdr', document.querySelector('.top').offsetHeight + 'px');
    document.body.style.overflow = 'hidden';
    if (!was) history.pushState({ sheet: 1 }, '');
  }
  function closeSheet(fromPop) {
    if (sheet.hidden) return;
    sheet.hidden = true;
    clearInterval(sheetAnim); sheetAnim = 0; sheetNav = null;
    $('sheetBody').innerHTML = '';
    document.body.style.overflow = '';
    document.body.classList.remove('sheet-open');
    navMark('');
    if (!fromPop && history.state && history.state.sheet) { ignorePop = true; history.back(); }
  }
  $('sheetClose').onclick = function () { closeSheet(false); };

  // Swipe sinistra/destra: esercizio successivo/precedente (scheda), fase successiva/precedente (timer)
  function onSwipe(el, fn) {
    var sx = 0, sy = 0, t0 = 0, ok = false;
    el.addEventListener('touchstart', function (ev) {
      var t = ev.touches[0]; sx = t.clientX; sy = t.clientY; t0 = Date.now();
      ok = ev.touches.length === 1 && !ev.target.closest('input,textarea,select,iframe');
    }, { passive: true });
    el.addEventListener('touchend', function (ev) {
      if (!ok) return; ok = false;
      var t = ev.changedTouches[0], dx = t.clientX - sx, dy = t.clientY - sy;
      if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.6 && Date.now() - t0 < 700) fn(dx < 0 ? 1 : -1);
    }, { passive: true });
  }
  onSwipe($('sheetBody'), function (dir) {
    if (!sheetNav) return;
    var j = sheetNav.i + dir; if (j < 0 || j >= sheetNav.list.length) return;
    var row = sheetNav.list[j], nav = sheetNav;
    openSheet(row.dataset.ex, row.dataset.reps, row.dataset.name);
    sheetNav = nav; sheetNav.i = j;
    buzz(10);
  });
  window.addEventListener('popstate', function () { if (ignorePop) { ignorePop = false; return; } closeSheet(true); });


  /* ---------- Promemoria: giorni senza allenamento, prossimo allenamento, stop ---------- */
  var DOW = ['dom', 'lun', 'mar', 'mer', 'gio', 'ven', 'sab'];
  function dayDiff(a, b) { return Math.round((new Date(b + 'T12:00') - new Date(a + 'T12:00')) / DAY_MS); }
  function activeStop() {
    var t = isoDate(new Date()), log = getLog();
    for (var i = log.length - 1; i >= 0; i--) { var x = log[i]; if (x.type === 'Stop' && x.when.slice(0, 10) <= t && x.until >= t) return x; }
    return null;
  }
  function lastActive() {
    var log = getLog();
    for (var i = log.length - 1; i >= 0; i--) if (ACTIVE.indexOf(log[i].type) >= 0) return log[i];
    return null;
  }
  function motivation() {
    var list = (state.program.motivation || []);
    return list.length ? list[Math.floor(Date.now() / DAY_MS) % list.length] : '';
  }
  // Messaggio motivazionale a fine allenamento, in base agli allenamenti fatti nella settimana (su 4)
  function weekMessage() {
    var wm = state.program.weekMotivation || {};
    var wStart = isoDate(mondayOf(new Date()));
    var n = getLog().filter(function (x) { return x.when.slice(0, 10) >= wStart && ACTIVE.indexOf(x.type) >= 0; }).length;
    var list = wm[String(Math.min(n, 5))] || [];
    var msg = list.length ? list[Math.floor(Math.random() * list.length)] : '';
    return n + ' allenament' + (n === 1 ? 'o' : 'i') + ' questa settimana. ' + msg;
  }
  // Frase ispirata ai libri scelti da Aldo (parole nostre, non estratti dei testi)
  function bookLine() {
    var l = state.program.bookLines || []; if (!l.length) return '';
    var b = l[Math.floor(Math.random() * l.length)];
    return '📖 ' + b.text + ' — ispirato a ' + b.src;
  }
  function fmtWhen(dt) { var d = new Date(dt); return DOW[d.getDay()] + ' ' + d.getDate() + '/' + (d.getMonth() + 1) + ' alle ' + dt.slice(11, 16); }
  function reminderHtml() {
    var today = isoDate(new Date());
    var st = activeStop();
    if (st) return '<div class="remind r-stop"><b>Stop · ' + esc(st.reason || '') + '</b> fino al ' + st.until.split('-').reverse().slice(0, 2).join('/') +
      '. Recupera bene: anche il riposo fa parte dell\'allenamento.</div>';
    var pl = store.get('planned', null), h = '';
    if (pl && pl.when.slice(0, 10) >= today) {
      h += '<div class="remind r-plan"><b>Prossimo allenamento:</b> ' + esc(fmtWhen(pl.when)) + (pl.label ? ' · ' + esc(pl.label) : '') +
        '<div class="r-btns"><button data-r="cal">Aggiungi al calendario</button><button data-r="plan">Cambia</button></div></div>';
      return h;
    }
    var la = lastActive();
    if (!la) return '';
    var n = dayDiff(la.when.slice(0, 10), today);
    if (n < 2 || store.get('remindSnooze', '') === today) return '';
    return '<div class="remind r-late"><b>Non ti alleni da ' + n + ' giorni…</b> quando programmi il tuo prossimo allenamento?' +
      '<p class="r-quote">' + esc(motivation()) + '</p>' +
      (state.program.bookLines ? '<p class="r-quote">' + esc(bookLine()) + '</p>' : '') + (state.program.motivationLinks || []).map(function (l) { return '<p class="r-quote"><a href="' + esc(l.url) + '" target="_blank" rel="noopener">' + esc(l.label) + '</a></p>'; }).join('') +
      '<div class="r-btns"><button data-r="plan" class="r-main">Programma</button><button data-r="later">Più tardi</button></div></div>';
  }
  function bindReminder() {
    $('main').querySelectorAll('[data-r]').forEach(function (b) {
      b.onclick = function () {
        var a = b.dataset.r;
        if (a === 'later') { store.set('remindSnooze', isoDate(new Date())); renderDay(); }
        if (a === 'plan') openPlanForm();
        if (a === 'cal') { var pl = store.get('planned', null); if (pl) downloadIcs(pl); }
      };
    });
  }
  function openPlanForm() {
    var train = state.days.filter(function (d) { return d.id !== 'yoga'; });
    var nx = state.days[nextDayIndex()];
    var tmr = addDays(new Date(), 1); tmr.setHours(18, 30, 0, 0);
    $('sheetTitle').textContent = 'Programma allenamento';
    $('sheetBody').innerHTML = '<div class="sheet-inner form">' +
      '<label class="f-l" for="pWhen">Quando</label><input class="f-in" id="pWhen" type="datetime-local" value="' + localDT(tmr) + '">' +
      '<label class="f-l">Cosa</label>' + chips('pday', train.map(function (d) { return d.tab; }).concat(['Padel', 'Corsa']), nx ? nx.tab : '') +
      '<label class="f-l">Ripeti ogni settimana (facoltativo)</label><div class="chips multi" id="pRep">' +
        ['LU', 'MA', 'ME', 'GI', 'VE', 'SA', 'DO'].map(function (g) { return '<button type="button" aria-pressed="false" data-v="' + g + '">' + g + '</button>'; }).join('') + '</div>' +
      '<p class="muted small">Dopo il salvataggio si apre il Calendario dell\'iPhone: tocca «Aggiungi». L\'avviso arriva 30 minuti prima come notifica, anche ad app chiusa. Con i giorni selezionati il promemoria si ripete ogni settimana.</p>' +
      '<button class="btn-big btn-red" id="pSave">Salva e aggiungi al calendario</button></div>';
    showSheet();
    var c = $('sheetBody').querySelector('.chips');
    c.onclick = function (ev) { var b = ev.target.closest('button'); if (!b) return; c.querySelectorAll('button').forEach(function (x) { x.setAttribute('aria-pressed', x === b); }); };
    $('pRep').onclick = function (ev) { var b = ev.target.closest('button'); if (b) b.setAttribute('aria-pressed', b.getAttribute('aria-pressed') !== 'true'); };
    $('pSave').onclick = function () {
      var sel = c.querySelector('[aria-pressed="true"]');
      var MAP = { LU: 'MO', MA: 'TU', ME: 'WE', GI: 'TH', VE: 'FR', SA: 'SA', DO: 'SU' };
      var rep = [].map.call($('pRep').querySelectorAll('[aria-pressed="true"]'), function (b) { return MAP[b.dataset.v]; });
      var pl = { when: $('pWhen').value, label: sel ? sel.dataset.v : '', repeat: rep };
      if (!pl.when) return;
      store.set('planned', pl); store.set('remindSnooze', '');
      downloadIcs(pl);
      closeSheet(false); renderDay();
    };
  }

  /* ---------- 📅 Pianifica la settimana: scegli i giorni, ogni allenamento va nel Calendario (iPhone o Google) ---------- */
  function openWeekPlanner() {
    var train = state.days.filter(function (d) { return d.id !== 'yoga' && !d.optional; });
    var sv = store.get('weekPlan', { days: ['LU', 'ME', 'VE', 'SA'].slice(0, train.length), time: '18:30', repeat: true });
    var G = ['LU', 'MA', 'ME', 'GI', 'VE', 'SA', 'DO'];
    $('sheetTitle').textContent = '📅 Pianifica la settimana';
    $('sheetBody').innerHTML = '<div class="sheet-inner form">' +
      '<label class="f-l">In quali giorni ti alleni? (' + train.length + ' allenamenti)</label><div class="chips multi" id="wpDays">' +
        G.map(function (g) { return '<button type="button" data-v="' + g + '" aria-pressed="' + (sv.days.indexOf(g) >= 0) + '">' + g + '</button>'; }).join('') + '</div>' +
      '<label class="f-l" for="wpTime">Ora</label><input class="f-in" id="wpTime" type="time" value="' + esc(sv.time) + '">' +
      '<label class="chk-row"><input type="checkbox" id="wpRep"' + (sv.repeat ? ' checked' : '') + '> Ripeti ogni settimana</label>' +
      '<div id="wpList"></div>' +
      '<button class="btn-big btn-red" id="wpIcs">Aggiungi tutti al Calendario (iPhone)</button>' +
      '<p class="muted small">Un solo file con tutti gli allenamenti e l\'avviso 30 minuti prima. Se il Calendario dell\'iPhone è collegato a Google, compaiono anche lì.</p></div>';
    showSheet();
    var days = $('wpDays');
    var plan = function () {
      var sel = [].map.call(days.querySelectorAll('[aria-pressed="true"]'), function (b) { return b.dataset.v; });
      sel.sort(function (a, b) { return G.indexOf(a) - G.indexOf(b); });
      var t = $('wpTime').value || '18:30', rep = $('wpRep').checked;
      store.set('weekPlan', { days: sel, time: t, repeat: rep });
      var now = new Date(), tp = t.split(':');
      return sel.slice(0, train.length).map(function (g, i) {
        var want = (G.indexOf(g) + 1) % 7, d = new Date(now.getFullYear(), now.getMonth(), now.getDate(), +tp[0], +tp[1]);
        while (d.getDay() !== want || d < now) d.setDate(d.getDate() + 1);
        return { when: d, g: g, day: train[i], rep: rep };
      });
    };
    var show = function () {
      var ev = plan();
      $('wpList').innerHTML = ev.length ? ev.map(function (e, i) {
        return '<div class="wp-row"><div><b>' + e.g + ' ' + e.when.getDate() + '/' + (e.when.getMonth() + 1) + '</b> · ' + esc(e.day.tab) + (e.day.title ? ' — ' + esc(e.day.title) : '') + '</div>' +
          '<a class="wp-g" target="_blank" rel="noopener" href="' + gcalUrl(e) + '">Google</a></div>';
      }).join('') + (days.querySelectorAll('[aria-pressed="true"]').length > train.length ? '<p class="muted small">Hai scelto più giorni di quanti allenamenti: uso i primi ' + train.length + '.</p>' : '')
        : '<p class="muted small">Scegli almeno un giorno.</p>';
    };
    days.onclick = function (ev) { var b = ev.target.closest('button'); if (!b) return; b.setAttribute('aria-pressed', b.getAttribute('aria-pressed') !== 'true'); show(); };
    $('wpTime').onchange = show; $('wpRep').onchange = show;
    $('wpIcs').onclick = function () { var ev = plan(); if (ev.length) downloadWeekIcs(ev); };
    show();
  }
  var RR = { LU: 'MO', MA: 'TU', ME: 'WE', GI: 'TH', VE: 'FR', SA: 'SA', DO: 'SU' };
  function lDT(d) { var p = function (n) { return ('0' + n).slice(-2); }; return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + 'T' + p(d.getHours()) + p(d.getMinutes()) + '00'; }
  function evTitle(e) { return 'Allenamento ' + e.day.tab + (e.day.title ? ' – ' + e.day.title : ''); }
  function gcalUrl(e) {
    var end = new Date(e.when.getTime() + 60 * 60000), tz = '';
    try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone; } catch (x) {}
    return 'https://calendar.google.com/calendar/render?action=TEMPLATE&text=' + encodeURIComponent(evTitle(e)) + '&dates=' + lDT(e.when) + '/' + lDT(end) +
      '&details=' + encodeURIComponent('Apri TRAIN: ' + location.origin + location.pathname) + (tz ? '&ctz=' + encodeURIComponent(tz) : '') +
      (e.rep ? '&recur=' + encodeURIComponent('RRULE:FREQ=WEEKLY;BYDAY=' + RR[e.g]) : '');
  }
  function downloadWeekIcs(list) {
    var lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//TRAIN.ALDO//IT'], stamp = lDT(new Date());
    list.forEach(function (e, i) {
      lines = lines.concat(['BEGIN:VEVENT', 'UID:' + Date.now() + '-' + i + '@trainaldo', 'DTSTAMP:' + stamp,
        'DTSTART:' + lDT(e.when), 'DTEND:' + lDT(new Date(e.when.getTime() + 60 * 60000)), 'SUMMARY:' + evTitle(e).replace(/[,;]/g, ' '),
        'DESCRIPTION:Apri TRAIN: ' + location.origin + location.pathname].concat(e.rep ? ['RRULE:FREQ=WEEKLY;BYDAY=' + RR[e.g]] : []).concat(
        ['BEGIN:VALARM', 'TRIGGER:-PT30M', 'ACTION:DISPLAY', 'DESCRIPTION:Tra 30 minuti: allenamento!', 'END:VALARM', 'END:VEVENT']));
    });
    lines.push('END:VCALENDAR');
    var a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([lines.join('\r\n')], { type: 'text/calendar' }));
    a.download = 'allenamenti-settimana.ics';
    document.body.appendChild(a); a.click(); a.remove();
  }

  // Evento calendario con avviso: il Calendario dell'iPhone fa da notifica
  function downloadIcs(pl) {
    var d = new Date(pl.when);
    if (pl.repeat && pl.repeat.length) {   // la prima data deve cadere in uno dei giorni scelti
      var codes = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
      for (var g = 0; g < 7 && pl.repeat.indexOf(codes[d.getDay()]) < 0; g++) d.setDate(d.getDate() + 1);
    }
    var e = new Date(d.getTime() + 60 * 60000);
    var f = function (x) { return x.getUTCFullYear() + ('0' + (x.getUTCMonth() + 1)).slice(-2) + ('0' + x.getUTCDate()).slice(-2) + 'T' + ('0' + x.getUTCHours()).slice(-2) + ('0' + x.getUTCMinutes()).slice(-2) + '00Z'; };
    var who = state.program.athleteName ? ' · ' + state.program.athleteName : '';
    var ics = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//TRAIN.ALDO//IT', 'BEGIN:VEVENT',
      'UID:' + Date.now() + '@trainaldo', 'DTSTAMP:' + f(new Date()), 'DTSTART:' + f(d), 'DTEND:' + f(e),
      'SUMMARY:Allenamento ' + (pl.label || '') + who, 'DESCRIPTION:' + motivation().replace(/[,;]/g, ' ') + '\\nApri TRAIN: ' + location.origin + location.pathname,
    ].concat(pl.repeat && pl.repeat.length ? ['RRULE:FREQ=WEEKLY;BYDAY=' + pl.repeat.join(',')] : []).concat([
      'BEGIN:VALARM', 'TRIGGER:-PT30M', 'ACTION:DISPLAY', 'DESCRIPTION:Tra 30 minuti: allenamento!', 'END:VALARM',
      'END:VEVENT', 'END:VCALENDAR']).join('\r\n');
    var a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([ics], { type: 'text/calendar' }));
    a.download = 'allenamento.ics';
    document.body.appendChild(a); a.click(); a.remove();
  }

  /* ---------- Messaggio al coach (WhatsApp) ---------- */
  function who() { return state.program.athleteName || 'Aldo'; }
  function entryText(x) {
    var d = x.when.split('T');
    return '🏋️ ' + who() + ' · ' + x.type + (x.label ? ' · ' + x.label : '') + '\n📅 ' + d[0].split('-').reverse().join('/') + ' ' + (d[1] || '') +
      (x.place ? '\n📍 ' + x.place : '') + (x.dur ? '\n⏱ ' + x.dur + ' min' : '') + (x.kcal ? ' · ' + x.kcal + ' kcal' : '') +
      (x.type === 'Stop' ? '\n⛔ ' + (x.reason || '') + ' fino al ' + x.until.split('-').reverse().slice(0, 2).join('/') : '') +
      (x.note ? '\n💬 ' + x.note : '');
  }
  function sendWhatsApp(text) {
    // senza numero: WhatsApp chiede a chi inviarlo (coach, preparatore, fisio)
    window.open('https://wa.me/?text=' + encodeURIComponent(text), '_blank');
  }
  function openCoachMessage(day, cur) {
    var ex = state.program.exercises, lines = [];
    (cur.sections || []).forEach(function (sec) {
      (sec.items || []).forEach(function (it) {
        var e = ex[it.ex] || {}, kg = e.kg ? store.get('kg.' + it.ex, '') : '', nt = store.get('exnote.' + it.ex, null);
        if (kg || (nt && nt.t)) lines.push('• ' + (it.name || e.name) + (it.reps ? ' ' + it.reps : '') + (kg ? ' · ' + kg + ' kg' : '') + (nt && nt.t ? ' — ' + nt.t : ''));
      });
    });
    var dnote = store.get('daynote.' + state.plan.id + '.' + day.id, null);
    var base = '🏋️ ' + who() + ' · ' + state.plan.name + ' · ' + day.tab + (day.variants ? ' · ' + cur.label : '') +
      '\n📅 ' + new Date().toLocaleDateString('it-IT') + '\n\nSensazioni: ';
    $('sheetTitle').textContent = 'Messaggio al coach';
    $('sheetBody').innerHTML = '<div class="sheet-inner form">' +
      '<label class="f-l">Come è andata? (1 = pessimo, 5 = ottimo)</label>' + chips('feel', ['1', '2', '3', '4', '5'], '') +
      '<label class="f-l">Dolori?</label>' + chips('g_dolore', ['Nessuno', 'Lieve', 'Forte'], '') +
      '<label class="f-l">Energia</label>' + chips('g_energia', ['Bassa', 'Media', 'Alta'], '') +
      '<label class="f-l">Sonno stanotte</label>' + chips('g_sonno', ['< 6 ore', '6–7 ore', '7–8 ore', '> 8 ore'], '') +
      '<label class="f-l" for="waTxt">Messaggio (puoi modificarlo)</label>' +
      '<textarea class="f-in" id="waTxt" rows="10">' + esc(base + (lines.length ? '\n\nEsercizi:\n' + lines.join('\n') : '') + (dnote && dnote.t ? '\n\nNote:\n' + dnote.t : '')) + '</textarea>' +
      '<p class="muted small">Dentro ci sono i kg e le «📝 note per il coach» degli esercizi. Toccando il pulsante si apre WhatsApp e scegli a chi inviarlo.</p>' +
      '<button class="btn-big btn-wa-big" id="waSend">Apri WhatsApp</button></div>';
    showSheet();
    var GUIDED = ['Dolori', 'Energia', 'Sonno'];
    $('sheetBody').querySelectorAll('.chips').forEach(function (c, i) {
      c.onclick = function (ev) {
        var b = ev.target.closest('button'); if (!b) return;
        c.querySelectorAll('button').forEach(function (x) { x.setAttribute('aria-pressed', x === b); });
        var t = $('waTxt').value;
        if (i === 0) { $('waTxt').value = t.replace(/Sensazioni:( \d\/5)?/, 'Sensazioni: ' + b.dataset.v + '/5'); return; }
        var k = GUIDED[i - 1], line = k + ': ' + b.dataset.v, re = new RegExp('^' + k + ':.*$', 'm');
        if (re.test(t)) t = t.replace(re, line);
        else {
          var at = t.search(/\n\n(Esercizi:|Note:)/);
          t = at < 0 ? t + '\n' + line : t.slice(0, at) + '\n' + line + t.slice(at);
        }
        $('waTxt').value = t;
      };
    });
    $('waSend').onclick = function () { sendWhatsApp($('waTxt').value); };
  }

  /* ---------- Playlist preferite (Spotify, Apple Music, YouTube Music) ---------- */
  var MUSIC = [{ id: 'forza', label: 'Forza' }, { id: 'cardio', label: 'Cardio' }, { id: 'yoga', label: 'Yoga' }];
  // 🎵 in cima a ogni giorno: scegli la playlist (si apre Spotify/Apple Music, la musica continua in sottofondo)
  function openMusic(day) {
    var m = store.get('music', {});
    var first = day && day.id === 'yoga' ? 'yoga' : 'forza';
    var list = MUSIC.slice().sort(function (a, b) { return (b.id === first) - (a.id === first); });
    $('sheetTitle').textContent = '🎵 Musica';
    $('sheetBody').innerHTML = '<div class="sheet-inner form">' +
      list.map(function (x) {
        return m[x.id] ? '<div class="music-row"><a class="music-big" href="' + esc(m[x.id]) + '" target="_blank" rel="noopener">▶ ' + x.label + '</a>' +
          '<button type="button" class="music-chg" data-chg="' + x.id + '">✏️ Cambia</button></div>'
          : '<div class="music-big off">' + x.label + ' · link non impostato</div>';
      }).join('') +
      '<details class="music-edit"' + (MUSIC.some(function (x) { return m[x.id]; }) ? '' : ' open') + '><summary>✏️ Cambia i link delle playlist</summary>' +
      MUSIC.map(function (x) {
        return '<label class="f-l" for="mu2_' + x.id + '">' + x.label + '</label><input class="f-in" id="mu2_' + x.id + '" data-music="' + x.id + '" inputmode="url" placeholder="incolla il link (Spotify, Apple Music, YouTube Music)" value="' + esc(m[x.id] || '') + '">';
      }).join('') +
      '<p class="plan-hint">In Spotify: playlist → ··· → Condividi → Copia link.</p><button class="btn-big btn-red" id="muSave">Salva</button></details>' +
      '<p class="plan-hint">«▶» apre l\'app Spotify (o la piattaforma del link): la musica continua in sottofondo anche a schermo spento, poi torni in TRAIN.</p></div>';
    showSheet();
    $('sheetBody').querySelectorAll('[data-chg]').forEach(function (b) {
      b.onclick = function () { var d = $('sheetBody').querySelector('.music-edit'); d.open = true; var i = $('mu2_' + b.dataset.chg); i.focus(); i.select(); };
    });
    $('muSave').onclick = function () {
      var mm = store.get('music', {});
      $('sheetBody').querySelectorAll('[data-music]').forEach(function (inp) { mm[inp.dataset.music] = inp.value.trim(); });
      store.set('music', mm);
      openMusic(day);
    };
  }


  /* ---------- ⏱ Timer libero: Tabata, EMOM, intervalli personalizzati ---------- */
  function openFreeTimer() {
    var t = store.get('freeTimer', { work: 20, rest: 10, rounds: 8 });
    $('sheetTitle').textContent = '⏱ Timer';
    $('sheetBody').innerHTML = '<div class="sheet-inner form">' +
      '<label class="f-l">Modello</label><div class="chips" id="ftPre">' +
      '<button type="button" data-p="20,10,8">Tabata 20/10 ×8</button><button type="button" data-p="60,0,10">EMOM 10\'</button>' +
      '<button type="button" data-p="40,20,6">40/20 ×6</button><button type="button" data-p="30,30,10">30/30 ×10</button></div>' +
      '<div class="f-three"><div><label class="f-l" for="ftW">Lavoro (sec)</label><input class="f-in" id="ftW" type="number" inputmode="numeric" min="5" value="' + t.work + '"></div>' +
      '<div><label class="f-l" for="ftR">Recupero (sec)</label><input class="f-in" id="ftR" type="number" inputmode="numeric" min="0" value="' + t.rest + '"></div>' +
      '<div><label class="f-l" for="ftN">Giri</label><input class="f-in" id="ftN" type="number" inputmode="numeric" min="1" value="' + t.rounds + '"></div></div>' +
      '<p class="muted small" id="ftTot"></p>' +
      '<button class="btn-big btn-red" id="ftGo">Avvia</button>' +
      '<p class="plan-hint">Segnale a ogni cambio, 3-2-1 prima della fine, campanello a 15\'\' nelle fasi lunghe. Puoi usarlo per tabata, circuiti metabolici o qualsiasi esercizio a tempo.</p></div>';
    showSheet();
    var tot = function () {
      var w = +$('ftW').value || 0, r = +$('ftR').value || 0, n = +$('ftN').value || 0;
      var sTot = n * w + Math.max(0, n - 1) * r;
      $('ftTot').textContent = 'Durata totale: ' + fmtClock(sTot);
    };
    ['ftW', 'ftR', 'ftN'].forEach(function (id) { $(id).oninput = tot; }); tot();
    $('ftPre').onclick = function (ev) {
      var b = ev.target.closest('[data-p]'); if (!b) return;
      var v = b.dataset.p.split(','); $('ftW').value = v[0]; $('ftR').value = v[1]; $('ftN').value = v[2]; tot();
    };
    $('ftGo').onclick = function () {
      var w = Math.max(5, +$('ftW').value || 20), r = Math.max(0, +$('ftR').value || 0), n = Math.max(1, +$('ftN').value || 1);
      store.set('freeTimer', { work: w, rest: r, rounds: n });
      var ph = [];
      for (var i = 1; i <= n; i++) {
        ph.push({ title: 'LAVORO', step: 'Giro ' + i + ' di ' + n, sec: w, kind: 'work' });
        if (r && i < n) ph.push({ title: 'RECUPERO', step: 'Giro ' + i + ' di ' + n, sec: r, kind: 'rest' });
      }
      closeSheet(false);
      unlockAudio();
      startGuided(null, ph);
    };
  }

  /* ---------- Diario: allenamenti, fisioterapia, progressi ---------- */
  var PLACES = ['Palestra', 'Casa', 'Aperto', 'Campo'];
  var TYPES = ['Allenamento', 'Padel', 'Corsa', 'Yoga', 'Fisioterapia', 'Nota', 'Stop'];
  var ACTIVE = ['Allenamento', 'Padel', 'Corsa', 'Yoga'];          // contano come allenamento
  var STOP_REASONS = ['Infortunio', 'Febbre / malattia', 'Impedimento', 'Riposo'];
  function addDays(d, n) { var x = new Date(d); x.setDate(x.getDate() + n); return x; }
  function getLog() { return store.get('log', []); }
  function localDT(d) { return isoDate(d) + 'T' + ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2); }
  function chips(name, list, sel) {
    return '<div class="chips" data-name="' + name + '">' + list.map(function (x) {
      return '<button type="button" aria-pressed="' + (x === sel) + '" data-v="' + esc(x) + '">' + esc(x) + '</button>';
    }).join('') + '</div>';
  }
  function openLogForm(type, label, ref, pre) {
    pre = pre || {};
    $('sheetTitle').textContent = 'Registra';
    var lastPlace = store.get('lastPlace', 'Palestra');
    $('sheetBody').innerHTML = '<div class="sheet-inner form">' +
      '<label class="f-l">Tipo</label>' + chips('type', state.plan.kind === 'rehab' ? TYPES.filter(function (t) { return t !== 'Padel' && t !== 'Corsa'; }) : TYPES, type) +
      '<div id="fStop" class="f-group"><label class="f-l">Motivo dello stop</label>' + chips('reason', STOP_REASONS, 'Infortunio') +
      '<label class="f-l" for="fUntil">Fino al (compreso)</label><input class="f-in" id="fUntil" type="date" value="' + isoDate(addDays(new Date(), 2)) + '"></div>' +
      (ref ? '' : '<div id="fDayBox" class="f-group"><label class="f-l">Giorno della scheda ' + esc(state.plan.name) + '</label>' +
        chips('dayref', state.days.filter(function (d) { return d.id !== 'yoga'; }).map(function (d) { return d.tab; }).concat(['Altro']), 'Altro') + '</div>') +
      '<div id="fAct" class="f-group"><label class="f-l" for="fLabel">Cosa</label><input class="f-in" id="fLabel" value="' + esc(label || '') + '" placeholder="es. Day 1, seduta fisio…">' +
      '<label class="f-l">Luogo</label>' + chips('place', PLACES, lastPlace) +
      '<div class="f-two"><div><label class="f-l" for="fDur">Minuti</label><input class="f-in" id="fDur" type="number" inputmode="numeric" min="0" placeholder="facoltativo" value="' + (pre.dur || '') + '"></div>' +
      '<div><label class="f-l" for="fKcal">Calorie (kcal)</label><input class="f-in" id="fKcal" type="number" inputmode="numeric" min="0" placeholder="da Apple Watch"></div></div>' +
      '<button type="button" class="btn-ghost-dark" id="fPaste">📋 Incolla minuti e calorie (Apple Watch)</button></div>' +
      '<label class="f-l" for="fWhen">Data e ora</label><input class="f-in" id="fWhen" type="datetime-local" value="' + (pre.when || localDT(new Date())) + '">' +
      '<label class="f-l" for="fNote">Note</label><textarea class="f-in" id="fNote" rows="3" placeholder="come è andata, dolori, sensazioni…"></textarea>' +
      '<button class="btn-big btn-red" id="fSave">Salva</button></div>';
    showSheet();
    var body = $('sheetBody');
    var setMode = function (t) {
      $('fStop').hidden = t !== 'Stop';
      $('fAct').hidden = t === 'Stop' || t === 'Nota';
      if ($('fDayBox')) $('fDayBox').hidden = ACTIVE_DAY.indexOf(t) < 0;
      $('fNote').placeholder = t === 'Stop' ? 'es. distorsione caviglia, 38° di febbre…' : t === 'Nota' ? 'scrivi la tua nota' : 'come è andata, dolori, sensazioni…';
    };
    setMode(type);
    // Incolla: legge un testo tipo «45 min 420 kcal» copiato da Fitness o da un Comando rapido
    $('fPaste').onclick = function () {
      var apply = function (t) {
        var m = (t || '').match(/(\d+[.,]?\d*)\s*(?:min|minuti|'|m\b)/i), k = (t || '').match(/(\d+[.,]?\d*)\s*(?:kcal|cal)/i);
        if (m) $('fDur').value = Math.round(parseFloat(m[1].replace(',', '.')));
        if (k) $('fKcal').value = Math.round(parseFloat(k[1].replace(',', '.')));
        if (!m && !k) alert('Non ho trovato minuti o calorie negli appunti. Copia un testo tipo «45 min 420 kcal».');
      };
      if (navigator.clipboard && navigator.clipboard.readText) navigator.clipboard.readText().then(apply, function () { apply(prompt('Incolla qui il testo (es. 45 min 420 kcal):') || ''); });
      else apply(prompt('Incolla qui il testo (es. 45 min 420 kcal):') || '');
    };
    body.querySelectorAll('.chips').forEach(function (c) {
      c.onclick = function (ev) {
        var b = ev.target.closest('button'); if (!b) return;
        c.querySelectorAll('button').forEach(function (x) { x.setAttribute('aria-pressed', x === b); });
        if (c.dataset.name === 'type') {
          setMode(b.dataset.v);
          if (b.dataset.v === 'Fisioterapia' && !$('fLabel').value.match(/fisio/i)) $('fLabel').value = 'Seduta di fisioterapia';
        }
      };
    });
    $('fSave').onclick = function () {
      var val = function (n) { var b = body.querySelector('.chips[data-name="' + n + '"] [aria-pressed="true"]'); return b ? b.dataset.v : ''; };
      var t = val('type'), act = t !== 'Stop' && t !== 'Nota';
      var entry = { id: Date.now(), when: $('fWhen').value || localDT(new Date()), type: t,
        place: act ? val('place') : '', label: act ? $('fLabel').value.trim() : '', dur: act ? (+$('fDur').value || 0) : 0, note: $('fNote').value.trim() };
      if (act && +$('fKcal').value) entry.kcal = +$('fKcal').value;
      if (ref && ACTIVE_DAY.indexOf(t) >= 0) entry.week = planWeek(state.plan).n;
      if (t === 'Stop') { entry.reason = val('reason'); entry.until = $('fUntil').value || entry.when.slice(0, 10); entry.label = entry.reason; }
      if (!ref && ACTIVE_DAY.indexOf(t) >= 0) {
        var dr = val('dayref'), dd = state.days.filter(function (d) { return d.tab === dr; })[0];
        if (dd) { ref = { planId: state.plan.id, dayId: dd.id }; if (!entry.label || (t !== 'Allenamento' && entry.label === t)) entry.label = t !== 'Allenamento' ? t + ' · ' + state.plan.name + ' · ' + dd.tab : '';
          if (!entry.label) entry.label = state.plan.name + ' · ' + dd.tab; }
      }
      if (ref && ACTIVE_DAY.indexOf(t) >= 0) { entry.planId = ref.planId; entry.dayId = ref.dayId; }
      var log = getLog(); log.push(entry);
      log.sort(function (a, b) { return a.when < b.when ? -1 : 1; });
      store.set('log', log); if (pre.sess) store.set('session', null);
      if (ref && ACTIVE_DAY.indexOf(t) >= 0) clearSets(ref.planId, ref.dayId);
      if (entry.place) store.set('lastPlace', entry.place);
      if (ACTIVE.indexOf(t) >= 0) store.set('remindSnooze', '');
      closeSheet(false);
      renderTabs(); renderDay();
      var flash = 'Salvato ✓';
      if (ref && ACTIVE_DAY.indexOf(t) >= 0) flash += ' — ' + weekMessage() + (bookLine() ? ' ' + bookLine() : '');
      setTimeout(function () { openDiary(flash); }, 50);
    };
  }

  /* ---------- Card social: immagine verticale (storia) da condividere ---------- */
  function shareCard(x) {
    // Card social in stile disegnato: carta grigia, tratto nero, granata per gli accenti
    Promise.all([document.fonts.load("italic 900 100px 'Barlow Condensed'"), document.fonts.load("100px 'Caveat Brush'")]).catch(function () {}).then(function () { drawCard(x); });
  }
  function drawCard(x) {
    var cv = document.createElement('canvas'); cv.width = 1080; cv.height = 1920;
    var c = cv.getContext('2d'), HW = "'Caveat Brush', 'Marker Felt', cursive", BC = "italic 900 %spx 'Barlow Condensed', 'Arial Narrow', sans-serif", F = '-apple-system, "SF Pro Display", Helvetica, Arial, sans-serif';
    var INK = '#1d1d21', RED = '#8b1a1a', PAPER = '#d3d4d8', DARK = '#2a2b31';
    c.fillStyle = PAPER; c.fillRect(0, 0, 1080, 1920);
    c.fillStyle = DARK; c.fillRect(0, 1450, 1080, 470);
    var day = x.when.slice(0, 10), mon = mondayOf(new Date(day + 'T12:00'));
    var wk = getLog().filter(function (y) { return y.when.slice(0, 10) >= isoDate(mon) && y.when.slice(0, 10) <= day && ACTIVE.indexOf(y.type) >= 0; }).length;
    var d = new Date(day + 'T12:00'), when = d.getDate() + ' ' + ['gen', 'feb', 'mar', 'apr', 'mag', 'giu', 'lug', 'ago', 'set', 'ott', 'nov', 'dic'][d.getMonth()] + ' ' + d.getFullYear();
    var ctr = function (txt, font, y, col) { c.font = font; c.fillStyle = col; c.textAlign = 'center'; c.fillText(txt, 540, y); };
    // titolo
    ctr('TRAIN.BEYOND', BC.replace('%s', 120), 190, RED);
    ctr('ORDINARY WORKOUT', '700 38px ' + F, 250, INK);
    c.fillStyle = INK; c.fillRect(90, 290, 900, 5);
    // riquadro con doppio bordo a mano
    c.strokeStyle = INK; c.lineWidth = 7; c.lineCap = 'round'; c.lineJoin = 'round';
    c.strokeRect(100, 360, 880, 760); c.lineWidth = 3; c.strokeRect(112, 372, 856, 736);
    ctr('Fatto!', '230px ' + HW, 600, INK);
    var lbl = (x.type === 'Allenamento' ? (x.label || x.type) : x.type), words = lbl.split(' · '), yy = 690;
    words.forEach(function (w) { ctr(w, '600 52px ' + F, yy, INK); yy += 62; });
    ctr(when, '500 38px ' + F, yy + 14, '#55565c');
    // disegno: atleta con bilanciere
    c.lineWidth = 9; c.strokeStyle = INK;
    c.beginPath(); c.moveTo(330, 1070); c.lineTo(750, 1070); c.stroke();
    c.beginPath(); c.arc(540, 885, 28, 0, 7); c.stroke();
    c.beginPath(); c.moveTo(540, 913); c.lineTo(540, 985); c.lineTo(500, 1070); c.moveTo(540, 985); c.lineTo(580, 1070); c.moveTo(440, 940); c.lineTo(540, 925); c.lineTo(640, 940); c.stroke();
    c.strokeStyle = RED; c.lineWidth = 11;
    c.beginPath(); c.moveTo(415, 925); c.lineTo(415, 955); c.moveTo(665, 925); c.lineTo(665, 955); c.moveTo(440, 940); c.lineTo(415, 940); c.moveTo(640, 940); c.lineTo(665, 940); c.stroke();
    // numeri
    var stats = [];
    if (x.dur) stats.push([x.dur >= 60 ? Math.floor(x.dur / 60) + 'h' + ('0' + (x.dur % 60)).slice(-2) : String(x.dur), x.dur >= 60 ? 'tempo' : 'minuti']);
    if (x.kcal) stats.push([String(x.kcal), 'kcal']);
    stats.push([String(wk), 'in settimana']);
    var n = stats.length, w = 900 / n;
    stats.forEach(function (st, i) {
      var cx = 90 + w * i + w / 2;
      c.textAlign = 'center'; c.font = '150px ' + HW; c.fillStyle = RED; c.fillText(st[0], cx, 1290);
      c.font = '500 36px ' + F; c.fillStyle = INK; c.fillText(st[1], cx, 1345);
    });
    // cartiglio
    c.save(); c.translate(540, 1405); c.rotate(-0.03);
    c.fillStyle = '#e7e8ea'; c.strokeStyle = RED; c.lineWidth = 6; c.fillRect(-330, -42, 660, 84); c.strokeRect(-330, -42, 660, 84);
    c.font = '54px ' + HW; c.fillStyle = RED; c.textAlign = 'center'; c.fillText('Beyond ordinary workout', 0, 18); c.restore();
    // frase
    var wmL = (state.program.weekMotivation || {})[String(Math.min(wk, 5))] || [], line = wmL.length ? wmL[(+day.slice(8) || 0) % wmL.length] : 'Un allenamento alla volta.';
    c.font = '58px ' + HW; c.fillStyle = '#ffffff'; c.textAlign = 'left';
    var ws = String(line).split(' '), ln = '', ly = 1590;
    ws.forEach(function (w2) { if (c.measureText(ln + w2).width > 640) { c.fillText(ln, 90, ly); ln = ''; ly += 66; } ln += w2 + ' '; });
    c.fillText(ln, 90, ly);
    var done = function () {
      cv.toBlob(function (b) {
        var f = new File([b], 'train-beyond.png', { type: 'image/png' });
        if (navigator.canShare && navigator.canShare({ files: [f] })) { navigator.share({ files: [f], title: 'TRAIN.BEYOND' }).catch(function () {}); return; }
        var a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = 'trainaldo.png'; document.body.appendChild(a); a.click(); a.remove();
      }, 'image/png');
    };
    var im = new Image();
    im.onload = function () {
      c.fillStyle = '#fff'; c.beginPath(); c.roundRect ? c.roundRect(780, 1590, 210, 240, 24) : c.rect(780, 1590, 210, 240); c.fill();
      c.drawImage(im, 790, 1600, 190, 220); done();
    };
    im.onerror = done; im.src = 'img/bow-logo.png';
  }

  function openDiary(flash) {
    var log = getLog(), now = new Date();
    var monday = mondayOf(now);
    var mStart = isoDate(new Date(now.getFullYear(), now.getMonth(), 1)), wStart = isoDate(monday);
    var isAct = function (x) { return ACTIVE.indexOf(x.type) >= 0; };
    var inMonth = log.filter(function (x) { return x.when.slice(0, 10) >= mStart && x.type !== 'Nota'; });
    var inWeek = log.filter(function (x) { return x.when.slice(0, 10) >= wStart && isAct(x); });
    var stopDays = 0;
    log.forEach(function (x) {
      if (x.type !== 'Stop') return;
      for (var d = new Date(x.when.slice(0, 10) + 'T12:00'); isoDate(d) <= x.until; d = addDays(d, 1)) if (isoDate(d) >= mStart && isoDate(d) <= isoDate(now)) stopDays++;
    });
    var sumOf = function (arr, f) { return arr.reduce(function (a, x) { return a + (x[f] || 0); }, 0); };
    var fmtShort = function (m) { return m >= 60 ? Math.floor(m / 60) + 'h' + ('0' + (m % 60)).slice(-2) : m + "'"; };
    var tile = function (h, v, l) { return '<button type="button" class="stat" data-hist="' + h + '"><b>' + v + '</b><small>' + l + '</small></button>'; };
    var weekStrip = function (lg, mon) {
      var todayIso = isoDate(new Date()), cells = '';
      for (var k = 0; k < 7; k++) {
        var d = addDays(mon, k), iso = isoDate(d), ents = lg.filter(function (x) { return x.when.slice(0, 10) === iso; });
        var act = ents.filter(function (x) { return isAct(x) || x.type === 'Fisioterapia'; }), stop = lg.some(function (x) { return x.type === 'Stop' && x.when.slice(0, 10) <= iso && iso <= x.until; });
        var st = act.length ? 'done' : stop ? 'stop' : iso < todayIso ? 'rest' : iso === todayIso ? 'today' : 'next';
        var lbl = act.length ? '✓' : stop ? 'Stop' : iso < todayIso ? 'Rest' : iso === todayIso ? 'Oggi' : '·';
        cells += '<div class="wd s-' + st + (iso === todayIso ? ' now' : '') + '"><small>' + WD[d.getDay()] + '</small><b>' + d.getDate() + '</b><span>' + lbl + '</span></div>';
      }
      return '<div class="wstrip">' + cells + '</div>';
    };
    var count = function (arr, f) { var o = {}; arr.forEach(function (x) { if (x[f]) o[x[f]] = (o[x[f]] || 0) + 1; }); return o; };
    var byPlace = count(inMonth, 'place'), byType = count(inMonth, 'type');
    var fmtMin = function (m) { return m >= 60 ? Math.floor(m / 60) + ' h ' + (m % 60 ? (m % 60) + ' min' : '').trim() : m + ' min'; };
    var sumRow = function (title, arr) {
      var dur = arr.filter(function (x) { return x.dur; }), kc = arr.filter(function (x) { return x.kcal; });
      var tm = dur.reduce(function (a, x) { return a + x.dur; }, 0), tk = kc.reduce(function (a, x) { return a + x.kcal; }, 0);
      return '<div class="d-row"><small>' + title + '</small><span class="pill">Tempo <b>' + fmtMin(tm) + '</b>' + (dur.length ? ' · media ' + fmtMin(Math.round(tm / dur.length)) : '') + '</span>' +
        '<span class="pill">Calorie <b>' + tk + ' kcal</b>' + (kc.length ? ' · media ' + Math.round(tk / kc.length) : '') + '</span></div>';
    };
    var pills = function (o) { var k = Object.keys(o); return k.length ? k.map(function (x) { return '<span class="pill">' + esc(x) + ' <b>' + o[x] + '</b></span>'; }).join('') : '<span class="muted">nessuno</span>'; };

    // Progressi kg: primo e ultimo valore registrato per esercizio
    var ex = state.program.exercises, prog = [];
    Object.keys(ex).forEach(function (k) {
      var hst = store.get('kgh.' + k, []);
      if (hst.length) prog.push({ name: ex[k].name, first: hst[0], last: hst[hst.length - 1], n: hst.length });
    });
    var fmtD = function (d) { var p = d.split('-'); return +p[2] + '/' + +p[1]; };


    var progRow = function (p) {
      var diff = (parseFloat(p.last.v) - parseFloat(p.first.v));
      return '<div class="prog"><span class="p-n">' + esc(p.name) + '</span><span class="p-v">' + esc(p.first.v) + ' → <b>' + esc(p.last.v) + ' kg</b>' +
        (p.n > 1 && diff ? ' <em class="' + (diff > 0 ? 'up' : 'down') + '">' + (diff > 0 ? '+' : '') + Math.round(diff * 10) / 10 + '</em>' : '') +
        '</span><small>dal ' + fmtD(p.first.d) + (p.n > 1 ? ' al ' + fmtD(p.last.d) : '') + '</small></div>';
    };
    // Carichi: in vista i 3 con il maggior aumento, il resto si apre
    var progHtml = function () {
      if (!prog.length) return '<p class="muted">Scrivi i kg negli esercizi: qui vedrai come crescono nel tempo.</p>';
      var gain = function (p) { return (parseFloat(p.last.v) - parseFloat(p.first.v)) || 0; };
      var top = prog.slice().sort(function (a, b) { return gain(b) - gain(a); }).slice(0, 3);
      var rest = prog.filter(function (p) { return top.indexOf(p) < 0; });
      return top.map(progRow).join('') + (rest.length ? '<details class="more"><summary>Tutti i carichi (' + prog.length + ')</summary>' + rest.map(progRow).join('') + '</details>' : '');
    };
    // Storico: una riga per voce (data, tipo, cosa, durata/kcal), si apre per dettagli, 💬 e ✕
    var histRow = function (x) {
      var d = x.when.split('T');
      var sum = '<b>' + fmtD(d[0]) + '</b> · ' + esc(x.type === 'Allenamento' ? (x.label || x.type) : x.type + (x.label && x.label !== x.type ? ' · ' + x.label : '')) +
        (x.dur ? ' · ' + x.dur + "'" : '') + (x.kcal ? ' · ' + x.kcal + ' kcal' : '') +
        (ACTIVE.indexOf(x.type) >= 0 ? '<button type="button" class="e-card" data-card="' + x.id + '" aria-label="Crea la card per i social">📤</button>' : '');
      return '<details class="entry' + (x.type === 'Stop' ? ' e-stop' : x.type === 'Nota' ? ' e-note' : x.type === 'Padel' ? ' e-padel' : '') + '"><summary>' + sum + '</summary>' +
        '<div class="e-body"><div>' + esc(d[1] || '') + ' · ' + esc(x.type) + (x.type === 'Stop' ? ' · fino al ' + fmtD(x.until) : '') + (x.place ? ' · ' + esc(x.place) : '') + (x.week ? ' · sett. ' + x.week : '') + '</div>' +
        (x.note ? '<div class="muted">' + esc(x.note) + '</div>' : '') +
        '<div class="e-btns"><button class="e-share" data-share="' + x.id + '" aria-label="Invia su WhatsApp">💬 Invia</button><button class="e-share" data-card="' + x.id + '" aria-label="Immagine per i social">📤 Card social</button><button class="e-del" data-del="' + x.id + '" aria-label="Elimina">✕ Elimina</button></div></div></details>';
    };
    var histHtml = function () {
      if (!log.length) return '<p class="muted">Ancora nessun allenamento registrato.</p>';
      var rev = log.slice().reverse();
      return rev.slice(0, 6).map(histRow).join('') + (rev.length > 6 ? '<details class="more"><summary>Vecchie registrazioni (' + (rev.length - 6) + ')</summary>' + rev.slice(6).map(histRow).join('') + '</details>' : '');
    };

    var h = '<div class="sheet-inner diary">' + (flash ? '<div class="flash">' + esc(flash) + '</div>' + (log.length ? '<button class="btn-big btn-red card-cta" data-card="' + log[log.length - 1].id + '">📤 Crea la card per i social</button>' : '') : '') +
      '<h3 class="d-h">La mia settimana</h3>' + weekStrip(log, monday) +
      '<div class="stats">' + tile('week', inWeek.length, 'allenamenti', 'week') + tile('week', fmtShort(sumOf(inWeek, 'dur')), 'tempo', 'week') + tile('week', sumOf(inWeek, 'kcal'), 'kcal', 'week') + '</div>' +
      '<h3 class="d-h">Questo mese</h3>' +
      '<div class="stats s4">' + tile('month', inMonth.filter(isAct).length, 'allenamenti', 'month') + tile('month', fmtShort(sumOf(inMonth, 'dur')), 'tempo', 'month') + tile('month', sumOf(inMonth, 'kcal'), 'kcal', 'month') + tile('stop', stopDays, 'giorni di stop', 'stop') + '</div>' +
      '<p class="muted small hist-tip">Tocca un riquadro per vedere lo storico.</p>' +
      '<div class="d-cols"><div class="d-row"><small>Luogo</small>' + pills(byPlace) + '</div>' +
      '<div class="d-row"><small>Tipo · mese</small>' + pills(byType) + '</div>' +
      '<div class="d-row"><small>Tipo · sett.</small>' + pills(count(inWeek, 'type')) + '</div></div>' +
      '<div class="d-actions"><button class="btn-start" data-new="Allenamento">+ Allenamento</button><button class="btn-start alt" data-new="Fisioterapia">+ Fisioterapia</button>' +
      '<button class="btn-start gray" data-new="Nota">+ Nota</button><button class="btn-start gray" data-new="Stop">+ Stop</button></div>' +
      '<h3 class="d-h">Invia al coach</h3><div class="coach-box"><textarea id="coachMsg" rows="5" placeholder="Scrivi qui i tuoi appunti, oppure richiama le note degli allenamenti"></textarea>' +
      '<div class="coach-btns"><button type="button" class="btn-start gray" id="coachRecall">↺ Richiama note</button><button type="button" class="btn-start alt" id="coachAi">✨ Sistema con IA</button></div>' +
      '<p class="muted small" id="coachHint">«Sistema con IA» copia il testo con le istruzioni e apre Claude: incolla, copia la versione migliorata e riportala qui.</p>' +
      '<button type="button" class="btn-big btn-red" id="coachSend">💬 Invia al coach</button></div>' +
      '<h3>Progressi carichi</h3>' + progHtml() +
      '<h3 id="histH">Storico</h3><div id="histBox">' + histHtml() + '</div>' +
      '<button class="btn-ghost-dark" id="dExport">Esporta backup dei dati</button>' +
      '<p class="muted small">I dati restano su questo dispositivo.</p></div>';

    $('sheetTitle').textContent = 'Diary';
    $('sheetBody').innerHTML = h;
    if (sheet.hidden) showSheet(); else $('sheetBody').scrollTop = 0;
    $('sheetBody').querySelector('.diary').onclick = function (ev) {
      var n = ev.target.closest('[data-new]');
      if (n) { closeSheet(false); setTimeout(function () { openLogForm(n.dataset.new, n.dataset.new === 'Fisioterapia' ? 'Seduta di fisioterapia' : ''); }, 50); return; }
      var hs = ev.target.closest('[data-hist]');
      if (hs) {
        var k = hs.dataset.hist, arr = k === 'week' ? inWeek : k === 'month' ? inMonth.filter(isAct) : log.filter(function (x) { return x.type === 'Stop'; });
        $('histH').textContent = 'Storico · ' + (k === 'week' ? 'questa settimana' : k === 'month' ? 'questo mese' : 'stop') + ' (' + arr.length + ')';
        $('histBox').innerHTML = (arr.length ? arr.slice().reverse().map(histRow).join('') : '<p class="muted">Nessuna registrazione.</p>') + '<button type="button" class="btn-ghost-dark" id="histAll">Mostra tutto lo storico</button>';
        $('histH').scrollIntoView({ behavior: 'smooth', block: 'start' });
        return;
      }
      if (ev.target.id === 'histAll') { $('histH').textContent = 'Storico'; $('histBox').innerHTML = histHtml(); return; }
      var cd = ev.target.closest('[data-card]');
      if (cd) { ev.preventDefault(); var en3 = getLog().filter(function (x) { return String(x.id) === cd.dataset.card; })[0]; if (en3) shareCard(en3); return; }
      var sh = ev.target.closest('[data-share]');
      if (sh) { var en2 = getLog().filter(function (x) { return String(x.id) === sh.dataset.share; })[0]; if (en2) sendWhatsApp(entryText(en2)); return; }
      var del = ev.target.closest('[data-del]');
      if (del && confirm('Eliminare questa registrazione?')) {
        store.set('log', getLog().filter(function (x) { return String(x.id) !== del.dataset.del; }));
        openDiary();
      }
      if (ev.target.id === 'dExport') exportData();
    };
    var cm = $('coachMsg');
    $('coachRecall').onclick = function () {
      var rows = log.filter(function (x) { return x.when.slice(0, 10) >= wStart && x.type !== 'Stop'; }).map(function (x) {
        return fmtD(x.when.slice(0, 10)) + ' · ' + (x.label || x.type) + (x.dur ? ' · ' + x.dur + "'" : '') + (x.kcal ? ' · ' + x.kcal + ' kcal' : '') + (x.note ? ' — ' + x.note : '');
      });
      cm.value = (cm.value ? cm.value + '\n\n' : '') + (rows.length ? 'Ciao coach, questa settimana:\n' + rows.join('\n') : 'Ciao coach, ');
    };
    $('coachAi').onclick = function () {
      if (!cm.value.trim()) { $('coachHint').textContent = 'Scrivi prima qualcosa o richiama le note.'; return; }
      var prompt = 'Riscrivi questo messaggio per il mio allenatore: chiaro, breve, cordiale, in italiano, senza inventare nulla.\n\n' + cm.value;
      var done = function () { $('coachHint').textContent = 'Testo copiato. Si apre Claude: incolla, poi copia la versione migliorata e incollala qui sopra.'; window.open('https://claude.ai/new', '_blank'); };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(prompt).then(done, function () { $('coachHint').textContent = 'Non riesco a copiare: seleziona il testo e copialo a mano.'; });
      else done();
    };
    $('coachSend').onclick = function () { if (cm.value.trim()) sendWhatsApp(cm.value.trim()); else $('coachHint').textContent = 'Il messaggio è vuoto.'; };
  }
  /* ---------- Alimentazione · Rehab · Drills (sezioni del footer) ---------- */
  var INFO = {
    food: { group: 'food', title: 'Nutrition', text: 'Piano alimentare e dati corporei (body weight). Sono file riservati: si aprono con la passphrase.',
      wa: 'Ciao, ti scrivo per l\'alimentazione: ', waLbl: '💬 Scrivi al nutrizionista' },
    rehab: { group: 'rehab', title: 'Rehab', text: 'Protocolli scritti dal fisioterapista: vengono inseriti nei giorni e nelle schede, e qui li trovi tutti.',
      log: true, protocols: true, wa: 'Ciao, ti scrivo per la riabilitazione: ', waLbl: '💬 Scrivi al fisioterapista' },
    drills: { title: 'Drills', text: 'Drills di basket e tecnica: arriveranno quando l\'app si aprirà a tutti.',
      wa: 'Ciao coach, ti scrivo per i drills: ', waLbl: '💬 Scrivi al coach' }
  };
  // Protocollo di rehab scritto (program.json → rehab: [{id, title, text}]); si apre dalla voce Rehab o dentro un giorno con {type:'protocol', ref:id}
  function protocolHtml(p, open) {
    var lines = String(p.text || '').split('\n').filter(function (l) { return l.trim(); });
    return '<details class="proto"' + (open ? ' open' : '') + '><summary>🩺 ' + esc(p.title) + '</summary><div class="proto-b">' + lines.map(function (l) { return '<p>' + esc(l) + '</p>'; }).join('') + '</div></details>';
  }
  function openInfo(k) {
    var x = INFO[k];
    $('sheetTitle').textContent = x.title;
    var pr = x.protocols ? (state.program.rehab || []) : [];
    var docs = (state.program.docs || []).filter(function (d) { return d.group === x.group; });
    $('sheetBody').innerHTML = '<div class="sheet-inner form"><p class="info-t">' + esc(x.text) + '</p>' +
      docs.map(function (d) { return '<button type="button" class="doc" data-vf="' + esc(d.file) + '" data-vt="' + esc(d.title) + '"' + (d.thumb ? ' data-th="' + esc(d.thumb) + '"' : '') + '><span class="doc-th">📄</span><span class="doc-t">' + esc(d.title) + '</span></button>'; }).join('') +
      (x.protocols ? state.program.plans.filter(function (pl) { return pl.kind === 'rehab'; }).map(function (pl) {
        return '<h3 class="coach-h">' + esc(pl.name) + '</h3><div class="chips">' + pl.days.map(function (d, i) { return '<button type="button" data-rp="' + esc(pl.id) + '" data-rd="' + i + '">' + dayIcon(d) + ' ' + esc(d.tab) + '</button>'; }).join('') + '</div>';
      }).join('') : '') +
      (x.protocols ? (pr.length ? pr.map(protocolHtml).join('') : '<p class="muted">Nessun protocollo assegnato per ora.</p>') : '') +
      (x.log ? '<button class="btn-big btn-red" id="infLog">+ Registra seduta di fisioterapia</button>' : '') +
      '<button class="btn-big btn-red" id="infWa">' + x.waLbl + '</button></div>';
    showSheet();
    Array.prototype.forEach.call($('sheetBody').querySelectorAll('.doc[data-th]'), function (b) {
      var pw = lsGet('trainaldo-vp'); if (!pw) return;   // anteprima solo se la passphrase è già salvata, senza chiederla
      fetch(b.getAttribute('data-th')).then(function (r) { return r.arrayBuffer(); }).then(function (buf) { return vaultDecrypt(buf, pw); })
        .then(function (img) { b.querySelector('.doc-th').innerHTML = '<img alt="" src="' + URL.createObjectURL(new Blob([img], { type: 'image/jpeg' })) + '">'; }).catch(function () {});
    });
    Array.prototype.forEach.call($('sheetBody').querySelectorAll('.doc'), function (b) { b.onclick = function () { openVaultDoc(b.getAttribute('data-vf'), b.getAttribute('data-vt')); }; });
    Array.prototype.forEach.call($('sheetBody').querySelectorAll('[data-rp]'), function (b) {
      b.onclick = function () {
        var pl = state.program.plans.filter(function (z) { return z.id === b.dataset.rp; })[0];
        closeSheet(false);
        if (pl) { selectPlan(pl, true); state.day = +b.dataset.rd; store.set('day', state.day); renderTabs(); renderDay(); }
      };
    });
    if ($('infLog')) $('infLog').onclick = function () { closeSheet(false); setTimeout(function () { openLogForm('Fisioterapia', 'Seduta di fisioterapia'); }, 50); };
    $('infWa').onclick = function () { sendWhatsApp(x.wa); };
  }
  function exportData() {
    var data = {};
    try { for (var i = 0; i < localStorage.length; i++) { var k = localStorage.key(i); if (k.indexOf(NS) === 0 && (ATHLETE !== 'aldo' || k.indexOf('trainaldo.@') !== 0)) data[k] = localStorage.getItem(k); } } catch (e) {}
    var blob = new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = 'trainaldo-' + ATHLETE + '-backup-' + isoDate(new Date()) + '.json';
    document.body.appendChild(a); a.click(); a.remove();
  }
  $('diaryBtn').onclick = function () { if (state.program) openDiary(); };
  $('musicFab').onclick = function () { if (state.program) openMusic(state.days[state.day]); };
  $('navPlan').onclick = function () { if (state.program) { openPlans(); navMark('navPlan'); } };
  $('navDiary').onclick = function () { if (state.program) { openDiary(); navMark('navDiary'); } };
  $('navFood').onclick = function () { if (state.program) { openInfo('food'); navMark('navFood'); } };
  $('navRehab').onclick = function () { if (state.program) { openInfo('rehab'); navMark('navRehab'); } };
  $('navDrills').onclick = function () { if (state.program) { openInfo('drills'); navMark('navDrills'); } };

  /* ---------- Audio, vibrazione, schermo acceso ---------- */
  var actx = null, wakeLock = null;
  function unlockAudio() {
    try {
      // i suoni del timer abbassano per un attimo la musica (Spotify) senza fermarla
      try { if (navigator.audioSession) navigator.audioSession.type = 'transient'; } catch (e) {}
      if (!actx) actx = new (window.AudioContext || window.webkitAudioContext)();
      if (actx.state === 'suspended') actx.resume();
      var o = actx.createOscillator(), g = actx.createGain();
      g.gain.value = 0.0001; o.connect(g); g.connect(actx.destination); o.start(); o.stop(actx.currentTime + 0.02);
    } catch (e) {}
  }
  // Campanello: due rintocchi con coda lunga
  function bell() {
    if (!actx) return;
    try {
      [0, 0.45].forEach(function (w) {
        [1318, 1975, 2637].forEach(function (f, i) {
          var t = actx.currentTime + w, o = actx.createOscillator(), g = actx.createGain();
          o.type = 'sine'; o.frequency.value = f;
          g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.35 / (i + 1), t + 0.01);
          g.gain.exponentialRampToValueAtTime(0.0001, t + 1.2);
          o.connect(g); g.connect(actx.destination); o.start(t); o.stop(t + 1.3);
        });
      });
    } catch (e) {}
  }
  function beep(freq, dur, when) {
    if (!actx) return;
    try {
      var t = actx.currentTime + (when || 0);
      var o = actx.createOscillator(), g = actx.createGain();
      o.type = 'sine'; o.frequency.value = freq || 880;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.5, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + (dur || 0.25));
      o.connect(g); g.connect(actx.destination); o.start(t); o.stop(t + (dur || 0.25) + 0.05);
    } catch (e) {}
  }
  function buzz(p) { try { if (navigator.vibrate) navigator.vibrate(p); } catch (e) {} }
  function keepAwake(on) {
    try {
      if (on && 'wakeLock' in navigator && !wakeLock) {
        navigator.wakeLock.request('screen').then(function (l) { wakeLock = l; l.addEventListener('release', function () { wakeLock = null; }); }).catch(function () {});
      } else if (!on && wakeLock) { wakeLock.release(); wakeLock = null; }
    } catch (e) {}
  }

  /* ---------- Timer recupero ---------- */
  var timer = $('timer'), ringFg = $('ringFg');
  var C = 2 * Math.PI * 88;
  ringFg.style.strokeDasharray = C;
  var T = { end: 0, total: 0, raf: 0, lastBeep: -1, done: false };

  function startTimer(sec, label, work) {
    T.total = sec; T.end = Date.now() + sec * 1000; T.done = false; T.lastBeep = -1; T.work = !!work; T.bell = false;
    T.label = (work ? 'Lavoro · ' : '') + (label || 'Recupero');
    $('tLabel').textContent = T.label;
    $('tStop').textContent = 'Chiudi';
    timer.className = 'overlay';
    setTimerMode(store.get('timerMode', 'full'));
    keepAwake(true);
    tick();
  }
  function tick() {
    clearTimeout(T.raf);
    var left = (T.end - Date.now()) / 1000;
    if (left <= 0) {
      $('tNum').textContent = '0:00';
      ringFg.style.strokeDashoffset = C;
      if (!T.done) {
        T.done = true;
        timer.className = 'overlay done';
        tBar.className = 't-bar done'; $('tBarNum').textContent = '0:00'; $('tBarLbl').textContent = T.work ? 'Fatto!' : 'Via! Prossimo giro';
        $('tLabel').textContent = T.work ? 'Fatto! Prossimo esercizio' : 'Via! Prossimo giro';
        $('tStop').textContent = 'OK';
        beep(880, 0.3); beep(1175, 0.5, 0.35);
        buzz([300, 120, 300]);
      }
      return;
    }
    var s = Math.ceil(left);
    $('tNum').textContent = fmtClock(left);
    ringFg.style.strokeDashoffset = C * (1 - left / T.total);
    timer.className = 'overlay' + (left <= 10 ? ' warn' : '');
    tBar.className = 't-bar' + (left <= 10 ? ' warn' : ''); $('tBarNum').textContent = fmtClock(left); $('tBarLbl').textContent = T.label;
    if (s === 15 && T.total > 20 && !T.bell) { T.bell = true; bell(); buzz([150, 80, 150]); }   // campanello: mancano 15''
    if (s <= 3 && s !== T.lastBeep) { T.lastBeep = s; beep(660, 0.12); }
    T.raf = setTimeout(tick, 200);
  }
  function stopTimer() {
    clearTimeout(T.raf);
    timer.hidden = true; tBar.hidden = true; document.body.classList.remove('has-tbar');
    keepAwake(false);
  }
  // Timer a tutto schermo o ridotto a banner (per consultare gli esercizi mentre scorre)
  var tBar = $('tBar');
  function setTimerMode(mode) {
    var banner = mode === 'banner';
    timer.hidden = banner; tBar.hidden = !banner;
    document.body.classList.toggle('has-tbar', banner);
  }
  $('tMin').onclick = function () { setTimerMode('banner'); };
  $('tBarOpen').onclick = function () { setTimerMode('full'); };
  $('tBarClose').onclick = stopTimer;
  $('tStop').onclick = stopTimer;
  $('tPlus').onclick = function () { if (T.done) return; T.end += 15000; T.total += 15; tick(); };
  $('tMinus').onclick = function () { if (T.done) return; T.end -= 15000; T.total = Math.max(1, T.total - 15); tick(); };

  /* ---------- Timer guidato (intervalli, HIIT, yoga) ---------- */
  var iv = $('ivTimer');
  var I = { phases: [], idx: 0, end: 0, paused: false, pauseLeft: 0, raf: 0, lastBeep: -1, total: 0 };

  function exImg(e, n) { return e && e.img ? photoSrc(e, n) : e && e.video ? ytThumb(e.video) : null; }
  function buildPhases(sec) {
    var ex = state.program.exercises, ph = [];
    if (sec.type === 'intervals') {
      sec.steps.forEach(function (s, i) {
        var step = 'Intervallo ' + (i + 1) + ' di ' + sec.steps.length;
        ph.push({ title: 'CORSA', step: step, sec: s[0] * 60, kind: 'work' });
        ph.push({ title: 'RECUPERO', step: step, sec: s[1] * 60, kind: 'rest' });
      });
    } else if (sec.type === 'hiit') {
      var n = sec.items.length;
      for (var r = 1; r <= sec.rounds; r++) {
        sec.items.forEach(function (it, j) {
          var e = ex[it.ex] || {}, name = it.name || e.name;
          var step = 'Giro ' + r + ' di ' + sec.rounds + ' · esercizio ' + (j + 1) + ' di ' + n;
          ph.push({ title: name, step: step, sec: sec.work, kind: 'work', img: exImg(e, 0) });
          if (j < n - 1 && sec.rest) {
            var nx = ex[sec.items[j + 1].ex] || {};
            ph.push({ title: 'RECUPERO', step: step, sec: sec.rest, kind: 'rest', img: exImg(nx, 0) });
          }
        });
        if (r < sec.rounds && sec.roundRest) {
          ph.push({ title: 'RECUPERO GIRO', step: 'Fine giro ' + r + ' di ' + sec.rounds, sec: sec.roundRest, kind: 'rest', img: exImg(ex[sec.items[0].ex], 0) });
        }
      }
    } else if (sec.type === 'emom') {
      var ns = sec.items.length, rounds = Math.ceil(sec.minutes / ns);
      for (var m = 0; m < sec.minutes; m++) {
        var it2 = sec.items[m % ns], e2 = ex[it2.ex] || {};
        var r2 = it2.editable ? store.get('reps.' + it2.ex, '') : (it2.reps || '');
        ph.push({ title: (it2.name || e2.name) + (r2 ? ' × ' + r2 : ''), sec: 60, kind: 'work', img: exImg(e2, 0),
          step: 'Minuto ' + (m + 1) + ' di ' + sec.minutes + ' · giro ' + (Math.floor(m / ns) + 1) + ' di ' + rounds });
      }
    } else if (sec.type === 'run') {
      ph.push({ title: 'CORSA · ' + sec.pace, step: sec.label, sec: sec.minutes * 60, kind: 'work' });
    } else if (sec.type === 'timer') {
      var mins = +store.get('tmin.' + sec.id, '') || sec.minutes;
      ph.push({ title: sec.label, step: mins + "'", sec: mins * 60, kind: 'yoga' });
    } else if (sec.type === 'cooldown') {
      var poses = sec.items.filter(function (it) { return it.sec; });
      poses.forEach(function (it, j) {
        var e = ex[it.ex] || {}, name = it.name || e.name, sides = it.sides || 1;
        for (var k = 0; k < sides; k++) {
          ph.push({ title: name + (sides > 1 ? (k === 0 ? ' · lato destro' : ' · lato sinistro') : ''),
            step: 'Posizione ' + (j + 1) + ' di ' + poses.length, sec: it.sec, kind: 'yoga', img: exImg(e, 1) });
        }
      });
    }
    return ph;
  }
  function startGuided(si, phases) {
    if (phases) I.phases = phases;
    else { var sec = daySections(state.days[state.day])[si]; if (!sec) return; I.phases = buildPhases(sec); }
    if (!I.phases.length) return;
    I.total = I.phases.reduce(function (a, p) { return a + p.sec; }, 0);
    I.idx = 0; I.paused = false; I.bellIdx = -1;
    iv.hidden = false;
    keepAwake(true);
    enterPhase(Date.now());
  }
  function enterPhase(from) {
    var p = I.phases[I.idx];
    I.end = from + p.sec * 1000; I.lastBeep = -1;
    $('ivPause').textContent = 'Pausa'; I.paused = false;
    iv.className = 'overlay iv ' + (p.kind === 'rest' ? 'rec' : p.kind);
    $('ivPhase').textContent = p.title;
    $('ivStep').textContent = p.step || '';
    var img = $('ivImg');
    if (p.img) { img.src = p.img; img.hidden = false; } else { img.hidden = true; img.removeAttribute('src'); }
    var nx = I.phases[I.idx + 1];
    $('ivNext').textContent = nx ? 'Poi: ' + nx.title + ' ' + fmtRest(nx.sec) : 'Ultima fase';
    beep(p.kind === 'work' ? 1046 : p.kind === 'yoga' ? 523 : 587, 0.45);
    buzz(p.kind === 'work' ? [400] : [200, 100, 200]);
    ivTick();
  }
  function elapsedBefore(idx) { var a = 0; for (var i = 0; i < idx; i++) a += I.phases[i].sec; return a; }
  function ivTick() {
    clearTimeout(I.raf);
    if (I.paused) return;
    var p = I.phases[I.idx];
    var left = (I.end - Date.now()) / 1000;
    if (left <= 0) {
      if (I.idx < I.phases.length - 1) { I.idx++; enterPhase(I.end); return; }
      $('ivNum').textContent = '0:00';
      $('ivFill').style.width = '100%';
      iv.className = 'overlay iv done';
      $('ivPhase').textContent = 'FINITO';
      $('ivStep').textContent = 'Ottimo lavoro';
      $('ivImg').hidden = true;
      $('ivNext').textContent = '';
      $('ivTotal').textContent = '';
      beep(880, 0.3); beep(1175, 0.3, 0.35); beep(1568, 0.6, 0.7);
      buzz([300, 120, 300, 120, 500]);
      return;
    }
    var s = Math.ceil(left);
    $('ivNum').textContent = fmtClock(left);
    var done = elapsedBefore(I.idx) + (p.sec - left);
    $('ivFill').style.width = (done / I.total * 100) + '%';
    $('ivTotal').textContent = 'Totale ' + fmtClock(done) + ' / ' + fmtClock(I.total);
    if (s === 15 && p.sec >= 30 && I.bellIdx !== I.idx) { I.bellIdx = I.idx; bell(); }
    if (p.kind !== 'yoga' && s <= 3 && s !== I.lastBeep) { I.lastBeep = s; beep(660, 0.12); }
    I.raf = setTimeout(ivTick, 200);
  }
  $('ivPause').onclick = function () {
    if (iv.classList.contains('done')) return;
    if (!I.paused) {
      I.paused = true; I.pauseLeft = I.end - Date.now();
      clearTimeout(I.raf);
      this.textContent = 'Riprendi';
    } else {
      I.paused = false; I.end = Date.now() + I.pauseLeft;
      this.textContent = 'Pausa';
      ivTick();
    }
  };
  $('ivSkip').onclick = function () {
    if (iv.classList.contains('done')) return;
    if (I.idx < I.phases.length - 1) { I.idx++; enterPhase(Date.now()); } else { I.end = Date.now(); I.paused = false; ivTick(); }
  };
  onSwipe(iv, function (dir) {
    if (iv.hidden || iv.classList.contains('done')) return;
    if (dir > 0) $('ivSkip').onclick();
    else if (I.idx > 0) { I.idx--; enterPhase(Date.now()); }
  });
  onSwipe(timer, function (dir) { if (!timer.hidden && dir > 0) stopTimer(); });
  $('ivStop').onclick = function () {
    clearTimeout(I.raf);
    iv.hidden = true;
    keepAwake(false);
  };

  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState !== 'visible') return;
    if (!timer.hidden) { keepAwake(true); tick(); }
    if (!iv.hidden) { keepAwake(true); ivTick(); }
  });

  /* ---------- Service worker ---------- */
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    var hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.register('sw.js').catch(function () {});
    navigator.serviceWorker.addEventListener('controllerchange', function () {
      if (hadController) location.reload();
    });
  }
})();

