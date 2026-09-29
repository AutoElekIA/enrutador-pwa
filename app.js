// ============================================
//  Enrutador PWA — Lógica principal
// ============================================

// ---------- 1. Service Worker ----------
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js')
    .then(() => console.log('Service Worker registrado'))
    .catch(err => console.log('Error SW:', err));
}

// ---------- 2. Estado global ----------
let packages = JSON.parse(localStorage.getItem('packages') || '[]');
let currentPhoto = null;
let ocrResultText = '';

// ---------- 3. Elementos del DOM ----------
const btnCapture   = document.getElementById('btnCapture');
const btnOptimize  = document.getElementById('btnOptimize');
const cameraInput  = document.getElementById('cameraInput');
const packagesList = document.getElementById('packagesList');
const addressModal = document.getElementById('addressModal');
const labelPreview = document.getElementById('labelPreview');
const inputRecipient = document.getElementById('inputRecipient');
const inputAddress   = document.getElementById('inputAddress');
const ocrText        = document.getElementById('ocrText');
const btnCancelAddress = document.getElementById('btnCancelAddress');
const btnSaveAddress   = document.getElementById('btnSaveAddress');
const loader      = document.getElementById('loader');
const loaderText  = document.getElementById('loaderText');

// ---------- 4. Utilidades ----------
function showLoader(msg) {
  loaderText.textContent = msg || 'Procesando…';
  loader.hidden = false;
}
function hideLoader() {
  loader.hidden = true;
}
function savePackages() {
  localStorage.setItem('packages', JSON.stringify(packages));
}

// ---------- 5. Renderizar lista de paquetes ----------
function renderPackages() {
  if (packages.length === 0) {
    packagesList.innerHTML = '<p class="empty">Aún no hay paquetes. Captura una etiqueta para comenzar.</p>';
    btnOptimize.disabled = true;
    return;
  }
  packagesList.innerHTML = '';
  packages.forEach((p, i) => {
    const div = document.createElement('div');
    div.className = 'package-item';
    div.innerHTML = `
      <div class="pkg-info">
        <strong>${i + 1}. ${p.recipient || 'Sin nombre'}</strong>
        <span>${p.address}</span>
      </div>
      <button class="pkg-delete" data-index="${i}">🗑️</button>
    `;
    packagesList.appendChild(div);
  });
  // Botones de borrar
  document.querySelectorAll('.pkg-delete').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const idx = parseInt(e.target.dataset.index);
      packages.splice(idx, 1);
      savePackages();
      renderPackages();
    });
  });
  btnOptimize.disabled = packages.length === 0;
}

// ---------- 6. Captura de etiqueta ----------
btnCapture.addEventListener('click', () => {
  cameraInput.click();
});

cameraInput.addEventListener('change', async (e) => {
  if (!e.target.files || e.target.files.length === 0) return;
  const file = e.target.files[0];
  currentPhoto = file;

  // Mostrar vista previa
  const reader = new FileReader();
  reader.onload = (ev) => {
    labelPreview.src = ev.target.result;
  };
  reader.readAsDataURL(file);

  // Abrir modal en modo "cargando"
  inputRecipient.value = '';
  inputAddress.value = '';
  ocrText.textContent = '';
  addressModal.hidden = false;

  // Ejecutar OCR
  showLoader('Leyendo etiqueta…');
  try {
    const { data: { text } } = await Tesseract.recognize(file, 'spa', {
      logger: m => {
        if (m.status === 'recognizing text') {
          loaderText.textContent = `Leyendo… ${Math.round(m.progress * 100)}%`;
        }
      }
    });
    ocrResultText = text || '';
    ocrText.textContent = ocrResultText;

    // Intento simple de extraer dirección y destinatario
    const lineas = ocrResultText.split('\n').map(l => l.trim()).filter(l => l.length > 3);
    inputAddress.value   = detectarDireccion(lineas);
    inputRecipient.value = detectarNombre(lineas);
  } catch (err) {
    console.error('Error OCR:', err);
    ocrText.textContent = 'Error al leer la etiqueta: ' + err.message;
  } finally {
    hideLoader();
    cameraInput.value = '';
  }
});

// ---------- 7. Heurísticas simples de OCR ----------
function detectarDireccion(lineas) {
  // Busca líneas que tengan números y palabras clave de dirección
  const claves = ['calle', 'av', 'avenida', 'col', 'colonia', 'cp', 'c.p', 'no.', 'núm', 'num', 'código postal'];
  for (const l of lineas) {
    const low = l.toLowerCase();
    if (claves.some(k => low.includes(k)) || /\d{4,5}/.test(l)) {
      return l;
    }
  }
  // Si no encuentra, devuelve las dos últimas líneas
  return lineas.slice(-2).join(', ');
}

function detectarNombre(lineas) {
  // La primera línea suele ser el nombre del destinatario
  for (const l of lineas.slice(0, 3)) {
    const low = l.toLowerCase();
    if (!/\d/.test(l) && l.length < 40 && !low.includes('destinatario')) {
      return l;
    }
  }
  return lineas[0] || '';
}

// ---------- 8. Guardar dirección confirmada ----------
btnCancelAddress.addEventListener('click', () => {
  addressModal.hidden = true;
});

btnSaveAddress.addEventListener('click', () => {
  const recipient = inputRecipient.value.trim();
  const address   = inputAddress.value.trim();
  if (!address) {
    alert('Debes escribir una dirección.');
    return;
  }
  packages.push({
    recipient,
    address,
    ocr: ocrResultText,
    coords: null,
    delivered: false,
    createdAt: Date.now()
  });
  savePackages();
  renderPackages();
  addressModal.hidden = true;
});

// ---------- 9. Optimización de ruta (vecino más cercano) ----------
btnOptimize.addEventListener('click', async () => {
  if (packages.length === 0) return;
  showLoader('Geocodificando direcciones…');

  try {
    // Geocodificar cada dirección con Nominatim
    for (const p of packages) {
      if (p.coords) continue; // ya tiene coords
      const url = 'https://nominatim.openstreetmap.org/search?format=json&limit=1&q=' +
                  encodeURIComponent(p.address);
      const r = await fetch(url, {
        headers: { 'Accept-Language': 'es' }
      });
      const data = await r.json();
      if (data && data[0]) {
        p.coords = { lat: parseFloat(data[0].lat), lon: parseFloat(data[0].lon) };
      }
      // Respetar el rate limit de Nominatim (1 req/seg)
      await new Promise(res => setTimeout(res, 1100));
    }

    const validos = packages.filter(p => p.coords);
    if (validos.length === 0) {
      hideLoader();
      alert('No se pudo geocodificar ninguna dirección. Revisa las direcciones.');
      return;
    }

    // Ordenar con vecino más cercano desde la posición actual (o primer punto)
    let rutaOrdenada = [];
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        pos => {
          rutaOrdenada = ordenarPorVecinoMasCercano(
            { lat: pos.coords.latitude, lon: pos.coords.longitude },
            validos
          );
          savePackages();
          renderPackages();
          hideLoader();
          alert('Ruta optimizada. Lista para navegar.');
        },
        err => {
          // Sin geolocalización, ordenar desde el primer punto
          rutaOrdenada = ordenarPorVecinoMasCercano(validos[0].coords, validos);
          savePackages();
          renderPackages();
          hideLoader();
          alert('Ruta optimizada (sin GPS inicial). Lista para navegar.');
        }
      );
    } else {
      rutaOrdenada = ordenarPorVecinoMasCercano(validos[0].coords, validos);
      savePackages();
      renderPackages();
      hideLoader();
    }
  } catch (err) {
    console.error(err);
    hideLoader();
    alert('Error al optimizar: ' + err.message);
  }
});

function ordenarPorVecinoMasCercano(inicio, lista) {
  const restantes = [...lista];
  const orden = [];
  let actual = inicio;
  while (restantes.length > 0) {
    let mejorIdx = 0;
    let mejorDist = Infinity;
    for (let i = 0; i < restantes.length; i++) {
      const d = distancia(actual, restantes[i].coords);
      if (d < mejorDist) { mejorDist = d; mejorIdx = i; }
    }
    const elegido = restantes.splice(mejorIdx, 1)[0];
    orden.push(elegido);
    actual = elegido.coords;
  }
  // Reordenar el array global según el orden calculado
  const nuevosPackages = [];
  for (const p of orden) {
    const idx = packages.indexOf(p);
    if (idx > -1) {
      nuevosPackages.push(p);
      packages.splice(idx, 1);
    }
  }
  packages = [...nuevosPackages, ...packages];
  return packages;
}

function distancia(a, b) {
  const R = 6371;
  const dLat = (b.lat - a.lat) * Math.PI / 180;
  const dLon = (b.lon - a.lon) * Math.PI / 180;
  const x = Math.sin(dLat/2) ** 2 +
            Math.cos(a.lat * Math.PI/180) * Math.cos(b.lat * Math.PI/180) *
            Math.sin(dLon/2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

// ---------- 10. Inicio ----------
document.addEventListener('DOMContentLoaded', () => {
  renderPackages();
});