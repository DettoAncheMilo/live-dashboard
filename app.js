let selectedDriverId = localStorage.getItem('pit_driver_id') || null;
let currentRaceId = localStorage.getItem('pit_race_id') || null;
let ws = null; 
let lastKnownDrivers = []; 

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
  } else if (state === 'connecting') {
    btn.style.backgroundColor = '#3b82f6'; 
    btn.style.color = '#ffffff';
    btn.innerText = 'CONNECTING ⏳';
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

document.addEventListener('input', function(event) {
  if (event.target && event.target.id === 'raceLinkInput') {
    setButtonState('default');
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

function updateBanner() {
  const statusBox = document.getElementById('sessionStatus');
  if (!statusBox) return;
  statusBox.innerHTML = `⏱️ TIME: <span style="color: #22c55e;">${sessionTimeLeft}</span> &nbsp;|&nbsp; 🔄 LAPS: <span style="color: #3b82f6;">${myDriverLaps}</span>`;
}

function loadNewRace() {
  const inputUrl = document.getElementById('raceLinkInput').value;
  if (!inputUrl) return;

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

function resetDashboard() {
  sessionTimeLeft = "--:--";
  myDriverLaps = "-";
  document.getElementById('sessionStatus').innerHTML = '⏱️ Waiting for connection...';
  document.getElementById('driverSelect').innerHTML = '<option value="">Select Rider...</option>';
  lastKnownDrivers = [];
  
  selectedDriverId = null;
  localStorage.removeItem('pit_driver_id');
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
  
  ws.onerror = function() { setButtonState('error'); };
  ws.onclose = function() { setTimeout(connectTime2Race, 3000); };
}

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

               if (arg.tss) sessionTimeLeft = arg.tss;
               else if (arg.timeRemaining) sessionTimeLeft = arg.timeRemaining;
               else if (arg.timeToFinish) sessionTimeLeft = arg.timeToFinish;
               
               updateBanner();

              if (arg.results) {
                 const mappedDrivers = arg.results.map(d => {
                   
                   let lapsCount = '-';
                   if (d.l !== undefined) lapsCount = d.l;
                   else if (d.lc !== undefined) lapsCount = d.lc;
                   else if (d.ls !== undefined) lapsCount = d.ls; // <--- IL COLPEVOLE!
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
                 
                 lastKnownDrivers = mappedDrivers;
                 populateDriverDropdown(mappedDrivers);
                 updateDashboard(mappedDrivers);
               }
            }
          } catch(e) {}
        }
      });
    };
    
    ws.onerror = function() { setButtonState('error'); };
    ws.onclose = function() { setTimeout(() => connectMylaps(sessionId), 3000); };

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
  const nameStr = num ? `#${num}` : (driver.fullname || driver.nam || driver.nickname || 'Rider').substring(0, 8);
  
  let gapHtml = '';
  
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

    let paceDeltaText = '';
    let myLastTimeRaw = myDriver.lasttime || myDriver.lsTm;
    let myMs = parseTimeToMs(formatLapTime(myLastTimeRaw));
    let theirMs = parseTimeToMs(theirLastLap);
    
    if (myMs > 0 && theirMs > 0) {
      let diffMs = theirMs - myMs;
      let sign = diffMs > 0 ? '+' : '';
      let color = diffMs > 0 ? '#22c55e' : '#ef4444'; 
      paceDeltaText = `<span style="color: ${color};">Δ ${sign}${(diffMs/1000).toFixed(3)}</span>`;
    }

    gapHtml = `
      <span style="font-size: 1.1rem; color: #ffcc00; margin-top: 4px; font-weight: bold;">${physicalGapText}</span>
      <span style="font-size: 1.1rem; font-weight: bold;">${paceDeltaText}</span>
    `;
  }

  return `
    <span class="rival-num">${nameStr}</span>
    <span style="font-size: 1.4rem; color: #ccc;">⏱ ${theirLastLap}</span>
    ${gapHtml}
  `;
}

function updateDashboard(driversList) {
  if (!selectedDriverId) return;
  const myDriver = driversList.find(d => String(getDriverId(d)) === String(selectedDriverId));

  if (myDriver) {
    myDriverLaps = myDriver.laps || '-';
    updateBanner();

    let myPos = parseInt(myDriver.position || myDriver.pos, 10);
    document.getElementById('pos').innerText = `P${myPos || '-'}`;

    const leaderDriver = driversList.find(d => parseInt(d.position || d.pos, 10) === 1);
    
    if (myPos === 1) {
      document.getElementById('gap').innerText = '+0.000';
    } else if (leaderDriver) {
      let myBestMs = parseTimeToMs(formatLapTime(myDriver.besttime || myDriver.btTm));
      let leaderBestMs = parseTimeToMs(formatLapTime(leaderDriver.besttime || leaderDriver.btTm));
      
      if (myBestMs > 0 && leaderBestMs > 0) {
        let gapMs = Math.abs(myBestMs - leaderBestMs);
        document.getElementById('gap').innerText = `+${(gapMs / 1000).toFixed(3)}`;
      } else {
        document.getElementById('gap').innerText = myDriver.difference || myDriver.df ? `+${myDriver.difference || myDriver.df}` : '+0.000';
      }
    } else {
      document.getElementById('gap').innerText = myDriver.difference || myDriver.df ? `+${myDriver.difference || myDriver.df}` : '+0.000';
    }

    const myNum = myDriver.raceno || myDriver.no || '';
    document.getElementById('myDriverNum').innerText = myNum ? `#${myNum}` : 'ME';

    let stringAhead = '--';
    if (myPos > 1) {
      const driverAhead = driversList.find(d => parseInt(d.position || d.pos, 10) === myPos - 1);
      stringAhead = driverAhead ? formatRivalInfo(driverAhead, myDriver) : '--';
    } else if (myPos === 1) {
      stringAhead = '<span class="rival-num" style="color:#ffcc00">LEADER</span><span style="font-size: 1.8rem;">🥇</span>';
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