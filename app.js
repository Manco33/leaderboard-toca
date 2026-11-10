/**
 * TOCA SOCIAL — TV Leaderboard Web Engine  |  app.js
 * (Samsung Smart TV 60FPS Hardware-Accelerated Edition)
 *
 * Basado en el modelo original de TV Toca Social (Retro Arcade + SQLite)
 * adaptado 100% a Web en Tiempo Real con Supabase (match_scores).
 *
 * Optimizaciones Smart TV (Tizen / WebOS / Android TV):
 *   - Escalado nativo 1080×1920 por hardware (soporta viewports 720p, 1080p y 4K sin deformar)
 *   - Barra de progreso acelerada por GPU (transform: scaleX) con 0 ciclos de CPU por frame
 *   - Motor de nieve Pixel-Art en buffer ligero (360×640 @ 30fps) con 0 cambios de globalAlpha
 *   - Diffing inteligente de DOM: el cintillo inferior y la tabla no se destruyen en cada sync si no cambiaron los datos
 */

// ════════════════════════════════════════
//  SUPABASE CONFIG (Tu Propia Tecnología)
// ════════════════════════════════════════

var SUPABASE_URL  = 'https://oemqcvivlbjirewybyfe.supabase.co';
var SUPABASE_ANON = 'sb_publishable_lNTBokUMevI5a_uGPR-6iQ_k8gvKk--';

var sbClient = null;
try {
  if (window.supabase && typeof window.supabase.createClient === 'function') {
    sbClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON);
  }
} catch (err) {
  console.error('[TV Toca Social] Error iniciando cliente Supabase:', err);
}

// ════════════════════════════════════════
//  GAMES & CONFIG
// ════════════════════════════════════════

var GAMES = [
  { id: 'STRIKER',       dbId: 'striker',        label: 'STRIKER',        logo: 'logos/striker.png',       img: 'images/striker.png' },
  { id: 'ATOMSPLITTER',  dbId: 'atom-splitter',  label: 'ATOM SPLITTER',  logo: 'logos/atomsplitter.png',  img: 'images/atomsplitter.png' },
  { id: 'ZOMBIES',       dbId: 'zombies',        label: 'ZOMBIES',        logo: 'logos/zombies.png',       img: 'images/zombies.png' },
  { id: 'TOCACHALLENGE', dbId: 'toca-challenge', label: 'TOCA CHALLENGE', logo: 'logos/tocachallenge.png', img: 'images/tocachallenge.png' }
];

var FAKE_SEEDS = [
  'mateo g.', 'carlos r.', 'lucas m.', 'valeria p.', 'diego s.',
  'fernando k.', 'andrea l.', 'sofia b.', 'alejandro v.', 'jenny'
];

var SEG_COUNT     = 22;    // segments in the pixelated progress bar
var HOY_MS        = 12000; // 12 s showing today's scores
var ALLTIME_MS    = 8000;  // 8 s showing all-time records
var PLACEHOLDER_N = 10;    // always render this many rows
var SYNC_MS       = 10000; // background REST sync interval

var currentGameIdx = 0;
var currentMode    = 'today';   // 'today' | 'alltime'
var scoreMode      = 'best';    // 'best' (récord individual) | 'sum' (acumulado torneo)
var screenRotation = 270;       // 270° por defecto para la posición vertical de la TV
var xmasMode       = true;      // Modo Navideño / Nieve Arcade activo por defecto

var phaseTimer    = null;
var phaseDuration = HOY_MS;

// Cache en memoria + firmas para evitar repintados innecesarios en Smart TV
var cacheToday   = {};
var cacheAllTime = {};
var recentLiveEvents = [];
var realtimeConnected = false;
var lastListSignature   = '';
var lastFooterSignature = '';

// ════════════════════════════════════════
//  BOOT
// ════════════════════════════════════════

document.addEventListener('DOMContentLoaded', function () {
  loadKioskSettings();
  applyScreenRotation(screenRotation);
  applyXmasMode(xmasMode);
  fitTvViewport();
  window.addEventListener('resize', fitTvViewport);

  buildXmasGarland();
  initSnowfall();
  buildTabs();
  startClock();
  initKioskModal();
  requestScreenWakeLock();

  // Cargar caché previo de localStorage si existe para arranque instantáneo
  loadLocalCache();
  enterPhase('today');
  renderFooter(true);

  // Sincronizar con Supabase inmediatamente y suscribirse a Realtime
  syncAllGamesFromSupabase(true);
  initSupabaseRealtime();
  setInterval(function () {
    syncAllGamesFromSupabase(false);
  }, SYNC_MS);
});

// ════════════════════════════════════════
//  NATIVE 1080×1920 HARDWARE SCALER FOR SMART TV
// ════════════════════════════════════════

function fitTvViewport() {
  var vw = window.innerWidth  || 1920;
  var vh = window.innerHeight || 1080;
  var scaleX = 1;
  var scaleY = 1;

  if (screenRotation === 90 || screenRotation === 270) {
    // Al rotar 90° o 270°, el ancho de 1080px ocupa el alto de la TV (vh)
    // y el alto de 1920px ocupa el ancho de la TV (vw)
    scaleX = vh / 1080;
    scaleY = vw / 1920;
  } else {
    scaleX = vw / 1080;
    scaleY = vh / 1920;
  }

  var rootStyle = document.documentElement.style;
  rootStyle.setProperty('--tv-scale-x', scaleX.toFixed(5));
  rootStyle.setProperty('--tv-scale-y', scaleY.toFixed(5));
}

// ════════════════════════════════════════
//  PIXEL SNOWFALL & CHRISTMAS GARLAND ENGINE
//  (Optimizado para TV Samsung: Buffer 360×640 @ 30fps)
// ════════════════════════════════════════

function applyXmasMode(enabled) {
  xmasMode = Boolean(enabled);
  document.body.classList.toggle('xmas-active', xmasMode);
}

function buildXmasGarland() {
  var garland = document.getElementById('xmas-garland');
  if (!garland) return;
  var colors = ['c-red', 'c-ice', 'c-aqua', 'c-gold', 'c-pink'];
  var html = '';
  for (var i = 0; i < 24; i++) {
    var cls = colors[i % colors.length];
    html += '<span class="xmas-bulb ' + cls + '"></span>';
  }
  garland.innerHTML = html;
}

function initSnowfall() {
  var canvas = document.getElementById('snow-canvas');
  if (!canvas) return;

  // Buffer ligero fijo de 360x640 (escalado por GPU con image-rendering: pixelated)
  // Reduce en 90% el ancho de banda de memoria gráfica en TVs Samsung Tizen
  var W = 360;
  var H = 640;
  canvas.width  = W;
  canvas.height = H;

  var ctx = canvas.getContext('2d', { alpha: true });
  if (ctx) ctx.imageSmoothingEnabled = false;

  var FLAKE_COUNT = 42;
  var flakes = [];
  // Colores con alpha pre-calculado para no cambiar ctx.globalAlpha en cada partícula
  var colorsLayer0 = ['rgba(255,255,255,0.42)', 'rgba(214,255,246,0.40)'];
  var colorsLayer1 = ['rgba(255,255,255,0.75)', 'rgba(214,255,246,0.72)', 'rgba(0,255,194,0.65)'];
  var colorsLayer2 = ['rgba(255,255,255,0.92)', 'rgba(255,132,255,0.82)', 'rgba(0,255,194,0.85)'];

  function createFlake(randomY) {
    var r = Math.random();
    var layer = r < 0.20 ? 2 : (r < 0.60 ? 1 : 0);
    var cList = layer === 2 ? colorsLayer2 : (layer === 1 ? colorsLayer1 : colorsLayer0);
    return {
      x: Math.random() * W,
      y: randomY ? Math.random() * H : -8 - Math.random() * 20,
      vy: layer === 2 ? (0.85 + Math.random() * 0.45) : layer === 1 ? (0.55 + Math.random() * 0.30) : (0.32 + Math.random() * 0.20),
      vx: (Math.random() - 0.5) * 0.25,
      size: layer === 0 ? 1 : 2,
      isCrystal: layer === 2,
      color: cList[Math.floor(Math.random() * cList.length)]
    };
  }

  for (var i = 0; i < FLAKE_COUNT; i++) {
    flakes.push(createFlake(true));
  }

  var lastFrameTime = 0;
  var FRAME_INTERVAL = 33; // ~30 FPS estables para no saturar el hilo de composición de la TV

  function tickSnow(now) {
    requestAnimationFrame(tickSnow);
    if (!xmasMode) return;
    if (now - lastFrameTime < FRAME_INTERVAL) return;
    lastFrameTime = now;

    ctx.clearRect(0, 0, W, H);

    for (var i = 0; i < FLAKE_COUNT; i++) {
      var f = flakes[i];
      f.y += f.vy;
      f.x += f.vx;

      if (f.y > H + 6) {
        f.y = -6;
        f.x = Math.random() * W;
      }
      if (f.x < -6) f.x = W + 4;
      else if (f.x > W + 6) f.x = -4;

      var px = f.x | 0;
      var py = f.y | 0;

      ctx.fillStyle = f.color;
      if (f.isCrystal) {
        // Cruz pixelada 8-bit en una sola pasada
        ctx.fillRect(px - 1, py, 3, 1);
        ctx.fillRect(px, py - 1, 1, 3);
      } else {
        ctx.fillRect(px, py, f.size, f.size);
      }
    }
  }

  requestAnimationFrame(tickSnow);
}

// ════════════════════════════════════════
//  FILTER & VALIDATION (Ported from ScoreDao.kt)
// ════════════════════════════════════════

function isValidPlayerName(rawName) {
  if (!rawName) return false;
  var name = String(rawName).trim();
  if (!name) return false;
  if (FAKE_SEEDS.indexOf(name.toLowerCase()) !== -1) return false;
  if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(name)) return false;
  var letters = name.replace(/[^a-zA-ZáéíóúÁÉÍÓÚñÑ]/g, '');
  if (letters.length < 2) return false;
  return true;
}

// ════════════════════════════════════════
//  SUPABASE REALTIME & REST SYNC ENGINE
// ════════════════════════════════════════

function getGuatemalaDateStr(dateObj) {
  var d = dateObj || new Date();
  try {
    var parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Guatemala',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).formatToParts(d);
    var y = '', m = '', day = '';
    parts.forEach(function (p) {
      if (p.type === 'year') y = p.value;
      if (p.type === 'month') m = p.value;
      if (p.type === 'day') day = p.value;
    });
    if (y && m && day) return y + '-' + m + '-' + day;
  } catch (e) {}
  return d.toISOString().slice(0, 10);
}

function getGuatemalaTodayStartISO() {
  var todayStr = getGuatemalaDateStr(new Date());
  return todayStr + 'T00:00:00-06:00';
}

function fetchSupabaseRest(queryPath) {
  var url = SUPABASE_URL + '/rest/v1/' + queryPath;
  return fetch(url, {
    method: 'GET',
    headers: {
      'apikey': SUPABASE_ANON,
      'Authorization': 'Bearer ' + SUPABASE_ANON,
      'Accept': 'application/json'
    },
    cache: 'no-store'
  }).then(function (resp) {
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    return resp.json();
  });
}

function processRawRowsToTop10(rows, game) {
  if (!Array.isArray(rows) || rows.length === 0) return [];
  var isTocaChallenge = (game.id === 'TOCACHALLENGE');
  var byPlayer = {};

  rows.forEach(function (row) {
    var rawName = (row.player_name || '').trim();
    var rawScore = Number(row.score) || 0;
    if (rawScore <= 0) return;

    var namesToProcess = [];
    if (isTocaChallenge && rawName.indexOf(' & ') !== -1) {
      var splitNames = rawName.split(' & ');
      splitNames.forEach(function (n) {
        namesToProcess.push({
          name: n.trim(),
          score: Math.round(rawScore / splitNames.length)
        });
      });
    } else {
      namesToProcess.push({ name: rawName, score: rawScore });
    }

    namesToProcess.forEach(function (item) {
      if (!isValidPlayerName(item.name)) return;
      var key = item.name.toUpperCase();
      var dateStr = row.played_at ? getGuatemalaDateStr(new Date(row.played_at)) : getGuatemalaDateStr();
      var boxLabel = row.box_id ? String(row.box_id).toUpperCase() : '';

      if (!byPlayer[key]) {
        byPlayer[key] = {
          playerName: item.name,
          score: item.score,
          playedDate: dateStr,
          achievedDate: dateStr,
          boxId: boxLabel
        };
      } else {
        if (scoreMode === 'sum') {
          byPlayer[key].score += item.score;
        } else if (item.score > byPlayer[key].score) {
          byPlayer[key].score = item.score;
          byPlayer[key].playedDate = dateStr;
          byPlayer[key].achievedDate = dateStr;
          byPlayer[key].boxId = boxLabel;
        }
      }
    });
  });

  var list = Object.keys(byPlayer).map(function (k) { return byPlayer[k]; });
  list.sort(function (a, b) { return b.score - a.score; });
  return list.slice(0, PLACEHOLDER_N);
}

function syncGameFromSupabase(game, isInitialBoot) {
  var todayStartIso = encodeURIComponent(getGuatemalaTodayStartISO());

  var allTimeQuery = 'match_scores?select=player_name,score,box_id,played_at' +
    '&game_id=eq.' + encodeURIComponent(game.dbId) +
    '&order=score.desc&limit=250';

  var todayQuery = 'match_scores?select=player_name,score,box_id,played_at' +
    '&game_id=eq.' + encodeURIComponent(game.dbId) +
    '&played_at=gte.' + todayStartIso +
    '&order=score.desc&limit=200';

  return Promise.all([
    fetchSupabaseRest(allTimeQuery),
    fetchSupabaseRest(todayQuery)
  ]).then(function (results) {
    var allTimeRows = results[0] || [];
    var todayRows   = results[1] || [];

    var prevTop1 = (cacheAllTime[game.id] && cacheAllTime[game.id][0]) ? cacheAllTime[game.id][0] : null;
    var newAllTimeTop10 = processRawRowsToTop10(allTimeRows, game);
    cacheAllTime[game.id] = newAllTimeTop10;

    if (!isInitialBoot && prevTop1 && newAllTimeTop10.length > 0) {
      var currentTop1 = newAllTimeTop10[0];
      if (currentTop1.score > prevTop1.score && currentTop1.playerName.toUpperCase() !== prevTop1.playerName.toUpperCase()) {
        window.showRecordBreakCelebration({
          gameType: game.id,
          playerName: currentTop1.playerName,
          newScore: currentTop1.score,
          previousRecord: prevTop1.score,
          previousHolder: prevTop1.playerName
        });
      }
    }

    // ESTRICTAMENTE SOLO RÉCORDS DE HOY (00:00 a 23:59 hora Guatemala)
    var todayStr = getGuatemalaDateStr(new Date());
    var strictTodayRows = todayRows.filter(function (r) {
      return r.played_at && getGuatemalaDateStr(new Date(r.played_at)) === todayStr;
    });
    cacheToday[game.id] = processRawRowsToTop10(strictTodayRows, game);
  }).catch(function (err) {
    console.warn('[TV Toca Social] Error sincronizando ' + game.id + ':', err);
  });
}

function syncAllGamesFromSupabase(isInitialBoot) {
  var promises = GAMES.map(function (g) {
    return syncGameFromSupabase(g, isInitialBoot);
  });

  Promise.all(promises).then(function () {
    saveLocalCache();
    loadAndRender(false);
    renderFooter(false);
  });
}

function initSupabaseRealtime() {
  if (!sbClient) return;
  try {
    sbClient
      .channel('tv-toca-social-live')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'match_scores' }, function (payload) {
        var row = payload && payload.new;
        if (!row) return;

        var matchedGame = null;
        for (var i = 0; i < GAMES.length; i++) {
          if (GAMES[i].dbId === row.game_id) {
            matchedGame = GAMES[i];
            break;
          }
        }

        var playerName = (row.player_name || 'Jugador').trim();
        var scoreVal   = Number(row.score) || 0;
        var boxLabel   = row.box_id ? String(row.box_id).toUpperCase() : 'BOX';

        if (matchedGame && scoreVal > 0 && isValidPlayerName(playerName)) {
          var currentTop1 = (cacheAllTime[matchedGame.id] && cacheAllTime[matchedGame.id][0])
            ? cacheAllTime[matchedGame.id][0]
            : null;

          if (currentTop1 && scoreVal > currentTop1.score) {
            window.showRecordBreakCelebration({
              gameType: matchedGame.id,
              playerName: playerName,
              newScore: scoreVal,
              previousRecord: currentTop1.score,
              previousHolder: currentTop1.playerName
            });
          }

          recentLiveEvents.unshift({
            game: matchedGame,
            playerName: playerName,
            score: scoreVal,
            boxId: boxLabel
          });
          if (recentLiveEvents.length > 6) recentLiveEvents.pop();

          syncGameFromSupabase(matchedGame, false).then(function () {
            saveLocalCache();
            loadAndRender(false);
            renderFooter(true);
          });
        }
      })
      .subscribe(function (status) {
        realtimeConnected = (status === 'SUBSCRIBED');
        updateConnectionUI();
      });
  } catch (e) {
    console.error('[TV Toca Social] Error en Realtime:', e);
  }
}

function updateConnectionUI() {
  var infoEl = document.getElementById('kiosk-conn-info');
  if (infoEl) {
    infoEl.textContent = realtimeConnected
      ? '● Supabase Realtime: CONECTADO EN VIVO'
      : '● Supabase REST: Sincronización activa';
  }
}

function saveLocalCache() {
  try {
    localStorage.setItem('toca_tv_cache_date', getGuatemalaDateStr(new Date()));
    localStorage.setItem('toca_tv_cache_today', JSON.stringify(cacheToday));
    localStorage.setItem('toca_tv_cache_alltime', JSON.stringify(cacheAllTime));
  } catch (e) {}
}

function loadLocalCache() {
  try {
    var todayStr = getGuatemalaDateStr(new Date());
    var savedDate = localStorage.getItem('toca_tv_cache_date');
    var t = localStorage.getItem('toca_tv_cache_today');
    var a = localStorage.getItem('toca_tv_cache_alltime');
    if (t && savedDate === todayStr) {
      var parsedToday = JSON.parse(t) || {};
      Object.keys(parsedToday).forEach(function (gKey) {
        cacheToday[gKey] = (parsedToday[gKey] || []).filter(function (item) {
          return item && item.playedDate === todayStr;
        });
      });
    } else {
      cacheToday = {};
      localStorage.removeItem('toca_tv_cache_today');
    }
    if (a) cacheAllTime = JSON.parse(a) || {};
  } catch (e) {}
}

// ════════════════════════════════════════
//  CLOCK (America/Guatemala)
// ════════════════════════════════════════

var lastDateRendered = '';

function startClock() {
  tickClock();
  setInterval(tickClock, 1000);
}

function tickClock() {
  var clockEl = document.getElementById('clock');
  var dateEl  = document.getElementById('date-display');
  var now     = new Date();

  try {
    if (clockEl) {
      clockEl.textContent = now.toLocaleTimeString('es-GT', {
        timeZone: 'America/Guatemala',
        hour12: false,
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
      });
    }
    if (dateEl) {
      var dStr = now.toLocaleDateString('es-GT', {
        timeZone: 'America/Guatemala',
        weekday: 'short',
        day: 'numeric',
        month: 'short',
        year: 'numeric'
      });
      var formattedDate = dStr.charAt(0).toUpperCase() + dStr.slice(1);
      if (formattedDate !== lastDateRendered) {
        lastDateRendered = formattedDate;
        dateEl.textContent = formattedDate;
      }
    }
  } catch (e) {
    if (clockEl) clockEl.textContent = now.toTimeString().slice(0, 8);
  }
}

// ════════════════════════════════════════
//  TABS
// ════════════════════════════════════════

function buildTabs() {
  var nav = document.getElementById('game-tabs');
  if (!nav) return;
  nav.innerHTML = '';
  GAMES.forEach(function (game, idx) {
    var btn = document.createElement('button');
    btn.className = 'game-tab' + (idx === currentGameIdx ? ' active' : '');
    btn.id = 'tab-' + idx;
    btn.innerHTML =
      '<img src="' + game.logo + '" class="tab-game-logo" alt="' + game.label + '" decoding="async">' +
      '<span class="tab-game-label">' + game.label + '</span>';
    btn.addEventListener('click', function () {
      currentGameIdx = idx;
      refreshTabsUI();
      enterPhase('today');
    });
    nav.appendChild(btn);
  });
}

function refreshTabsUI() {
  GAMES.forEach(function (_, idx) {
    var el = document.getElementById('tab-' + idx);
    if (el) el.className = 'game-tab' + (idx === currentGameIdx ? ' active' : '');
  });
}

// ════════════════════════════════════════
//  PHASE ROTATION: HOY → ALL-TIME → next game
//  (GPU-composited progress bar via transform: scaleX)
// ════════════════════════════════════════

function enterPhase(phase) {
  if (phaseTimer) clearTimeout(phaseTimer);

  currentMode   = phase;
  phaseDuration = phase === 'today' ? HOY_MS : ALLTIME_MS;

  var lblToday   = document.getElementById('mode-label-today');
  var lblAlltime = document.getElementById('mode-label-alltime');
  if (lblToday)   lblToday.className   = 'mode-label' + (phase === 'today' ? ' active-mode' : '');
  if (lblAlltime) lblAlltime.className = 'mode-label' + (phase === 'alltime' ? ' active-mode' : '');

  loadAndRender(true);
  animateProgressBarGPU(phaseDuration);

  phaseTimer = setTimeout(function () {
    if (currentMode === 'today') {
      enterPhase('alltime');
    } else {
      currentGameIdx = (currentGameIdx + 1) % GAMES.length;
      refreshTabsUI();
      enterPhase('today');
    }
  }, phaseDuration);
}

function animateProgressBarGPU(durationMs) {
  var fill = document.getElementById('mode-progress-fill');
  if (!fill) return;
  fill.style.transition = 'none';
  fill.style.transform  = 'scaleX(0)';
  // Forzar lectura mínima para reiniciar transición en GPU sin loop JS
  void fill.offsetWidth;
  fill.style.transition = 'transform ' + durationMs + 'ms linear';
  fill.style.transform  = 'scaleX(1)';
}

// ════════════════════════════════════════
//  DATA ACCESSORS
// ════════════════════════════════════════

function loadScores() {
  var gameId = GAMES[currentGameIdx].id;

  var list = currentMode === 'today' ? cacheToday[gameId] : cacheAllTime[gameId];
  if (Array.isArray(list) && list.length > 0) {
    return list;
  }

  if (window.Android) {
    try {
      var json = currentMode === 'today'
        ? window.Android.getTodayScores(gameId)
        : window.Android.getAllTimeRecords(gameId);
      var data = JSON.parse(json || '[]');
      if (Array.isArray(data) && data.length > 0) return data;
    } catch (e) {}
  }

  return [];
}

function loadHallOfFame() {
  return GAMES.map(function (g) {
    var topList = cacheAllTime[g.id];
    var topRecord = (Array.isArray(topList) && topList.length > 0) ? topList[0] : null;
    return { game: g, record: topRecord };
  });
}

// ════════════════════════════════════════
//  RENDER ORCHESTRATOR (With DOM Diffing)
// ════════════════════════════════════════

var lastHeaderKey = '';

function loadAndRender(forceHeader) {
  var game = GAMES[currentGameIdx];
  var scores = loadScores();

  var headerKey = game.id + '|' + currentMode;
  if (forceHeader || headerKey !== lastHeaderKey) {
    lastHeaderKey = headerKey;
    var gh = document.getElementById('game-header');
    if (gh) {
      if (game.img) {
        gh.style.backgroundImage =
          'linear-gradient(90deg, rgba(10, 0, 55, 0.90) 0%, rgba(10, 0, 55, 0.58) 45%, rgba(10, 0, 55, 0.88) 100%), url("' + game.img + '")';
      } else {
        gh.style.backgroundImage = 'none';
      }
      gh.innerHTML =
        '<div class="game-title-row">' +
        '<img src="' + game.logo + '" class="game-logo-large" alt="' + game.label + '" decoding="async">' +
        '<span class="game-name-large">' + game.label + '</span>' +
        '</div>' +
        '<span class="game-mode-badge">' +
        (currentMode === 'today' ? '▶ CAMPEONES DE HOY' : '★ RÉCORDS HISTÓRICOS') +
        '</span>';
    }
  }

  var sig = headerKey + '|' + JSON.stringify(scores);
  if (sig === lastListSignature) return;
  lastListSignature = sig;

  renderScoreList(scores);
}

// ════════════════════════════════════════
//  RENDER — Score list (Single-pass direct render)
// ════════════════════════════════════════

function renderScoreList(scores) {
  var list = document.getElementById('score-list');
  if (!list) return;

  var top = scores.slice(0, PLACEHOLDER_N);
  var maxScore = top.length > 0 ? (top[0].score || 1) : 1;

  while (top.length < PLACEHOLDER_N) top.push(null);

  list.innerHTML = top.map(function (entry, idx) {
    var rank = idx + 1;

    if (!entry) {
      return (
        '<div class="score-row empty">' +
        '<div class="rank-badge">' + rank + '</div>' +
        '<div class="player-info"><div class="player-name">- - -</div></div>' +
        '<div class="seg-bar">' + buildSegBar(0) + '</div>' +
        '<div class="score-value">' +
        '<span class="score-number">???</span>' +
        '<span class="score-pts">PTS</span>' +
        '</div>' +
        '</div>'
      );
    }

    var pct      = Math.round((entry.score / maxScore) * 100);
    var filled   = Math.round(pct / 100 * SEG_COUNT);
    var rankCls  = rank === 1 ? 'rank-1' : rank === 2 ? 'rank-2' : rank === 3 ? 'rank-3' : '';
    var badgeCls = rank === 1 ? 'gold' : rank === 2 ? 'silver' : rank === 3 ? 'bronze' : '';
    var dateStr  = fmtDate(entry.playedDate || entry.achievedDate || '');
    var metaText = dateStr + (entry.boxId ? ' · ' + entry.boxId : '');

    return (
      '<div class="score-row ' + rankCls + '">' +
      '<div class="rank-badge ' + badgeCls + '">' + rank + '</div>' +
      '<div class="player-info">' +
      '<div class="player-name">' + escHtml(entry.playerName) + '</div>' +
      (metaText ? '<div class="player-date">' + escHtml(metaText) + '</div>' : '') +
      '</div>' +
      '<div class="seg-bar">' + buildSegBar(filled) + '</div>' +
      '<div class="score-value">' +
      '<span class="score-number">' + fmtScore(entry.score) + '</span>' +
      '<span class="score-pts">PTS</span>' +
      '</div>' +
      '</div>'
    );
  }).join('');
}

function buildSegBar(filledCount) {
  var html = '';
  for (var i = 0; i < SEG_COUNT; i++) {
    html += '<div class="seg-block' + (i < filledCount ? ' filled' : '') + '"></div>';
  }
  return html;
}

// ════════════════════════════════════════
//  RENDER — Footer Hall of Fame + Live Ticker
// ════════════════════════════════════════

function renderFooter(force) {
  var track = document.getElementById('footer-ticker-track');
  if (!track) return;

  var hof = loadHallOfFame();
  var records = hof.filter(function (d) { return d.record; });

  var footerSig = JSON.stringify(recentLiveEvents) + '|' + JSON.stringify(records);
  if (!force && footerSig === lastFooterSignature) return;
  lastFooterSignature = footerSig;

  var items = [];

  recentLiveEvents.forEach(function (ev) {
    items.push(
      '<div class="ticker-item">' +
        '<span class="ticker-star">◆</span>' +
        '<img src="' + ev.game.logo + '" class="ticker-game-logo" alt="' + ev.game.label + '">' +
        '<span class="ticker-pname">' + escHtml(ev.playerName) + '</span>' +
        '<span class="ticker-sep">▸</span>' +
        '<span class="ticker-pscore">' + fmtScore(ev.score) + ' PTS</span>' +
        '<span class="ticker-game-name">[' + escHtml(ev.boxId) + ']</span>' +
      '</div>'
    );
  });

  records.forEach(function (d) {
    items.push(
      '<div class="ticker-item">' +
        '<span class="ticker-star">★</span>' +
        '<img src="' + d.game.logo + '" class="ticker-game-logo" alt="' + d.game.label + '">' +
        '<span class="ticker-game-name">RÉCORD ' + d.game.label + '</span>' +
        '<span class="ticker-sep">▸</span>' +
        '<span class="ticker-pname">' + escHtml(d.record.playerName) + '</span>' +
        '<span class="ticker-pscore">' + fmtScore(d.record.score) + ' PTS</span>' +
      '</div>'
    );
  });

  items.push(
    '<div class="ticker-item">' +
      '<span class="ticker-star">◆</span>' +
      '<span class="ticker-cta highlight">¡SUPERA EL RÉCORD EN TU BOX Y APARECE EN PANTALLA EN TIEMPO REAL!</span>' +
    '</div>'
  );

  items.push(
    '<div class="ticker-item">' +
      '<span class="ticker-star">★</span>' +
      '<span class="ticker-cta">COMPARTE TU VICTORIA CON #TocaSocialGT @TocaSocial</span>' +
    '</div>'
  );

  var oneSet = items.join('');
  track.innerHTML = oneSet + oneSet;
}

// ════════════════════════════════════════
//  RECORD BREAK CELEBRATION
// ════════════════════════════════════════

window.showRecordBreakCelebration = function (event) {
  var overlay = document.getElementById('record-overlay');
  if (!overlay) return;

  var gameLabel = (event.gameType || 'TOCA')
    .replace('ATOMSPLITTER', 'ATOM SPLITTER')
    .replace('TOCACHALLENGE', 'TOCA CHALLENGE');

  setText('rec-game', '— ' + gameLabel + ' —');
  setText('rec-player', event.playerName || '');
  setText('rec-score', fmtScore(event.newScore));

  var prevEl = document.getElementById('rec-prev');
  if (prevEl) {
    prevEl.textContent = event.previousRecord
      ? 'RÉCORD ANTERIOR: ' + fmtScore(event.previousRecord) +
      (event.previousHolder ? ' · ' + event.previousHolder : '')
      : '¡PRIMER RÉCORD EN ESTA CATEGORÍA!';
  }

  overlay.classList.remove('hidden');
  setTimeout(function () { overlay.classList.add('hidden'); }, 10000);
};

// ════════════════════════════════════════
//  WEB KIOSK SETTINGS & ROTATION
// ════════════════════════════════════════

function loadKioskSettings() {
  try {
    var params = new URLSearchParams(window.location.search);
    if (params.has('rot')) {
      screenRotation = parseInt(params.get('rot'), 10);
      if ([0, 90, 180, 270].indexOf(screenRotation) === -1) screenRotation = 270;
    } else {
      var savedRot = localStorage.getItem('toca_tv_rotation_v2');
      if (savedRot !== null) {
        screenRotation = parseInt(savedRot, 10);
        if ([0, 90, 180, 270].indexOf(screenRotation) === -1) screenRotation = 270;
      } else {
        screenRotation = 270;
      }
    }

    var savedXmas = localStorage.getItem('toca_tv_xmas_mode');
    if (savedXmas !== null) {
      xmasMode = savedXmas !== 'off';
    } else {
      xmasMode = true;
    }

    var savedScoreMode = localStorage.getItem('toca_tv_score_mode');
    if (savedScoreMode === 'sum' || savedScoreMode === 'best') {
      scoreMode = savedScoreMode;
    }

    var savedHoy = parseInt(localStorage.getItem('toca_tv_hoy_sec'), 10);
    if (savedHoy >= 4 && savedHoy <= 120) HOY_MS = savedHoy * 1000;

    var savedAll = parseInt(localStorage.getItem('toca_tv_alltime_sec'), 10);
    if (savedAll >= 4 && savedAll <= 120) ALLTIME_MS = savedAll * 1000;
  } catch (e) {}
}

function applyScreenRotation(deg) {
  screenRotation = [0, 90, 180, 270].indexOf(deg) !== -1 ? deg : 270;
  document.body.classList.remove('rot-0', 'rot-90', 'rot-180', 'rot-270');
  document.body.classList.add('rot-' + screenRotation);
  fitTvViewport();
}

function initKioskModal() {
  var modal        = document.getElementById('kiosk-modal');
  var btnGear      = document.getElementById('btn-kiosk-settings');
  var btnClose     = document.getElementById('btn-close-modal');
  var btnSave      = document.getElementById('btn-save-kiosk');
  var btnFull      = document.getElementById('btn-fullscreen');
  var btnTestRec   = document.getElementById('btn-test-record');
  var logoTrigger  = document.getElementById('logo-unlock-trigger');
  var rotBtns      = document.querySelectorAll('#rot-btn-group .kiosk-opt-btn');
  var xmasBtns     = document.querySelectorAll('#xmas-btn-group .kiosk-opt-btn');

  var selectedRot  = screenRotation;
  var selectedXmas = xmasMode;
  var tapCount = 0;
  var tapTimer = null;

  function openModal() {
    if (!modal) return;
    selectedRot  = screenRotation;
    selectedXmas = xmasMode;
    rotBtns.forEach(function (b) {
      b.classList.toggle('active', parseInt(b.dataset.rot, 10) === selectedRot);
    });
    xmasBtns.forEach(function (b) {
      b.classList.toggle('active', (b.dataset.xmas === 'on') === selectedXmas);
    });
    var modeSel = document.getElementById('kiosk-score-mode');
    if (modeSel) modeSel.value = scoreMode;
    var hoyInput = document.getElementById('kiosk-hoy-sec');
    if (hoyInput) hoyInput.value = Math.round(HOY_MS / 1000);
    var allInput = document.getElementById('kiosk-alltime-sec');
    if (allInput) allInput.value = Math.round(ALLTIME_MS / 1000);
    updateConnectionUI();
    modal.classList.remove('hidden');
  }

  if (btnGear) btnGear.addEventListener('click', openModal);
  if (btnClose) btnClose.addEventListener('click', function () { modal.classList.add('hidden'); });

  if (logoTrigger) {
    logoTrigger.addEventListener('click', function () {
      tapCount++;
      clearTimeout(tapTimer);
      if (tapCount >= 5) {
        tapCount = 0;
        openModal();
      } else {
        tapTimer = setTimeout(function () { tapCount = 0; }, 2000);
      }
    });
  }

  rotBtns.forEach(function (btn) {
    btn.addEventListener('click', function () {
      selectedRot = parseInt(btn.dataset.rot, 10) || 0;
      rotBtns.forEach(function (b) {
        b.classList.toggle('active', parseInt(b.dataset.rot, 10) === selectedRot);
      });
    });
  });

  xmasBtns.forEach(function (btn) {
    btn.addEventListener('click', function () {
      selectedXmas = (btn.dataset.xmas === 'on');
      xmasBtns.forEach(function (b) {
        b.classList.toggle('active', (b.dataset.xmas === 'on') === selectedXmas);
      });
    });
  });

  if (btnFull) {
    btnFull.addEventListener('click', function () {
      if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen().catch(function () {});
      } else {
        document.exitFullscreen().catch(function () {});
      }
    });
  }

  if (btnTestRec) {
    btnTestRec.addEventListener('click', function () {
      modal.classList.add('hidden');
      var g = GAMES[currentGameIdx];
      var top = (cacheAllTime[g.id] && cacheAllTime[g.id][0]) || { playerName: 'MELISSA', score: 2650 };
      window.showRecordBreakCelebration({
        gameType: g.id,
        playerName: top.playerName,
        newScore: top.score + 150,
        previousRecord: top.score,
        previousHolder: top.playerName
      });
    });
  }

  if (btnSave) {
    btnSave.addEventListener('click', function () {
      applyScreenRotation(selectedRot);
      applyXmasMode(selectedXmas);
      var modeSel = document.getElementById('kiosk-score-mode');
      if (modeSel) scoreMode = modeSel.value;

      var hoySec = parseInt((document.getElementById('kiosk-hoy-sec') || {}).value, 10) || 12;
      var allSec = parseInt((document.getElementById('kiosk-alltime-sec') || {}).value, 10) || 8;
      HOY_MS     = Math.max(4, Math.min(120, hoySec)) * 1000;
      ALLTIME_MS = Math.max(4, Math.min(120, allSec)) * 1000;

      try {
        localStorage.setItem('toca_tv_rotation_v2', String(screenRotation));
        localStorage.setItem('toca_tv_xmas_mode', xmasMode ? 'on' : 'off');
        localStorage.setItem('toca_tv_score_mode', scoreMode);
        localStorage.setItem('toca_tv_hoy_sec', String(Math.round(HOY_MS / 1000)));
        localStorage.setItem('toca_tv_alltime_sec', String(Math.round(ALLTIME_MS / 1000)));
      } catch (e) {}

      modal.classList.add('hidden');
      lastListSignature = '';
      syncAllGamesFromSupabase(true);
      enterPhase('today');
    });
  }
}

function requestScreenWakeLock() {
  if ('wakeLock' in navigator) {
    navigator.wakeLock.request('screen').catch(function () {});
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible') {
        navigator.wakeLock.request('screen').catch(function () {});
      }
    });
  }
}

// ════════════════════════════════════════
//  HELPERS
// ════════════════════════════════════════

function fmtScore(n) {
  return Number(n || 0).toLocaleString('es-GT');
}

function fmtDate(dateStr) {
  if (!dateStr) return '';
  try {
    var p = String(dateStr).split('-');
    if (p.length === 3) {
      var d = new Date(+p[0], +p[1] - 1, +p[2]);
      return d.toLocaleDateString('es-GT', { day: 'numeric', month: 'short', year: 'numeric' });
    }
  } catch (e) { /* ignore */ }
  return dateStr;
}

function escHtml(s) {
  if (!s) return '';
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function setText(id, text) {
  var el = document.getElementById(id);
  if (el) el.textContent = text;
}
