let selectedDriverId = localStorage.getItem('pit_driver_id') || null;
let currentRaceId = localStorage.getItem('pit_race_id') || null;
let ws = null; 

if ('wakeLock' in navigator) {
  navigator.wakeLock.request('screen').catch(console.error);
}

// Pulisce i tempi sporchi di Time2Race (da "00:00:47.262000" a "47.262")
function formatLapTime(timeStr) {
  if (!timeStr || timeStr === "00:00:00.000000") return '--:--.--';
  let formatted = timeStr;
  // Rimuove le ore se sono a zero
  if (formatted.startsWith("00:")) formatted = formatted.substring(3);
  // Rimuove i minuti se sono a zero (es. per piste da Go-Kart sotto il minuto)
  if (formatted.startsWith("00:")) formatted = formatted.substring(3);
  // Taglia i microsecondi in eccesso lasciando solo i millesimi
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
    connectWebSocket(); 
  } else {
    alert("Inserisci un link valido (es. https://stg.mk.time2race.it/race/37/)");
  }
}

function changeDriver(id) {
  selectedDriverId = id;
  localStorage.setItem('pit_driver_id', id);
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
      
      // Time2Race manda i piloti nell'oggetto "drivers"
      let driversList = payload.drivers;
      
      if (!driversList && payload.data && payload.data.drivers) {
        driversList = payload.data.drivers;
      }

      if (driversList && driversList.length > 0) {
        populateDriverDropdown(driversList);
        updateDashboard(driversList);
      }
    } catch (err) {
      console.log("In attesa dati live...");
    }
  };

  ws.onclose = function() {
    setTimeout(connectWebSocket, 3000); // Riconnessione automatica in caso di caduta linea
  };
}

function updateDashboard(driversList) {
  if (!selectedDriverId) return;

  // Cerca il pilota usando l'ID univoco assegnato al menu a tendina
  const myDriver = driversList.find(d => String(d.id) === String(selectedDriverId));

  if (myDriver) {
    document.getElementById('pos').innerText = `P${myDriver.position || '-'}`;
    document.getElementById('lastLap').innerText = formatLapTime(myDriver.lasttime);
    document.getElementById('bestLap').innerText = formatLapTime(myDriver.besttime);
    document.getElementById('gap').innerText = myDriver.difference ? `+${myDriver.difference}` : '+0.000';
  }
}

function populateDriverDropdown(drivers) {
  const select = document.getElementById('driverSelect');
  
  // Popola la tendina solo se è vuota o ha solo l'opzione di default
  if (select.options.length <= 1 && drivers.length > 0) {
    select.innerHTML = '<option value="">Seleziona Pilota...</option>';
    drivers.forEach(d => {
      const opt = document.createElement('option');
      opt.value = d.id; // Usa l'ID univoco di gara del pilota
      
      const num = d.raceno || '';
      const name = d.fullname || d.nickname || `Pilota ${d.id}`;
      
      opt.textContent = num ? `#${num} ${name}` : name;
      
      if (String(opt.value) === String(selectedDriverId)) {
        opt.selected = true;
      }
      select.appendChild(opt);
    });
    
    // Forza il primo aggiornamento della dashboard subito dopo aver popolato la tendina
    updateDashboard(drivers);
  }
}

if (currentRaceId) {
  document.getElementById('raceLinkInput').value = `https://stg.mk.time2race.it/race/${currentRaceId}/`;
  connectWebSocket();
}