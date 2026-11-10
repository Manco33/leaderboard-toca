/**
 * TOCA SOCIAL — TV Leaderboard Web Engine  |  app.js
 *
 * Basado en el modelo original de TV Toca Social (Retro Arcade + SQLite)
 * adaptado 100% a Web en Tiempo Real con Supabase (match_scores).
 *
 * Rotación de fases:
 *   Por cada juego → muestra CAMPEONES DE HOY (12 s) → luego RÉCORDS HISTÓRICOS (8 s) → siguiente juego
 *
 * Siempre renderiza 10 filas con barras segmentadas de 22 bloques,
 * ticker inferior en vivo estilo ESPN y celebración de Nuevo Récord a pantalla completa.
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
var SYNC_MS       = 8000;  // background REST sync interval

var currentGameIdx = 0;
var currentMode    = 'today';   // 'today' | 'alltime'
var scoreMode      = 'best';    // 'best' (récord individual) | 'sum' (acumulado torneo)
var screenRotation = 270;       // 270° por defecto para la posición vertical de la TV
var xmasMode       = true;      // Modo Navideño / Nieve Arcade activo por defecto

var phaseTimer    = null;
var rafProgress   = null;
var progressStart = 0;
var phaseDuration = HOY_MS;

// Cache en memoria (reemplaza SQLite local manteniendo velocidad instantánea)
var cacheToday   = {}; // { STRIKER: [...], ATOMSPLITTER: [...], ... }
var cacheAllTime = {}; // { STRIKER: [...], ATOMSPLITTER: [...], ... }
var recentLiveEvents = []; // Últimos disparos en vivo para el ticker ESPN
var realtimeConnected = false;

// ════════════════════════════════════════
//  BOOT
// ════════════════════════════════════════

document.addEventListener('DOMContentLoaded', function () {
  loadKioskSettings();
  applyScreenRotation(screenRotation);
  applyXmasMode(xmasMode);
  buildXmasGarland();
  initSnowfall();
  buildTabs();
  startClock();
  initKioskModal();
  requestScreenWakeLock();

  // Cargar caché previo de localStorage si existe para arranque instantáneo
  loadLocalCache();
  enterPhase('today');
  renderFooter();

  // Sincronizar con Supabase inmediatamente y suscribirse a Realtime
  syncAllGamesFromSupabase(true);
  initSupabaseRealtime();
  setInterval(function () {
    syncAllGamesFromSupabase(false);
  }, SYNC_MS);
});

// ════════════════════════════════════════
//  PIXEL SNOWFALL & CHRISTMAS GARLAND ENGINE
//  (100% Canvas & Pixel Art — Cero Emojis)
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
  for (var i = 0; i < 28; i++) {
    var cls = colors[i % colors.length];
    html += '<span class="xmas-bulb ' + cls + '"></span>';
  }
  garland.innerHTML = html;
}

function initSnowfall() {
  var canvas = document.getElementById('snow-canvas');
  var appEl  = document.getElementById('app');
  if (!canvas || !appEl) return;

  var ctx = canvas.getContext('2d');
  var width = 1080;
  var height = 1920;

  function resizeSnowCanvas() {
    var rectW = appEl.clientWidth  || 1080;
    var rectH = appEl.clientHeight || 1920;
    width  = canvas.width  = rectW;
    height = canvas.height = rectH;
  }
  resizeSnowCanvas();
  window.addEventListener('resize', resizeSnowCanvas);

  var FLAKE_COUNT = 115;
  var flakes = [];
  var palette = ['#ffffff', '#ffffff', '#ffffff', '#d6fff6', '#00ffc2', '#ff84ff'];

  function createFlake(randomY) {
    // 3 capas de profundidad: 0 = fondo lento, 1 = medio, 2 = primer plano con cristal pixelado
    var layer = Math.random() < 0.22 ? 2 : (Math.random() < 0.55 ? 1 : 0);
    var size  = layer === 2 ? 4 : (layer === 1 ? 4 : 2);
    return {
      x: Math.random() * width,
      y: randomY ? Math.random() * height : -16 - Math.random() * 40,
      vy: layer === 2 ? (1.35 + Math.random() * 0.85) : layer === 1 ? (0.85 + Math.random() * 0.55) : (0.45 + Math.random() * 0.35),
      vx: (Math.random() - 0.5) * 0.45,
      swayAmp: 0.35 + Math.random() * 0.65,
      swaySpeed: 0.012 + Math.random() * 0.02,
      phase: Math.random() * Math.PI * 2,
      size: size,
      isCrystal: layer === 2,
      color: palette[Math.floor(Math.random() * palette.length)],
      alpha: layer === 2 ? 0.92 : (layer === 1 ? 0.72 : 0.45)
    };
  }

  for (var i = 0; i < FLAKE_COUNT; i++) {
    flakes.push(createFlake(true));
  }

  function drawPixelCrystal(x, y, p, color, alpha) {
    ctx.globalAlpha = alpha;
    ctx.fillStyle = color;
    // Centro y brazos en cruz estilo 8-bit (sin antialiasing)
    ctx.fillRect(x, y, p, p);
    ctx.fillRect(x - p, y, p, p);
    ctx.fillRect(x + p, y, p, p);
    ctx.fillRect(x, y - p, p, p);
    ctx.fillRect(x, y + p, p, p);
    // Puntas externas más tenues para efecto cristal arcade
    ctx.globalAlpha = alpha * 0.55;
    ctx.fillRect(x - p * 2, y, p, p);
    ctx.fillRect(x + p * 2, y, p, p);
    ctx.fillRect(x, y - p * 2, p, p);
    ctx.fillRect(x, y + p * 2, p, p);
  }

  function tickSnow() {
    if (xmasMode) {
      if (canvas.width !== appEl.clientWidth || canvas.height !== appEl.clientHeight) {
        resizeSnowCanvas();
      }
      ctx.clearRect(0, 0, width, height);

      for (var i = 0; i < flakes.length; i++) {
        var f = flakes[i];
        f.phase += f.swaySpeed;
        f.y += f.vy;
        f.x += f.vx + Math.sin(f.phase) * f.swayAmp;

        // Reaparecer arriba al llegar al borde inferior
        if (f.y > height + 20) {
          flakes[i] = createFlake(false);
          continue;
        }
        if (f.x < -20) f.x = width + 15;
        if (f.x > width + 20) f.x = -15;

        // Snap a coordenadas enteras para estética pixel-perfect
        var px = Math.round(f.x);
        var py = Math.round(f.y);

        if (f.isCrystal) {
          drawPixelCrystal(px, py, 3, f.color, f.alpha);
        } else {
          ctx.globalAlpha = f.alpha;
          ctx.fillStyle = f.color;
          ctx.fillRect(px, py, f.size, f.size);
        }
      }
      ctx.globalAlpha = 1;
    }
    requestAnimationFrame(tickSnow);
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
  // Descartar nombres que parecen fechas (dd/mm/yyyy)
  if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(name)) return false;
  // Debe tener al menos 2 letras alfabéticas
  var letters = name.replace(/[^a-zA-ZáéíóúÁÉÍÓÚñÑ]/g, '');
  if (letters.length < 2) return false;
  return true;
}

// ════════════════════════════════════════
//  SUPABASE REALTIME & REST SYNC ENGINE
//  (Replaces TocaApiClient.kt + ScoreRepository.kt)
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
  // America/Guatemala es UTC-6 todo el año (sin horario de verano)
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

/**
 * Agrupa y ordena una lista de filas de match_scores según el modo (best vs sum)
 * y aplica las reglas de Toca Challenge (individual) y limpieza de nombres.
 */
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

  // 1) Consulta All-Time (Top 250 por puntaje descendente para ese juego)
  var allTimeQuery = 'match_scores?select=player_name,score,box_id,played_at' +
    '&game_id=eq.' + encodeURIComponent(game.dbId) +
    '&order=score.desc&limit=250';

  // 2) Consulta Hoy (desde las 00:00 hora Guatemala)
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

    // Detectar si hubo ruptura de récord histórico respecto a nuestro caché previo
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
    // Filtramos además por fecha exacta de hoy para garantizar que nunca aparezcan días anteriores
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
    loadAndRender();
    renderFooter();
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

        // Encontrar el juego correspondiente
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
          // 1. Verificar si este tiro en vivo acaba de romper el Récord Histórico #1
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

          // 2. Agregar al ticker en vivo estilo ESPN
          recentLiveEvents.unshift({
            game: matchedGame,
            playerName: playerName,
            score: scoreVal,
            boxId: boxLabel
          });
          if (recentLiveEvents.length > 6) recentLiveEvents.pop();

          // 3. Sincronizar de inmediato ese juego y refrescar pantalla
          syncGameFromSupabase(matchedGame, false).then(function () {
            saveLocalCache();
            loadAndRender();
            renderFooter();
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
    // Solo cargar caché de HOY si corresponde exactamente a la fecha de hoy
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
      dateEl.textContent = dStr.charAt(0).toUpperCase() + dStr.slice(1);
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
      '<img src="' + game.logo + '" class="tab-game-logo" alt="' + game.label + '">' +
      '<span class="tab-game-label">' + game.label + '</span>';
    btn.addEventListener('click', function () {
      currentGameIdx = idx;
      refreshTabsUI();
      enterPhase('today');   // clicking a tab always restarts from HOY
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
// ════════════════════════════════════════

function enterPhase(phase) {
  if (phaseTimer) clearTimeout(phaseTimer);
  if (rafProgress) cancelAnimationFrame(rafProgress);

  currentMode   = phase;
  phaseDuration = phase === 'today' ? HOY_MS : ALLTIME_MS;
  progressStart = Date.now();

  // Update mode label UI
  var lblToday   = document.getElementById('mode-label-today');
  var lblAlltime = document.getElementById('mode-label-alltime');
  if (lblToday)   lblToday.className   = 'mode-label' + (phase === 'today' ? ' active-mode' : '');
  if (lblAlltime) lblAlltime.className = 'mode-label' + (phase === 'alltime' ? ' active-mode' : '');

  loadAndRender();
  animateProgressBar();

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

function animateProgressBar() {
  var fill = document.getElementById('mode-progress-fill');
  if (!fill) return;
  function tick() {
    var pct = Math.min(((Date.now() - progressStart) / phaseDuration) * 100, 100);
    fill.style.width = pct + '%';
    rafProgress = requestAnimationFrame(tick);
  }
  tick();
}

// ════════════════════════════════════════
//  DATA ACCESSORS (Supabase Cache + Android Bridge Fallback)
// ════════════════════════════════════════

function loadScores() {
  var gameId = GAMES[currentGameIdx].id;

  // 1) Si ya tenemos datos en el caché de Supabase, usarlos directamente
  var list = currentMode === 'today' ? cacheToday[gameId] : cacheAllTime[gameId];
  if (Array.isArray(list) && list.length > 0) {
    return list;
  }

  // 2) Si en 'today' está vacío pero hay 'alltime', o si estamos en WebView Android legacy
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
//  RENDER ORCHESTRATOR
// ════════════════════════════════════════

function loadAndRender() {
  var game = GAMES[currentGameIdx];

  // Sub-header with game background image
  var gh = document.getElementById('game-header');
  if (gh) {
    if (game.img) {
      gh.style.backgroundImage =
        'linear-gradient(90deg, rgba(10, 0, 55, 0.88) 0%, rgba(10, 0, 55, 0.55) 45%, rgba(10, 0, 55, 0.85) 100%), url("' + game.img + '")';
    } else {
      gh.style.backgroundImage = 'none';
    }
    gh.innerHTML =
      '<div class="game-title-row">' +
      '<img src="' + game.logo + '" class="game-logo-large" alt="' + game.label + '">' +
      '<span class="game-name-large">' + game.label + '</span>' +
      '</div>' +
      '<span class="game-mode-badge">' +
      (currentMode === 'today' ? '▶ CAMPEONES DE HOY' : '★ RÉCORDS HISTÓRICOS') +
      '</span>';
  }

  renderScoreList(loadScores());
}

// ════════════════════════════════════════
//  RENDER — Score list (always 10 rows)
// ════════════════════════════════════════

function renderScoreList(scores) {
  var list = document.getElementById('score-list');
  if (!list) return;

  var top = scores.slice(0, PLACEHOLDER_N);
  var maxScore = top.length > 0 ? (top[0].score || 1) : 1;

  // Pad to PLACEHOLDER_N with empty entries
  while (top.length < PLACEHOLDER_N) top.push(null);

  list.innerHTML = top.map(function (entry, idx) {
    var rank = idx + 1;

    if (!entry) {
      return (
        '<div class="score-row empty" style="--row-idx:' + idx + '">' +
        '<div class="rank-badge">' + rank + '</div>' +
        '<div class="player-info"><div class="player-name">- - -</div></div>' +
        '<div class="seg-bar">' + buildSegBar(0, rank) + '</div>' +
        '<div class="score-value">' +
        '<span class="score-number">???</span>' +
        '<span class="score-pts">PTS</span>' +
        '</div>' +
        '</div>'
      );
    }

    var pct      = Math.round((entry.score / maxScore) * 100);
    var rankCls  = rank === 1 ? 'rank-1' : rank === 2 ? 'rank-2' : rank === 3 ? 'rank-3' : '';
    var badgeCls = rank === 1 ? 'gold' : rank === 2 ? 'silver' : rank === 3 ? 'bronze' : '';
    var dateStr  = fmtDate(entry.playedDate || entry.achievedDate || '');
    var metaText = dateStr + (entry.boxId ? ' · ' + entry.boxId : '');

    return (
      '<div class="score-row ' + rankCls + '" style="--row-idx:' + idx + '">' +
      '<div class="rank-badge ' + badgeCls + '">' + rank + '</div>' +
      '<div class="player-info">' +
      '<div class="player-name">' + escHtml(entry.playerName) + '</div>' +
      (metaText ? '<div class="player-date">' + escHtml(metaText) + '</div>' : '') +
      '</div>' +
      '<div class="seg-bar" data-pct="' + pct + '">' + buildSegBar(0, rank) + '</div>' +
      '<div class="score-value">' +
      '<span class="score-number">' + fmtScore(entry.score) + '</span>' +
      '<span class="score-pts">PTS</span>' +
      '</div>' +
      '</div>'
    );
  }).join('');

  // Animate bars after two rAF frames
  requestAnimationFrame(function () {
    requestAnimationFrame(function () {
      list.querySelectorAll('.seg-bar[data-pct]').forEach(function (bar) {
        var pct = parseInt(bar.dataset.pct, 10) || 0;
        var filled = Math.round(pct / 100 * SEG_COUNT);
        bar.innerHTML = buildSegBar(filled, 0);
      });
    });
  });
}

function buildSegBar(filledCount, rank) {
  var html = '';
  for (var i = 0; i < SEG_COUNT; i++) {
    html += '<div class="seg-block' + (i < filledCount ? ' filled' : '') + '"></div>';
  }
  return html;
}

// ════════════════════════════════════════
//  RENDER — Footer Hall of Fame + Live Ticker
//  (Sin emojis — iconografía arcade limpia)
// ════════════════════════════════════════

function renderFooter() {
  var track = document.getElementById('footer-ticker-track');
  if (!track) return;

  var hof = loadHallOfFame();
  var records = hof.filter(function (d) { return d.record; });

  var items = [];

  // 1. Últimos disparos en vivo desde las 18 cabinas (Realtime)
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

  // 2. Récords Históricos #1 de cada juego (Salón de la Fama)
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

  // 3. Mensajes arcade Toca Social (0% emojis)
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
//  (Replaces Android Web Kiosk SettingsActivity & RotatedWebView)
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
  if (screenRotation !== 0) {
    document.body.classList.add('rot-' + screenRotation);
  }
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

  // 5 toques en el logo TOCA abre ajustes (igual que TapUnlockHandler.kt en android-web-kiosk)
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
