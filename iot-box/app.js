let selectedDriverId = localStorage.getItem('pit_driver_id') || null;
let currentRaceId = localStorage.getItem('pit_race_id') || null;
let ws = null; 
let lastKnownDrivers = []; 

let sessionTimeLeft = "--:--";
let myDriverLaps = "-";
let activeEngine = 'time2race';

let currentDeviceId = ""; 
let isMqttConnected = false;

if ('wakeLock' in navigator) {
  navigator.wakeLock.request('screen').catch(console.error);
}

function updatePairingUI() {
  const statusEl = document.getElementById("pairStatus");
  if (!statusEl) return;
  if (currentDeviceId === "") {
    statusEl.innerText = "STATUS: UNPAIRED";
    statusEl.style.color = "#ffcc00"; 
  } else {
    if (isMqttConnected) {
      statusEl.innerText = "STATUS: PAIRED TO " + currentDeviceId + " (RADIO 🟢)";
      statusEl.style.color = "#22c55e"; 
    } else {
      statusEl.innerText = "STATUS: PAIRED TO " + currentDeviceId + " (RADIO 🔴)";
      statusEl.style.color = "#ef4444"; 
    }
  }
}

window.addEventListener('DOMContentLoaded', () => {
  const targetElement = document.getElementById('loadBtn'); 
  if (targetElement && targetElement.parentNode) {
    const inputStr = `<input type="text" id="myRaceNumber" placeholder="My#" title="Insert your race number" style="width: 50px; max-width: 50px; flex: 0 0 50px; margin-left: 8px; margin-right: 8px; padding: 2px; border-radius: 4px; border: 1px solid #555; background: #222; color: #ffcc00; font-weight: bold; text-align: center; font-size: 0.95rem; box-sizing: border-box;">`;
    targetElement.insertAdjacentHTML('beforebegin', inputStr);
    const savedNum = localStorage.getItem('pit_race_number');
    if (savedNum) document.getElementById('myRaceNumber').value = savedNum;
  }
  const savedDeviceId = localStorage.getItem("pitboard_id");
  if (savedDeviceId) {
    const inputEl = document.getElementById("deviceIdInput");
    if (inputEl) inputEl.value = savedDeviceId;
  }
  updatePairingUI();
});

window.pairDevice = function() {
  const inputEl = document.getElementById("deviceIdInput");
  if (!inputEl) return;
  const input = inputEl.value.trim().toUpperCase();
  if (input === "") { alert("Inserisci un Device ID valido!"); return; }
  
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

window.unpairDevice = function() {
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
  
  currentDeviceId = "";
  localStorage.removeItem("pitboard_id");
  const inputEl = document.getElementById("deviceIdInput");
  if (inputEl) inputEl.value = "";
  updatePairingUI();
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
  const keepAliveAudio = document.getElementById('keepAliveAudio');
  if (keepAliveAudio) keepAliveAudio.play().catch(e => console.log("Audio background ignorato"));
  setButtonState('connecting');
  
  if (inputUrl.includes('time2race.it')) {
    const match = inputUrl.match(/race\/(\d+)/); 
    if (match && match[1]) {
      currentRaceId = match[1]; activeEngine = 'time2race';
      localStorage.setItem('pit_race_id', currentRaceId);
      resetDashboard(); connectTime2Race(); 
    }
  } else if (inputUrl.includes('speedhive.mylaps.com')) {
    const match = inputUrl.match(/sessions\/([A-Za-z0-9\-]+)/);
    if (match && match[1]) {
      currentRaceId = match[1]; activeEngine = 'mylaps';
      localStorage.setItem('pit_race_id', currentRaceId);
      resetDashboard(); connectMylaps(currentRaceId);
    } else {
      setButtonState('error'); alert("Invalid Mylaps link.");
    }
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
      num: "--", time: "--:--", laps: "-", ca: 0, cb: 0, cab: 0, cbb: 1 
    });
    const msgResetLite = new Paho.MQTT.Message(resetLite);
    msgResetLite.destinationName = "pitboard/" + currentDeviceId + "/live";
    try { mqttClient.send(msgResetLite); } catch(e) {}
  }
  if (ws) { ws.onclose = null; ws.onerror = null; ws.close(); ws = null; }
  if (window.wsTimeout) clearTimeout(window.wsTimeout);
  currentRaceId = null; activeEngine = null;
  localStorage.removeItem('pit_race_id');
  document.getElementById('raceLinkInput').value = '';
  const numInput = document.getElementById('myRaceNumber');
  if (numInput) { numInput.value = ''; localStorage.removeItem('pit_race_number'); }
  resetDashboard();
}

function resetDashboard() {
  sessionTimeLeft = "--:--"; myDriverLaps = "-";
  document.getElementById('sessionStatus').innerHTML = '⏱️ Waiting for connection...';
  document.getElementById('driverSelect').innerHTML = '<option value="">Select Rider...</option>';
  lastKnownDrivers = []; selectedDriverId = null;
  localStorage.removeItem('pit_driver_id');
  updateDashboard([]); setButtonState('default');
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
  if (event.target && event.target.id === 'driverSelect') changeDriver();
});

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

function formatRivalInfo(driver, myDriver) {
  if (!driver) return '--';
  const num = driver.raceno || driver.no || '';
  const theirLastLap = formatLapTime(driver.lasttime || driver.lsTm);
  const theirBestLap = formatLapTime(driver.besttime || driver.btTm);
  const nameStr = num ? `#${num}` : (driver.fullname || driver.nam || driver.nickname || 'Rider').substring(0, 8);
  
  let gapHtml = ''; let paceDeltaHtml = '<span style="color: #666;">Δ --</span>'; let bestDeltaHtml = '<span style="color: #666;">Δ --</span>';
  
  if (myDriver) {
    let myDiffStr = String(myDriver.gap || myDriver.difference || myDriver.df || '0');
    let theirDiffStr = String(driver.gap || driver.difference || driver.df || '0');
    let isLapped = myDiffStr.toLowerCase().includes('lap') || theirDiffStr.toLowerCase().includes('lap');
    let prefix = (parseInt(driver.position || driver.pos, 10) < parseInt(myDriver.position || myDriver.pos, 10)) ? "-" : "+";

    let physicalGapText = 'LAPPED';
    if (!isLapped) {
      let gap = Math.abs((parseFloat(myDiffStr.replace('+', '').replace(',', '.')) || 0) - (parseFloat(theirDiffStr.replace('+', '').replace(',', '.')) || 0));
      physicalGapText = `GAP ${prefix}${gap.toFixed(3)}`;
    }
    gapHtml = `<span style="font-size: 1.1rem; color: #ffcc00; margin-top: 4px; margin-bottom: 4px; font-weight: bold;">${physicalGapText}</span>`;

    let myLastMs = parseTimeToMs(formatLapTime(myDriver.lasttime || myDriver.lsTm));
    let theirLastMs = parseTimeToMs(theirLastLap);
    if (myLastMs > 0 && theirLastMs > 0) {
      let diffMs = myLastMs - theirLastMs;
      paceDeltaHtml = `<span style="color: ${diffMs > 0 ? '#ef4444' : '#22c55e'};">Δ ${diffMs > 0 ? '+' : ''}${(diffMs/1000).toFixed(3)}</span>`;
    }

    let myBestMs = parseTimeToMs(formatLapTime(myDriver.besttime || myDriver.btTm));
    let theirBestMs = parseTimeToMs(theirBestLap);
    if (myBestMs > 0 && theirBestMs > 0) {
      let diffMs = myBestMs - theirBestMs;
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

function updateDashboard(driversList) {
  const numInput = document.getElementById('myRaceNumber');
  if (numInput && !selectedDriverId && driversList.length > 0) {
    const targetNum = numInput.value.trim();
    if (targetNum !== "") {
      const autoDriver = driversList.find(d => String(d.raceno || d.no) === String(targetNum));
      if (autoDriver) {
        selectedDriverId = getDriverId(autoDriver); localStorage.setItem('pit_driver_id', selectedDriverId);
        const selectEl = document.getElementById('driverSelect'); if (selectEl) selectEl.value = selectedDriverId;
      }
    }
  }

  if (!selectedDriverId) return;
  const myDriver = driversList.find(d => String(getDriverId(d)) === String(selectedDriverId));

  if (myDriver) {
    myDriverLaps = myDriver.laps || '-'; updateBanner();
    let myPos = parseInt(myDriver.position || myDriver.pos, 10) || "-";
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

    const myNumText = (myDriver.raceno || myDriver.no) ? `#${myDriver.raceno || myDriver.no}` : 'ME';
    document.getElementById('myDriverNum').innerText = myNumText;

    let myLastMs = parseTimeToMs(formatLapTime(myDriver.lasttime || myDriver.lsTm));
    let stringAhead = '--'; let mqttAhead = '--'; let mqttAheadGap = '--'; let mqttAheadGapBL = '--'; let c_a = 0;
    let stringBehind = '--'; let mqttBehind = '--'; let mqttBehindGap = '--'; let mqttBehindGapBL = '--'; let c_b = 0;

    let myDiffStr = String(myDriver.gap || myDriver.difference || myDriver.df || '0');
    let myDiffFloat = parseFloat(myDiffStr.replace('+', '').replace(',', '.')) || 0;

    // AHEAD
    if (myPos > 1) {
      const driverAhead = driversList.find(d => parseInt(d.position || d.pos, 10) === myPos - 1);
      if (driverAhead) {
        stringAhead = formatRivalInfo(driverAhead, myDriver);
        mqttAhead = "#" + (driverAhead.raceno || driverAhead.no || "");
        let theirLastMs = parseTimeToMs(formatLapTime(driverAhead.lasttime || driverAhead.lsTm));
        let theirBestMs = parseTimeToMs(formatLapTime(driverAhead.besttime || driverAhead.btTm));
        
        if (myDiffStr.toLowerCase().includes('lap') || String(driverAhead.gap || driverAhead.df || '0').toLowerCase().includes('lap')) {
          mqttAheadGap = "LAPPED"; mqttAheadGapBL = "LAPPED";
        } else {
          let theirDiffFloat = parseFloat(String(driverAhead.gap || driverAhead.df || '0').replace('+', '').replace(',', '.')) || 0;
          mqttAheadGap = "+" + Math.abs(myDiffFloat - theirDiffFloat).toFixed(3);
          if (myLastMs > 0 && theirLastMs > 0) { c_a = (myLastMs <= theirLastMs) ? 1 : 2; mqttAheadGap = (c_a == 1 ? "-" : "+") + mqttAheadGap.substring(1); }
          
          if (myBestMs > 0 && theirBestMs > 0) {
            let diffMsBL = myBestMs - theirBestMs; 
            mqttAheadGapBL = (diffMsBL > 0 ? "+" : "") + (diffMsBL / 1000).toFixed(3);
          }
        }
      }
    } else if (myPos === 1) {
      stringAhead = '<span class="rival-num" style="color:#ffcc00">LEADER</span><br><span style="font-size: 1.8rem;">🥇</span>'; mqttAhead = "--"; 
    }
    document.getElementById('driverAhead').innerHTML = stringAhead;

    // BEHIND
    const driverBehind = driversList.find(d => parseInt(d.position || d.pos, 10) === myPos + 1);
    if (driverBehind) {
      stringBehind = formatRivalInfo(driverBehind, myDriver);
      mqttBehind = "#" + (driverBehind.raceno || driverBehind.no || "");
      let theirLastMs = parseTimeToMs(formatLapTime(driverBehind.lasttime || driverBehind.lsTm));
      let theirBestMs = parseTimeToMs(formatLapTime(driverBehind.besttime || driverBehind.btTm));

      if (myDiffStr.toLowerCase().includes('lap') || String(driverBehind.gap || driverBehind.df || '0').toLowerCase().includes('lap')) {
        mqttBehindGap = "LAPPED"; mqttBehindGapBL = "LAPPED";
      } else {
        let theirDiffFloat = parseFloat(String(driverBehind.gap || driverBehind.df || '0').replace('+', '').replace(',', '.')) || 0;
        mqttBehindGap = "+" + Math.abs(myDiffFloat - theirDiffFloat).toFixed(3);
        if (myLastMs > 0 && theirLastMs > 0) { c_b = (myLastMs <= theirLastMs) ? 1 : 2; mqttBehindGap = (c_b == 1 ? "-" : "+") + mqttBehindGap.substring(1); }

        if (myBestMs > 0 && theirBestMs > 0) {
            let diffMsBL = myBestMs - theirBestMs; 
            mqttBehindGapBL = (diffMsBL > 0 ? "+" : "") + (diffMsBL / 1000).toFixed(3);
        }
      }
    } else if (myPos > 0 && driversList.length > 0) {
      stringBehind = '<span class="rival-num" style="color:#888">CLEAR</span>'; mqttBehind = "--"; 
    }
    document.getElementById('driverBehind').innerHTML = stringBehind;
    
    if (typeof mqttClient !== 'undefined' && isMqttConnected && currentDeviceId !== "") {
      
      // PACCHETTO "LITE" - Inserite tutte le chiavi vuote per non far crashare LilyGO
      const payloadLite = JSON.stringify({
        p: String(myPos), gap: gapText, 
        ahead: mqttAhead, ahead_html: "-", gap_a: mqttAheadGap, gap_a_bl: mqttAheadGapBL, time_a_ll: "-", time_a_bl: "-",
        behind: mqttBehind, behind_html: "-", gap_b: mqttBehindGap, gap_b_bl: mqttBehindGapBL, time_b_ll: "-", time_b_bl: "-",
        num: myNumText, time: sessionTimeLeft, laps: String(myDriverLaps),
        ca: c_a, cb: c_b, cab: 0, cbb: 1
      });
      const msgLite = new Paho.MQTT.Message(payloadLite);
      msgLite.destinationName = "pitboard/" + currentDeviceId + "/live";
      try { mqttClient.send(msgLite); } catch(e) {}

      // PACCHETTO "FULL"
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

function populateDriverDropdown(drivers) {
  const select = document.getElementById('driverSelect');
  if (select.options.length <= 1 && drivers.length > 0) {
    select.innerHTML = '<option value="">Select Rider...</option>';
    drivers.forEach(d => {
      const opt = document.createElement('option'); opt.value = getDriverId(d); 
      const num = d.raceno || d.no || ''; const name = d.fullname || d.nickname || d.nam || `Rider ${getDriverId(d)}`;
      opt.textContent = num ? `#${num} ${name}` : name;
      if (String(opt.value) === String(selectedDriverId)) opt.selected = true;
      select.appendChild(opt);
    });
    updateDashboard(drivers);
  }
}

if (currentRaceId) {
  if (currentRaceId.includes('-')) {
    activeEngine = 'mylaps'; document.getElementById('raceLinkInput').value = `https://speedhive.mylaps.com/livetiming/EVENT/sessions/${currentRaceId}`; connectMylaps(currentRaceId);
  } else {
    activeEngine = 'time2race'; document.getElementById('raceLinkInput').value = `https://stg.mk.time2race.it/race/${currentRaceId}/`; connectTime2Race();
  }
}

const mqttClient = new Paho.MQTT.Client("broker.hivemq.com", 8884, "/mqtt", "PitWall_Web_" + parseInt(Math.random() * 100000));
mqttClient.onConnectionLost = function(responseObject) { isMqttConnected = false; updatePairingUI(); setTimeout(connectMQTT, 3000); };
mqttClient.onMessageArrived = function(message) {};

function connectMQTT() {
  mqttClient.connect({
    useSSL: true, timeout: 10,
    onSuccess: function() { isMqttConnected = true; updatePairingUI(); },
    onFailure: function(err) { isMqttConnected = false; updatePairingUI(); setTimeout(connectMQTT, 5000); }
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

connectMQTT();