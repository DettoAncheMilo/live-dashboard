let selectedDriverId = localStorage.getItem('pit_driver_id') || null;
let currentRaceId = localStorage.getItem('pit_race_id') || null;
let ws = null; // Variabile per il WebSocket

if ('wakeLock' in navigator) {
  navigator.wakeLock.request('screen').catch(console.error);
}

function loadNewRace() {
  const inputUrl = document.getElementById('raceLinkInput').value;
  const match = inputUrl.match(/race\/(\d+)/); 
  
  if (match && match[1]) {
    currentRaceId = match[1];
    localStorage.setItem('pit_race_id', currentRaceId);
    document.getElementById('driverSelect').innerHTML = '<option value="">Seleziona Pilota...</option>';
    connectWebSocket(); // Avvia la connessione live
  } else {
    alert("Inserisci un link valido di Time2Race!");
  }
}

function changeDriver(id) {
  selectedDriverId = id;
  localStorage.setItem('pit_driver_id', id);
  // Con il WebSocket non serve ricaricare, i dati si aggiorneranno al primo passaggio sul traguardo
}

function connectWebSocket() {
  if (!currentRaceId) return;
  
  // Chiude vecchie connessioni se presenti
  if (ws) ws.close();

  // Costruisce l'URL diretto del WebSocket scoperto nel pannello Rete
  const wsUrl = `wss://api-stg.mk.time2race.it/live/${currentRaceId}/ranking/`;
  console.log("Connessione Live a:", wsUrl);
  
  ws = new WebSocket(wsUrl);

  // Quando il server "spara" un nuovo tempo sul giro
  ws.onmessage = function(event) {
    // Gestisce il caso in cui il server mandi un "ping" per tenere aperta la connessione
    if (event.data === 'ping' || event.data === 'pong') return;
    
    try {
      const payload = JSON.parse(event.data);
      
      if (payload && payload.data) {
        let driversList = [];
        
        // Trova dinamicamente l'array dei piloti (qualunque sia il nome che usano)
        for (const key in payload.data) {
          if (Array.isArray(payload.data[key])) {
            driversList = payload.data[key];
            break; 
          }
        }

        if (driversList.length > 0) {
          populateDriverDropdown(driversList);
          updateDashboard(driversList);
        }
      }
    } catch (err) {
      console.log("Errore lettura dati:", err);
    }
  };

  // Se la connessione cade (es. entri in un punto senza segnale nel paddock)
  ws.onclose = function() {
    console.log("Connessione persa. Riconnessione in 3 secondi...");
    setTimeout(connectWebSocket, 3000);
  };
}

function updateDashboard(driversList) {
  if (!selectedDriverId) return;

  const myDriver = driversList.find(d => 
    String(d.user_id) === String(selectedDriverId) || 
    String(d.id) === String(selectedDriverId) ||
    String(d.num) === String(selectedDriverId) ||
    String(d.number) === String(selectedDriverId)
  );

  if (myDriver) {
    // Cerchiamo i campi in base ai nomi più usati nei sistemi di cronometraggio
    document.getElementById('pos').innerText = `P${myDriver.position || myDriver.pos || myDriver.rank || myDriver.class_pos || '-'}`;
    document.getElementById('lastLap').innerText = myDriver.last_lap || myDriver.lastlap || myDriver.lap_time || myDriver.last_time || '--:--.--';
    document.getElementById('bestLap').innerText = myDriver.best_lap || myDriver.bestlap || myDriver.best_time || '--:--.--';
    document.getElementById('gap').innerText = myDriver.gap_to_leader || myDriver.gap || myDriver.diff || myDriver.diff_first || '+0.0';
  }
}

function populateDriverDropdown(drivers) {
  const select = document.getElementById('driverSelect');
  
  if (select.options.length <= 1 && drivers.length > 0) {
    select.innerHTML = '<option value="">Seleziona Pilota...</option>';
    drivers.forEach(d => {
      // Identificativo pilota
      const opt = document.createElement('option');
      opt.value = d.user_id || d.id || d.num || d.number;
      
      // Nome e Numero da mostrare a tendina
      const num = d.number || d.race_number || d.num || '';
      const name = d.name || d.fullname || d.driver_name || d.competitor_name || (`Pilota ${opt.value}`);
      
      opt.textContent = num ? `#${num} ${name}` : name;
      
      if (String(opt.value) === String(selectedDriverId)) {
        opt.selected = true;
      }
      select.appendChild(opt);
    });
  }
}

// All'apertura dell'app, ricollegati all'ultima gara
if (currentRaceId) {
  document.getElementById('raceLinkInput').value = `https://stg.mk.time2race.it/race/${currentRaceId}/`;
  connectWebSocket();
}