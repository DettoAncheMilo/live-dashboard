let selectedDriverId = localStorage.getItem('pit_driver_id') || null;
let currentRaceId = localStorage.getItem('pit_race_id') || null;
let ws = null; 
let lastKnownDrivers = []; 

// Variabili per far scorrere il tempo in locale
let localTimerInterval = null;
let currentRaceSeconds = 0;
let isSessionRunning = false;
let sessionLapsToGo = 0;
let isSessionEnded = false;

if ('wakeLock' in navigator) {
  navigator.wakeLock.request('screen').catch(console.error);
}

function getDriverId(d) {
  return d.id || d.user_id || d.raceno || d.fullname;
}

function formatLapTime(timeStr) {
  if (!timeStr || timeStr === "00:00:00.000000") return '--:--.--';
  let formatted = timeStr;
  if (formatted.startsWith("00:")) formatted = formatted.substring(3);
  if (formatted.startsWith("00:")) formatted = formatted.substring(3);
  if (formatted.includes('.')) formatted = formatted.substring(0, formatted.indexOf('.') + 4);
  return formatted;
}

// Converte "00:15:57" in secondi totali per farli scorrere
function timeStringToSeconds(str) {
  if (!str) return 0;
  const parts = str.split(':');
  return (+parts[0]) * 3600 + (+parts[1]) * 60 + (+parts[2]);
}

// Converte i secondi in formato MM:SS o HH:MM:SS
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

function loadNewRace() {
  const inputUrl = document.getElementById('raceLinkInput').value;
  const match = inputUrl.match(/race\/(\d+)/); 
  
  if (match && match[1]) {
    currentRaceId = match[1];
    localStorage.setItem('pit_race_id', currentRaceId);
    document.getElementById('driverSelect').innerHTML = '<option value="">Seleziona Pilota...</option>';
    lastKnownDrivers = []; 
    connectWebSocket(); 
  } else {
    alert("Inserisci un link valido (es. https://stg.mk.time2race.it/race/37/)");
  }
}

function changeDriver() {
  const selectElement = document.getElementById('driverSelect');
  const newId = selectElement.value;
  
  if (!newId) return;

  selectedDriverId = newId;
  localStorage.setItem('pit_driver_id', newId);
  
  if (lastKnownDrivers.length > 0) {
    updateDashboard(lastKnownDrivers);
  }
}

document.addEventListener('change', function(event) {
  if (event.target && event.target.id === 'driverSelect') {
    changeDriver();
  }
});

function connectWebSocket() {
  if (!currentRaceId) return;
  if (ws) ws.close();

  const wsUrl = `wss://api-stg.mk.time2race.it/live/${currentRaceId}/ranking/`;
  ws = new WebSocket(wsUrl);

  ws.onmessage = function(event) {
    if (event.data === 'ping' || event.data === 'pong') return;
    
    try {
      const payload = JSON.parse(event.data);
      
      // Sincronizza il tempo di gara (racetime) con il server
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

// Funzione che gestisce i dati ricevuti dal server
function updateSessionInfo(race) {
  isSessionEnded = race.endrace;
  isSessionRunning = race.running;
  sessionLapsToGo = race.lapstogo || 0;
  
  // Usa il racetime e lo converte in secondi
  currentRaceSeconds = timeStringToSeconds(race.racetime || "00:00:00");
  
  renderSessionTimer();

  // Gestisce lo scorrimento locale ogni secondo
  if (isSessionRunning && !isSessionEnded) {
    if (!localTimerInterval) {
      localTimerInterval = setInterval(() => {
        currentRaceSeconds++;
        renderSessionTimer();
      }, 1000);
    }
  } else {
    // Se la gara è in pausa o finita, ferma lo scorrimento
    if (localTimerInterval) {
      clearInterval(localTimerInterval);
      localTimerInterval = null;
    }
  }
}

// Funzione che aggiorna materialmente la grafica del banner
function renderSessionTimer() {
  const statusBox = document.getElementById('sessionStatus');
  if (!statusBox) return;

  if (isSessionEnded) {
    statusBox.innerHTML = "🏁 <strong style='color: #ef4444;'>SESSIONE TERMINATA</strong> 🏁";
    if (localTimerInterval) clearInterval(localTimerInterval);
    return;
  }

  let timeText = secondsToTimeString(currentRaceSeconds);
  let statusHtml = `⏱️ Gara: <span style="color: #22c55e;">${timeText}</span>`;

  if (!isSessionRunning && currentRaceSeconds > 0) {
    statusHtml += ` <span style="color: #eab308; font-size: 0.9em;">(PAUSA)</span>`;
  }

  if (sessionLapsToGo > 0) {
    statusHtml += ` &nbsp;|&nbsp; 🔄 Giri: <span style="color: #3b82f6;">${sessionLapsToGo}</span>`;
  }

  statusBox.innerHTML = statusHtml;
}

function updateDashboard(driversList) {
  if (!selectedDriverId) return;

  const myDriver = driversList.find(d => String(getDriverId(d)) === String(selectedDriverId));

  if (myDriver) {
    document.getElementById('pos').innerText = `P${myDriver.position || '-'}`;
    document.getElementById('lastLap').innerText = formatLapTime(myDriver.lasttime);
    document.getElementById('bestLap').innerText = formatLapTime(myDriver.besttime);
    document.getElementById('gap').innerText = myDriver.difference ? `+${myDriver.difference}` : '+0.000';
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
      
      const num = d.raceno || '';
      const name = d.fullname || d.nickname || `Pilota ${getDriverId(d)}`;
      
      opt.textContent = num ? `#${num} ${name}` : name;
      
      if (String(opt.value) === String(selectedDriverId)) {
        opt.selected = true;
      }
      select.appendChild(opt);
    });
    
    updateDashboard(drivers);
  }
}

if (currentRaceId) {
  document.getElementById('raceLinkInput').value = `https://stg.mk.time2race.it/race/${currentRaceId}/`;
  connectWebSocket();
}