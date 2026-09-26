/* TRAIN.ALDO — app */
(function () {
  'use strict';

  var APP_VERSION = '1.3.0';
  var IMG_BASE = 'img/';
  var state = { program: null, plan: null, days: [], day: 0, variant: {} };

  var $ = function (id) { return document.getElementById(id); };
  var store = {
    get: function (k, d) { try { var v = localStorage.getItem('trainaldo.' + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
    set: function (k, v) { try { localStorage.setItem('trainaldo.' + k, JSON.stringify(v)); } catch (e) {} }
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
  function photoSrc(ex, n) { return IMG_BASE + ex.img + '/' + n + '.jpg'; }
  function ytThumb(id) { return 'https://i.ytimg.com/vi/' + id + '/mqdefault.jpg'; }

  /* ---------- Caricamento ---------- */
  fetch('data/program.json', { cache: 'no-cache' })
    .then(function (r) { return r.json(); })
    .then(function (p) {
      state.program = p;
      state.variant = store.get('variant', {});
      $('version').textContent = 'v' + APP_VERSION + ' · schede aggiornate al ' + (p.updated || '—');
      selectPlan(pickPlan(), false);
    })
    .catch(function () {
      $('main').innerHTML = '<p class="loading">Impossibile caricare la scheda. Controlla la connessione e riapri l\'app.</p>';
    });

  /* ---------- Schede (piani) ---------- */
  function thisMonth() { return new Date().getMonth() + 1; }
  function planForMonth(m) {
    var plans = state.program.plans;
    for (var i = 0; i < plans.length; i++) if ((plans[i].months || []).indexOf(m) >= 0) return plans[i];
    return null;
  }
  // Scelta manuale valida solo nel mese in cui è stata fatta; poi torna alla scheda del mese
  function pickPlan() {
    var plans = state.program.plans;
    var saved = store.get('plan', null);
    if (saved && saved.month === thisMonth()) {
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
  function selectPlan(plan, manual) {
    state.plan = plan;
    state.days = resolveDays(plan);
    if (state.program.yoga) state.days.push(buildYogaDay());
    if (manual) { store.set('plan', { id: plan.id, month: thisMonth() }); state.day = 0; }
    else state.day = Math.min(store.get('day', 0), state.days.length - 1);
    store.set('day', state.day);
    $('planName').textContent = plan.name;
    renderTabs();
    renderDay();
    window.scrollTo(0, 0);
  }
  function openPlans() {
    var cur = planForMonth(thisMonth());
    $('sheetTitle').textContent = 'Schede';
    $('sheetBody').innerHTML = '<div class="sheet-inner plan-list">' + state.program.plans.map(function (pl) {
      return '<button class="plan-item' + (pl.id === state.plan.id ? ' on' : '') + '" data-plan="' + esc(pl.id) + '">' +
        '<span class="plan-n">' + esc(pl.name) + '</span>' +
        (cur && cur.id === pl.id ? '<span class="plan-badge">questo mese</span>' : '') +
        (pl.id === state.plan.id ? '<span class="plan-check">✓</span>' : '') + '</button>';
    }).join('') + '<p class="plan-hint">All\'inizio di ogni mese l\'app apre da sola la scheda del mese.</p></div>';
    showSheet();
    $('sheetBody').querySelector('.plan-list').onclick = function (e) {
      var b = e.target.closest('.plan-item'); if (!b) return;
      var pl = state.program.plans.filter(function (x) { return x.id === b.dataset.plan; })[0];
      closeSheet(false);
      if (pl) selectPlan(pl, true);
    };
  }
  $('planBtn').onclick = function () { if (state.program) openPlans(); };

  /* ---------- Tab ---------- */
  function renderTabs() {
    var nav = $('tabs');
    nav.innerHTML = state.days.map(function (d, i) {
      return '<button class="tab" role="tab" data-i="' + i + '" aria-selected="' + (i === state.day) + '">' + esc(d.tab) + '</button>';
    }).join('');
    nav.onclick = function (e) {
      var b = e.target.closest('.tab'); if (!b) return;
      state.day = +b.dataset.i; store.set('day', state.day);
      Array.prototype.forEach.call(nav.children, function (t, i) { t.setAttribute('aria-selected', i === state.day); });
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

  function renderDay() {
    var day = state.days[state.day];
    var cur = currentSections(day);
    var h = '<h1 class="day-title"><small>' + esc(day.id === 'yoga' ? 'Sempre disponibile' : state.plan.name) + '</small>' + esc(day.tab) + (day.title ? ' — ' + esc(day.title) : '') + '</h1>';
    if (day.sameAs) h += '<div class="note-box"><b>Uguale</b> alla scheda ' + esc(day.sameAs) + '.</div>';

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
      } else {
        h += renderBlock(sec, si);
      }
    });

    var main = $('main');
    main.innerHTML = h;

    var sw = main.querySelector('.switch');
    if (sw) sw.onclick = function (e) {
      var b = e.target.closest('button'); if (!b) return;
      state.variant[state.plan.id + '/' + day.id] = b.dataset.v; store.set('variant', state.variant);
      renderDay();
    };
  }

  function renderBlock(sec, si) {
    var ex = state.program.exercises;
    var mob = sec.type === 'mobility' || sec.type === 'list';
    var guided = sec.type === 'hiit' || sec.type === 'cooldown';
    var badge = sec.badge || (sec.type === 'hiit' ? 'HIIT' : sec.type === 'cooldown' ? 'YOGA' : 'MOB');
    var sub = sec.sub || (sec.type === 'mobility' ? 'Attivazione' : '');
    if (sec.type === 'hiit') {
      var tot = sec.rounds * (sec.items.length * sec.work + (sec.items.length - 1) * sec.rest) + (sec.rounds - 1) * (sec.roundRest || 0);
      sub = fmtRest(sec.work) + ' lavoro · ' + fmtRest(sec.rest) + ' recupero · ' + sec.rounds + ' giri · circa ' + Math.round(tot / 60) + "'";
    }
    var head = (mob || guided)
      ? '<div class="letter sm">' + esc(badge) + '</div><div class="block-meta"><div class="block-kind">' + esc(sec.label) + '</div><div class="block-sub">' + esc(sub) + '</div></div>'
      : '<div class="letter">' + esc(sec.letter) + '</div><div class="block-meta"><div class="block-kind">' + kindOf(sec) + ' ×' + sec.sets + '</div><div class="block-sub">' + sec.sets + ' serie' + (sec.rest ? ' · recupero ' + fmtRest(sec.rest) : '') + '</div></div>';

    var rows = sec.items.map(function (it) {
      var e = ex[it.ex] || { name: it.ex };
      var name = it.name || e.name;
      var reps = it.reps || (sec.type === 'hiit' ? fmtRest(sec.work) : it.sec ? fmtRest(it.sec) + ((it.sides || 1) > 1 ? ' per lato' : '') : e.dur || '');
      var hasMedia = e.equip !== 'Corsa';
      var thumb = e.img ? '<img src="' + photoSrc(e, 0) + '" alt="" loading="lazy">'
        : e.video ? '<img src="' + ytThumb(e.video) + '" alt="" loading="lazy">'
        : e.equip === 'Corsa' ? 'RUN' : '';
      var kg = e.kg
        ? '<div class="kg"><input type="text" inputmode="decimal" enterkeyhint="done" data-kg="' + esc(it.ex) + '" value="' + esc(store.get('kg.' + it.ex, '')) + '" placeholder="–" aria-label="Kg ' + esc(name) + '"><label>kg</label></div>'
        : '';
      return '<div class="ex' + (hasMedia ? '' : ' static') + '" data-ex="' + esc(it.ex) + '" data-reps="' + esc(reps) + '" data-name="' + esc(name) + '"' + (hasMedia ? ' role="button" tabindex="0"' : '') + '>' +
        '<div class="thumb">' + thumb + '</div>' +
        '<div class="ex-main">' + (it.code ? '<div class="ex-code">' + esc(it.code) + '</div>' : '') +
        '<div class="ex-name">' + esc(name) + '</div>' +
        '<div class="ex-info"><b>' + esc(reps) + '</b>' + (it.note ? ' <b>' + esc(it.note) + '</b>' : '') + ' · ' + esc(e.equip || '') + '</div></div>' + kg + '</div>';
    }).join('');

    var lbl = 'Recupero blocco ' + esc(sec.letter);
    var rest = mob ? '' : guided
      ? '<div class="rest"><div class="rest-txt">Timer guidato<span>' + (sec.type === 'hiit' ? 'lavoro / recupero con segnale' : 'cambio posizione con segnale') + '</span></div>' +
        '<button class="btn-start" data-guided="' + si + '">Avvia</button></div>'
      : sec.rest
      ? '<div class="rest"><div class="rest-txt">Recupero ' + fmtRest(sec.rest) + '<span>tra un giro e l\'altro</span></div>' +
        '<button class="btn-start" data-rest="' + sec.rest + '" data-label="' + lbl + '">Avvia</button></div>'
      : '<div class="rest rest-free"><div class="rest-txt">Recupero<span>scegli e parte il timer</span></div><div class="rest-chips">' +
        [60, 75, 90, 120].map(function (r) { return '<button class="btn-start chip" data-rest="' + r + '" data-label="' + lbl + '">' + fmtRest(r) + '</button>'; }).join('') + '</div></div>';

    return '<section class="block' + (mob ? ' mob' : '') + (sec.type === 'cooldown' ? ' yoga' : '') + '"><div class="block-head">' + head + '</div>' + rows + rest + '</section>';
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
      '<div class="block-kind">' + esc(sec.label) + '</div><div class="block-sub">Passo corsa ' + esc(sec.pace) + ' · ' + totalMin + ' min di lavoro</div></div></div>' +
      '<div class="iv-grid">' + rows + '</div>' +
      '<div class="iv-legend"><span><i style="background:var(--red)"></i>Corsa (min)</span><span><i style="background:#e8dcd0"></i>Recupero (min)</span></div>' +
      '<div class="rest"><div class="rest-txt">Timer guidato<span>corsa / recupero con segnale</span></div>' +
      '<button class="btn-start" data-guided="' + si + '">Avvia</button></div></section>';
  }

  /* ---------- Eventi lista ---------- */
  var main = $('main');
  main.addEventListener('click', function (e) {
    if (e.target.closest('.kg')) return;
    var st = e.target.closest('.btn-start');
    if (st) {
      unlockAudio();
      if (st.dataset.guided) startGuided(+st.dataset.guided);
      else startTimer(+st.dataset.rest, st.dataset.label);
      return;
    }
    var row = e.target.closest('.ex');
    if (row && !row.classList.contains('static')) openSheet(row.dataset.ex, row.dataset.reps, row.dataset.name);
  });
  main.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && e.target.classList.contains('ex')) e.target.click();
  });
  document.addEventListener('input', function (e) {
    var k = e.target.dataset && e.target.dataset.kg;
    if (!k) return;
    var v = e.target.value.replace(',', '.').replace(/[^0-9.]/g, '');
    store.set('kg.' + k, v);
    document.querySelectorAll('[data-kg="' + k + '"]').forEach(function (inp) { if (inp !== e.target) inp.value = v; });
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && e.target.dataset && e.target.dataset.kg) e.target.blur();
  });

  /* ---------- Scheda esercizio ---------- */
  var sheet = $('sheet');
  function openSheet(key, reps, name) {
    var e = state.program.exercises[key]; if (!e) return;
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
        '<div class="dots" id="dots"><button aria-pressed="true" data-p="0">Inizio</button><button aria-pressed="false" data-p="1">Fine</button></div>' +
        '<p class="photo-hint">Tocca la foto per cambiare posizione</p>';
    }

    h += '<div class="facts"><div class="fact"><small>Reps</small><b>' + esc(reps || '—') + '</b></div>' +
      '<div class="fact"><small>Attrezzo</small><b>' + esc(e.equip || '—') + '</b></div>' +
      (e.kg ? '<div class="fact"><small>Kg</small><input type="text" inputmode="decimal" enterkeyhint="done" data-kg="' + esc(key) + '" value="' + esc(store.get('kg.' + key, '')) + '" placeholder="–"></div>' : '') +
      '</div>';
    if (e.cue) h += '<div class="cue">' + esc(e.cue) + '</div>';

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
        $('dots').children[0].setAttribute('aria-pressed', p === 0);
        $('dots').children[1].setAttribute('aria-pressed', p === 1);
      };
      var cur = 0;
      photos.onclick = function () { cur = 1 - cur; show(cur); };
      $('dots').onclick = function (ev) { var b = ev.target.closest('button'); if (b) { cur = +b.dataset.p; show(cur); } };
    }
  }
  function showSheet() {
    $('sheetBody').scrollTop = 0;
    sheet.hidden = false;
    document.body.style.overflow = 'hidden';
    history.pushState({ sheet: 1 }, '');
  }
  function closeSheet(fromPop) {
    if (sheet.hidden) return;
    sheet.hidden = true;
    $('sheetBody').innerHTML = '';
    document.body.style.overflow = '';
    if (!fromPop && history.state && history.state.sheet) history.back();
  }
  $('sheetClose').onclick = function () { closeSheet(false); };
  window.addEventListener('popstate', function () { closeSheet(true); });

  /* ---------- Audio, vibrazione, schermo acceso ---------- */
  var actx = null, wakeLock = null;
  function unlockAudio() {
    try {
      if (!actx) actx = new (window.AudioContext || window.webkitAudioContext)();
      if (actx.state === 'suspended') actx.resume();
      var o = actx.createOscillator(), g = actx.createGain();
      g.gain.value = 0.0001; o.connect(g); g.connect(actx.destination); o.start(); o.stop(actx.currentTime + 0.02);
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

  function startTimer(sec, label) {
    T.total = sec; T.end = Date.now() + sec * 1000; T.done = false; T.lastBeep = -1;
    $('tLabel').textContent = label || 'Recupero';
    $('tStop').textContent = 'Chiudi';
    timer.className = 'overlay';
    timer.hidden = false;
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
        $('tLabel').textContent = 'Via! Prossimo giro';
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
    if (s <= 3 && s !== T.lastBeep) { T.lastBeep = s; beep(660, 0.12); }
    T.raf = setTimeout(tick, 200);
  }
  function stopTimer() {
    clearTimeout(T.raf);
    timer.hidden = true;
    keepAwake(false);
  }
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
  function startGuided(si) {
    var sec = daySections(state.days[state.day])[si]; if (!sec) return;
    I.phases = buildPhases(sec); if (!I.phases.length) return;
    I.total = I.phases.reduce(function (a, p) { return a + p.sec; }, 0);
    I.idx = 0; I.paused = false;
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
