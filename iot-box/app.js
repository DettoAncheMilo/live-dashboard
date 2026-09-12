let selectedDriverId = localStorage.getItem('pit_driver_id') || null;
let currentRaceId = localStorage.getItem('pit_race_id') || null;
let ws = null; 
let lastKnownDrivers = []; 

let sessionTimeLeft = "--:--";
let myDriverLaps = "-";
let activeEngine = 'time2race';

// ==========================================
// PAIRING LOGIC
// ==========================================
let currentDeviceId = localStorage.getItem("pitboard_id") || "";

if ('wakeLock' in navigator) {
  navigator.wakeLock.request('screen').catch(console.error);
}

window.addEventListener('DOMContentLoaded', () => {
  const targetElement = document.getElementById('loadBtn'); 
  if (targetElement && targetElement.parentNode) {
    const inputStr = `<input type="text" id="myRaceNumber" placeholder="My#" title="Insert your race number" style="width: 50px; max-width: 50px; flex: 0 0 50px; margin-left: 8px; margin-right: 8px; padding: 2px; border-radius: 4px; border: 1px solid #555; background: #222; color: #ffcc00; font-weight: bold; text-align: center; font-size: 0.95rem; box-sizing: border-box;">`;
    targetElement.insertAdjacentHTML('beforebegin', inputStr);
    
    const savedNum = localStorage.getItem('pit_race_number');
    if (savedNum) {
      document.getElementById('myRaceNumber').value = savedNum;
    }
  }

  if (currentDeviceId !== "") {
    const inputEl = document.getElementById("deviceIdInput");
    const statusEl = document.getElementById("pairStatus");
    if (inputEl) inputEl.value = currentDeviceId;
    if (statusEl) {
      statusEl.innerText = "STATUS: PAIRED TO " + currentDeviceId;
      statusEl.style.color = "#22c55e"; 
    }
  }
});

window.pairDevice = function() {
  const inputEl = document.getElementById("deviceIdInput");
  if (!inputEl) return;
  const input = inputEl.value.trim().toUpperCase();
  
  if (input === "") {
    alert("Please enter a valid Device ID!");
    return;
  }
  
  currentDeviceId = input;
  localStorage.setItem("pitboard_id", currentDeviceId);
  
  const statusEl = document.getElementById("pairStatus");
  if (statusEl) {
    statusEl.innerText = "STATUS: PAIRED TO " + currentDeviceId;
    statusEl.style.color = "#22c55e";
  }
  
  if (typeof sendConfigToLilyGO === "function") sendConfigToLilyGO();
};

window.unpairDevice = function() {
  currentDeviceId = "";
  localStorage.removeItem("pitboard_id");
  
  const inputEl = document.getElementById("deviceIdInput");
  const statusEl = document.getElementById("pairStatus");
  
  if (inputEl) inputEl.value = "";
  if (statusEl) {
    statusEl.innerText = "STATUS: UNPAIRED";
    statusEl.style.color = "#ffcc00";
  }
};

function setButtonState(state) {
  const btn = document.getElementById('loadBtn');
  const stopBtn = document.getElementById('stopBtn');
  if (!btn) return;

  if (state === 'connected') {
    btn.style.backgroundColor = '#22c55e'; 
    btn.style.color = '#ffffff';
    btn.innerText = 'ONLINE ✓';
    if (stopBtn) stopBtn.style.display = 'block'; 
  } else if (state === 'connecting') {
    btn.style.backgroundColor = '#3b82f6'; 
    btn.style.color = '#ffffff';
    btn.innerText = 'CONNECTING ⏳';
    if (stopBtn) stopBtn.style.display = 'none'; 
  } else if (state === 'error') {
    btn.style.backgroundColor = '#ef4444'; 
    btn.style.color = '#ffffff';
    btn.innerText = 'ERROR ⚠️';
    if (stopBtn) stopBtn.style.display = 'none'; 
  } else {
    btn.style.backgroundColor = '#ffcc00'; 
    btn.style.color = '#000000';
    btn.innerText = 'LOAD';
    if (stopBtn) stopBtn.style.display = 'none'; 
  }
}

document.addEventListener('input', function(event) {
  if (event.target && event.target.id === 'raceLinkInput') {
    setButtonState('default');
  }
  if (event.target && event.target.id === 'myRaceNumber') {
    localStorage.setItem('pit_race_number', event.target.value.trim());
  }
});

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

function parseTimeToMs(str) {
  if (!str || str.includes('-') || str === '--:--.--') return 0;
  let parts = str.split(':');
  let secs = 0;
  let ms = 0;
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

  const keepAliveAudio = document.getElementById('keepAliveAudio');
  if (keepAliveAudio) {
    keepAliveAudio.play().catch(e => console.log("Audio background ignorato"));
  }

  setButtonState('connecting');
  
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
      setButtonState('error');
      alert("Invalid Mylaps link. Ensure it contains '/sessions/...'");
    }
  } else {
    setButtonState('error');
    alert("Please insert a valid link (Time2Race or Mylaps)!");
  }
}

function stopSession() {
  if (ws) {
    ws.onclose = null; 
    ws.onerror = null; 
    ws.close();
    ws = null;
  }
  if (window.wsTimeout) clearTimeout(window.wsTimeout);
  
  currentRaceId = null;
  activeEngine = null;
  localStorage.removeItem('pit_race_id');
  document.getElementById('raceLinkInput').value = '';

  const numInput = document.getElementById('myRaceNumber');
  if (numInput) {
    numInput.value = '';
    localStorage.removeItem('pit_race_number');
  }

  resetDashboard();
}

function resetDashboard() {
  sessionTimeLeft = "--:--";
  myDriverLaps = "-";
  document.getElementById('sessionStatus').innerHTML = '⏱️ Waiting for connection...';
  document.getElementById('driverSelect').innerHTML = '<option value="">Select Rider...</option>';
  lastKnownDrivers = [];
  
  selectedDriverId = null;
  localStorage.removeItem('pit_driver_id');
  
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

document.addEventListener('change', function(event) {
  if (event.target && event.target.id === 'driverSelect') {
    changeDriver();
  }
});

function connectTime2Race() {
  if (!currentRaceId || activeEngine !== 'time2race') return;
  
  if (ws) {
    ws.onclose = null; 
    ws.onerror = null; 
    ws.close();
  }

  if (window.wsTimeout) clearTimeout(window.wsTimeout);

  const wsUrl = `wss://api-stg.mk.time2race.it/live/${currentRaceId}/ranking/`;
  ws = new WebSocket(wsUrl);

  ws.onopen = function() { setButtonState('connected'); }; 

  ws.onmessage = function(event) {
    if (event.data === 'ping' || event.data === 'pong') return;
    try {
      const payload = JSON.parse(event.data);
      const raceInfo = payload.race || (payload.data ? payload.data.race : null);
      
      if (raceInfo) {
        sessionTimeLeft = raceInfo.remaining || raceInfo.timeremaining || raceInfo.time_left || raceInfo.racetime || "--:--";
        if (raceInfo.endrace) sessionTimeLeft = "ENDED";
        updateBanner();
      }

      let incomingDrivers = payload.drivers || (payload.data ? payload.data.drivers : null);
      if (incomingDrivers && incomingDrivers.length > 0) {
        incomingDrivers.forEach(newD => {
          const idx = lastKnownDrivers.findIndex(oldD => String(getDriverId(oldD)) === String(getDriverId(newD)));
          if (idx !== -1) {
            lastKnownDrivers[idx] = { ...lastKnownDrivers[idx], ...newD };
          } else {
            lastKnownDrivers.push(newD);
          }
        });

        lastKnownDrivers.sort((a, b) => {
          let posA = parseInt(a.position || a.pos || 9999);
          let posB = parseInt(b.position || b.pos || 9999);
          return posA - posB;
        });

        populateDriverDropdown(lastKnownDrivers);
        updateDashboard(lastKnownDrivers);
      }
    } catch (err) {}
  };
  
  ws.onerror = function() { setButtonState('error'); };
  ws.onclose = function() { window.wsTimeout = setTimeout(connectTime2Race, 3000); };
}

async function connectMylaps(sessionId) {
  if (!currentRaceId || activeEngine !== 'mylaps') return;
  
  if (ws) {
    ws.onclose = null; 
    ws.onerror = null; 
    ws.close();
  }

  if (window.wsTimeout) clearTimeout(window.wsTimeout);

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

               if (arg.timeRemaining) sessionTimeLeft = arg.timeRemaining;
               else if (arg.timeToFinish) sessionTimeLeft = arg.timeToFinish;
               else if (arg.ttg) sessionTimeLeft = arg.ttg; 
               else if (arg.rT) sessionTimeLeft = arg.rT; 
               else if (arg.tss) sessionTimeLeft = arg.tss;
               
               updateBanner();

               if (arg.results) {
                 const mappedDrivers = arg.results.map(d => {
                   let lapsCount = '-';
                   if (d.l !== undefined) lapsCount = d.l;
                   else if (d.lc !== undefined) lapsCount = d.lc;
                   else if (d.ls !== undefined) lapsCount = d.ls;
                   else if (d.lap !== undefined) lapsCount = d.lap;
                   else if (d.laps !== undefined) lapsCount = d.laps;
                   else if (d.Laps !== undefined) lapsCount = d.Laps;
                   else if (d.Lap !== undefined) lapsCount = d.Lap;
                   else if (d.lapCount !== undefined) lapsCount = d.lapCount;
                   else if (d.c !== undefined) lapsCount = d.c;

                   return {
                     id: d.id,
                     raceno: d.no,
                     fullname: d.nam,
                     position: d.pos,
                     lasttime: d.lsTm,
                     besttime: d.btTm,
                     difference: d.df,
                     laps: lapsCount
                   };
                 });
                 
                 mappedDrivers.forEach(newD => {
                   const idx = lastKnownDrivers.findIndex(oldD => String(oldD.id) === String(newD.id));
                   if (idx !== -1) {
                     lastKnownDrivers[idx] = { ...lastKnownDrivers[idx], ...newD };
                   } else {
                     lastKnownDrivers.push(newD);
                   }
                 });

                 lastKnownDrivers.sort((a, b) => {
                   let posA = parseInt(a.position || 9999);
                   let posB = parseInt(b.position || 9999);
                   return posA - posB;
                 });
                 
                 populateDriverDropdown(lastKnownDrivers);
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
    setButtonState('error');
    document.getElementById('sessionStatus').innerHTML = "⚠️ CONNECTION ERROR";
  }
}

function formatRivalInfo(driver, myDriver) {
  if (!driver) return '--';
  const num = driver.raceno || driver.no || '';
  
  const theirLastTimeRaw = driver.lasttime || driver.lsTm;
  const theirLastLap = formatLapTime(theirLastTimeRaw);
  
  const theirBestTimeRaw = driver.besttime || driver.btTm;
  const theirBestLap = formatLapTime(theirBestTimeRaw);
  
  const nameStr = num ? `#${num}` : (driver.fullname || driver.nam || driver.nickname || 'Rider').substring(0, 8);
  
  let gapHtml = '';
  let paceDeltaHtml = '<span style="color: #666;">Δ --</span>';
  let bestDeltaHtml = '<span style="color: #666;">Δ --</span>';
  
  if (myDriver) {
    let myDiffStr = String(myDriver.difference || myDriver.df || '0');
    let theirDiffStr = String(driver.difference || driver.df || '0');
    let isLapped = myDiffStr.toLowerCase().includes('lap') || theirDiffStr.toLowerCase().includes('lap') || 
                   myDiffStr.toLowerCase().includes('gir') || theirDiffStr.toLowerCase().includes('gir');
                   
    let physicalGapText = '';
    if (isLapped) {
      physicalGapText = 'LAPPED';
    } else {
      let d1 = parseFloat(myDiffStr.replace('+', '').replace(',', '.')) || 0;
      let d2 = parseFloat(theirDiffStr.replace('+', '').replace(',', '.')) || 0;
      let gap = Math.abs(d1 - d2);
      physicalGapText = `GAP +${gap.toFixed(3)}`;
    }
    gapHtml = `<span style="font-size: 1.1rem; color: #ffcc00; margin-top: 4px; margin-bottom: 4px; font-weight: bold;">${physicalGapText}</span>`;

    let myLastTimeRaw = myDriver.lasttime || myDriver.lsTm;
    let myLastMs = parseTimeToMs(formatLapTime(myLastTimeRaw));
    let theirLastMs = parseTimeToMs(theirLastLap);
    if (myLastMs > 0 && theirLastMs > 0) {
      let diffMs = theirLastMs - myLastMs;
      let sign = diffMs > 0 ? '+' : '';
      let color = diffMs > 0 ? '#22c55e' : '#ef4444'; 
      paceDeltaHtml = `<span style="color: ${color};">Δ ${sign}${(diffMs/1000).toFixed(3)}</span>`;
    }

    let myBestTimeRaw = myDriver.besttime || myDriver.btTm;
    let myBestMs = parseTimeToMs(formatLapTime(myBestTimeRaw));
    let theirBestMs = parseTimeToMs(theirBestLap);
    if (myBestMs > 0 && theirBestMs > 0) {
      let diffMs = theirBestMs - myBestMs;
      let sign = diffMs > 0 ? '+' : '';
      let color = diffMs > 0 ? '#22c55e' : '#ef4444'; 
      bestDeltaHtml = `<span style="color: ${color};">Δ ${sign}${(diffMs/1000).toFixed(3)}</span>`;
    }
  }

  return `
    <span class="rival-num">${nameStr}</span>
    ${gapHtml}
    <div style="display:flex; flex-direction:column; gap:4px; font-size:1.1rem; font-weight:bold; background:#1a1a1a; padding:6px; border-radius:6px; border:1px solid #333; margin-top:2px; width:100%; min-width:170px;">
       <span style="color:#ccc; display:flex; justify-content:space-between; align-items:center;"><span>⏱ L: ${theirLastLap}</span> ${paceDeltaHtml}</span>
       <span style="color:#06b6d4; display:flex; justify-content:space-between; align-items:center;"><span>🔥 B: ${theirBestLap}</span> ${bestDeltaHtml}</span>
    </div>
  `;
}

function updateDashboard(driversList) {
  const numInput = document.getElementById('myRaceNumber');
  if (numInput && !selectedDriverId && driversList.length > 0) {
    const targetNum = numInput.value.trim();
    if (targetNum !== "") {
      const autoDriver = driversList.find(d => String(d.raceno || d.no) === String(targetNum));
      if (autoDriver) {
        selectedDriverId = getDriverId(autoDriver);
        localStorage.setItem('pit_driver_id', selectedDriverId);
        
        const selectEl = document.getElementById('driverSelect');
        if (selectEl) selectEl.value = selectedDriverId;
        
        if (typeof sendConfigToLilyGO === "function") {
          sendConfigToLilyGO();
        }
      }
    }
  }

  if (!selectedDriverId) {
    document.getElementById('pos').innerText = 'P-';
    document.getElementById('driverAhead').innerHTML = '--';
    document.getElementById('driverBehind').innerHTML = '--';
    document.getElementById('gap').innerText = '--';
    document.getElementById('myDriverNum').innerText = '--';
    
    if (typeof mqttClient !== 'undefined' && isMqttConnected && currentDeviceId !== "") {
      const payload = JSON.stringify({ p: 0, gap: "--", ahead: "--", behind: "--", num: "--", time: "--:--", laps: "-" });
      const message = new Paho.MQTT.Message(payload);
      message.destinationName = "pitboard/" + currentDeviceId + "/live";
      try { mqttClient.send(message); } catch(e) {}
    }
    return;
  }

  const myDriver = driversList.find(d => String(getDriverId(d)) === String(selectedDriverId));

  if (myDriver) {
    myDriverLaps = myDriver.laps || '-';
    updateBanner();

    let myPos = parseInt(myDriver.position || myDriver.pos, 10);
    document.getElementById('pos').innerText = `P${myPos || '-'}`;

    const leaderDriver = driversList.find(d => parseInt(d.position || d.pos, 10) === 1);
    
    let gapText = "+0.000";
    if (myPos === 1) {
      gapText = '+0.000';
    } else if (leaderDriver) {
      // CONFRONTO BEST LAP PURISSIMO CON SEGNO CORRETTO (Tuo Best - Leader Best)
      let myBestMs = parseTimeToMs(formatLapTime(myDriver.besttime || myDriver.btTm));
      let leaderBestMs = parseTimeToMs(formatLapTime(leaderDriver.besttime || leaderDriver.btTm));
      
      if (myBestMs > 0 && leaderBestMs > 0) {
        let diffMs = myBestMs - leaderBestMs;
        let sign = diffMs > 0 ? '+' : '';
        gapText = `${sign}${(diffMs / 1000).toFixed(3)}`;
      } else {
        gapText = '+0.000';
      }
    } else {
      gapText = '+0.000';
    }
    document.getElementById('gap').innerText = gapText;

    const myNum = myDriver.raceno || myDriver.no || '';
    const myNumText = myNum ? `#${myNum}` : 'ME';
    document.getElementById('myDriverNum').innerText = myNumText;

    let stringAhead = '--';
    if (myPos > 1) {
      const driverAhead = driversList.find(d => parseInt(d.position || d.pos, 10) === myPos - 1);
      stringAhead = driverAhead ? formatRivalInfo(driverAhead, myDriver) : '--';
    } else if (myPos === 1) {
      stringAhead = '<span class="rival-num" style="color:#ffcc00">LEADER</span><br><span style="font-size: 1.8rem;">🥇</span>';
    }
    document.getElementById('driverAhead').innerHTML = stringAhead;

    let stringBehind = '--';
    const driverBehind = driversList.find(d => parseInt(d.position || d.pos, 10) === myPos + 1);
    
    if (driverBehind) {
      stringBehind = formatRivalInfo(driverBehind, myDriver);
    } else if (myPos > 0 && driversList.length > 0) {
      stringBehind = '<span class="rival-num" style="color:#888">CLEAR</span>';
    }
    document.getElementById('driverBehind').innerHTML = stringBehind;
    
    if (typeof mqttClient !== 'undefined' && isMqttConnected && currentDeviceId !== "") {
      const payload = JSON.stringify({
        p: myPos,
        gap: gapText,
        ahead: stringAhead,
        behind: stringBehind,
        num: myNumText,       
        time: sessionTimeLeft,
        laps: String(myDriverLaps) 
      });
      const message = new Paho.MQTT.Message(payload);
      message.destinationName = "pitboard/" + currentDeviceId + "/live";
      message.retained = false;
      try { mqttClient.send(message); } catch(e) {}
    }

  } else {
    document.getElementById('pos').innerText = 'P-';
    document.getElementById('driverAhead').innerHTML = '--';
    document.getElementById('driverBehind').innerHTML = '--';
    document.getElementById('gap').innerText = '--';
    document.getElementById('myDriverNum').innerText = '--';
    
    if (typeof mqttClient !== 'undefined' && isMqttConnected && currentDeviceId !== "") {
      const payload = JSON.stringify({ p: 0, gap: "--", ahead: "--", behind: "--", num: "--", time: "--:--", laps: "-" });
      const message = new Paho.MQTT.Message(payload);
      message.destinationName = "pitboard/" + currentDeviceId + "/live";
      try { mqttClient.send(message); } catch(e) {}
    }
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

const mqttClient = new Paho.MQTT.Client("broker.hivemq.com", 8884, "PitWall_Web_" + parseInt(Math.random() * 100000));
let isMqttConnected = false;

mqttClient.onConnectionLost = function(responseObject) {
  isMqttConnected = false;
  setTimeout(connectMQTT, 5000); 
};

function connectMQTT() {
  mqttClient.connect({
    useSSL: true,
    onSuccess: function() {
      isMqttConnected = true;
      sendConfigToLilyGO(); 
    }
  });
}

function sendConfigToLilyGO() {
  if (!currentRaceId || !selectedDriverId || !isMqttConnected || currentDeviceId === "") return;
  
  const payload = JSON.stringify({
    engine: activeEngine,
    raceId: currentRaceId,
    driverId: selectedDriverId
  });

  const message = new Paho.MQTT.Message(payload);
  message.destinationName = "pitboard/" + currentDeviceId + "/config"; 
  message.retained = true; 
  
  try {
    mqttClient.send(message);
  } catch(e) {}
}

window.sendPitCommand = function(commandText, colorCode) {
  if (!isMqttConnected) {
    alert("⚠️ Radio connection not active. Please wait...");
    return;
  }
  
  if (currentDeviceId === "") {
    alert("⚠️ No Device Paired! Please pair your Pitboard in the settings first.");
    return;
  }

  const payload = JSON.stringify({
    cmd: commandText,
    color: colorCode
  });

  const message = new Paho.MQTT.Message(payload);
  message.destinationName = "pitboard/" + currentDeviceId + "/command";
  message.retained = false; 
  
  try {
    mqttClient.send(message);
    
    document.body.style.border = "4px solid white";
    setTimeout(() => { document.body.style.border = "none"; }, 500);

  } catch(e) {}
};

connectMQTT();
