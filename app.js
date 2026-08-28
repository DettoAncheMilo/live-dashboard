let selectedDriverId = localStorage.getItem('pit_driver_id') || "3";
let currentRaceId = localStorage.getItem('pit_race_id') || "55";
let timingInterval = null;

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
    startTimingLoop();
  } else {
    alert("Inserisci un link valido (es. https://stg.mk.time2race.it/race/55/?user_id=3)");
  }
}

function changeDriver(id) {
  selectedDriverId = id;
  localStorage.setItem('pit_driver_id', id);
  fetchTimingData();
}

async function fetchTimingData() {
  if (!currentRaceId) return; 

  // Endpoint corretto basato sui parametri di ricerca DataTables
  const targetApi = `https://api-stg.mk.time2race.it/api/public/races/?format=datatables&subscription_id=${currentRaceId}`;
  const proxyUrl = `https://corsproxy.io/?${encodeURIComponent(targetApi)}`;

  try {
    const response = await fetch(proxyUrl);
    const result = await response.json();
    
    // DataTables restituisce l'array dei piloti nella proprietà 'data'
    const driversList = result.data || result.results || (Array.isArray(result) ? result : []); 
    
    populateDriverDropdown(driversList);

    if (selectedDriverId) {
      const myDriver = driversList.find(d => 
        String(d.user_id) === String(selectedDriverId) || 
        String(d.id) === String(selectedDriverId) ||
        String(d.subscription_id) === String(selectedDriverId)
      );

      if (myDriver) {
        document.getElementById('pos').innerText = `P${myDriver.position || myDriver.pos || '-'}`;
        document.getElementById('lastLap').innerText = myDriver.last_lap || myDriver.last_lap_time || myDriver.time || '--:--.--';
        document.getElementById('bestLap').innerText = myDriver.best_lap || myDriver.best_lap_time || '--:--.--';
        document.getElementById('gap').innerText = myDriver.gap_to_leader || myDriver.gap || '+0.0';
      }
    }
  } catch (error) {
    console.error("Errore nel recupero dati live:", error);
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
      if (String(opt.value) === String(selectedDriverId)) opt.selected = true;
      select.appendChild(opt);
    });
  }
}

function startTimingLoop() {
  if (timingInterval) clearInterval(timingInterval);
  fetchTimingData();
  timingInterval = setInterval(fetchTimingData, 1500);
}

if (currentRaceId) {
  document.getElementById('raceLinkInput').value = `https://stg.mk.time2race.it/race/${currentRaceId}/?user_id=3`;
  startTimingLoop();
}