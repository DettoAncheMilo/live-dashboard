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
let isHubConnected = false;
const hubStatusAtByBroker = [0, 0];
let isRaceSession = false;

// Mantiene acceso ai controlli del browser e all'orientamento scelto dall'utente.
// Il wake lock viene richiesto al primo tocco e rinnovato quando si torna alla pagina.
let wakeLock = null;
const requestScreenWakeLock = async () => {
    if (!('wakeLock' in navigator) || document.visibilityState !== 'visible' || wakeLock) return;
    try {
        wakeLock = await navigator.wakeLock.request('screen');
        wakeLock.addEventListener('release', () => { wakeLock = null; });
    } catch (err) { wakeLock = null; }
};

// Retry on user interaction if the first request was denied or later released.
document.addEventListener('pointerdown', requestScreenWakeLock);
document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') requestScreenWakeLock();
});
window.addEventListener('pageshow', requestScreenWakeLock);

window.toggleSettings = function() {
    const panel = document.getElementById('settingsPanel');
    panel.classList.toggle('collapsed');
    const button = document.getElementById('toggleSettingsBtn');
    if (button) {
        const expanded = !panel.classList.contains('collapsed');
        button.setAttribute('aria-expanded', String(expanded));
        button.setAttribute('aria-label', expanded ? 'Close settings' : 'Open settings');
    }
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
    if (str.includes(':')) return parseTimeToMs(str); 
    let val = parseFloat(str);
    return isNaN(val) ? 0 : val * 1000;
}

function updatePairingUI() {
    const statusEl = document.getElementById("pairStatus");
    if (!statusEl) return;
    if (currentDeviceId === "") {
        statusEl.innerText = "NO DISPLAY"; statusEl.style.color = "#888";
    } else {
        if (isHubConnected) { statusEl.innerText = "DISPLAY 🟢"; statusEl.style.color = "#22c55e"; }
        else { statusEl.innerText = "DISPLAY 🔴"; statusEl.style.color = "#ef4444"; }
    }
}

window.addEventListener('DOMContentLoaded', () => {
    const savedNum = localStorage.getItem('pit_race_number');
    if (savedNum) document.getElementById('myRaceNumber').value = savedNum;
    const savedDeviceId = localStorage.getItem("pitboard_id");
    if (savedDeviceId) {
        document.getElementById("deviceIdInput").value = savedDeviceId;
        currentDeviceId = savedDeviceId;
    }
    updatePairingUI();
    if (!currentRaceId) document.getElementById('settingsPanel').classList.remove('collapsed');
});

window.pairDevice = function() {
    const inputEl = document.getElementById("deviceIdInput");
    if (!inputEl) return;
    const input = inputEl.value.trim().toUpperCase();
    
    if (input === "") {
        const previousDeviceId = localStorage.getItem("pitboard_id") || currentDeviceId;
        if (typeof mqttClient !== 'undefined' && isMqttConnected) {
            const resetLite = JSON.stringify({ p: "-", gap: "--", ahead: "--", ahead_html: "-", gap_a: "--", gap_a_bl: "--", time_a_ll: "-", time_a_bl: "-", behind: "--", behind_html: "-", gap_b: "--", gap_b_bl: "--", time_b_ll: "-", time_b_bl: "-", num: "--", time: "--:--", laps: "-", ca: 0, cb: 0, cab: 0, cbb: 2 });
            const msgResetLite = new Paho.MQTT.Message(resetLite);
            if (previousDeviceId) {
                msgResetLite.destinationName = "pitboard/" + previousDeviceId + "/live";
                try { mqttClient.send(msgResetLite); } catch(e) {}
            }
        }
        currentDeviceId = "";
        isHubConnected = false;
        hubStatusAtByBroker.fill(0);
        localStorage.removeItem("pitboard_id");
        updatePairingUI();
        return;
    }

    const pairingChanged = String(currentDeviceId).toUpperCase() !== input;
    currentDeviceId = input;
    if (pairingChanged) {
        isHubConnected = false;
        hubStatusAtByBroker.fill(0);
    }
    localStorage.setItem("pitboard_id", currentDeviceId);
    updatePairingUI();

    if (typeof mqttClient !== 'undefined' && isMqttConnected && currentDeviceId !== "") {
        const pairLite = JSON.stringify({ p: "-", gap: "--", ahead: "--", ahead_html: "-", gap_a: "--", gap_a_bl: "--", time_a_ll: "-", time_a_bl: "-", behind: "--", behind_html: "-", gap_b: "--", gap_b_bl: "--", time_b_ll: "-", time_b_bl: "-", num: "--", time: "--:--", laps: "-", ca: 0, cb: 0, cab: 0, cbb: 1 });
        const msgPair = new Paho.MQTT.Message(pairLite);
        msgPair.destinationName = "pitboard/" + currentDeviceId + "/live";
        try { mqttClient.send(msgPair); } catch(e) {}
    }
    if (lastKnownDrivers.length > 0) updateDashboard(lastKnownDrivers);
};

window.setButtonState = function(state) {
    const btn = document.getElementById('loadBtn');
    const stopBtn = document.getElementById('stopBtn');
    if (!btn) return;
    if (state === 'connected') {
        btn.style.backgroundColor = 'var(--accent-green)'; btn.style.color = '#000'; btn.innerText = 'ON ✓';
        if (stopBtn) stopBtn.style.display = 'block'; 
    } else if (state === 'connecting') {
        btn.style.backgroundColor = 'var(--accent-blue)'; btn.style.color = '#fff'; btn.innerText = '...';
        if (stopBtn) stopBtn.style.display = 'none'; 
    } else if (state === 'error') {
        btn.style.backgroundColor = 'var(--accent-red)'; btn.style.color = '#fff'; btn.innerText = 'ERR';
        if (stopBtn) stopBtn.style.display = 'none'; 
    } else {
        btn.style.backgroundColor = 'var(--accent-yellow)'; btn.style.color = '#000'; btn.innerText = 'LOAD';
        if (stopBtn) stopBtn.style.display = 'none'; 
    }
}

document.addEventListener('input', function(event) {
    if (event.target && event.target.id === 'raceLinkInput') window.setButtonState('default');
    if (event.target && event.target.id === 'myRaceNumber') localStorage.setItem('pit_race_number', event.target.value.trim());
});

function getDriverId(d) { 
    return d.id || d.user_id || d.raceno || d.no || d.number || d.num || d.fullname || d.name || d.nam || "unknown"; 
}

function isDriverInPit(driver) {
    if (!driver || typeof driver !== 'object') return false;

    const flagKeys = ['isInPit', 'inPit', 'in_pit', 'pitLane', 'pit_lane', 'onPitLane', 'on_pit_lane', 'pitStatus', 'pit_status', 'pit'];
    for (const key of flagKeys) {
        const value = driver[key];
        if (typeof value === 'boolean') return value;
        if (typeof value === 'number' && key !== 'pit') return value !== 0;
        if (typeof value === 'string') {
            const token = value.trim().toUpperCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ');
            if (['TRUE', 'YES', '1', 'IN PIT', 'PIT LANE', 'IN PIT LANE'].includes(token)) return true;
            if (['FALSE', 'NO', '0', 'ON TRACK', 'OUT'].includes(token)) return false;
        }
    }

    const statusValues = [driver.status, driver.state, driver.pitStatus, driver.pit_status,
        driver.lasttime, driver.lsTm, driver.lastLap, driver.last_lap];
    return statusValues.some(value => {
        if (typeof value !== 'string') return false;
        const token = value.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/gi, ' ')
            .trim().toUpperCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ');
        return /^(?:IN )?PIT(?: LANE)?$/.test(token);
    });
}

function formatLapTime(timeStr) {
    if (timeStr === null || timeStr === undefined || timeStr === "" || String(timeStr) === "00:00:00.000000") return '--:--.--';
    let formatted = String(timeStr);
    if (formatted.startsWith("00:")) formatted = formatted.substring(3);
    if (formatted.startsWith("00:")) formatted = formatted.substring(3);
    if (formatted.includes('.')) formatted = formatted.substring(0, formatted.indexOf('.') + 4);
    return formatted;
}

function parseTimeToMs(str) {
    if (!str || str.includes('-') || str === '--:--.--') return 0;
    let parts = str.split(':'); let secs = 0, ms = 0;
    let lastPart = parts.pop(); let secParts = lastPart.split('.');
    secs += parseInt(secParts[0], 10) || 0;
    if(secParts[1]) ms = parseInt(secParts[1].padEnd(3, '0').substring(0,3), 10) || 0;
    if(parts.length > 0) secs += parseInt(parts.pop(), 10) * 60;
    if(parts.length > 0) secs += parseInt(parts.pop(), 10) * 3600;
    return (secs * 1000) + ms;
}

function updateBanner() {
    const statusBox = document.getElementById('sessionStatus');
    if (!statusBox) return;
    statusBox.textContent = `⏱️ ${sessionTimeLeft} | 🔄 ${myDriverLaps} LAPS`;
}

window.loadNewRace = function() {
    const inputUrl = document.getElementById('raceLinkInput').value;
    if (!inputUrl) return;
    window.setButtonState('connecting'); window.pairDevice();
    
    if (inputUrl.includes('time2race.it')) {
        const match = inputUrl.match(/race\/(\d+)/); 
        if (match && match[1]) {
            currentRaceId = match[1]; activeEngine = 'time2race';
            localStorage.setItem('pit_race_id', currentRaceId); localStorage.setItem('pit_active_engine', activeEngine);
            resetDashboard(); connectTime2Race(); 
        }
    } else if (inputUrl.includes('speedhive.mylaps.com')) {
        const match = inputUrl.match(/sessions\/([A-Za-z0-9\-]+)/);
        if (match && match[1]) {
            currentRaceId = match[1]; activeEngine = 'mylaps';
            localStorage.setItem('pit_race_id', currentRaceId); localStorage.setItem('pit_active_engine', activeEngine);
            resetDashboard(); connectMylaps(currentRaceId);
        } else { window.setButtonState('error'); alert("Invalid MYLAPS link."); }
    } else if (inputUrl.includes('livetiming.ficr.it')) {
        const match = inputUrl.match(/livetiming\.ficr\.it\/([^\/]+)/);
        if (match && match[1]) {
            currentRaceId = match[1]; activeEngine = 'ficr';
            localStorage.setItem('pit_race_id', currentRaceId); localStorage.setItem('pit_active_engine', activeEngine);
            resetDashboard(); connectFicr(currentRaceId);
        } else { window.setButtonState('error'); alert("Invalid FICR link."); }
    } else if (inputUrl.includes('mgmtiming.it')) {
        currentRaceId = inputUrl; activeEngine = 'mgm';
        localStorage.setItem('pit_race_id', currentRaceId); localStorage.setItem('pit_active_engine', activeEngine);
        resetDashboard(); connectMgm(currentRaceId);
    } else { window.setButtonState('error'); alert("Unsupported race link. Paste a MYLAPS, FICR, MGM, or Time2Race link."); }
}

window.stopSession = function() {
    if (typeof mqttClient !== 'undefined' && isMqttConnected && currentDeviceId !== "") {
        const resetLite = JSON.stringify({ p: "-", gap: "--", ahead: "--", ahead_html: "-", gap_a: "--", gap_a_bl: "--", time_a_ll: "-", time_a_bl: "-", behind: "--", behind_html: "-", gap_b: "--", gap_b_bl: "--", time_b_ll: "-", time_b_bl: "-", num: "--", time: "--:--", laps: "-", ca: 0, cb: 0, cab: 0, cbb: 2 });
        const msgResetLite = new Paho.MQTT.Message(resetLite);
        msgResetLite.destinationName = "pitboard/" + currentDeviceId + "/live";
        try { mqttClient.send(msgResetLite); } catch(e) {}
    }
    if (ws) { ws.onclose = null; ws.onerror = null; ws.close(); ws = null; }
    if (window.wsTimeout) clearTimeout(window.wsTimeout);
    if (window.ficrTimeout) clearTimeout(window.ficrTimeout);
    
    currentRaceId = null; activeEngine = null;
    localStorage.removeItem('pit_race_id'); localStorage.removeItem('pit_active_engine');
    
    document.getElementById('raceLinkInput').value = '';
    const numInput = document.getElementById('myRaceNumber');
    if (numInput) { numInput.value = ''; localStorage.removeItem('pit_race_number'); }
    resetDashboard();
    document.getElementById('settingsPanel').classList.remove('collapsed');
}

function resetDashboard() {
    sessionTimeLeft = "--:--"; myDriverLaps = "-"; isRaceSession = false; 
    document.getElementById('sessionStatus').textContent = '⏱️ Waiting for connection...';
    document.getElementById('driverSelect').innerHTML = '<option value="">Select rider</option>';
    document.getElementById('targetSelect').innerHTML = '<option value="">No target</option>';
    
    lastKnownDrivers = []; selectedDriverId = null; selectedTargetId = null;
    localStorage.removeItem('pit_driver_id'); localStorage.removeItem('pit_target_id');
    
    document.querySelector('#liveTimingTable tbody').innerHTML = '';
    window.setButtonState('default');
}

function changeDriver() {
    const selectElement = document.getElementById('driverSelect');
    if (!selectElement.value) return;
    selectedDriverId = selectElement.value; localStorage.setItem('pit_driver_id', selectedDriverId);
    if (lastKnownDrivers.length > 0) updateDashboard(lastKnownDrivers);
}

function changeTarget() {
    const selectElement = document.getElementById('targetSelect');
    if(!selectElement) return;
    selectedTargetId = selectElement.value;
    if(selectedTargetId) localStorage.setItem('pit_target_id', selectedTargetId); else localStorage.removeItem('pit_target_id');
    if (lastKnownDrivers.length > 0) updateDashboard(lastKnownDrivers);
}

document.addEventListener('change', function(event) {
    if (event.target && event.target.id === 'driverSelect') changeDriver();
    if (event.target && event.target.id === 'targetSelect') changeTarget(); 
});

function mergeAndSortDrivers(mappedDrivers) {
    const now = Date.now();
    mappedDrivers.forEach(sourceDriver => {
        const newD = { ...sourceDriver, isInPit: isDriverInPit(sourceDriver) };
        const idx = lastKnownDrivers.findIndex(oldD => {
            let oldIdStr = String(getDriverId(oldD)); 
            let newIdStr = String(getDriverId(newD));
            let isFicrOrMgm = oldIdStr.includes('ficr_') || oldIdStr.includes('mgm_');
            
            if (!isFicrOrMgm && oldIdStr !== "unknown" && oldIdStr === newIdStr) return true;
            
            let oldNum = String(oldD.raceno || oldD.no || oldD.number || oldD.num || '').trim();
            let newNum = String(newD.raceno || newD.no || newD.number || newD.num || '').trim();
            if (oldNum !== "" && newNum !== "" && oldNum === newNum) return true;
            
            let oldName = String(oldD.fullname || oldD.name || oldD.nam || oldD.nickname || '').trim().toLowerCase();
            let newName = String(newD.fullname || newD.name || newD.nam || newD.nickname || '').trim().toLowerCase();
            if (oldName !== "" && newName !== "" && oldName === newName) return true;
            
            return false;
        });

        if (idx !== -1) {
            lastKnownDrivers[idx] = { ...lastKnownDrivers[idx], ...newD, _lastSeenAt: now };
        } else {
            lastKnownDrivers.push({ ...newD, _lastSeenAt: now });
        }
    });

    // Rimuove righe non più presenti nel feed dopo una finestra per gli aggiornamenti intermittenti.
    lastKnownDrivers = lastKnownDrivers.filter(d => now - (d._lastSeenAt || now) <= 15000);
    
    lastKnownDrivers.sort((a, b) => parseInt(a.position || a.pos || 9999) - parseInt(b.position || b.pos || 9999));
    populateDriverDropdown(lastKnownDrivers); 
    populateTargetDropdown(lastKnownDrivers); 
    updateDashboard(lastKnownDrivers);
}

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
        window.setButtonState('connected'); pollFicr(eventName, sessionId);
    } catch (error) { window.setButtonState('error'); }
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
        try { parsedData = JSON.parse(rawText); } catch(e) { window.ficrTimeout = setTimeout(() => pollFicr(eventName, sessionId), 3000); return; }

        if (Array.isArray(parsedData) && parsedData.length > 1) {
            const sessionInfo = parsedData[0]; const driversArray = parsedData[1]; 
            if (sessionInfo.b) { isRaceSession = String(sessionInfo.b).toLowerCase().includes('gara') || String(sessionInfo.b).toLowerCase().includes('race'); }
            sessionTimeLeft = sessionInfo.j || sessionInfo.k || "--:--"; updateBanner();

            const mappedDrivers = [];
            if (Array.isArray(driversArray)) {
                for (let i = 0; i < driversArray.length; i++) {
                    const d = driversArray[i];
                    if (d.m && d.m !== "00:00.000") {
                        mappedDrivers.push({ ...d, id: `ficr_${i}`, raceno: d.b || d.a, fullname: d.c || "Rider", position: d.r, lasttime: d.h, besttime: d.m, difference: (d.s && d.s !== "--") ? d.s : "", laps: d.j });
                    }
                }
            }
            mergeAndSortDrivers(mappedDrivers);
        }
    } catch (error) {}
    window.ficrTimeout = setTimeout(() => pollFicr(eventName, sessionId), 3000);
}

function connectTime2Race() {
    if (!currentRaceId || activeEngine !== 'time2race') return;
    if (ws) { ws.onclose = null; ws.onerror = null; ws.close(); }
    if (window.wsTimeout) clearTimeout(window.wsTimeout);
    ws = new WebSocket(`wss://api-stg.mk.time2race.it/live/${currentRaceId}/ranking/`);
    ws.onopen = function() { window.setButtonState('connected'); document.getElementById('settingsPanel').classList.add('collapsed'); }; 
    ws.onmessage = function(event) {
        if (event.data === 'ping' || event.data === 'pong') return;
        try {
            const payload = JSON.parse(event.data);
            const raceInfo = payload.race || (payload.data ? payload.data.race : null);
            if (raceInfo) {
                sessionTimeLeft = raceInfo.remaining || raceInfo.timeremaining || raceInfo.time_left || raceInfo.racetime || "--:--";
                if (raceInfo.endrace) sessionTimeLeft = "ENDED";
                isRaceSession = String(raceInfo.name || raceInfo.sessionname || "").toLowerCase().includes('gara') || String(raceInfo.name || raceInfo.sessionname || "").toLowerCase().includes('race');
                updateBanner();
            }
            let incomingDrivers = payload.drivers || (payload.data ? payload.data.drivers : null);
            if (incomingDrivers && incomingDrivers.length > 0) {
                mergeAndSortDrivers(incomingDrivers);
            }
        } catch (err) {}
    };
    ws.onerror = function() { window.setButtonState('error'); };
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
        const token = settings.accessToken; let endpointUrl = settings.url;

        if(!token || !endpointUrl) throw new Error("Token missing!");
        ws = new WebSocket(`${endpointUrl.replace("https://", "wss://")}&access_token=${token}`);
        const END_CHAR = String.fromCharCode(0x1E); 

        ws.onopen = function() {
            window.setButtonState('connected'); document.getElementById('settingsPanel').classList.add('collapsed');
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
                            if (arg.sessionName) isRaceSession = String(arg.sessionName).toLowerCase().includes('gara') || String(arg.sessionName).toLowerCase().includes('race');
                            if (arg.timeRemaining) sessionTimeLeft = arg.timeRemaining; else if (arg.timeToFinish) sessionTimeLeft = arg.timeToFinish; else if (arg.ttg) sessionTimeLeft = arg.ttg; else if (arg.rT) sessionTimeLeft = arg.rT; else if (arg.tss) sessionTimeLeft = arg.tss;
                            updateBanner();
                            if (arg.results) {
                                const mappedDrivers = arg.results.map(d => {
                                    let lapsCount = d.l || d.lc || d.ls || d.lap || d.laps || d.Laps || d.Lap || d.lapCount || d.c || '-';
                                    return { ...d, id: d.id, raceno: d.no, fullname: d.nam, position: d.pos, lasttime: d.lsTm, besttime: d.btTm, difference: d.df, laps: lapsCount };
                                });
                                mergeAndSortDrivers(mappedDrivers);
                            }
                        }
                    } catch(e) {}
                }
            });
        };
        ws.onerror = function() { window.setButtonState('error'); };
        ws.onclose = function() { window.wsTimeout = setTimeout(() => connectMylaps(sessionId), 3000); };
    } catch (error) { window.setButtonState('error'); }
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
        ws.onopen = function() { window.setButtonState('connected'); document.getElementById('settingsPanel').classList.add('collapsed'); };
        ws.onmessage = function(event) {
            if (event.data === '{}') return; 
            try {
                const payload = JSON.parse(event.data);
                if (payload.M && Array.isArray(payload.M)) {
                    payload.M.forEach(msg => {
                        if (msg.M === "updatelivePage" && msg.A && Array.isArray(msg.A)) {
                            const dataBlock = msg.A[0]; const sessionBlock = msg.A[1]; 
                            if (sessionBlock) {
                                isRaceSession = String(sessionBlock.TitoloRun || "").toLowerCase().includes('gara') || String(sessionBlock.TitoloRun || "").toLowerCase().includes('race');
                                if (sessionBlock.Rimanente && sessionBlock.Rimanente !== "") sessionTimeLeft = sessionBlock.Rimanente;
                                else if (sessionBlock.DurataGara && sessionBlock.DurataGara !== "") sessionTimeLeft = sessionBlock.DurataGara;
                                else if (sessionBlock.TempoTrascorso && sessionBlock.TempoTrascorso !== "") sessionTimeLeft = sessionBlock.TempoTrascorso;
                                updateBanner();
                            }
                            if (Array.isArray(dataBlock)) {
                                const mappedDrivers = [];
                                dataBlock.forEach((d, idx) => {
                                    const tdRegex = /<td[^>]*>(.*?)<\/td>/g; let tdMatches = []; let match;
                                    while ((match = tdRegex.exec(d.RigaTabella)) !== null) tdMatches.push(match[1].trim());
                                    if (tdMatches.length >= 7) {
                                        let gap = tdMatches[6].replace(/&nbsp;/gi, '').trim(); if (gap === '-' || gap === '') gap = '--';
                                        mappedDrivers.push({ ...d, id: `mgm_${tdMatches[1]}_${idx}`, raceno: tdMatches[1], fullname: tdMatches[2], position: d.PosizioneArrivo || tdMatches[0], lasttime: tdMatches[4], besttime: tdMatches[5], difference: gap, laps: tdMatches[3] });
                                    }
                                });
                                mergeAndSortDrivers(mappedDrivers);
                            }
                        }
                    });
                }
            } catch(e) {}
        };
        ws.onerror = function() { window.setButtonState('error'); };
        ws.onclose = function() { window.wsTimeout = setTimeout(() => connectMgm(originalUrl), 3000); };
    } catch (error) { window.setButtonState('error'); }
}

function populateTargetDropdown(drivers) {
    const select = document.getElementById('targetSelect');
    if (!select) return;
    const currentVal = select.value;
    select.innerHTML = '<option value="">No target</option>';
    drivers.forEach(d => {
        const opt = document.createElement('option'); opt.value = getDriverId(d); 
        const num = d.raceno || d.no || d.number || d.num || ''; 
        const name = d.fullname || d.name || d.nam || d.nickname || `Rider ${getDriverId(d)}`;
        opt.textContent = `${num ? `#${num} ` : ''}${name}${isDriverInPit(d) ? ' · IN PIT' : ''}`;
        if (String(opt.value) === String(selectedTargetId) || String(opt.value) === String(currentVal)) opt.selected = true;
        select.appendChild(opt);
    });
}

function populateDriverDropdown(drivers) {
    const select = document.getElementById('driverSelect');
    if (!select) return;
    const currentVal = select.value;
    select.innerHTML = '<option value="">Select rider</option>';
    drivers.forEach(d => {
        const opt = document.createElement('option'); opt.value = getDriverId(d); 
        const num = d.raceno || d.no || d.number || d.num || ''; 
        const name = d.fullname || d.name || d.nam || d.nickname || `Rider ${getDriverId(d)}`;
        opt.textContent = `${num ? `#${num} ` : ''}${name}${isDriverInPit(d) ? ' · IN PIT' : ''}`;
        if (String(opt.value) === String(selectedDriverId) || String(opt.value) === String(currentVal)) opt.selected = true;
        select.appendChild(opt);
    });
}

function updateDashboard(driversList) {
    const numInput = document.getElementById('myRaceNumber');
    const emptyState = document.getElementById('emptyState');
    
    if (numInput && !selectedDriverId && driversList.length > 0) {
        let targetNumRaw = String(numInput.value).trim();
        
        if (targetNumRaw !== "") {
            let targetNumMatch = isNaN(targetNumRaw) ? targetNumRaw.toUpperCase() : parseInt(targetNumRaw, 10).toString();
            
            const autoDriver = driversList.find(d => {
                let dNumRaw = String(d.raceno || d.no || d.number || d.num || "").trim();
                if (dNumRaw === "") return false;
                let dNumMatch = isNaN(dNumRaw) ? dNumRaw.toUpperCase() : parseInt(dNumRaw, 10).toString();
                return dNumMatch === targetNumMatch;
            });
            
            if (autoDriver) {
                selectedDriverId = getDriverId(autoDriver); 
                localStorage.setItem('pit_driver_id', selectedDriverId);
                
                const selectEl = document.getElementById('driverSelect'); 
                if (selectEl) selectEl.value = selectedDriverId;
                
            }
        }
    }

    const tbody = document.querySelector('#liveTimingTable tbody');
    if (!driversList.length) {
        if (tbody) tbody.innerHTML = '';
        if (emptyState) {
            emptyState.hidden = false;
            emptyState.textContent = 'Load a race in Settings. The standings will appear here; then select your rider.';
        }
        return;
    }
    if (emptyState) emptyState.hidden = true;
    tbody.innerHTML = ''; 

    let meRowObj = null;
    let targetRowObj = null;
    let otherRows = [];

    driversList.forEach((d, index) => {
        const dId = getDriverId(d);
        let isMe = String(dId) === String(selectedDriverId);
        let isTarget = String(dId) === String(selectedTargetId);
        let rowData = { data: d, index: index + 1 };

        if (isMe) meRowObj = rowData;
        else if (isTarget) targetRowObj = rowData;
        else otherRows.push(rowData);
    });

    let topOffsetCounter = 40; 

    const appendRow = (obj, isPinned) => {
        const d = obj.data;
        const dId = getDriverId(d);
        const tr = document.createElement('tr');
        
        let isMe = String(dId) === String(selectedDriverId);
        let isTarget = String(dId) === String(selectedTargetId);
        
        if (isMe) tr.classList.add('row-me');
        if (isTarget) tr.classList.add('row-target');
        
        if (isPinned) {
            tr.classList.add('pinned-row');
            tr.style.top = topOffsetCounter + 'px';
            topOffsetCounter += 45; 
        }
        
        const pos = d.position || d.pos || obj.index;
        const num = d.raceno || d.no || d.number || d.num || '';
        const name = (d.fullname || d.name || d.nickname || d.nam || 'Rider').substring(0, 15);
        const last = isDriverInPit(d) ? 'IN PIT' : formatLapTime(d.lasttime || d.lsTm);
        const best = formatLapTime(d.besttime || d.btTm);
        let gap = d.difference || d.df || d.gap || '';
        if(gap === '-' || gap === '') gap = '--';
        
        const columns = [
            ['col-pos', pos], ['col-num', num], ['col-name', name],
            ['col-last', last], ['col-best', best], ['col-gap', gap]
        ];
        columns.forEach(([className, value]) => {
            const td = document.createElement('td');
            td.className = className;
            td.textContent = String(value ?? '');
            tr.appendChild(td);
        });
        tbody.appendChild(tr);
    };

    if (meRowObj) appendRow(meRowObj, true);
    if (targetRowObj) appendRow(targetRowObj, true);
    otherRows.forEach(obj => appendRow(obj, false));

    // La classifica completa resta utile anche prima di impostare il proprio pilota.
    if (!selectedDriverId) return;

    const myIndex = driversList.findIndex(d => String(getDriverId(d)) === String(selectedDriverId));
    if (myIndex === -1) {
        myDriverLaps = '-';
        updateBanner();
        if (isMqttConnected && currentDeviceId !== '') {
            const emptyTelemetry = {
                p: '-', gap: '--', ahead: '--', ahead_html: '--', gap_a: '--', gap_a_bl: '--',
                time_a_ll: '--:--', time_a_bl: '--:--', behind: '--', behind_html: '--',
                gap_b: '--', gap_b_bl: '--', time_b_ll: 'P-', time_b_bl: '#--',
                num: '--', time: sessionTimeLeft, laps: '-', ca: 0, cb: 0, cab: 0, cbb: 1
            };
            const resetMessage = new Paho.MQTT.Message(JSON.stringify(emptyTelemetry));
            resetMessage.destinationName = `pitboard/${currentDeviceId}/live`;
            try { mqttClient.send(resetMessage); } catch (error) {}
        }
        return;
    }
    
    const myDriver = driversList[myIndex];
    const myTarget = selectedTargetId ? driversList.find(d => String(getDriverId(d)) === String(selectedTargetId)) : null;

    myDriverLaps = myDriver.laps || '-'; updateBanner();
    let myPos = parseInt(myDriver.position || myDriver.pos, 10) || (myIndex + 1);

    let overallBestMs = Infinity;
    driversList.forEach(d => { let bMs = parseTimeToMs(formatLapTime(d.besttime || d.btTm)); if (bMs > 0 && bMs < overallBestMs) overallBestMs = bMs; });

    let myBestMs = parseTimeToMs(formatLapTime(myDriver.besttime || myDriver.btTm));
    let gapText = "--";
    if (myBestMs > 0 && overallBestMs !== Infinity) {
        let diffMs = myBestMs - overallBestMs;
        gapText = diffMs === 0 ? "-0.000" : `+${(diffMs / 1000).toFixed(3)}`; 
    }

    const rawNumStr = String(myDriver.raceno || myDriver.no || myDriver.number || myDriver.num || '').trim();
    const myNumText = rawNumStr !== "" ? `#${rawNumStr}` : 'ME';
    let myLastMs = parseTimeToMs(formatLapTime(myDriver.lasttime || myDriver.lsTm));
    let mqttAhead = '--'; let mqttAheadGap = '--'; let mqttAheadGapBL = '--'; let c_a = 0;
    let mqttBehind = '--'; let mqttBehindGap = '--'; let mqttBehindGapBL = '--'; let c_b = 0;
    let myDiffStr = String(myDriver.gap || myDriver.difference || myDriver.df || '0');
    let myDiffMs = parseGapToMs(myDiffStr);
    let t_pos = "--", t_num = "--", t_last = "--", t_best = "--", t_pace_delta = "--", t_total_gap = "--";
    let flag_catch = 0;
    let targetInPit = 0;

    if(myTarget) {
        targetInPit = isDriverInPit(myTarget) ? 1 : 0;
        t_pos = "P" + (myTarget.position || myTarget.pos || "-");
        const tgtNumStr = String(myTarget.raceno || myTarget.no || myTarget.number || myTarget.num || "").trim();
        t_num = tgtNumStr !== "" ? `#${tgtNumStr}` : "--";
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
                t_total_gap = "GAP: " + prefix + (Math.abs(myDiffMs - theirDiffMs) / 1000).toFixed(3);
            } else { t_total_gap = "GAP: LAPPED"; }
        } else {
            let targetBestMs = parseTimeToMs(t_best);
            if (myBestMs > 0 && targetBestMs > 0) {
                let bestDiffMs = myBestMs - targetBestMs;
                t_total_gap = "B-GAP: " + (bestDiffMs > 0 ? "+" : "") + (bestDiffMs / 1000).toFixed(3); 
            } else { t_total_gap = "B-GAP: --"; }
        }
    }

    if (myIndex > 0) {
        const driverAhead = driversList[myIndex - 1]; 
        mqttAhead = "#" + String(driverAhead.raceno || driverAhead.no || driverAhead.number || driverAhead.num || "").trim();
        let theirLastMs = parseTimeToMs(formatLapTime(driverAhead.lasttime || driverAhead.lsTm));
        let theirBestMs = parseTimeToMs(formatLapTime(driverAhead.besttime || driverAhead.btTm));
        let theirDiffStr = String(driverAhead.gap || driverAhead.difference || driverAhead.df || '0');
        let theirDiffMs = parseGapToMs(theirDiffStr);
        let isLapped = isLappedGap(myDiffStr) || isLappedGap(theirDiffStr);

        if (isLapped) { mqttAheadGap = "LAPPED"; } else { mqttAheadGap = "+" + (Math.abs(myDiffMs - theirDiffMs) / 1000).toFixed(3); }
        if (myLastMs > 0 && theirLastMs > 0) c_a = (myLastMs <= theirLastMs) ? 1 : 2;
        if (myBestMs > 0 && theirBestMs > 0) {
            let diffMsBL = myBestMs - theirBestMs; 
            mqttAheadGapBL = (diffMsBL > 0 ? "+" : "") + (diffMsBL / 1000).toFixed(3);
        } else { mqttAheadGapBL = "--"; }
    } else if (myIndex === 0) { mqttAhead = "--"; }

    if (myIndex < driversList.length - 1) {
        const driverBehind = driversList[myIndex + 1]; 
        mqttBehind = "#" + String(driverBehind.raceno || driverBehind.no || driverBehind.number || driverBehind.num || "").trim();
        let theirLastMs = parseTimeToMs(formatLapTime(driverBehind.lasttime || driverBehind.lsTm));
        let theirBestMs = parseTimeToMs(formatLapTime(driverBehind.besttime || driverBehind.btTm));
        let theirDiffStr = String(driverBehind.gap || driverBehind.difference || driverBehind.df || '0');
        let theirDiffMs = parseGapToMs(theirDiffStr);
        let isLapped = isLappedGap(myDiffStr) || isLappedGap(theirDiffStr);

        if (isLapped) { mqttBehindGap = "LAPPED"; } else { mqttBehindGap = "+" + (Math.abs(myDiffMs - theirDiffMs) / 1000).toFixed(3); }
        if (myLastMs > 0 && theirLastMs > 0) c_b = (myLastMs <= theirLastMs) ? 1 : 2;
        if (myBestMs > 0 && theirBestMs > 0) {
            let diffMsBL = myBestMs - theirBestMs; 
            mqttBehindGapBL = (diffMsBL > 0 ? "+" : "") + (diffMsBL / 1000).toFixed(3);
        } else { mqttBehindGapBL = "--"; }
    } else if (myIndex >= 0 && driversList.length > 0) { mqttBehind = "--"; }
    
    if (typeof mqttClient !== 'undefined' && isMqttConnected && currentDeviceId !== "") {
        const payloadLite = JSON.stringify({
            p: String(myPos), gap: gapText, 
            target_pit: targetInPit,
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

const mqttBrokerDefinitions = [
    { name: 'HiveMQ', host: 'broker.hivemq.com', port: 8884, path: '/mqtt' },
    { name: 'EMQX', host: 'broker.emqx.io', port: 8084, path: '/mqtt' }
];
const mqttClients = mqttBrokerDefinitions.map((broker, index) => {
    const id = `PitWall_${index}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    return new Paho.MQTT.Client(broker.host, broker.port, broker.path, id);
});
const mqttReconnectTimers = [null, null];
const mqttConnecting = [false, false];

// Facade compatibile con il resto dell'app: pubblica su ogni broker disponibile.
const mqttClient = {
    get connected() {
        return mqttClients.some(client => client.isConnected());
    },
    send(message) {
        const connectedClients = mqttClients.filter(client => client.isConnected());
        if (connectedClients.length === 0) throw new Error('Nessun broker MQTT connesso');
        let sent = 0;
        connectedClients.forEach(client => {
            try {
                const payload = message.payloadString !== undefined ? message.payloadString : message.payloadBytes;
                const copy = new Paho.MQTT.Message(payload);
                copy.destinationName = message.destinationName;
                copy.qos = Number.isInteger(message.qos) ? message.qos : 0;
                copy.retained = Boolean(message.retained);
                client.send(copy);
                sent++;
            } catch (error) {}
        });
        if (sent === 0) throw new Error('Pubblicazione MQTT fallita');
    }
};

function refreshMqttConnectionState() {
    isMqttConnected = mqttClients.some(client => client.isConnected());
    updatePairingUI();
}

function scheduleMqttReconnect(index, delayMs) {
    if (mqttReconnectTimers[index]) clearTimeout(mqttReconnectTimers[index]);
    mqttReconnectTimers[index] = setTimeout(() => connectMQTT(index), delayMs);
}

function connectMQTT(index = null) {
    const indexes = index === null ? mqttClients.map((_, i) => i) : [index];
    indexes.forEach(i => {
        const client = mqttClients[i];
        if (client.isConnected() || mqttConnecting[i]) return;
        mqttConnecting[i] = true;
        client.connect({
            useSSL: true,
            timeout: 10,
            onSuccess: function() {
                mqttConnecting[i] = false;
                try { client.subscribe('pitboard/+/status'); } catch (error) {}
                refreshMqttConnectionState();
                if (currentDeviceId !== '') pairDevice();
            },
            onFailure: function() {
                mqttConnecting[i] = false;
                refreshMqttConnectionState();
                scheduleMqttReconnect(i, 5000);
            }
        });
    });
}

mqttClients.forEach((client, index) => {
    client.onMessageArrived = function(message) {
        if (!message.destinationName || !message.destinationName.endsWith('/status')) return;
        try {
            const status = JSON.parse(message.payloadString);
            const statusDeviceId = String(status.deviceId || message.destinationName.split('/')[1] || '').toUpperCase();
            if (statusDeviceId === String(currentDeviceId).toUpperCase()) {
                hubStatusAtByBroker[index] = status.online === true ? Date.now() : 0;
                isHubConnected = hubStatusAtByBroker.some(stamp => stamp > 0 && Date.now() - stamp < 10000);
                updatePairingUI();
            }
        } catch (error) {}
    };
    client.onConnectionLost = function() {
        mqttConnecting[index] = false;
        hubStatusAtByBroker[index] = 0;
        isHubConnected = hubStatusAtByBroker.some(stamp => stamp > 0 && Date.now() - stamp < 10000);
        refreshMqttConnectionState();
        scheduleMqttReconnect(index, 3000);
    };
});

setInterval(() => {
    const now = Date.now();
    const stillOnline = hubStatusAtByBroker.some(stamp => stamp > 0 && now - stamp < 10000);
    if (isHubConnected !== stillOnline) {
        isHubConnected = stillOnline;
        updatePairingUI();
    }
}, 2000);

function triggerScreenFlash(colorCode) {
    const overlay = document.getElementById('flashOverlay');
    if (!overlay) return;
    overlay.style.setProperty('--flash-color', colorCode);
    overlay.classList.remove('flash-active');
    void overlay.offsetWidth; 
    overlay.classList.add('flash-active');
}

window.sendPitCommand = function(commandText, colorCode) {
    if (!isMqttConnected || !isHubConnected || currentDeviceId === "") {
            alert("Display is not connected.");
        return;
    }

    const payload = JSON.stringify({ cmd: commandText, color: colorCode });
    const message = new Paho.MQTT.Message(payload);
    message.destinationName = "pitboard/" + currentDeviceId + "/command"; message.retained = false; 
    try {
        mqttClient.send(message);
        triggerScreenFlash(colorCode); 
    } catch(e) {}
};

window.sendCustomMessage = function() {
    const inputField = document.getElementById("customTextInput");
    const colorPicker = document.getElementById("customColorPicker");
    let customText = inputField.value.trim().toUpperCase();
    let chosenColor = colorPicker.value.toUpperCase(); 

    if (customText === "") return; 

    if (!isMqttConnected || !isHubConnected || currentDeviceId === "") {
            alert("Display is not connected.");
        return; 
    }

    const payload = JSON.stringify({ cmd: customText, color: chosenColor });
    const message = new Paho.MQTT.Message(payload);
    message.destinationName = "pitboard/" + currentDeviceId + "/command"; message.retained = false; 
    try {
        mqttClient.send(message);
        triggerScreenFlash(chosenColor); 
        inputField.value = "";
    } catch(e) {}
};

connectMQTT();
