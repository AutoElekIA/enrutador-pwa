// ============================================
//  Enrutador PWA — Lógica principal (v19)
//  Con navegación: mapa, pines, voz y Google Maps
// ============================================

const MI_VERSION = 'v19-2026-10-01';

// ---------- Referencias DOM ----------
const btnCapture   = document.getElementById('btnCapture');
const btnOptimize  = document.getElementById('btnOptimize');
const btnSettings  = document.getElementById('btnSettings');
const cameraInput  = document.getElementById('cameraInput');
const packagesList = document.getElementById('packagesList');

const viewHome = document.getElementById('viewHome');
const viewMap  = document.getElementById('viewMap');
const btnExitNav = document.getElementById('btnExitNav');

const cropModal      = document.getElementById('cropModal');
const cropImage      = document.getElementById('cropImage');
const btnCancelCrop  = document.getElementById('btnCancelCrop');
const btnConfirmCrop = document.getElementById('btnConfirmCrop');
const btnRotate      = document.getElementById('btnRotate');
const btnWide        = document.getElementById('btnWide');
const btnSquare      = document.getElementById('btnSquare');
const btnFree        = document.getElementById('btnFree');

const addressModal    = document.getElementById('addressModal');
const labelPreview    = document.getElementById('labelPreview');
const inputRecipient  = document.getElementById('inputRecipient');
const inputAddress    = document.getElementById('inputAddress');
const ocrText         = document.getElementById('ocrText');
const btnCancelAddress = document.getElementById('btnCancelAddress');
const btnSaveAddress   = document.getElementById('btnSaveAddress');

const settingsModal      = document.getElementById('settingsModal');
const inputApiKey        = document.getElementById('inputApiKey');
const btnCancelSettings  = document.getElementById('btnCancelSettings');
const btnSaveSettings    = document.getElementById('btnSaveSettings');

const loader     = document.getElementById('loader');
const loaderText = document.getElementById('loaderText');

const navCurrentStop = document.getElementById('navCurrentStop');
const navInstruction = document.getElementById('navInstruction');
const navDistance    = document.getElementById('navDistance');
const navEta         = document.getElementById('navEta');
const btnRepeat      = document.getElementById('btnRepeat');
const btnOpenMaps    = document.getElementById('btnOpenMaps');
const btnNext        = document.getElementById('btnNext');

const versionTag = document.getElementById('versionTag');
if (versionTag) versionTag.textContent = MI_VERSION;

// ---------- Estado ----------
let packages = JSON.parse(localStorage.getItem('packages') || '[]');
let ocrResultText = '';
let cropperInstance = null;
let rotacionActual = 0;

// Estado de navegación
let mapInstance = null;
let mapMarkers = [];
let mapRouteLine = null;
let currentStopIndex = 0;
let userLocation = null;
let watchId = null;

// ---------- Utilidades ----------
function showLoader(msg) {
  loaderText.textContent = msg || 'Procesando…';
  loader.hidden = false;
}
function hideLoader() { loader.hidden = true; }
function savePackages() { localStorage.setItem('packages', JSON.stringify(packages)); }
function getApiKey() { return localStorage.getItem('ocrspace_key') || ''; }
function setApiKey(key) { localStorage.setItem('ocrspace_key', key.trim()); }

// ---------- Imagen: reducir peso ----------
function canvasABlobLigero(canvas) {
  return new Promise(function(resolve) {
    canvas.toBlob(function(blob) {
      if (blob && blob.size <= 950000) { resolve(blob); return; }
      canvas.toBlob(function(b2) {
        resolve(b2 || blob);
      }, 'image/jpeg', 0.7);
    }, 'image/jpeg', 0.85);
  });
}

// ---------- OCR.space ----------
async function ocrSpaceReconocer(canvas, apiKey) {
  const blob = await canvasABlobLigero(canvas);

  const debugInfo = [];
  debugInfo.push('🖼️ Blob: ' + blob.size + ' bytes (' + (blob.size/1024).toFixed(1) + ' KB)');
  debugInfo.push('🔑 API key: ' + (apiKey ? apiKey.substring(0, 8) + '...' : '❌ VACÍA'));
  debugInfo.push('');

  const formData = new FormData();
  formData.append('apikey', apiKey);
  formData.append('language', 'spa');
  formData.append('isOverlayRequired', 'false');
  formData.append('OCREngine', '2');
  formData.append('scale', 'true');
  formData.append('detectOrientation', 'true');
  formData.append('file', blob, 'etiqueta.jpg');

  let resp, data;
  try {
    resp = await fetch('https://api.ocr.space/parse/image', { method: 'POST', body: formData });
    debugInfo.push('📡 HTTP status: ' + resp.status);
  } catch (err) {
    debugInfo.push('❌ Error de red: ' + err.message);
    const e = new Error(debugInfo.join('\n')); e.detalleDebug = true; throw e;
  }

  try {
    data = await resp.json();
  } catch (err) {
    debugInfo.push('❌ Respuesta no es JSON');
    const e = new Error(debugInfo.join('\n')); e.detalleDebug = true; throw e;
  }

  debugInfo.push('OCRExitCode: ' + (data.OCRExitCode !== undefined ? data.OCRExitCode : 'N/A'));
  debugInfo.push('IsErroredOnProcessing: ' + data.IsErroredOnProcessing);
  if (data.ErrorMessage) debugInfo.push('ErrorMessage: ' + JSON.stringify(data.ErrorMessage));
  debugInfo.push('');

  if (data.IsErroredOnProcessing) {
    debugInfo.push('❌ OCR.space reportó error.');
    debugInfo.push('Respuesta completa:');
    debugInfo.push(JSON.stringify(data, null, 2));
    const e = new Error(debugInfo.join('\n')); e.detalleDebug = true; throw e;
  }

  if (!data.ParsedResults || !data.ParsedResults.length) {
    debugInfo.push('❌ Sin ParsedResults.');
    debugInfo.push(JSON.stringify(data, null, 2));
    const e = new Error(debugInfo.join('\n')); e.detalleDebug = true; throw e;
  }

  const parsed = data.ParsedResults[0];
  debugInfo.push('📝 ParsedText length: ' + (parsed.ParsedText ? parsed.ParsedText.length : 0));
  debugInfo.push('');
  debugInfo.push('=== TEXTO RECONOCIDO ===');
  debugInfo.push(parsed.ParsedText || '(vacío)');

  const resultado = parsed.ParsedText || '';
  if (resultado && resultado.trim().length > 0) return resultado;

  const e = new Error(debugInfo.join('\n')); e.detalleDebug = true; throw e;
}

// ---------- Render lista ----------
function renderPackages() {
  if (packages.length === 0) {
    packagesList.innerHTML = '<p class="empty">Aún no hay paquetes. Captura una etiqueta para comenzar.</p>';
    btnOptimize.disabled = true;
    return;
  }
  packagesList.innerHTML = '';
  packages.forEach(function(p, i) {
    const div = document.createElement('div');
    div.className = 'package-item';
    div.innerHTML =
      '<div class="pkg-info">' +
        '<strong>' + (i + 1) + '. ' + (p.recipient || 'Sin nombre') + '</strong>' +
        '<span>' + p.address + '</span>' +
      '</div>' +
      '<button class="pkg-delete" data-index="' + i + '">🗑️</button>';
    packagesList.appendChild(div);
  });
  document.querySelectorAll('.pkg-delete').forEach(function(btn) {
    btn.addEventListener('click', function(e) {
      const idx = parseInt(e.target.dataset.index);
      packages.splice(idx, 1);
      savePackages();
      renderPackages();
    });
  });
  btnOptimize.disabled = packages.length === 0;
}

// ---------- Captura ----------
btnCapture.addEventListener('click', function() {
  if (!getApiKey()) {
    alert('Primero configura tu API key de OCR.space en Ajustes ⚙️');
    return;
  }
  cameraInput.click();
});

cameraInput.addEventListener('change', function(e) {
  if (!e.target.files || e.target.files.length === 0) return;
  const file = e.target.files[0];
  const reader = new FileReader();
  reader.onload = function(ev) {
    cropImage.src = ev.target.result;
    cropModal.hidden = false;
    rotacionActual = 0;
    if (cropperInstance) { cropperInstance.destroy(); cropperInstance = null; }
    setTimeout(function() {
      cropperInstance = new Cropper(cropImage, {
        viewMode: 1, aspectRatio: 2.5, autoCropArea: 0.9,
        movable: true, zoomable: true, rotatable: true,
        scalable: false, background: false, responsive: true
      });
    }, 100);
  };
  reader.readAsDataURL(file);
});

// ---------- Controles recorte ----------
btnRotate.addEventListener('click', function() {
  if (!cropperInstance) return;
  rotacionActual = (rotacionActual + 90) % 360;
  cropperInstance.rotate(rotacionActual);
});
btnWide.addEventListener('click', function() { if (cropperInstance) cropperInstance.setAspectRatio(2.5); });
btnSquare.addEventListener('click', function() { if (cropperInstance) cropperInstance.setAspectRatio(1); });
btnFree.addEventListener('click', function() { if (cropperInstance) cropperInstance.setAspectRatio(NaN); });

btnCancelCrop.addEventListener('click', function() {
  if (cropperInstance) { cropperInstance.destroy(); cropperInstance = null; }
  cropModal.hidden = true;
  cameraInput.value = '';
  rotacionActual = 0;
});

// ---------- Confirmar recorte ----------
btnConfirmCrop.addEventListener('click', async function() {
  if (!cropperInstance) return;

  const canvasRecortado = cropperInstance.getCroppedCanvas({
    maxWidth: 2000, maxHeight: 2000,
    imageSmoothingEnabled: true, imageSmoothingQuality: 'high'
  });
  if (!canvasRecortado) { alert('No se pudo recortar la imagen.'); return; }

  labelPreview.src = canvasRecortado.toDataURL('image/jpeg', 0.9);

  cropperInstance.destroy();
  cropperInstance = null;
  cropModal.hidden = true;
  rotacionActual = 0;

  inputRecipient.value = '';
  inputAddress.value = '';
  ocrText.textContent = '';
  addressModal.hidden = false;

  showLoader('Enviando a OCR.space…');

  try {
    const texto = await ocrSpaceReconocer(canvasRecortado, getApiKey());
    ocrResultText = texto;
    ocrText.textContent = texto;
    inputAddress.value   = detectarDireccion(texto);
    inputRecipient.value = detectarNombre(texto);
  } catch (err) {
    console.error('Error OCR:', err);
    ocrText.textContent = err.detalleDebug ? err.message : ('Error: ' + err.message);
    alert('OCR falló. Toca "Texto OCR completo" para ver detalles.');
  } finally {
    hideLoader();
    cameraInput.value = '';
  }
});

// ---------- Correcciones OCR ----------
const CORRECCIONES_OCR = [
  [/\bMETEPECCP\b/gi, 'METEPEC, CP'],
  [/\b([A-ZÁÉÍÓÚÑ]{4,})CP\.?\s*(\d{5})/g, '$1, CP $2'],
  [/\bCP\.?\s*(\d{5})/gi, 'CP $1'],
  [/\bSANTA\s+MARIA\b/gi, 'Santa María'],
  [/\bSAN\s+MIGUEL\b/gi, 'San Miguel']
];

function aplicarCorrecciones(texto) {
  let t = texto;
  for (let i = 0; i < CORRECCIONES_OCR.length; i++) {
    t = t.replace(CORRECCIONES_OCR[i][0], CORRECCIONES_OCR[i][1]);
  }
  return t;
}

// ---------- Heurísticas ----------
function limpiarDireccion(s) {
  return s.replace(/\s+/g, ' ').replace(/\s*,\s*/g, ', ').replace(/[.,;]+$/, '').trim();
}

function detectarDireccion(texto) {
  let t = aplicarCorrecciones(texto).replace(/[""«»]/g, '"').replace(/[|]/g, 'I');
  const lineas = t.split('\n').map(function(l) { return l.trim(); }).filter(function(l) { return l.length > 2; });
  if (lineas.length === 0) return '';
  const textoCompleto = lineas.join(' ');

  const matchDir = textoCompleto.match(/(?:direcci[oó]n\s*(?:completa)?[:\s]+)(.+)/i);
  if (matchDir && matchDir[1].trim().length > 10) return limpiarDireccion(matchDir[1].trim());

  const matchCP = textoCompleto.match(/\b(\d{5})\b/);
  let idxCP = -1;
  if (matchCP) {
    idxCP = lineas.findIndex(function(l) { return l.indexOf(matchCP[1]) !== -1; });
  }
  if (idxCP > -1) {
    const inicio = Math.max(0, idxCP - 3);
    const fin = Math.min(lineas.length, idxCP + 1);
    return limpiarDireccion(lineas.slice(inicio, fin).join(', '));
  }
  return limpiarDireccion(lineas.slice(0, 5).join(', '));
}

function detectarNombre(texto) {
  const lineas = texto.split('\n').map(function(l) { return l.trim(); }).filter(function(l) { return l.length > 2; });
  if (lineas.length === 0) return '';
  for (let i = 0; i < lineas.length; i++) {
    const m = lineas[i].match(/(?:destinatario|nombre|para)[:\s]+(.+)/i);
    if (m && m[1].trim().length > 2) return m[1].trim();
  }
  const prohibidas = ['direcc', 'calle', 'colonia', 'envio', 'envío', 'guia', 'guía',
                      'paquete', 'remitente', 'cp', 'código', 'codigo', 'tel',
                      'teléfono', 'camino', 'av.', 'avenida', 'metepec', 'méxico',
                      'mexico', 'santa', 'san', 'maría', 'magdalena', 'zacango',
                      'forestal', 'dreams', 'lagoons', 'privada', 'framboyanes',
                      'totocuitlapilco', 'toluca', 'coacalco', 'tultitlán',
                      'higuera', 'boulevard', 'rosas', 'villa', 'flores'];
  for (let i = 0; i < Math.min(5, lineas.length); i++) {
    const l = lineas[i];
    const low = l.toLowerCase();
    let tieneProhibida = false;
    for (let j = 0; j < prohibidas.length; j++) {
      if (low.indexOf(prohibidas[j]) !== -1) { tieneProhibida = true; break; }
    }
    const sinNumeros = !/\d/.test(l);
    const tieneForma = /^[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+(\s+[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+){1,3}$/.test(l);
    if (!tieneProhibida && sinNumeros && tieneForma) return l;
  }
  return '';
}

// ---------- Ajustes ----------
btnSettings.addEventListener('click', function() {
  inputApiKey.value = getApiKey();
  settingsModal.hidden = false;
});
btnCancelSettings.addEventListener('click', function() { settingsModal.hidden = true; });
btnSaveSettings.addEventListener('click', function() {
  const key = inputApiKey.value.trim();
  if (!key) { alert('Ingresa una key válida.'); return; }
  setApiKey(key);
  settingsModal.hidden = true;
  alert('Key guardada correctamente.');
});

// ---------- Guardar paquete ----------
btnCancelAddress.addEventListener('click', function() { addressModal.hidden = true; });
btnSaveAddress.addEventListener('click', function() {
  const recipient = inputRecipient.value.trim();
  const address   = inputAddress.value.trim();
  if (!address) { alert('Debes escribir una dirección.'); return; }
  packages.push({
    recipient: recipient,
    address: address,
    ocr: ocrResultText,
    coords: null,
    delivered: false,
    createdAt: Date.now()
  });
  savePackages();
  renderPackages();
  addressModal.hidden = true;
});

// ---------- Geocodificación ----------
function extraerCP(direccion) {
  const m = direccion.match(/\b(\d{5})\b/);
  return m ? m[1] : '';
}

function extraerCiudad(direccion) {
  const ciudades = [
    'Coacalco de Berriozábal', 'Coacalco', 'Tultitlán',
    'San Mateo Atenco', 'Cuautitlán Izcalli', 'Cuautitlán',
    'Metepec', 'Toluca', 'Zinacantepec', 'Lerma',
    'Calimaya', 'Mexicaltzingo', 'Chapultepec',
    'Ecatepec', 'Tlalnepantla', 'Naucalpan', 'Atizapán',
    'Nezahualcóyotl', 'Chimalhuacán', 'Texcoco',
    'Ixtapaluca', 'Chalco', 'Tecámac', 'Acolman'
  ];
  const ordenadas = ciudades.slice().sort(function(a, b) { return b.length - a.length; });
  for (let i = 0; i < ordenadas.length; i++) {
    if (new RegExp('\\b' + ordenadas[i] + '\\b', 'i').test(direccion)) return ordenadas[i];
  }
  return '';
}

async function geocodificarConNominatim(consulta) {
  const url = 'https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=mx&q=' + encodeURIComponent(consulta);
  const r = await fetch(url, { cache: 'no-store' });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const data = await r.json();
  if (data && data[0]) {
    return {
      lat: parseFloat(data[0].lat),
      lon: parseFloat(data[0].lon),
      display: data[0].display_name,
      query: consulta
    };
  }
  return null;
}

async function geocodificarDireccion(direccion) {
  const cp = extraerCP(direccion);
  const ciudad = extraerCiudad(direccion);
  const variantes = [];
  if (cp) variantes.push(cp);
  if (cp && ciudad) variantes.push(cp + ', ' + ciudad + ', México');
  if (ciudad) variantes.push(ciudad + ', Estado de México, México');

  const intentos = [];
  for (let i = 0; i < variantes.length; i++) {
    const consulta = variantes[i];
    try {
      const resultado = await geocodificarConNominatim(consulta);
      if (resultado) return resultado;
      intentos.push('❌ "' + consulta + '" → sin resultados');
    } catch (err) {
      intentos.push('⚠️ "' + consulta + '" → ' + err.message);
    }
    await new Promise(function(res) { setTimeout(res, 1200); });
  }
  const err = new Error('No se encontró.\n' + intentos.join('\n'));
  err.intentos = intentos;
  throw err;
}

// ---------- Optimizar ruta → ir al mapa ----------
btnOptimize.addEventListener('click', async function() {
  if (packages.length === 0) return;
  showLoader('Geocodificando direcciones…');
  const errores = [];

  try {
    for (let i = 0; i < packages.length; i++) {
      const p = packages[i];
      if (p.coords) continue;
      loaderText.textContent = 'Geocodificando ' + (i + 1) + '/' + packages.length + '…';
      try {
        const resultado = await geocodificarDireccion(p.address);
        p.coords = { lat: resultado.lat, lon: resultado.lon };
        p.geocodedAs = resultado.display;
      } catch (err) {
        errores.push({ address: p.address, detalles: err.intentos || [err.message] });
      }
    }

    const validos = packages.filter(function(p) { return p.coords; });
    const fallidos = packages.filter(function(p) { return !p.coords; });

    if (validos.length === 0) {
      hideLoader();
      alert('No se pudo geocodificar ninguna dirección.');
      return;
    }

    // Ordenar por cercanía
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        function(pos) {
          userLocation = { lat: pos.coords.latitude, lon: pos.coords.longitude };
          ordenarPorVecinoMasCercano(userLocation, validos);
          savePackages();
          hideLoader();
          currentStopIndex = 0;
          mostrarVistaMapa();
          if (fallidos.length > 0) {
            setTimeout(function() { alert('Ruta lista. ' + fallidos.length + ' dirección(es) omitidas.'); }, 500);
          }
        },
        function() {
          ordenarPorVecinoMasCercano(validos[0].coords, validos);
          savePackages();
          hideLoader();
          currentStopIndex = 0;
          mostrarVistaMapa();
          setTimeout(function() { alert('Ruta lista (sin GPS). ' + fallidos.length + ' omitidas.'); }, 500);
        }
      );
    } else {
      ordenarPorVecinoMasCercano(validos[0].coords, validos);
      savePackages();
      hideLoader();
      currentStopIndex = 0;
      mostrarVistaMapa();
    }
  } catch (err) {
    hideLoader();
    alert('Error al optimizar: ' + err.message);
  }
});

// ---------- Vista de mapa ----------
function mostrarVistaMapa() {
  viewHome.hidden = true;
  viewMap.hidden = false;

  // Si ya hay mapa, solo invalidar tamaño
  if (mapInstance) {
    setTimeout(function() {
      mapInstance.invalidateSize();
      redibujarRuta();
    }, 150);
  } else {
    setTimeout(inicializarMapa, 150);
  }

  // Iniciar seguimiento GPS
  if (navigator.geolocation && !watchId) {
    watchId = navigator.geolocation.watchPosition(
      function(pos) {
        userLocation = { lat: pos.coords.latitude, lon: pos.coords.longitude };
        if (mapInstance) redibujarRuta();
      },
      function() { /* sin GPS */ },
      { enableHighAccuracy: true, maximumAge: 10000, timeout: 15000 }
    );
  }
}

function inicializarMapa() {
  mapInstance = L.map('map').setView([19.4, -99.1], 12);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap',
    maxZoom: 19
  }).addTo(mapInstance);
  redibujarRuta();
}

function redibujarRuta() {
  if (!mapInstance) return;

  // Limpiar
  mapMarkers.forEach(function(m) { mapInstance.removeLayer(m); });
  mapMarkers = [];
  if (mapRouteLine) { mapInstance.removeLayer(mapRouteLine); mapRouteLine = null; }

  const coords = [];

  // Marcador de usuario
  if (userLocation) {
    const userIcon = L.divIcon({
      className: 'user-marker',
      html: '🔵',
      iconSize: [20, 20],
      iconAnchor: [10, 10]
    });
    const userMarker = L.marker([userLocation.lat, userLocation.lon], { icon: userIcon })
      .bindPopup('📍 Tu ubicación actual');
    userMarker.addTo(mapInstance);
    mapMarkers.push(userMarker);
    coords.push([userLocation.lat, userLocation.lon]);
  }

  // Marcadores de paradas
  const validos = packages.filter(function(p) { return p.coords; });
  validos.forEach(function(p, i) {
    const icono = L.divIcon({
      className: 'stop-marker',
      html: '<div class="stop-pin"><span>' + (i + 1) + '</span></div>',
      iconSize: [30, 30],
      iconAnchor: [15, 30]
    });
    const marker = L.marker([p.coords.lat, p.coords.lon], { icon: icono })
      .bindPopup('<strong>' + (i + 1) + '. ' + (p.recipient || 'Sin nombre') + '</strong><br>' + p.address);
    marker.addTo(mapInstance);
    mapMarkers.push(marker);
    coords.push([p.coords.lat, p.coords.lon]);
  });

  // Línea de ruta
  if (coords.length > 1) {
    mapRouteLine = L.polyline(coords, {
      color: '#22c55e', weight: 4, dashArray: '8, 8', opacity: 0.8
    }).addTo(mapInstance);
    mapInstance.fitBounds(mapRouteLine.getBounds(), { padding: [60, 60] });
  } else if (coords.length === 1) {
    mapInstance.setView(coords[0], 15);
  }

  actualizarPanelNavegacion();
}

function actualizarPanelNavegacion() {
  const validos = packages.filter(function(p) { return p.coords; });
  if (validos.length === 0) return;

  const actual = validos[currentStopIndex];
  if (!actual) {
    navCurrentStop.textContent = '✓ Completado';
    navInstruction.textContent = '🎉 Todas las paradas completadas';
    navDistance.textContent = '—';
    navEta.textContent = '—';
    return;
  }

  navCurrentStop.textContent = 'Parada ' + (currentStopIndex + 1) + ' de ' + validos.length;
  navInstruction.innerHTML =
    '<strong>' + (actual.recipient || 'Sin nombre') + '</strong><br>' +
    '<small>' + actual.address + '</small>';

  if (userLocation) {
    const dist = distancia(userLocation, actual.coords);
    navDistance.textContent = '📏 ' + dist.toFixed(1) + ' km';
    const min = Math.round((dist / 30) * 60);
    navEta.textContent = '⏱️ ~' + min + ' min';
  } else {
    navDistance.textContent = '📏 —';
    navEta.textContent = '⏱️ —';
  }
}

// ---------- Botones de navegación ----------
btnExitNav.addEventListener('click', function() {
  if (watchId) {
    navigator.geolocation.clearWatch(watchId);
    watchId = null;
  }
  viewMap.hidden = true;
  viewHome.hidden = false;
});

btnRepeat.addEventListener('click', function() {
  const validos = packages.filter(function(p) { return p.coords; });
  const actual = validos[currentStopIndex];
  if (!actual) return;

  if (!('speechSynthesis' in window)) {
    alert('Tu navegador no soporta voz.');
    return;
  }

  let texto = 'Parada ' + (currentStopIndex + 1) + ' de ' + validos.length + '. ';
  if (actual.recipient) texto += 'Para ' + actual.recipient + '. ';
  texto += actual.address + '.';
  if (userLocation) {
    const dist = distancia(userLocation, actual.coords);
    texto += ' Está a ' + dist.toFixed(1) + ' kilómetros.';
  }

  const utt = new SpeechSynthesisUtterance(texto);
  utt.lang = 'es-MX';
  utt.rate = 0.95;
  speechSynthesis.cancel();
  speechSynthesis.speak(utt);
});

btnOpenMaps.addEventListener('click', function() {
  const validos = packages.filter(function(p) { return p.coords; });
  const actual = validos[currentStopIndex];
  if (!actual) return;
  const url = 'https://www.google.com/maps/dir/?api=1&destination=' +
              actual.coords.lat + ',' + actual.coords.lon + '&travelmode=driving';
  window.open(url, '_blank');
});

btnNext.addEventListener('click', function() {
  const validos = packages.filter(function(p) { return p.coords; });
  const actual = validos[currentStopIndex];
  if (!actual) return;

  if (!confirm('¿Marcar como entregado?\n\n' + (actual.recipient || 'Sin nombre') + '\n' + actual.address)) return;

  // Eliminar del array
  actual.delivered = true;
  const idx = packages.indexOf(actual);
  if (idx > -1) packages.splice(idx, 1);
  savePackages();

  // Si ya no hay más, salir
  const restantes = packages.filter(function(p) { return p.coords; });
  if (restantes.length === 0) {
    redibujarRuta();
    alert('🎉 ¡Todas las paradas completadas!');
    setTimeout(function() {
      if (watchId) { navigator.geolocation.clearWatch(watchId); watchId = null; }
      viewMap.hidden = true;
      viewHome.hidden = false;
      renderPackages();
    }, 1500);
    return;
  }

  // El siguiente paquete quedó en la misma posición del índice
  if (currentStopIndex >= restantes.length) {
    currentStopIndex = restantes.length - 1;
  }

  redibujarRuta();
  renderPackages();
});

// ---------- Ordenamiento por cercanía ----------
function ordenarPorVecinoMasCercano(inicio, lista) {
  const restantes = lista.slice();
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
  for (let i = 0; i < orden.length; i++) {
    const idx = packages.indexOf(orden[i]);
    if (idx > -1) { nuevos.push(orden[i]); packages.splice(idx, 1); }
  }
  packages = nuevos.concat(packages);
}

function distancia(a, b) {
  const R = 6371;
  const dLat = (b.lat - a.lat) * Math.PI / 180;
  const dLon = (b.lon - a.lon) * Math.PI / 180;
  const x = Math.sin(dLat/2) * Math.sin(dLat/2) +
            Math.cos(a.lat * Math.PI/180) * Math.cos(b.lat * Math.PI/180) *
            Math.sin(dLon/2) * Math.sin(dLon/2);
  return 2 * R * Math.asin(Math.sqrt(x));
}

// ---------- Init ----------
document.addEventListener('DOMContentLoaded', function() {
  renderPackages();
});

console.log('app v19 cargado');