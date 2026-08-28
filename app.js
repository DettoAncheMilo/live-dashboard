let selectedDriverId = localStorage.getItem('pit_driver_id') || null;
let currentRaceId = localStorage.getItem('pit_race_id') || null;
let timingInterval = null;

// Impedisce allo schermo di spegnersi durante la sessione
if ('wakeLock' in navigator) {
  navigator.wakeLock.request('screen').catch(console.error);
}

// Estrae l'ID gara dal link (es. se incolli https://stg.mk.time2race.it/race/24/ estrae "24")
function loadNewRace() {
  const inputUrl = document.getElementById('raceLinkInput').value;
  const match = inputUrl.match(/race\/(\d+)/); 
  
  if (match && match[1]) {
    currentRaceId = match[1];
    localStorage.setItem('pit_race_id', currentRaceId);
    document.getElementById('driverSelect').innerHTML = '<option value="">Seleziona Pilota...</option>';
    startTimingLoop();
  } else {
    alert("Inserisci un link valido di Time2Race che contenga /race/NUMERO/");
  }
}

function changeDriver(id) {
  selectedDriverId = id;
  localStorage.setItem('pit_driver_id', id);
  fetchTimingData();
}

async function fetchTimingData() {
  if (!currentRaceId) return; 

  // Indirizzo ufficiale API Time2Race basato sulla struttura del loro server
  const API_URL = `https://api-stg.mk.time2race.it/api/public/races/${currentRaceId}/`; 

  try {
    const response = await fetch(API_URL);
    const data = await response.json();
    
    // Time2Race restituisce la lista piloti dentro 'results', 'drivers' o direttamente nell'oggetto
    const driversList = data.results || data.drivers || data.rankings || (Array.isArray(data) ? data : []); 
    
    populateDriverDropdown(driversList);

    if (selectedDriverId) {
      const myDriver = driversList.find(d => 
        String(d.user_id) === String(selectedDriverId) || 
        String(d.id) === String(selectedDriverId) ||
        String(d.subscription_id) === String(selectedDriverId)
      );

      if (myDriver) {
        document.getElementById('pos').innerText = `P${myDriver.position || myDriver.pos || '-'}`;
        document.getElementById('lastLap').innerText = myDriver.last_lap || myDriver.last_lap_time || '--:--.--';
        document.getElementById('bestLap').innerText = myDriver.best_lap || myDriver.best_lap_time || '--:--.--';
        document.getElementById('gap').innerText = myDriver.gap_to_leader || myDriver.gap || '+0.0';
      }
    }
  } catch (error) {
    console.error("Connessione API in corso...", error);
  }
}

function populateDriverDropdown(drivers) {
  const select = document.getElementById('driverSelect');
  if (select.options.length <= 1 && drivers.length > 0) {
    select.innerHTML = '<option value="">Seleziona Pilota...</option>';
    drivers.forEach(d => {
      const opt = document.createElement('option');
      opt.value = d.user_id || d.id || d.subscription_id;
      const num = d.number || d.race_number || '';
      const name = d.name || d.fullname || d.driver_name || (`Pilota ${opt.value}`);
      
      opt.textContent = num ? `#${num} ${name}` : name;
      
      if (String(opt.value) === String(selectedDriverId)) {
        opt.selected = true;
      }
      select.appendChild(opt);
    });
  }
}

function startTimingLoop() {
  if (timingInterval) clearInterval(timingInterval);
  fetchTimingData();
  timingInterval = setInterval(fetchTimingData, 1500); // Polling ogni 1.5 secondi
}

// All'apertura riprende l'ultima gara salvata
if (currentRaceId) {
  document.getElementById('raceLinkInput').value = `https://stg.mk.time2race.it/race/${currentRaceId}/`;
  startTimingLoop();
}