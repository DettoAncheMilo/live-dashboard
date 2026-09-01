let selectedDriverId = localStorage.getItem('pit_driver_id') || null;
let currentRaceId = localStorage.getItem('pit_race_id') || null;
let ws = null; 
let lastKnownDrivers = []; 

// Variabili per il Banner unificato
let sessionTimeLeft = "--:--";
let myDriverLaps = "-";
let activeEngine = 'time2race';

if ('wakeLock' in navigator) {
  navigator.wakeLock.request('screen').catch(console.error);
}

function setButtonState(state) {
  const btn = document.getElementById('loadBtn');
  if (!btn) return;

  if (state === 'connected') {
    btn.style.backgroundColor = '#22c55e'; 
    btn.style.color = '#ffffff';
    btn.innerText = 'ONLINE ✓';
  } else if (state === 'error') {
    btn.style.backgroundColor = '#ef4444'; 
    btn.style.color = '#ffffff';
    btn.innerText = 'ERROR ⚠️';
  } else {
    btn.style.backgroundColor = '#ffcc00'; 
    btn.style.color = '#000000';
    btn.innerText = 'LOAD';
  }
}

function getDriverId(d) {
  return d.id || d.user_id || d.raceno || d.fullname || d.no || d.nam;
}

function formatLapTime(timeStr) {
  if (!timeStr || timeStr === "00:00:00.000000") return '--:--.--';
  let formatted = timeStr;
  if (formatted.startsWith("00:")) formatted = formatted.substring(3);
  if (formatted.startsWith("00:")) formatted = formatted.substring(3);
  if (formatted.includes('.')) formatted = formatted.substring(0, formatted.indexOf('.') + 4);
  return formatted;
}

// Funzione che aggiorna il banner in alto
function updateBanner() {
  const statusBox = document.getElementById('sessionStatus');
  if (!statusBox) return;
  statusBox.innerHTML = `⏱️ TIME TO GO: <span style="color: #22c55e;">${sessionTimeLeft}</span> &nbsp;|&nbsp; 🔄 LAPS: <span style="color: #3b82f6;">${myDriverLaps}</span>`;
}

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
    const match = inputUrl.match(/sessions\/([A-Za-z0-9\-]+)/);
    if (match && match[1]) {
      currentRaceId = match[1];
      activeEngine = 'mylaps';
      localStorage.setItem('pit_race_id', currentRaceId);
      resetDashboard();
      connectMylaps(currentRaceId);
    } else {
      alert("Invalid Mylaps link. Ensure it contains '/sessions/...'");
    }
  } else {
    alert("Please insert a valid link (Time2Race or Mylaps)!");
  }
}

function resetDashboard() {
  setButtonState('default');
  sessionTimeLeft = "--:--";
  myDriverLaps = "-";
  document.getElementById('sessionStatus').innerHTML = '⏱️ Waiting for connection...';
  document.getElementById('driverSelect').innerHTML = '<option value="">Select Rider...</option>';
  lastKnownDrivers = [];
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

  ws.onopen = function() { setButtonState('connected'); };

  ws.onmessage = function(event) {
    if (event.data === 'ping' || event.data === 'pong') return;
    try {
      const payload = JSON.parse(event.data);
      const raceInfo = payload.race || (payload.data ? payload.data.race : null);
      
      if (raceInfo) {
        // Cerca il tempo rimanente o usa quello trascorso
        sessionTimeLeft = raceInfo.remaining || raceInfo.timeremaining || raceInfo.time_left || raceInfo.racetime || "--:--";
        if (raceInfo.endrace) sessionTimeLeft = "ENDED";
        updateBanner();
      }

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
// 2. MOTORE MYLAPS
// ==========================================
async function connectMylaps(sessionId) {
  if (!currentRaceId || activeEngine !== 'mylaps') return;
  if (ws) ws.close();

  try {
    const proxyUrl = 'https://mylaps-proxy.nico-mila91.workers.dev/?url=';
    const negotiateUrl = encodeURIComponent('https://notifications.speedhive.com/api/negotiate?negotiateVersion=1');
    
    const response = await fetch(proxyUrl + negotiateUrl, { method: 'POST' });
    const responseText = await response.text(); 
    
    const settings = JSON.parse(responseText);
    const token = settings.accessToken;
    let endpointUrl = settings.url;

    if(!token || !endpointUrl) throw new Error("Token missing!");

    endpointUrl = endpointUrl.replace("https://", "wss://");
    const wsUrl = `${endpointUrl}&access_token=${token}`;
    ws = new WebSocket(wsUrl);
    
    const END_CHAR = String.fromCharCode(0x1E); 

    ws.onopen = function() {
      setButtonState('connected');
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
            if(payload.type === 1 && payload.arguments && payload.arguments[0]) {
               const arg = payload.arguments[0];

               // SPIA SEGRETA: ci stampa nella console TUTTO quello che manda Mylaps
               console.log("🕵️ DATI MYLAPS GLOBALI:", arg);

               // CATTURA DATI SESSIONE GLOBALE (Time to Go)
               if (arg.timeRemaining) sessionTimeLeft = arg.timeRemaining;
               else if (arg.timeToFinish) sessionTimeLeft = arg.timeToFinish;
               else if (arg.session && arg.session.timeRemaining) sessionTimeLeft = arg.session.timeRemaining;
               
               updateBanner();

               // CATTURA PILOTI E GIRI
               if (arg.results) {
                 const mappedDrivers = arg.results.map(d => ({
                   id: d.id,
                   raceno: d.no,
                   fullname: d.nam,
                   position: d.pos,
                   lasttime: d.lsTm,
                   besttime: d.btTm,
                   difference: d.df,
                   // Nel 99% dei casi in Mylaps i giri si chiamano 'l'
                   laps: d.l || d.lap || d.laps || d.lp || '-' 
                 }));
                 
                 lastKnownDrivers = mappedDrivers;
                 populateDriverDropdown(mappedDrivers);
                 updateDashboard(mappedDrivers);
               }
            }
          } catch(e) {}
        }
      });
    };
    ws.onclose = function() { setTimeout(() => connectMylaps(sessionId), 3000); };

  } catch (error) {
    setButtonState('error');
    document.getElementById('sessionStatus').innerHTML = "⚠️ CONNECTION ERROR";
  }
}

// ==========================================
// GRAFICA E INTERFACCIA
// ==========================================
function formatRivalInfo(driver) {
  if (!driver) return '--';
  const num = driver.raceno || driver.no || '';
  const best = formatLapTime(driver.besttime || driver.btTm);
  const nameStr = num ? `#${num}` : (driver.fullname || driver.nam || driver.nickname || 'Rider').substring(0, 8);
  return `<span class="rival-num">${nameStr}</span><span>${best}</span>`;
}

function updateDashboard(driversList) {
  if (!selectedDriverId) return;
  const myDriver = driversList.find(d => String(getDriverId(d)) === String(selectedDriverId));

  if (myDriver) {
    // Aggiorna i giri del pilota nel banner
    myDriverLaps = myDriver.laps || '-';
    updateBanner();

    let myPos = parseInt(myDriver.position || myDriver.pos, 10);
    
    document.getElementById('pos').innerText = `P${myPos || '-'}`;
    document.getElementById('gap').innerText = myDriver.difference || myDriver.df ? `+${myDriver.difference || myDriver.df}` : '+0.000';

    const myNum = myDriver.raceno || myDriver.no || '';
    document.getElementById('myDriverNum').innerText = myNum ? `#${myNum}` : 'ME';

    let stringAhead = '--';
    if (myPos > 1) {
      const driverAhead = driversList.find(d => parseInt(d.position || d.pos, 10) === myPos - 1);
      stringAhead = driverAhead ? formatRivalInfo(driverAhead) : '--';
    } else if (myPos === 1) {
      stringAhead = '<span class="rival-num" style="color:#ffcc00">LEADER</span><span>🥇</span>';
    }
    document.getElementById('driverAhead').innerHTML = stringAhead;

    let stringBehind = '--';
    const driverBehind = driversList.find(d => parseInt(d.position || d.pos, 10) === myPos + 1);
    
    if (driverBehind) {
      stringBehind = formatRivalInfo(driverBehind);
    } else if (myPos > 0 && driversList.length > 0) {
      stringBehind = '<span class="rival-num" style="color:#888">CLEAR</span>';
    }
    document.getElementById('driverBehind').innerHTML = stringBehind;

  } else {
    document.getElementById('pos').innerText = `P-`;
    document.getElementById('driverAhead').innerHTML = '--';
    document.getElementById('driverBehind').innerHTML = '--';
    document.getElementById('gap').innerText = '+0.000';
    document.getElementById('myDriverNum').innerText = '--';
  }
}

function populateDriverDropdown(drivers) {
  const select = document.getElementById('driverSelect');
  if (select.options.length <= 1 && drivers.length > 0) {
    select.innerHTML = '<option value="">Select Rider...</option>';
    drivers.forEach(d => {
      const opt = document.createElement('option');
      opt.value = getDriverId(d); 
      const num = d.raceno || d.no || '';
      const name = d.fullname || d.nickname || d.nam || `Rider ${getDriverId(d)}`;
      opt.textContent = num ? `#${num} ${name}` : name;
      
      if (String(opt.value) === String(selectedDriverId)) opt.selected = true;
      select.appendChild(opt);
    });
    updateDashboard(drivers);
  }
}

if (currentRaceId) {
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