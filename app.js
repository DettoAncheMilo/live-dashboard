let selectedDriverId = localStorage.getItem('pit_driver_id') || null;
let currentRaceId = localStorage.getItem('pit_race_id') || null;
let ws = null; 
let lastKnownDrivers = []; 

// Gestione cronometro
let localRaceSeconds = 0;
let clockInterval = null;
let currentRaceData = null;
let activeEngine = 'time2race'; // Può essere 'time2race' o 'mylaps'

if ('wakeLock' in navigator) {
  navigator.wakeLock.request('screen').catch(console.error);
}

function getDriverId(d) {
  return d.id || d.user_id || d.raceno || d.fullname || d.no || d.nam; // Aggiunte le etichette Mylaps (no, nam)
}

function formatLapTime(timeStr) {
  if (!timeStr || timeStr === "00:00:00.000000") return '--:--.--';
  let formatted = timeStr;
  if (formatted.startsWith("00:")) formatted = formatted.substring(3);
  if (formatted.startsWith("00:")) formatted = formatted.substring(3);
  if (formatted.includes('.')) formatted = formatted.substring(0, formatted.indexOf('.') + 4);
  return formatted;
}

function timeStringToSeconds(str) {
  if (!str) return 0;
  const parts = str.split(':');
  if (parts.length < 3) return 0;
  return (+parts[0]) * 3600 + (+parts[1]) * 60 + (+parts[2]);
}

function secondsToTimeString(totalSeconds) {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  if (h > 0) {
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  } else {
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
}

// MOTORE IBRIDO: Riconosce quale link hai incollato
function loadNewRace() {
  const inputUrl = document.getElementById('raceLinkInput').value;
  
  if (inputUrl.includes('time2race.it')) {
    const match = inputUrl.match(/race\/(\d+)/); 
    if (match && match[1]) {
      currentRaceId = match[1];
      activeEngine = 'time2race';
      localStorage.setItem('pit_race_id', currentRaceId);
      document.getElementById('driverSelect').innerHTML = '<option value="">Seleziona Pilota...</option>';
      lastKnownDrivers = []; 
      connectWebSocket(); 
    }
  } else if (inputUrl.includes('speedhive.mylaps.com')) {
    // Il link è Mylaps. Lanciamo l'avviso per il blocco Token/CORS.
    alert("🚦 MOTORE MYLAPS RILEVATO!\n\nI server di Mylaps sono protetti da Token Microsoft Azure temporanei. Poiché la dashboard è su GitHub (senza un server backend), Microsoft blocca la connessione automatica per motivi di sicurezza (CORS).\n\nIl codice sorgente dell'app contiene già il decodificatore per Mylaps, pronto per quando aggiungerai un server!");
  } else {
    alert("Inserisci un link valido (Time2Race o Mylaps)!");
  }
}

function changeDriver() {
  const selectElement = document.getElementById('driverSelect');
  const newId = selectElement.value;
  if (!newId) return;
  selectedDriverId = newId;
  localStorage.setItem('pit_driver_id', newId);
  if (lastKnownDrivers.length > 0) updateDashboard(lastKnownDrivers);
}

document.addEventListener('change', function(event) {
  if (event.target && event.target.id === 'driverSelect') {
    changeDriver();
  }
});

// CONNESSIONE TIME2RACE
function connectWebSocket() {
  if (!currentRaceId || activeEngine !== 'time2race') return;
  if (ws) ws.close();

  const wsUrl = `wss://api-stg.mk.time2race.it/live/${currentRaceId}/ranking/`;
  ws = new WebSocket(wsUrl);

  ws.onmessage = function(event) {
    if (event.data === 'ping' || event.data === 'pong') return;
    try {
      const payload = JSON.parse(event.data);
      const raceInfo = payload.race || (payload.data ? payload.data.race : null);
      if (raceInfo) updateSessionInfo(raceInfo);

      let driversList = payload.drivers || (payload.data ? payload.data.drivers : null);
      if (driversList && driversList.length > 0) {
        lastKnownDrivers = driversList; 
        populateDriverDropdown(driversList);
        updateDashboard(driversList);
      }
    } catch (err) {
      console.log("In attesa dati live...");
    }
  };

  ws.onclose = function() {
    setTimeout(connectWebSocket, 3000); 
  };
}

/* 
=====================================================
  STRUTTURA MOTORE MYLAPS (DORMIENTE)
  Pronto per quando il progetto avrà un server backend
=====================================================
function connectMylaps(sessionToken, wssUrl) {
  ws = new WebSocket(wssUrl);
  // SignalR richiede il carattere invisibile 0x1E alla fine di ogni comando
  const END_CHAR = String.fromCharCode(0x1E);

  ws.onopen = function() {
    // 1. Handshake iniziale
    ws.send('{"protocol":"json","version":1}' + END_CHAR);
    // 2. Iscrizione alla gara specifica (JoinGroup)
    ws.send(JSON.stringify({
      arguments: [`session-${sessionToken}`],
      invocationId: "0",
      target: "JoinGroup",
      type: 1
    }) + END_CHAR);
  };

  ws.onmessage = function(event) {
    // Dividiamo i messaggi usando il carattere separatore di SignalR
    const messages = event.data.split(END_CHAR);
    messages.forEach(msg => {
      if(msg) {
        try {
          const payload = JSON.parse(msg);
          // Decodifica etichette Mylaps: btTm (Miglior Giro), lsTm (Ultimo Giro), pos (Posizione)
          if(payload.type === 1 && payload.arguments && payload.arguments[0].results) {
             const driversList = payload.arguments[0].results;
             // Da qui il codice riprende la nostra normale updateDashboard()!
          }
        } catch(e) {}
      }
    });
  };
}
=====================================================
*/

// SINCRONIZZAZIONE MORBIDA (Soft Sync)
function updateSessionInfo(race) {
  currentRaceData = race;
  let serverSeconds = timeStringToSeconds(race.racetime || "00:00:00");

  if (localRaceSeconds === 0 || Math.abs(localRaceSeconds - serverSeconds) > 2) {
    localRaceSeconds = serverSeconds;
  }

  if (!clockInterval) {
    clockInterval = setInterval(() => {
      if (currentRaceData && currentRaceData.running !== false && !currentRaceData.endrace) {
        localRaceSeconds++;
        renderSessionTimer();
      }
    }, 1000);
  }
  renderSessionTimer();
}

function renderSessionTimer() {
  const statusBox = document.getElementById('sessionStatus');
  if (!statusBox || !currentRaceData) return;

  if (currentRaceData.endrace) {
    statusBox.innerHTML = "🏁 <strong style='color: #ef4444;'>SESSIONE TERMINATA</strong> 🏁";
    return;
  }

  let timeText = secondsToTimeString(localRaceSeconds);
  let statusHtml = `⏱️ Gara: <span style="color: #22c55e;">${timeText}</span>`;

  if (currentRaceData.running === false && localRaceSeconds > 0) {
    statusHtml += ` <span style="color: #eab308; font-size: 0.9em;">(PAUSA)</span>`;
  }
  if (currentRaceData.lapstogo > 0) {
    statusHtml += ` &nbsp;|&nbsp; 🔄 Giri: <span style="color: #3b82f6;">${currentRaceData.lapstogo}</span>`;
  }
  statusBox.innerHTML = statusHtml;
}

function updateDashboard(driversList) {
  if (!selectedDriverId) return;
  const myDriver = driversList.find(d => String(getDriverId(d)) === String(selectedDriverId));

  if (myDriver) {
    // La logica supporta sia l'etichetta di Time2Race (.difference) sia se un domani passassi Mylaps (.df)
    document.getElementById('pos').innerText = `P${myDriver.position || myDriver.pos || '-'}`;
    document.getElementById('lastLap').innerText = formatLapTime(myDriver.lasttime || myDriver.lsTm);
    document.getElementById('bestLap').innerText = formatLapTime(myDriver.besttime || myDriver.btTm);
    document.getElementById('gap').innerText = myDriver.difference || myDriver.df ? `+${myDriver.difference || myDriver.df}` : '+0.000';
  } else {
    document.getElementById('pos').innerText = `P-`;
    document.getElementById('lastLap').innerText = '--:--.--';
    document.getElementById('bestLap').innerText = '--:--.--';
    document.getElementById('gap').innerText = '+0.000';
  }
}

function populateDriverDropdown(drivers) {
  const select = document.getElementById('driverSelect');
  if (select.options.length <= 1 && drivers.length > 0) {
    select.innerHTML = '<option value="">Seleziona Pilota...</option>';
    drivers.forEach(d => {
      const opt = document.createElement('option');
      opt.value = getDriverId(d); 
      const num = d.raceno || d.no || '';
      const name = d.fullname || d.nickname || d.nam || `Pilota ${getDriverId(d)}`;
      opt.textContent = num ? `#${num} ${name}` : name;
      if (String(opt.value) === String(selectedDriverId)) opt.selected = true;
      select.appendChild(opt);
    });
    updateDashboard(drivers);
  }
}

if (currentRaceId) {
  document.getElementById('raceLinkInput').value = `https://stg.mk.time2race.it/race/${currentRaceId}/`;
  connectWebSocket();
}