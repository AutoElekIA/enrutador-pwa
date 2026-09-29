// ============================================
//  Enrutador PWA — Lógica principal (v4 con recorte)
// ============================================

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js')
    .then(() => console.log('SW registrado'))
    .catch(err => console.log('Error SW:', err));
}

let packages = JSON.parse(localStorage.getItem('packages') || '[]');
let ocrResultText = '';
let cropperInstance = null;

// ---------- DOM ----------
const btnCapture   = document.getElementById('btnCapture');
const btnOptimize  = document.getElementById('btnOptimize');
const cameraInput  = document.getElementById('cameraInput');
const packagesList = document.getElementById('packagesList');

const cropModal    = document.getElementById('cropModal');
const cropImage    = document.getElementById('cropImage');
const btnCancelCrop  = document.getElementById('btnCancelCrop');
const btnConfirmCrop = document.getElementById('btnConfirmCrop');

const addressModal = document.getElementById('addressModal');
const labelPreview = document.getElementById('labelPreview');
const inputRecipient = document.getElementById('inputRecipient');
const inputAddress   = document.getElementById('inputAddress');
const ocrText        = document.getElementById('ocrText');
const btnCancelAddress = document.getElementById('btnCancelAddress');
const btnSaveAddress   = document.getElementById('btnSaveAddress');

const loader      = document.getElementById('loader');
const loaderText  = document.getElementById('loaderText');

// ---------- Utilidades ----------
function showLoader(msg) {
  loaderText.textContent = msg || 'Procesando…';
  loader.hidden = false;
}
function hideLoader() { loader.hidden = true; }
function savePackages() {
  localStorage.setItem('packages', JSON.stringify(packages));
}

// ---------- Render lista ----------
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

// ---------- Captura de foto ----------
btnCapture.addEventListener('click', () => cameraInput.click());

cameraInput.addEventListener('change', (e) => {
  if (!e.target.files || e.target.files.length === 0) return;
  const file = e.target.files[0];

  // Mostrar foto en el modal de recorte
  const reader = new FileReader();
  reader.onload = (ev) => {
    cropImage.src = ev.target.result;
    cropModal.hidden = false;

    // Destruir instancia previa si existe
    if (cropperInstance) {
      cropperInstance.destroy();
      cropperInstance = null;
    }

    // Esperar un instante a que la imagen cargue en el DOM
    setTimeout(() => {
      cropperInstance = new Cropper(cropImage, {
        viewMode: 1,
        autoCropArea: 0.7,
        movable: true,
        zoomable: true,
        rotatable: true,
        scalable: false,
        background: false,
        responsive: true
      });
    }, 100);
  };
  reader.readAsDataURL(file);
});

// ---------- Cancelar recorte ----------
btnCancelCrop.addEventListener('click', () => {
  if (cropperInstance) {
    cropperInstance.destroy();
    cropperInstance = null;
  }
  cropModal.hidden = true;
  cameraInput.value = '';
});

// ---------- Confirmar recorte → OCR ----------
btnConfirmCrop.addEventListener('click', async () => {
  if (!cropperInstance) return;

  // Obtener el recorte como canvas
  const canvas = cropperInstance.getCroppedCanvas({
    maxWidth: 1200,
    maxHeight: 1200,
    imageSmoothingEnabled: true,
    imageSmoothingQuality: 'high'
  });

  if (!canvas) {
    alert('No se pudo recortar la imagen.');
    return;
  }

  // Vista previa del recorte en el modal de dirección
  labelPreview.src = canvas.toDataURL('image/jpeg', 0.85);

  // Cerrar modal de recorte
  cropperInstance.destroy();
  cropperInstance = null;
  cropModal.hidden = true;

  // Preparar modal de dirección
  inputRecipient.value = '';
  inputAddress.value = '';
  ocrText.textContent = '';
  addressModal.hidden = false;

  showLoader('Iniciando OCR…');
  let cancelado = false;
  const timeoutId = setTimeout(() => {
    cancelado = true;
    hideLoader();
    alert('El OCR tardó demasiado. Intenta con una foto más cercana o con mejor luz.');
  }, 90000);

  try {
    // Convertir canvas a Blob (más eficiente)
    const blob = await new Promise(res => canvas.toBlob(res, 'image/jpeg', 0.9));

    const resultado = await Tesseract.recognize(blob, 'spa', {
      logger: m => {
        if (cancelado) return;
        if (m.status === 'loading tesseract core')  loaderText.textContent = 'Cargando motor OCR…';
        else if (m.status === 'loading language traineddata') loaderText.textContent = 'Descargando idioma (1ª vez)…';
        else if (m.status === 'initializing api')   loaderText.textContent = 'Inicializando…';
        else if (m.status === 'recognizing text')   loaderText.textContent = `Leyendo… ${Math.round(m.progress * 100)}%`;
      }
    });

    clearTimeout(timeoutId);
    if (cancelado) return;

    ocrResultText = resultado.data.text || '';
    ocrText.textContent = ocrResultText;

    const lineas = ocrResultText.split('\n').map(l => l.trim()).filter(l => l.length > 3);
    inputAddress.value   = detectarDireccion(lineas);
    inputRecipient.value = detectarNombre(lineas);

  } catch (err) {
    clearTimeout(timeoutId);
    console.error('Error OCR:', err);
    ocrText.textContent = 'Error al leer la etiqueta: ' + err.message;
    alert('Error de OCR: ' + err.message);
  } finally {
    clearTimeout(timeoutId);
    hideLoader();
    cameraInput.value = '';
  }
});

// ---------- Heurísticas ----------
function detectarDireccion(lineas) {
  const claves = ['calle', 'av', 'avenida', 'col', 'colonia', 'cp', 'c.p', 'no.', 'núm', 'num', 'código postal'];
  for (const l of lineas) {
    const low = l.toLowerCase();
    if (claves.some(k => low.includes(k)) || /\d{4,5}/.test(l)) return l;
  }
  return lineas.slice(-2).join(', ');
}

function detectarNombre(lineas) {
  for (const l of lineas.slice(0, 3)) {
    const low = l.toLowerCase();
    if (!/\d/.test(l) && l.length < 40 && !low.includes('destinatario')) return l;
  }
  return lineas[0] || '';
}

// ---------- Guardar paquete ----------
btnCancelAddress.addEventListener('click', () => { addressModal.hidden = true; });

btnSaveAddress.addEventListener('click', () => {
  const recipient = inputRecipient.value.trim();
  const address   = inputAddress.value.trim();
  if (!address) { alert('Debes escribir una dirección.'); return; }
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

// ---------- Optimizar ruta ----------
btnOptimize.addEventListener('click', async () => {
  if (packages.length === 0) return;
  showLoader('Geocodificando direcciones…');
  try {
    for (const p of packages) {
      if (p.coords) continue;
      const url = 'https://nominatim.openstreetmap.org/search?format=json&limit=1&q=' +
                  encodeURIComponent(p.address);
      const r = await fetch(url, { headers: { 'Accept-Language': 'es' } });
      const data = await r.json();
      if (data && data[0]) {
        p.coords = { lat: parseFloat(data[0].lat), lon: parseFloat(data[0].lon) };
      }
      await new Promise(res => setTimeout(res, 1100));
    }
    const validos = packages.filter(p => p.coords);
    if (validos.length === 0) {
      hideLoader();
      alert('No se pudo geocodificar ninguna dirección.');
      return;
    }
    const continuar = (origen) => {
      ordenarPorVecinoMasCercano(origen, validos);
      savePackages();
      renderPackages();
      hideLoader();
      alert('Ruta optimizada. Lista para navegar.');
    };
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        pos => continuar({ lat: pos.coords.latitude, lon: pos.coords.longitude }),
        () => continuar(validos[0].coords)
      );
    } else {
      continuar(validos[0].coords);
    }
  } catch (err) {
    hideLoader();
    alert('Error al optimizar: ' + err.message);
  }
});

function ordenarPorVecinoMasCercano(inicio, lista) {
  const restantes = [...lista];
  const orden = [];
  let actual = inicio;
  while (restantes.length > 0) {
    let mejorIdx = 0, mejorDist = Infinity;
    for (let i = 0; i < restantes.length; i++) {
      const d = distancia(actual, restantes[i].coords);
      if (d < mejorDist) { mejorDist = d; mejorIdx = i; }
    }
    const elegido = restantes.splice(mejorIdx, 1)[0];
    orden.push(elegido);
    actual = elegido.coords;
  }
  const nuevos = [];
  for (const p of orden) {
    const idx = packages.indexOf(p);
    if (idx > -1) { nuevos.push(p); packages.splice(idx, 1); }
  }
  packages = [...nuevos, ...packages];
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

// ---------- Init ----------
document.addEventListener('DOMContentLoaded', () => renderPackages());