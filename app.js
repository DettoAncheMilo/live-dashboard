let selectedDriverId = localStorage.getItem('pit_driver_id') || null;
let currentRaceId = localStorage.getItem('pit_race_id') || null;
let ws = null; 
let lastKnownDrivers = []; 

if ('wakeLock' in navigator) {
  navigator.wakeLock.request('screen').catch(console.error);
}

// Pulisce i tempi (da "00:00:47.262000" a "47.262")
function formatLapTime(timeStr) {
  if (!timeStr || timeStr === "00:00:00.000000") return '--:--.--';
  let formatted = timeStr;
  if (formatted.startsWith("00:")) formatted = formatted.substring(3);
  if (formatted.startsWith("00:")) formatted = formatted.substring(3);
  if (formatted.includes('.')) formatted = formatted.substring(0, formatted.indexOf('.') + 4);
  return formatted;
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

function changeDriver(id) {
  selectedDriverId = id;
  localStorage.setItem('pit_driver_id', id);
  
  // Aggiorna la dashboard all'istante pescando dalla memoria dell'ultimo giro
  if (lastKnownDrivers.length > 0) {
    updateDashboard(lastKnownDrivers);
  }
}

function connectWebSocket() {
  if (!currentRaceId) return;
  if (ws) ws.close();

  const wsUrl = `wss://api-stg.mk.time2race.it/live/${currentRaceId}/ranking/`;
  ws = new WebSocket(wsUrl);

  ws.onmessage = function(event) {
    if (event.data === 'ping' || event.data === 'pong') return;
    
    try {
      const payload = JSON.parse(event.data);
      let driversList = payload.drivers;
      
      if (!driversList && payload.data && payload.data.drivers) {
        driversList = payload.data.drivers;
      }

      if (driversList && driversList.length > 0) {
        lastKnownDrivers = driversList; // Salva i dati per il cambio rapido
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

function updateDashboard(driversList) {
  if (!selectedDriverId) return;

  const myDriver = driversList.find(d => String(d.id) === String(selectedDriverId));

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
  
  // SOLUZIONE: Questa riga forza il menu ad avvisare il codice quando tocchi un nome nuovo
  select.onchange = function(event) {
    changeDriver(event.target.value);
  };

  if (select.options.length <= 1 && drivers.length > 0) {
    select.innerHTML = '<option value="">Seleziona Pilota...</option>';
    drivers.forEach(d => {
      const opt = document.createElement('option');
      opt.value = d.id; 
      
      const num = d.raceno || '';
      const name = d.fullname || d.nickname || `Pilota ${d.id}`;
      
      opt.textContent = num ? `#${num} ${name}` : name;
      
      if (String(opt.value) === String(selectedDriverId)) {
        opt.selected = true;
      }
      select.appendChild(opt);
    });
    
    updateDashboard(drivers);
  }
}

// Avvio automatico se ricarichi la pagina
if (currentRaceId) {
  document.getElementById('raceLinkInput').value = `https://stg.mk.time2race.it/race/${currentRaceId}/`;
  
  // Assicuriamoci che anche all'avvio il menu sia "in ascolto"
  document.getElementById('driverSelect').onchange = function(event) {
    changeDriver(event.target.value);
  };
  
  connectWebSocket();
}