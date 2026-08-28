let selectedDriverId = localStorage.getItem('pit_driver_id') || null;
let currentRaceId = localStorage.getItem('pit_race_id') || null;
let timingInterval = null;

// Impedisce allo schermo di spegnersi (fondamentale per l'uso in pista)
if ('wakeLock' in navigator) {
  navigator.wakeLock.request('screen').catch(console.error);
}

// Estrae l'ID dal link incollato dall'utente
function loadNewRace() {
  const inputUrl = document.getElementById('raceLinkInput').value;
  const match = inputUrl.match(/race\/(\d+)/); 
  
  if (match && match[1]) {
    currentRaceId = match[1];
    localStorage.setItem('pit_race_id', currentRaceId);
    document.getElementById('driverSelect').innerHTML = '<option value="">Seleziona Pilota...</option>';
    startTimingLoop();
  } else {
    alert("Link non valido. Assicurati che contenga /race/NUMERO/");
  }
}

function changeDriver(id) {
  selectedDriverId = id;
  localStorage.setItem('pit_driver_id', id);
  fetchTimingData();
}

async function fetchTimingData() {
  if (!currentRaceId) return; 

  // ATTENZIONE: Questo è l'endpoint standard. 
  // Se i dati non caricano, dovrai verificare con Cmd+Option+I il percorso esatto dell'API.
  const API_URL = `https://stg.mk.time2race.it/api/race/${currentRaceId}/live`; 

  try {
    const response = await fetch(API_URL);
    const data = await response.json();
    
    // Adattamento dinamico in base alla struttura del JSON
    const driversList = data.results || data.drivers || data; 
    populateDriverDropdown(driversList);

    if (selectedDriverId) {
      const myDriver = driversList.find(d => String(d.user_id) === String(selectedDriverId) || String(d.id) === String(selectedDriverId));
      if (myDriver) {
        document.getElementById('pos').innerText = `P${myDriver.position || '-'}`;
        document.getElementById('lastLap').innerText = myDriver.last_lap || '--:--.--';
        document.getElementById('bestLap').innerText = myDriver.best_lap || '--:--.--';
        document.getElementById('gap').innerText = myDriver.gap_to_leader || myDriver.gap || '+0.0';
      }
    }
  } catch (error) {
    console.error("In attesa di connessione dati...", error);
  }
}

function populateDriverDropdown(drivers) {
  const select = document.getElementById('driverSelect');
  if (select.options.length <= 1 && drivers.length > 0) {
    select.innerHTML = '<option value="">Seleziona Pilota...</option>';
    drivers.forEach(d => {
      const opt = document.createElement('option');
      opt.value = d.user_id || d.id;
      opt.textContent = `#${d.number || ''} ${d.name || d.driver_name || 'Pilota ' + opt.value}`;
      if (String(opt.value) === String(selectedDriverId)) opt.selected = true;
      select.appendChild(opt);
    });
  }
}

function startTimingLoop() {
  if (timingInterval) clearInterval(timingInterval);
  fetchTimingData();
  timingInterval = setInterval(fetchTimingData, 2000); // Aggiornamento ogni 2 secondi
}

// Riprende automaticamente l'ultima gara salvata
if (currentRaceId) {
  document.getElementById('raceLinkInput').value = `https://stg.mk.time2race.it/race/${currentRaceId}/`;
  startTimingLoop();
}