let selectedDriverId = localStorage.getItem('pit_driver_id') || null;
let currentRaceId = localStorage.getItem('pit_race_id') || null;
let ws = null; 
let lastKnownDrivers = []; 

// Gestione cronometro
let localRaceSeconds = 0;
let clockInterval = null;
let currentRaceData = null;
let activeEngine = 'time2race';

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

// MOTORE IBRIDO: Riconoscimento automatico del circuito
function loadNewRace() {
  const inputUrl = document.getElementById('raceLinkInput').value;
  
  if (inputUrl.includes('time2race.it')) {
    const match = inputUrl.match(/race\/(\d+)/); 
    if (match && match[1]) {
      currentRaceId = match[1];
      activeEngine = 'time2race';
      localStorage.setItem('pit_race_id', currentRaceId);
      resetDashboard();
      connectTime2Race(); 
    }
  } else if (inputUrl.includes('speedhive.mylaps.com')) {
    // Estrae l'ID della sessione dal link (es. KKKINDLQ-2147483897-1073742199)
    const match = inputUrl.match(/sessions\/([A-Za-z0-9\-]+)/);
    if (match && match[1]) {
      currentRaceId = match[1];
      activeEngine = 'mylaps';
      localStorage.setItem('pit_race_id', currentRaceId);
      resetDashboard();
      connectMylaps(currentRaceId);
    } else {
      alert("Link Mylaps non valido. Assicurati che contenga '/sessions/...'");
    }
  } else {
    alert("Inserisci un link valido (Time2Race o Mylaps)!");
  }
}

function resetDashboard() {
  document.getElementById('driverSelect').innerHTML = '<option value="">Seleziona Pilota...</option>';
  lastKnownDrivers = [];
  localRaceSeconds = 0;
  currentRaceData = null;
  if(clockInterval) clearInterval(clockInterval);
  clockInterval = null;
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

// ==========================================
// 1. MOTORE TIME2RACE
// ==========================================
function connectTime2Race() {
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
    } catch (err) {}
  };
  ws.onclose = function() { setTimeout(connectTime2Race, 3000); };
}

// ==========================================
// 2. MOTORE MYLAPS (Tramite Cloudflare)
// ==========================================
async function connectMylaps(sessionId) {
  if (!currentRaceId || activeEngine !== 'mylaps') return;
  if (ws) ws.close();

  try {
    console.log("Richiesta Token tramite il server Cloudflare...");
    
    // Usiamo il tuo server per fregare il blocco CORS di Microsoft
    const proxyUrl = 'https://mylaps-proxy.nico-mila91.workers.dev/?url=';
    const settingsUrl = encodeURIComponent('https://speedhive.mylaps.com/api/clientSettings');
    
    const response = await fetch(proxyUrl + settingsUrl);
    const settings = await response.json();
    
    // Peschiamo il Token
    const token = settings.LiveTimingNotificationsToken || settings.liveTimingNotificationsToken;
    if(!token) throw new Error("Token non trovato!");

    const wsUrl = `wss://livetimingnotifications-eu-prd-sig01.service.signalr.net/client/?hub=livetiminghub&access_token=${token}`;
    ws = new WebSocket(wsUrl);
    const END_CHAR = String.fromCharCode(0x1E); // Carattere segreto di Microsoft

    ws.onopen = function() {
      console.log("Connesso a Mylaps! Eseguo Handshake SignalR...");
      ws.send('{"protocol":"json","version":1}' + END_CHAR);
      
      ws.send(JSON.stringify({
        arguments: [`session-${sessionId}`],
        invocationId: "0",
        target: "JoinGroup",
        type: 1
      }) + END_CHAR);
    };

    ws.onmessage = function(event) {
      const messages = event.data.split(END_CHAR);
      messages.forEach(msg => {
        if(msg) {
          try {
            const payload = JSON.parse(msg);
            
            // Quando arrivano i tempi sul giro...
            if(payload.type === 1 && payload.arguments && payload.arguments[0] && payload.arguments[0].results) {
               const rawDrivers = payload.arguments[0].results;
               
               // TRADUTTORE: Trasformiamo i dati di Mylaps in formato Time2Race!
               const mappedDrivers = rawDrivers.map(d => ({
                 id: d.id,
                 raceno: d.no,
                 fullname: d.nam,
                 position: d.pos,
                 lasttime: d.lsTm,
                 besttime: d.btTm,
                 difference: d.df
               }));
               
               lastKnownDrivers = mappedDrivers;
               populateDriverDropdown(mappedDrivers);
               updateDashboard(mappedDrivers);
               
               // Mylaps non invia i secondi di gara come T2R, quindi simuliamo la scritta
               document.getElementById('sessionStatus').innerHTML = "🏁 <strong style='color: #22c55e;'>MYLAPS LIVE TIMING ATTIVO</strong> 🏁";
            }
          } catch(e) {}
        }
      });
    };
    ws.onclose = function() { setTimeout(() => connectMylaps(sessionId), 3000); };

  } catch (error) {
    console.error("Errore server Cloudflare:", error);
    document.getElementById('sessionStatus').innerHTML = "⚠️ ERRORE DI CONNESSIONE MYLAPS";
  }
}

// ==========================================
// GRAFICA E INTERFACCIA (In comune)
// ==========================================
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
      const name = d.fullname || `Pilota ${getDriverId(d)}`;
      opt.textContent = num ? `#${num} ${name}` : name;
      
      if (String(opt.value) === String(selectedDriverId)) opt.selected = true;
      select.appendChild(opt);
    });
    updateDashboard(drivers);
  }
}

// Ripristina l'ultima corsa salvata al ricaricamento della pagina
if (currentRaceId) {
  // Controlla se la vecchia sessione era T2R o Mylaps in base al formato dell'ID
  if (currentRaceId.includes('-')) {
    activeEngine = 'mylaps';
    document.getElementById('raceLinkInput').value = `https://speedhive.mylaps.com/livetiming/EVENT/sessions/${currentRaceId}`;
    connectMylaps(currentRaceId);
  } else {
    activeEngine = 'time2race';
    document.getElementById('raceLinkInput').value = `https://stg.mk.time2race.it/race/${currentRaceId}/`;
    connectTime2Race();
  }
}