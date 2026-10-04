let selectedDriverId = localStorage.getItem('pit_driver_id') || null;
let selectedTargetId = localStorage.getItem('pit_target_id') || null; 
let currentRaceId = localStorage.getItem('pit_race_id') || null;
let activeEngine = localStorage.getItem('pit_active_engine') || null;
let ws = null; 
let lastKnownDrivers = []; 

let sessionTimeLeft = "--:--";
let myDriverLaps = "-";

let currentDeviceId = ""; 
let isMqttConnected = false;

// Variabile di stato per distinguere Gara / Qualifica
let isRaceSession = false;

// Anti-standby per il telefono
if ('wakeLock' in navigator) {
  navigator.wakeLock.request('screen').catch(console.error);
}

function isLappedGap(gapStr) {
  if (!gapStr) return false;
  const s = String(gapStr).toLowerCase();
  return s.includes('lap') || s.includes('lp');
}

function parseGapToMs(gapStr) {
  if (!gapStr) return 0;
  let str = String(gapStr).trim().toLowerCase();
  if (str === '--' || str === '' || isLappedGap(str)) return 0;
  
  str = str.replace('+', '').replace(',', '.');
  
  if (str.includes(':')) {
      return parseTimeToMs(str); 
  }
  
  let val = parseFloat(str);
  return isNaN(val) ? 0 : val * 1000;
}

function updatePairingUI() {
  const statusEl = document.getElementById("pairStatus");
  if (!statusEl) return;
  if (currentDeviceId === "") {
    statusEl.innerText = "UNPAIRED";
    statusEl.style.color = "#888"; 
  } else {
    if (isMqttConnected) {
      statusEl.innerText = "RADIO 🟢";
      statusEl.style.color = "#22c55e"; 
    } else {
      statusEl.innerText = "RADIO 🔴";
      statusEl.style.color = "#ef4444"; 
    }
  }
}

window.addEventListener('DOMContentLoaded', () => {
  const savedNum = localStorage.getItem('pit_race_number');
  if (savedNum) document.getElementById('myRaceNumber').value = savedNum;

  const savedDeviceId = localStorage.getItem("pitboard_id");
  if (savedDeviceId) {
    const inputEl = document.getElementById("deviceIdInput");
    if (inputEl) inputEl.value = savedDeviceId;
    currentDeviceId = savedDeviceId;
  }
  updatePairingUI();
});

window.pairDevice = function() {
  const inputEl = document.getElementById("deviceIdInput");
  if (!inputEl) return;
  const input = inputEl.value.trim().toUpperCase();
  
  if (input === "") {
      currentDeviceId = "";
      localStorage.removeItem("pitboard_id");
      updatePairingUI();
      
      if (typeof mqttClient !== 'undefined' && isMqttConnected) {
        const resetLite = JSON.stringify({ 
          p: "-", gap: "--", 
          ahead: "--", ahead_html: "-", gap_a: "--", gap_a_bl: "--", time_a_ll: "-", time_a_bl: "-",
          behind: "--", behind_html: "-", gap_b: "--", gap_b_bl: "--", time_b_ll: "-", time_b_bl: "-",
          num: "--", time: "--:--", laps: "-", ca: 0, cb: 0, cab: 0, cbb: 2 
        });
        const msgResetLite = new Paho.MQTT.Message(resetLite);
        msgResetLite.destinationName = "pitboard/" + localStorage.getItem("pitboard_id_old") + "/live"; 
        try { mqttClient.send(msgResetLite); } catch(e) {}
      }
      return;
  }

  currentDeviceId = input;
  localStorage.setItem("pitboard_id", currentDeviceId);
  updatePairingUI();

  if (typeof mqttClient !== 'undefined' && isMqttConnected && currentDeviceId !== "") {
    const pairLite = JSON.stringify({ 
      p: "-", gap: "--", 
      ahead: "--", ahead_html: "-", gap_a: "--", gap_a_bl: "--", time_a_ll: "-", time_a_bl: "-",
      behind: "--", behind_html: "-", gap_b: "--", gap_b_bl: "--", time_b_ll: "-", time_b_bl: "-",
      num: "--", time: "--:--", laps: "-", ca: 0, cb: 0, cab: 0, cbb: 1 
    });
    const msgPair = new Paho.MQTT.Message(pairLite);
    msgPair.destinationName = "pitboard/" + currentDeviceId + "/live";
    try { mqttClient.send(msgPair); } catch(e) {}
  }

  if (typeof sendConfigToLilyGO === "function") sendConfigToLilyGO();
  if (lastKnownDrivers.length > 0) updateDashboard(lastKnownDrivers);
};

function setButtonState(state) {
  const btn = document.getElementById('loadBtn');
  const stopBtn = document.getElementById('stopBtn');
  if (!btn) return;
  if (state === 'connected') {
    btn.style.backgroundColor = '#22c55e'; btn.style.color = '#ffffff'; btn.innerText = 'ONLINE ✓';
    if (stopBtn) stopBtn.style.display = 'block'; 
  } else if (state === 'connecting') {
    btn.style.backgroundColor = '#3b82f6'; btn.style.color = '#ffffff'; btn.innerText = 'CONNECTING ⏳';
    if (stopBtn) stopBtn.style.display = 'none'; 
  } else if (state === 'error') {
    btn.style.backgroundColor = '#ef4444'; btn.style.color = '#ffffff'; btn.innerText = 'ERROR ⚠️';
    if (stopBtn) stopBtn.style.display = 'none'; 
  } else {
    btn.style.backgroundColor = '#ffcc00'; btn.style.color = '#000000'; btn.innerText = 'LOAD';
    if (stopBtn) stopBtn.style.display = 'none'; 
  }
}

document.addEventListener('input', function(event) {
  if (event.target && event.target.id === 'raceLinkInput') setButtonState('default');
  if (event.target && event.target.id === 'myRaceNumber') localStorage.setItem('pit_race_number', event.target.value.trim());
});

function getDriverId(d) { return d.id || d.user_id || d.raceno || d.fullname || d.no || d.nam; }

function formatLapTime(timeStr) {
  if (!timeStr || timeStr === "00:00:00.000000") return '--:--.--';
  let formatted = timeStr;
  if (formatted.startsWith("00:")) formatted = formatted.substring(3);
  if (formatted.startsWith("00:")) formatted = formatted.substring(3);
  if (formatted.includes('.')) formatted = formatted.substring(0, formatted.indexOf('.') + 4);
  return formatted;
}

function parseTimeToMs(str) {
  if (!str || str.includes('-') || str === '--:--.--') return 0;
  let parts = str.split(':');
  let secs = 0, ms = 0;
  let lastPart = parts.pop(); 
  let secParts = lastPart.split('.');
  secs += parseInt(secParts[0], 10) || 0;
  if(secParts[1]) ms = parseInt(secParts[1].padEnd(3, '0').substring(0,3), 10) || 0;
  if(parts.length > 0) secs += parseInt(parts.pop(), 10) * 60;
  if(parts.length > 0) secs += parseInt(parts.pop(), 10) * 3600;
  return (secs * 1000) + ms;
}

function updateBanner() {
  const statusBox = document.getElementById('sessionStatus');
  if (!statusBox) return;
  statusBox.innerHTML = `⏱️ TIME: <span style="color: #22c55e;">${sessionTimeLeft}</span> &nbsp;|&nbsp; 🔄 LAPS: <span style="color: #3b82f6;">${myDriverLaps}</span>`;
}

function loadNewRace() {
  const inputUrl = document.getElementById('raceLinkInput').value;
  if (!inputUrl) return;
  
  setButtonState('connecting');
  pairDevice();
  
  if (inputUrl.includes('time2race.it')) {
    const match = inputUrl.match(/race\/(\d+)/); 
    if (match && match[1]) {
      currentRaceId = match[1]; activeEngine = 'time2race';
      localStorage.setItem('pit_race_id', currentRaceId);
      localStorage.setItem('pit_active_engine', activeEngine);
      resetDashboard(); connectTime2Race(); 
    }
  } else if (inputUrl.includes('speedhive.mylaps.com')) {
    const match = inputUrl.match(/sessions\/([A-Za-z0-9\-]+)/);
    if (match && match[1]) {
      currentRaceId = match[1]; activeEngine = 'mylaps';
      localStorage.setItem('pit_race_id', currentRaceId);
      localStorage.setItem('pit_active_engine', activeEngine);
      resetDashboard(); connectMylaps(currentRaceId);
    } else {
      setButtonState('error'); alert("Invalid Mylaps link.");
    }
  } else if (inputUrl.includes('livetiming.ficr.it')) {
    const match = inputUrl.match(/livetiming\.ficr\.it\/([^\/]+)/);
    if (match && match[1]) {
      currentRaceId = match[1];
      activeEngine = 'ficr';
      localStorage.setItem('pit_race_id', currentRaceId);
      localStorage.setItem('pit_active_engine', activeEngine);
      resetDashboard(); connectFicr(currentRaceId);
    } else {
      setButtonState('error'); alert("Invalid FICR link.");
    }
  } else if (inputUrl.includes('mgmtiming.it')) {
    currentRaceId = inputUrl; 
    activeEngine = 'mgm';
    localStorage.setItem('pit_race_id', currentRaceId);
    localStorage.setItem('pit_active_engine', activeEngine);
    resetDashboard(); connectMgm(currentRaceId);
  } else {
    setButtonState('error'); alert("Please insert a valid link!");
  }
}

function stopSession() {
  if (typeof mqttClient !== 'undefined' && isMqttConnected && currentDeviceId !== "") {
    const resetLite = JSON.stringify({ 
      p: "-", gap: "--", 
      ahead: "--", ahead_html: "-", gap_a: "--", gap_a_bl: "--", time_a_ll: "-", time_a_bl: "-",
      behind: "--", behind_html: "-", gap_b: "--", gap_b_bl: "--", time_b_ll: "-", time_b_bl: "-",
      num: "--", time: "--:--", laps: "-", ca: 0, cb: 0, cab: 0, cbb: 2 
    });
    const msgResetLite = new Paho.MQTT.Message(resetLite);
    msgResetLite.destinationName = "pitboard/" + currentDeviceId + "/live";
    try { mqttClient.send(msgResetLite); } catch(e) {}
  }

  if (ws) { ws.onclose = null; ws.onerror = null; ws.close(); ws = null; }
  if (window.wsTimeout) clearTimeout(window.wsTimeout);
  if (window.ficrTimeout) clearTimeout(window.ficrTimeout);
  
  currentRaceId = null; activeEngine = null;
  localStorage.removeItem('pit_race_id');
  localStorage.removeItem('pit_active_engine');
  
  document.getElementById('raceLinkInput').value = '';
  const numInput = document.getElementById('myRaceNumber');
  if (numInput) { numInput.value = ''; localStorage.removeItem('pit_race_number'); }
  resetDashboard();
}

function resetDashboard() {
  sessionTimeLeft = "--:--"; myDriverLaps = "-";
  isRaceSession = false; 
  document.getElementById('sessionStatus').innerHTML = '⏱️ Waiting for connection...';
  
  document.getElementById('driverSelect').innerHTML = '<option value="">Select Rider...</option>';
  const targetSelect = document.getElementById('targetSelect');
  if (targetSelect) targetSelect.innerHTML = '<option value="">Select Target...</option>';
  
  lastKnownDrivers = []; 
  selectedDriverId = null; 
  selectedTargetId = null;
  localStorage.removeItem('pit_driver_id');
  localStorage.removeItem('pit_target_id');
  
  document.getElementById('pos').innerText = 'P-'; 
  document.getElementById('driverAhead').innerHTML = '--';
  document.getElementById('driverBehind').innerHTML = '--'; 
  document.getElementById('gap').innerText = '--'; 
  document.getElementById('myDriverNum').innerText = '--';

  updateDashboard([]); 
  setButtonState('default');
}

function changeDriver() {
  const selectElement = document.getElementById('driverSelect');
  const newId = selectElement.value;
  if (!newId) return;
  selectedDriverId = newId;
  localStorage.setItem('pit_driver_id', newId);
  if (lastKnownDrivers.length > 0) updateDashboard(lastKnownDrivers);
  if (typeof sendConfigToLilyGO === "function") sendConfigToLilyGO();
}

function changeTarget() {
  const selectElement = document.getElementById('targetSelect');
  if(!selectElement) return;
  const newId = selectElement.value;
  selectedTargetId = newId;
  if(newId) localStorage.setItem('pit_target_id', newId);
  else localStorage.removeItem('pit_target_id');
  
  if (lastKnownDrivers.length > 0) updateDashboard(lastKnownDrivers);
}

document.addEventListener('change', function(event) {
  if (event.target && event.target.id === 'driverSelect') changeDriver();
  if (event.target && event.target.id === 'targetSelect') changeTarget(); 
});

async function connectFicr(eventName) {
  if (!currentRaceId || activeEngine !== 'ficr') return;
  if (window.ficrTimeout) clearTimeout(window.ficrTimeout);

  try {
    const proxyUrl = 'https://mylaps-proxy.nico-mila91.workers.dev/?url=';
    const baseUrl = `https://www.livetiming.ficr.it/${eventName}/`;
    const response = await fetch(proxyUrl + encodeURIComponent(baseUrl));
    const htmlText = await response.text();
    const cMatch = htmlText.match(/c=([a-fA-F0-9]+)/);
    const sessionId = cMatch ? cMatch[1] : '';

    setButtonState('connected');
    pollFicr(eventName, sessionId);
  } catch (error) {
    setButtonState('error');
    document.getElementById('sessionStatus').innerHTML = "⚠️ ERRORE CONNESSIONE FICR";
  }
}

async function pollFicr(eventName, sessionId) {
  if (activeEngine !== 'ficr') return;

  try {
    const proxyUrl = 'https://mylaps-proxy.nico-mila91.workers.dev/?url=';
    const timestamp = Date.now();
    const dataUrl = `https://www.livetiming.ficr.it/${eventName}/dataSend.php?u=${eventName}&c=${sessionId}&_=${timestamp}`;

    const response = await fetch(proxyUrl + encodeURIComponent(dataUrl));
    const rawText = await response.text();
    
    let parsedData;
    try {
      parsedData = JSON.parse(rawText);
    } catch(e) {
      window.ficrTimeout = setTimeout(() => pollFicr(eventName, sessionId), 3000);
      return;
    }

    if (Array.isArray(parsedData) && parsedData.length > 1) {
      const sessionInfo = parsedData[0];
      const driversArray = parsedData[1]; 
      
      if (sessionInfo.b) {
          const sName = String(sessionInfo.b).toLowerCase();
          isRaceSession = sName.includes('gara') || sName.includes('race');
      }

      sessionTimeLeft = sessionInfo.j || sessionInfo.k || "--:--";
      updateBanner();

      const mappedDrivers = [];
      if (Array.isArray(driversArray)) {
        for (let i = 0; i < driversArray.length; i++) {
          const d = driversArray[i];
          if (d.m && d.m !== "00:00.000") {
            mappedDrivers.push({
              id: d.a || `ficr_${i}`, 
              raceno: d.b || d.a,
              fullname: d.c || "Rider",
              position: d.r, 
              lasttime: d.h, 
              besttime: d.m, 
              difference: (d.s && d.s !== "--") ? d.s : "",
              laps: d.j 
            });
          }
        }
      }

      mappedDrivers.forEach(newD => {
        const idx = lastKnownDrivers.findIndex(oldD => String(oldD.id) === String(newD.id));
        if (idx !== -1) lastKnownDrivers[idx] = { ...lastKnownDrivers[idx], ...newD };
        else lastKnownDrivers.push(newD);
      });

      lastKnownDrivers.sort((a, b) => parseInt(a.position || 9999) - parseInt(b.position || 9999));
      populateDriverDropdown(lastKnownDrivers);
      populateTargetDropdown(lastKnownDrivers); 
      updateDashboard(lastKnownDrivers);
    }
  } catch (error) {}

  window.ficrTimeout = setTimeout(() => pollFicr(eventName, sessionId), 3000);
}

function connectTime2Race() {
  if (!currentRaceId || activeEngine !== 'time2race') return;
  if (ws) { ws.onclose = null; ws.onerror = null; ws.close(); }
  if (window.wsTimeout) clearTimeout(window.wsTimeout);

  ws = new WebSocket(`wss://api-stg.mk.time2race.it/live/${currentRaceId}/ranking/`);
  ws.onopen = function() { setButtonState('connected'); }; 
  ws.onmessage = function(event) {
    if (event.data === 'ping' || event.data === 'pong') return;
    try {
      const payload = JSON.parse(event.data);
      const raceInfo = payload.race || (payload.data ? payload.data.race : null);
      if (raceInfo) {
        sessionTimeLeft = raceInfo.remaining || raceInfo.timeremaining || raceInfo.time_left || raceInfo.racetime || "--:--";
        if (raceInfo.endrace) sessionTimeLeft = "ENDED";
        
        const sessionName = String(raceInfo.name || raceInfo.sessionname || "").toLowerCase();
        isRaceSession = sessionName.includes('gara') || sessionName.includes('race');
        
        updateBanner();
      }
      let incomingDrivers = payload.drivers || (payload.data ? payload.data.drivers : null);
      if (incomingDrivers && incomingDrivers.length > 0) {
        incomingDrivers.forEach(newD => {
          const idx = lastKnownDrivers.findIndex(oldD => String(getDriverId(oldD)) === String(getDriverId(newD)));
          if (idx !== -1) lastKnownDrivers[idx] = { ...lastKnownDrivers[idx], ...newD };
          else lastKnownDrivers.push(newD);
        });
        lastKnownDrivers.sort((a, b) => parseInt(a.position || a.pos || 9999) - parseInt(b.position || b.pos || 9999));
        populateDriverDropdown(lastKnownDrivers);
        populateTargetDropdown(lastKnownDrivers);
        updateDashboard(lastKnownDrivers);
      }
    } catch (err) {}
  };
  ws.onerror = function() { setButtonState('error'); };
  ws.onclose = function() { window.wsTimeout = setTimeout(connectTime2Race, 3000); };
}

async function connectMylaps(sessionId) {
  if (!currentRaceId || activeEngine !== 'mylaps') return;
  if (ws) { ws.onclose = null; ws.onerror = null; ws.close(); }
  if (window.wsTimeout) clearTimeout(window.wsTimeout);

  try {
    const proxyUrl = 'https://mylaps-proxy.nico-mila91.workers.dev/?url=';
    const negotiateUrl = encodeURIComponent('https://notifications.speedhive.com/api/negotiate?negotiateVersion=1');
    const response = await fetch(proxyUrl + negotiateUrl, { method: 'POST' });
    const settings = JSON.parse(await response.text());
    const token = settings.accessToken;
    let endpointUrl = settings.url;

    if(!token || !endpointUrl) throw new Error("Token missing!");
    ws = new WebSocket(`${endpointUrl.replace("https://", "wss://")}&access_token=${token}`);
    const END_CHAR = String.fromCharCode(0x1E); 

    ws.onopen = function() {
      setButtonState('connected'); 
      ws.send('{"protocol":"json","version":1}' + END_CHAR);
      ws.send(JSON.stringify({ arguments: [`session-${sessionId}`], invocationId: "0", target: "JoinGroup", type: 1 }) + END_CHAR);
    };

    ws.onmessage = function(event) {
      event.data.split(END_CHAR).forEach(msg => {
        if(msg) {
          try {
            const payload = JSON.parse(msg);
            if(payload.type === 1 && payload.arguments && payload.arguments[0]) {
               const arg = payload.arguments[0];
               
               if (arg.sessionName) {
                   const sName = String(arg.sessionName).toLowerCase();
                   isRaceSession = sName.includes('gara') || sName.includes('race');
               }
               
               if (arg.timeRemaining) sessionTimeLeft = arg.timeRemaining;
               else if (arg.timeToFinish) sessionTimeLeft = arg.timeToFinish;
               else if (arg.ttg) sessionTimeLeft = arg.ttg; 
               else if (arg.rT) sessionTimeLeft = arg.rT; 
               else if (arg.tss) sessionTimeLeft = arg.tss;
               updateBanner();

               if (arg.results) {
                 const mappedDrivers = arg.results.map(d => {
                   let lapsCount = d.l || d.lc || d.ls || d.lap || d.laps || d.Laps || d.Lap || d.lapCount || d.c || '-';
                   return { id: d.id, raceno: d.no, fullname: d.nam, position: d.pos, lasttime: d.lsTm, besttime: d.btTm, difference: d.df, laps: lapsCount };
                 });
                 mappedDrivers.forEach(newD => {
                   const idx = lastKnownDrivers.findIndex(oldD => String(oldD.id) === String(newD.id));
                   if (idx !== -1) lastKnownDrivers[idx] = { ...lastKnownDrivers[idx], ...newD };
                   else lastKnownDrivers.push(newD);
                 });
                 lastKnownDrivers.sort((a, b) => parseInt(a.position || 9999) - parseInt(b.position || 9999));
                 populateDriverDropdown(lastKnownDrivers);
                 populateTargetDropdown(lastKnownDrivers); 
                 updateDashboard(lastKnownDrivers);
               }
            }
          } catch(e) {}
        }
      });
    };
    ws.onerror = function() { setButtonState('error'); };
    ws.onclose = function() { window.wsTimeout = setTimeout(() => connectMylaps(sessionId), 3000); };
  } catch (error) {
    setButtonState('error'); document.getElementById('sessionStatus').innerHTML = "⚠️ CONNECTION ERROR";
  }
}

async function connectMgm(originalUrl) {
  if (!currentRaceId || activeEngine !== 'mgm') return;
  if (ws) { ws.onclose = null; ws.onerror = null; ws.close(); }
  if (window.wsTimeout) clearTimeout(window.wsTimeout);

  try {
    const proxyUrl = 'https://mylaps-proxy.nico-mila91.workers.dev/?url='; 
    const baseUrl = "https://live.mgmtiming.it/signalr";
    const negotiateUrl = encodeURIComponent(`${baseUrl}/negotiate?clientProtocol=1.5&connectionData=%5B%7B%22name%22%3A%22livetickerminimobile%22%7D%5D`);
    
    const response = await fetch(proxyUrl + negotiateUrl, { method: 'GET' });
    const settings = JSON.parse(await response.text());
    const token = encodeURIComponent(settings.ConnectionToken);

    const wsUrl = `wss://live.mgmtiming.it/signalr/connect?transport=webSockets&clientProtocol=1.5&connectionToken=${token}&connectionData=%5B%7B%22name%22%3A%22livetickerminimobile%22%7D%5D`;

    ws = new WebSocket(wsUrl);

    ws.onopen = function() {
      setButtonState('connected'); 
    };

    ws.onmessage = function(event) {
      if (event.data === '{}') return; 

      try {
        const payload = JSON.parse(event.data);
        
        if (payload.M && Array.isArray(payload.M)) {
          payload.M.forEach(msg => {
            if (msg.M === "updatelivePage" && msg.A && Array.isArray(msg.A)) {
               const dataBlock = msg.A[0]; 
               const sessionBlock = msg.A[1]; 

               if (sessionBlock) {
                 const runName = String(sessionBlock.TitoloRun || "").toLowerCase();
                 isRaceSession = runName.includes('gara') || runName.includes('race');
                 
                 if (sessionBlock.Rimanente && sessionBlock.Rimanente !== "") {
                   sessionTimeLeft = sessionBlock.Rimanente;
                 } else if (sessionBlock.DurataGara && sessionBlock.DurataGara !== "") {
                   sessionTimeLeft = sessionBlock.DurataGara;
                 } else if (sessionBlock.TempoTrascorso && sessionBlock.TempoTrascorso !== "") {
                   sessionTimeLeft = sessionBlock.TempoTrascorso;
                 }
                 updateBanner();
               }

               if (Array.isArray(dataBlock)) {
                 const mappedDrivers = [];
                 
                 dataBlock.forEach((d, idx) => {
                   const tdRegex = /<td[^>]*>(.*?)<\/td>/g;
                   let tdMatches = [];
                   let match;
                   while ((match = tdRegex.exec(d.RigaTabella)) !== null) {
                     tdMatches.push(match[1].trim());
                   }

                   if (tdMatches.length >= 7) {
                     let pos = d.PosizioneArrivo || tdMatches[0];
                     let raceno = tdMatches[1];
                     let fullname = tdMatches[2];
                     let laps = tdMatches[3];
                     let lasttime = tdMatches[4];
                     let besttime = tdMatches[5];
                     let gap = tdMatches[6];

                     gap = gap.replace(/&nbsp;/gi, '').trim();
                     if (gap === '-' || gap === '') gap = '--';

                     mappedDrivers.push({
                       id: `mgm_${raceno}_${idx}`, 
                       raceno: raceno, 
                       fullname: fullname, 
                       position: pos, 
                       lasttime: lasttime, 
                       besttime: besttime, 
                       difference: gap, 
                       laps: laps 
                     });
                   }
                 });

                 mappedDrivers.forEach(newD => {
                   const idx = lastKnownDrivers.findIndex(oldD => String(oldD.raceno) === String(newD.raceno));
                   if (idx !== -1) lastKnownDrivers[idx] = { ...lastKnownDrivers[idx], ...newD };
                   else lastKnownDrivers.push(newD);
                 });

                 lastKnownDrivers.sort((a, b) => parseInt(a.position || 9999) - parseInt(b.position || 9999));
                 populateDriverDropdown(lastKnownDrivers);
                 populateTargetDropdown(lastKnownDrivers);
                 updateDashboard(lastKnownDrivers);
               }
            }
          });
        }
      } catch(e) {}
    };
    
    ws.onerror = function() { setButtonState('error'); };
    ws.onclose = function() { window.wsTimeout = setTimeout(() => connectMgm(originalUrl), 3000); };
    
  } catch (error) {
    setButtonState('error'); document.getElementById('sessionStatus').innerHTML = "⚠️ CONNESSIONE MGM FALLITA";
  }
}

function formatRivalInfo(driver, myDriver) {
  if (!driver) return '--';
  const num = driver.raceno || driver.no || '';
  const theirLastLap = formatLapTime(driver.lasttime || driver.lsTm);
  const theirBestLap = formatLapTime(driver.besttime || driver.btTm);
  const nameStr = num ? `#${String(num).trim()}` : (driver.fullname || driver.nam || driver.nickname || 'Rider').substring(0, 8);
  
  let gapHtml = ''; let paceDeltaHtml = '<span style="color: #666;">Δ --</span>'; let bestDeltaHtml = '<span style="color: #666;">Δ --</span>';
  
  if (myDriver) {
    let myDiffStr = String(myDriver.gap || myDriver.difference || myDriver.df || '0');
    let theirDiffStr = String(driver.gap || driver.difference || driver.df || '0');
    
    let isLapped = isLappedGap(myDiffStr) || isLappedGap(theirDiffStr);
    let myPosInt = parseInt(myDriver.position || myDriver.pos, 10) || 0;
    let theirPosInt = parseInt(driver.position || driver.pos, 10) || 0;
    let prefix = (theirPosInt > 0 && myPosInt > 0 && theirPosInt < myPosInt) ? "-" : "+";

    let physicalGapText = 'LAPPED';
    if (!isLapped) {
      let myDiffMs = parseGapToMs(myDiffStr);
      let theirDiffMs = parseGapToMs(theirDiffStr);
      let gapMs = Math.abs(myDiffMs - theirDiffMs);
      physicalGapText = `GAP ${prefix}${(gapMs/1000).toFixed(3)}`;
    }
    gapHtml = `<span style="font-size: 1.1rem; color: #ffcc00; margin-top: 4px; margin-bottom: 4px; font-weight: bold;">${physicalGapText}</span>`;

    let myLastMs = parseTimeToMs(formatLapTime(myDriver.lasttime || myDriver.lsTm));
    let theirLastMs = parseTimeToMs(theirLastLap);
    if (myLastMs > 0 && theirLastMs > 0) {
      let diffMs = myLastMs - theirLastMs;
      paceDeltaHtml = `<span style="color: ${diffMs > 0 ? '#ef4444' : '#22c55e'};">Δ ${diffMs > 0 ? '+' : ''}${(diffMs/1000).toFixed(3)}</span>`;
    }

    let myBestMs2 = parseTimeToMs(formatLapTime(myDriver.besttime || myDriver.btTm));
    let theirBestMs2 = parseTimeToMs(theirBestLap);
    if (myBestMs2 > 0 && theirBestMs2 > 0) {
      let diffMs = myBestMs2 - theirBestMs2;
      bestDeltaHtml = `<span style="color: ${diffMs > 0 ? '#ef4444' : '#22c55e'};">Δ ${diffMs > 0 ? '+' : ''}${(diffMs/1000).toFixed(3)}</span>`;
    }
  }

  return `
    <span class="rival-num">${nameStr}</span>${gapHtml}
    <div style="display:flex; flex-direction:column; gap:4px; font-size:1.1rem; font-weight:bold; background:#1a1a1a; padding:6px; border-radius:6px; border:1px solid #333; margin-top:8px; width:100%; min-width:170px;">
        <span style="color:#ccc; display:flex; justify-content:space-between; align-items:center;"><span>⏱ L: ${theirLastLap}</span> ${paceDeltaHtml}</span>
        <span style="color:#06b6d4; display:flex; justify-content:space-between; align-items:center;"><span>🔥 B: ${theirBestLap}</span> ${bestDeltaHtml}</span>
    </div>
  `;
}

function populateTargetDropdown(drivers) {
  const select = document.getElementById('targetSelect');
  if (!select) return;
  const currentVal = select.value;
  select.innerHTML = '<option value="">Select Target...</option>';
  drivers.forEach(d => {
    const opt = document.createElement('option'); opt.value = getDriverId(d); 
    const num = d.raceno || d.no || ''; const name = d.fullname || d.nickname || d.nam || `Rider ${getDriverId(d)}`;
    opt.textContent = num ? `#${num} ${name}` : name;
    if (String(opt.value) === String(selectedTargetId) || String(opt.value) === String(currentVal)) opt.selected = true;
    select.appendChild(opt);
  });
}

function populateDriverDropdown(drivers) {
  const select = document.getElementById('driverSelect');
  const currentVal = select.value;
  select.innerHTML = '<option value="">Select Rider...</option>';
  drivers.forEach(d => {
    const opt = document.createElement('option'); opt.value = getDriverId(d); 
    const num = d.raceno || d.no || ''; const name = d.fullname || d.nickname || d.nam || `Rider ${getDriverId(d)}`;
    opt.textContent = num ? `#${num} ${name}` : name;
    if (String(opt.value) === String(selectedDriverId) || String(opt.value) === String(currentVal)) opt.selected = true;
    select.appendChild(opt);
  });
}

function updateDashboard(driversList) {
  const numInput = document.getElementById('myRaceNumber');
  if (numInput && !selectedDriverId && driversList.length > 0) {
    const targetNum = String(numInput.value).trim();
    if (targetNum !== "") {
      const autoDriver = driversList.find(d => String(d.raceno || d.no).trim() === targetNum);
      if (autoDriver) {
        selectedDriverId = getDriverId(autoDriver); localStorage.setItem('pit_driver_id', selectedDriverId);
        const selectEl = document.getElementById('driverSelect'); if (selectEl) selectEl.value = selectedDriverId;
      }
    }
  }

  if (!selectedDriverId) return;

  const myIndex = driversList.findIndex(d => String(getDriverId(d)) === String(selectedDriverId));
  if (myIndex === -1) return;
  const myDriver = driversList[myIndex];
  
  const myTarget = selectedTargetId ? driversList.find(d => String(getDriverId(d)) === String(selectedTargetId)) : null;

  if (myDriver) {
    myDriverLaps = myDriver.laps || '-'; updateBanner();
    let myPos = parseInt(myDriver.position || myDriver.pos, 10) || (myIndex + 1);
    document.getElementById('pos').innerText = `P${myPos}`;

    let overallBestMs = Infinity;
    driversList.forEach(d => {
      let bMs = parseTimeToMs(formatLapTime(d.besttime || d.btTm));
      if (bMs > 0 && bMs < overallBestMs) overallBestMs = bMs;
    });

    let myBestMs = parseTimeToMs(formatLapTime(myDriver.besttime || myDriver.btTm));
    let gapText = "--";
    if (myBestMs > 0 && overallBestMs !== Infinity) {
      let diffMs = myBestMs - overallBestMs;
      gapText = diffMs === 0 ? "-0.000" : `+${(diffMs / 1000).toFixed(3)}`; 
    }
    document.getElementById('gap').innerText = gapText;

    const myNumText = String(myDriver.raceno || myDriver.no || '').trim() ? `#${String(myDriver.raceno || myDriver.no).trim()}` : 'ME';
    document.getElementById('myDriverNum').innerText = myNumText;

    let myLastMs = parseTimeToMs(formatLapTime(myDriver.lasttime || myDriver.lsTm));
    let stringAhead = '--'; let mqttAhead = '--'; let mqttAheadGap = '--'; let mqttAheadGapBL = '--'; let c_a = 0;
    let stringBehind = '--'; let mqttBehind = '--'; let mqttBehindGap = '--'; let mqttBehindGapBL = '--'; let c_b = 0;

    let myDiffStr = String(myDriver.gap || myDriver.difference || myDriver.df || '0');
    let myDiffMs = parseGapToMs(myDiffStr);

    let t_pos = "--", t_num = "--", t_last = "--", t_best = "--", t_pace_delta = "--", t_total_gap = "--";
    let flag_catch = 0; 

    if(myTarget) {
      t_pos = "P" + (myTarget.position || myTarget.pos || "-");
      t_num = "#" + String(myTarget.raceno || myTarget.no || "").trim();
      t_last = formatLapTime(myTarget.lasttime || myTarget.lsTm);
      t_best = formatLapTime(myTarget.besttime || myTarget.btTm);

      let targetLastMs = parseTimeToMs(t_last);
      if (myLastMs > 0 && targetLastMs > 0) {
        let diffMs = myLastMs - targetLastMs;
        t_pace_delta = (diffMs > 0 ? "+" : "") + (diffMs / 1000).toFixed(3);
        flag_catch = (diffMs < 0) ? 1 : (diffMs > 0 ? 2 : 0); 
      }

      if (isRaceSession) {
          let theirDiffStr = String(myTarget.gap || myTarget.difference || myTarget.df || '0');
          let theirDiffMs = parseGapToMs(theirDiffStr);
          
          if (!isLappedGap(myDiffStr) && !isLappedGap(theirDiffStr)) {
            let prefix = (parseInt(myTarget.position || myTarget.pos, 10) < myPos) ? "-" : "+";
            let absGap = Math.abs(myDiffMs - theirDiffMs) / 1000;
            t_total_gap = "GAP: " + prefix + absGap.toFixed(3);
          } else {
            t_total_gap = "GAP: LAPPED";
          }
      } else {
          let targetBestMs = parseTimeToMs(t_best);
          if (myBestMs > 0 && targetBestMs > 0) {
            let bestDiffMs = myBestMs - targetBestMs;
            let prefix = (bestDiffMs > 0) ? "+" : ""; 
            t_total_gap = "B-GAP: " + prefix + (bestDiffMs / 1000).toFixed(3); 
          } else {
            t_total_gap = "B-GAP: --";
          }
      }
    }


    if (myIndex > 0) {
      const driverAhead = driversList[myIndex - 1]; 
      stringAhead = formatRivalInfo(driverAhead, myDriver);
      mqttAhead = "#" + String(driverAhead.raceno || driverAhead.no || "").trim();
      
      let theirLastMs = parseTimeToMs(formatLapTime(driverAhead.lasttime || driverAhead.lsTm));
      let theirBestMs = parseTimeToMs(formatLapTime(driverAhead.besttime || driverAhead.btTm));
      let theirDiffStr = String(driverAhead.gap || driverAhead.difference || driverAhead.df || '0');
      let theirDiffMs = parseGapToMs(theirDiffStr);
      
      let isLapped = isLappedGap(myDiffStr) || isLappedGap(theirDiffStr);

      if (isLapped) {
        mqttAheadGap = "LAPPED"; 
      } else {
        mqttAheadGap = "+" + (Math.abs(myDiffMs - theirDiffMs) / 1000).toFixed(3);
      }

      if (myLastMs > 0 && theirLastMs > 0) { 
          c_a = (myLastMs <= theirLastMs) ? 1 : 2; 
          if (!isLapped && mqttAheadGap !== "+0.000") {
              mqttAheadGap = (c_a === 1 ? "-" : "+") + mqttAheadGap.substring(1); 
          }
      }
      
      if (myBestMs > 0 && theirBestMs > 0) {
          let diffMsBL = myBestMs - theirBestMs; 
          mqttAheadGapBL = (diffMsBL > 0 ? "+" : "") + (diffMsBL / 1000).toFixed(3);
      } else {
          mqttAheadGapBL = "--";
      }
    } else if (myIndex === 0) {
      stringAhead = '<span class="rival-num" style="color:#ffcc00">LEADER</span><br><span style="font-size: 1.8rem;">🥇</span>'; mqttAhead = "--"; 
    }
    document.getElementById('driverAhead').innerHTML = stringAhead;

    if (myIndex < driversList.length - 1) {
      const driverBehind = driversList[myIndex + 1]; 
      stringBehind = formatRivalInfo(driverBehind, myDriver);
      mqttBehind = "#" + String(driverBehind.raceno || driverBehind.no || "").trim();
      
      let theirLastMs = parseTimeToMs(formatLapTime(driverBehind.lasttime || driverBehind.lsTm));
      let theirBestMs = parseTimeToMs(formatLapTime(driverBehind.besttime || driverBehind.btTm));
      let theirDiffStr = String(driverBehind.gap || driverBehind.difference || driverBehind.df || '0');
      let theirDiffMs = parseGapToMs(theirDiffStr);

      let isLapped = isLappedGap(myDiffStr) || isLappedGap(theirDiffStr);

      if (isLapped) {
        mqttBehindGap = "LAPPED"; 
      } else {
        mqttBehindGap = "+" + (Math.abs(myDiffMs - theirDiffMs) / 1000).toFixed(3);
      }

      if (myLastMs > 0 && theirLastMs > 0) { 
          c_b = (myLastMs <= theirLastMs) ? 1 : 2; 
          if (!isLapped && mqttBehindGap !== "+0.000") {
              mqttBehindGap = (c_b === 1 ? "-" : "+") + mqttBehindGap.substring(1); 
          }
      }

      if (myBestMs > 0 && theirBestMs > 0) {
          let diffMsBL = myBestMs - theirBestMs; 
          mqttBehindGapBL = (diffMsBL > 0 ? "+" : "") + (diffMsBL / 1000).toFixed(3);
      } else {
          mqttBehindGapBL = "--";
      }
    } else if (myIndex >= 0 && driversList.length > 0) {
      stringBehind = '<span class="rival-num" style="color:#888">CLEAR</span>'; mqttBehind = "--"; 
    }
    document.getElementById('driverBehind').innerHTML = stringBehind;
    
    if (typeof mqttClient !== 'undefined' && isMqttConnected && currentDeviceId !== "") {
      
      const payloadLite = JSON.stringify({
        p: String(myPos), gap: gapText, 
        ahead: mqttAhead, ahead_html: t_total_gap, 
        gap_a: mqttAheadGap, gap_a_bl: mqttAheadGapBL, time_a_ll: t_last, time_a_bl: t_best,
        behind: mqttBehind, behind_html: t_pace_delta, 
        gap_b: mqttBehindGap, gap_b_bl: mqttBehindGapBL, time_b_ll: t_pos, time_b_bl: t_num,
        num: myNumText, time: sessionTimeLeft, laps: String(myDriverLaps),
        ca: c_a, cb: c_b, cab: flag_catch, cbb: 1
      });
      const msgLite = new Paho.MQTT.Message(payloadLite);
      msgLite.destinationName = "pitboard/" + currentDeviceId + "/live";
      try { mqttClient.send(msgLite); } catch(e) {}

      const payloadFull = JSON.stringify({
        p: String(myPos), gap: gapText, ahead: mqttAhead, ahead_html: stringAhead,
        behind: mqttBehind, behind_html: stringBehind, num: myNumText, time: sessionTimeLeft, laps: String(myDriverLaps)
      });
      const msgFull = new Paho.MQTT.Message(payloadFull);
      msgFull.destinationName = "pitboard/" + currentDeviceId + "/live_app";
      try { mqttClient.send(msgFull); } catch(e) {}
    }

  } else {
    document.getElementById('pos').innerText = 'P-'; document.getElementById('driverAhead').innerHTML = '--';
    document.getElementById('driverBehind').innerHTML = '--'; document.getElementById('gap').innerText = '--'; document.getElementById('myDriverNum').innerText = '--';
    if (typeof mqttClient !== 'undefined' && isMqttConnected && currentDeviceId !== "") {
      const resetLite = JSON.stringify({ 
        p: "-", gap: "--", 
        ahead: "--", ahead_html: "-", gap_a: "--", gap_a_bl: "--", time_a_ll: "-", time_a_bl: "-",
        behind: "--", behind_html: "-", gap_b: "--", gap_b_bl: "--", time_b_ll: "-", time_b_bl: "-",
        num: "--", time: "--:--", laps: "-", ca: 0, cb: 0, cab: 0, cbb: 2 
      });
      const msgResetLite = new Paho.MQTT.Message(resetLite);
      msgResetLite.destinationName = "pitboard/" + currentDeviceId + "/live";
      try { mqttClient.send(msgResetLite); } catch(e) {}
    }
  }
}

if (currentRaceId) {
  if (activeEngine === 'mylaps') {
    document.getElementById('raceLinkInput').value = `https://speedhive.mylaps.com/livetiming/EVENT/sessions/${currentRaceId}`; 
    connectMylaps(currentRaceId);
  } else if (activeEngine === 'ficr') {
    document.getElementById('raceLinkInput').value = `https://www.livetiming.ficr.it/${currentRaceId}/`; 
    connectFicr(currentRaceId);
  } else if (activeEngine === 'mgm') {
    document.getElementById('raceLinkInput').value = currentRaceId; 
    connectMgm(currentRaceId);
  } else {
    document.getElementById('raceLinkInput').value = `https://stg.mk.time2race.it/race/${currentRaceId}/`; 
    connectTime2Race();
  }
}

// ==========================================
// CONNESSIONE MQTT (EMQX PUBLIC CLOUD)
// ==========================================

const randomString = Math.random().toString(36).substring(2, 10);
const mqttClientId = "PitWall_Web_" + randomString;

const mqttClient = new Paho.MQTT.Client("broker.emqx.io", 8084, "/mqtt", mqttClientId);

mqttClient.onConnectionLost = function(responseObject) { 
  console.log("MQTT Disconnesso:", responseObject.errorMessage);
  isMqttConnected = false; 
  updatePairingUI(); 
  setTimeout(connectMQTT, 3000); 
};

mqttClient.onMessageArrived = function(message) {};

function connectMQTT() {
  console.log("Tentativo di connessione MQTT su WSS (Porta 8084)...");
  mqttClient.connect({
    useSSL: true, 
    timeout: 10,
    onSuccess: function() { 
      console.log("MQTT Connesso con successo a EMQX!");
      isMqttConnected = true; 
      updatePairingUI(); 
      if (currentDeviceId !== "") {
          pairDevice();
      }
    },
    onFailure: function(err) { 
      console.error("MQTT Errore Connessione:", err.errorMessage);
      isMqttConnected = false; 
      updatePairingUI(); 
      setTimeout(connectMQTT, 5000); 
    }
  });
}

function sendConfigToLilyGO() {
  if (!currentRaceId || !selectedDriverId || !isMqttConnected || currentDeviceId === "") return;
  const payload = JSON.stringify({ engine: activeEngine, raceId: currentRaceId, driverId: selectedDriverId });
  const message = new Paho.MQTT.Message(payload);
  message.destinationName = "pitboard/" + currentDeviceId + "/config"; message.retained = true; 
  try { mqttClient.send(message); } catch(e) {}
}

window.sendPitCommand = function(commandText, colorCode) {
  if (!isMqttConnected || currentDeviceId === "") return;
  const payload = JSON.stringify({ cmd: commandText, color: colorCode });
  const message = new Paho.MQTT.Message(payload);
  message.destinationName = "pitboard/" + currentDeviceId + "/command"; message.retained = false; 
  try {
    mqttClient.send(message);
    document.body.style.border = "4px solid " + colorCode;
    setTimeout(() => { document.body.style.border = "none"; }, 500);
  } catch(e) {}
};

window.sendCustomMessage = function() {
    const inputField = document.getElementById("customTextInput");
    const colorPicker = document.getElementById("customColorPicker");
    
    let customText = inputField.value.trim().toUpperCase();
    let chosenColor = colorPicker.value.toUpperCase(); 

    if (customText === "") return; 

    if (!isMqttConnected || currentDeviceId === "") {
        alert("Board non connessa!");
        return;
    }

    const payload = JSON.stringify({ cmd: customText, color: chosenColor });
    const message = new Paho.MQTT.Message(payload);
    message.destinationName = "pitboard/" + currentDeviceId + "/command"; 
    message.retained = false; 
    
    try {
        mqttClient.send(message);
        document.body.style.border = "4px solid " + chosenColor;
        setTimeout(() => { document.body.style.border = "none"; }, 500);
        inputField.value = "";
    } catch(e) {
        console.error("Errore invio custom message", e);
    }
};

connectMQTT();

let wakeLock = null; 
const requestFullScreenAndWakeLock = async () => { 
  try { 
    let docEl = document.documentElement;
    if (!document.fullscreenElement && !document.webkitFullscreenElement) { 
      if (docEl.requestFullscreen) { 
        await docEl.requestFullscreen(); 
      } else if (docEl.webkitRequestFullscreen) { 
        await docEl.webkitRequestFullscreen(); 
      } else if (docEl.msRequestFullscreen) { 
        await docEl.msRequestFullscreen();
      }
    } 
  } catch (err) {} 

  try { 
    if ('wakeLock' in navigator) {
      wakeLock = await navigator.wakeLock.request('screen'); 
    }
  } catch (err) {} 
}; 
  
document.body.addEventListener('click', requestFullScreenAndWakeLock); 
document.body.addEventListener('touchstart', requestFullScreenAndWakeLock); 

document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState === 'visible') {
    await requestFullScreenAndWakeLock();
  }
});