// ============================================
//  Enrutador PWA — Lógica principal (v24)
//  + Dirección estilo México: Calle Num, Colonia, CP, México
//  + OCR limpia "Dirección completa:"
// ============================================

const MI_VERSION = 'v24-2026-10-01';

// ---------- DOM ----------
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
const btnCopy        = document.getElementById('btnCopy');
const btnOpenMaps    = document.getElementById('btnOpenMaps');
const btnNext        = document.getElementById('btnNext');

const versionTag = document.getElementById('versionTag');
if (versionTag) versionTag.textContent = MI_VERSION;

// ---------- Estado ----------
let packages = JSON.parse(localStorage.getItem('packages') || '[]');
let ocrResultText = '';
let cropperInstance = null;
let rotacionActual = 0;
let ordenManual = false;

let mapInstance = null;
let mapMarkers = [];
let mapRouteLine = null;
let currentStopIndex = 0;
let userLocation = null;
let watchId = null;

// ---------- Utilidades ----------
function showLoader(msg) { loaderText.textContent = msg || 'Procesando…'; loader.hidden = false; }
function hideLoader() { loader.hidden = true; }
function savePackages() { localStorage.setItem('packages', JSON.stringify(packages)); }
function getApiKey() { return localStorage.getItem('ocrspace_key') || ''; }
function setApiKey(key) { localStorage.setItem('ocrspace_key', key.trim()); }

// ---------- Reducir imagen ----------
function canvasABlobLigero(canvas) {
  return new Promise(function(resolve) {
    canvas.toBlob(function(blob) {
      if (blob && blob.size <= 950000) { resolve(blob); return; }
      canvas.toBlob(function(b2) { resolve(b2 || blob); }, 'image/jpeg', 0.7);
    }, 'image/jpeg', 0.85);
  });
}

// ---------- OCR.space ----------
async function ocrSpaceReconocer(canvas, apiKey) {
  const blob = await canvasABlobLigero(canvas);
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
  } catch (err) {
    const e = new Error('Error de red: ' + err.message); e.detalleDebug = true; throw e;
  }
  try { data = await resp.json(); } catch (err) {
    const e = new Error('Respuesta no es JSON. HTTP ' + resp.status); e.detalleDebug = true; throw e;
  }

  if (data.IsErroredOnProcessing) {
    const msg = data.ErrorMessage ? (Array.isArray(data.ErrorMessage) ? data.ErrorMessage.join(' | ') : data.ErrorMessage) : 'Error';
    const e = new Error('OCR.space error: ' + msg + '\n\nJSON: ' + JSON.stringify(data, null, 2));
    e.detalleDebug = true; throw e;
  }
  if (!data.ParsedResults || !data.ParsedResults.length) {
    const e = new Error('Sin resultados.\nHTTP: ' + resp.status + '\nOCRExitCode: ' + data.OCRExitCode + '\nJSON: ' + JSON.stringify(data, null, 2));
    e.detalleDebug = true; throw e;
  }
  const parsed = data.ParsedResults[0];
  const resultado = parsed.ParsedText || '';
  if (resultado && resultado.trim().length > 0) return resultado;

  const e = new Error('=== TEXTO VACÍO ===\n' + JSON.stringify(data, null, 2));
  e.detalleDebug = true; throw e;
}

// ---------- Extraer componentes de dirección ----------
function extraerCP(texto) {
  const m = texto.match(/\b(\d{5})\b/);
  return m ? m[1] : '';
}

// Extrae la colonia: suele estar entre el número de calle y el CP
function extraerColonia(texto) {
  // Después de quitar "Direccion completa:" y antes del CP
  // Patrón: ", COLONIA," o ", Colonia,"
  const partes = texto.split(',').map(function(s) { return s.trim(); });
  for (let i = 0; i < partes.length; i++) {
    const p = partes[i];
    // Colonia = no es número, no es CP, no es "mexico", tiene varias letras, longitud razonable
    if (p.length > 3 && p.length < 60 &&
        !/^\d+$/.test(p) &&
        !/^cp\s*\d{5}$/i.test(p) &&
        !/^\d{5}$/.test(p) &&
        !/^m[eé]xico$/i.test(p) &&
        !/^estado\s+de/i.test(p) &&
        /[A-ZÁÉÍÓÚÑ]/i.test(p)) {
      // Si tiene palabras como "seccion", "sección", "sector", "colonia"
      if (/secci[oó]n|sector|colonia|col\.|fracc|manzana|mz|villa|barrio|pueblo/i.test(p)) {
        return p;
      }
    }
  }
  return '';
}

// ---------- Formatear dirección ESTILO MÉXICO ----------
// Formato correcto para Google Maps en México: "Calle Numero, Colonia, CP, México"
// El CP en México ya define: Estado, Municipio, Zona
function formatearParaGoogle(direccion) {
  // 1. Extraer CP
  const cp = extraerCP(direccion);

  // 2. Limpiar el ruido
  let d = direccion
    // Quitar "Dirección completa:" o "Direccion completa:"
    .replace(/direcci[oó]n\s*(completa)?[:\s]*/gi, '')
    // Quitar "BERRIOZABALCP.55710" (palabra pegada al CP)
    .replace(/([A-ZÁÉÍÓÚÑ]{3,})CP\.?\s*\d{5}/gi, '$1')
    // Quitar "CP 55710" o "CP.55710"
    .replace(/\bCP\.?\s*\d{5}/gi, '')
    // Quitar CP suelto
    .replace(/\b\d{5}\b/g, '')
    // Quitar "Estado de México"
    .replace(/estado\s+de\s+m[eé]xico/gi, '')
    // Quitar "México" suelto
    .replace(/\bm[eé]xico\b/gi, '')
    // Normalizar comas y espacios
    .replace(/\s*,\s*/g, ', ')
    .replace(/\s{2,}/g, ' ')
    .replace(/,\s*,/g, ',')
    .replace(/^\s*,/, '')
    .replace(/,\s*$/, '')
    .trim();

  // 3. Separar por comas y limpiar cada pedazo
  let partes = d.split(',').map(function(s) { return s.trim(); }).filter(function(s) { return s.length > 0; });

  // 4. Unir calle + número: "boulevard de las rosas, 386" → "boulevard de las rosas 386"
  if (partes.length >= 2) {
    const primera = partes[0];
    const segunda = partes[1];
    // Si la segunda es solo un número (o número con letra)
    if (/^\d+[A-Za-z]?$/.test(segunda)) {
      partes[0] = primera + ' ' + segunda;
      partes.splice(1, 1);
    }
  }

  // 5. Title Case en cada parte
  partes = partes.map(function(p) {
    return p.split(' ').map(function(w) {
      if (w.length === 0) return w;
      // Preservar siglas de 2 letras o menos (MZ, LT, etc.)
      if (w.length <= 2 && w === w.toUpperCase()) return w.toUpperCase();
      // Si es todo mayúsculas y largo, capitalizar
      if (w === w.toUpperCase() && w.length > 2) {
        return w.charAt(0) + w.slice(1).toLowerCase();
      }
      return w;
    }).join(' ');
  });

  // 6. Armar: "Calle Numero, Colonia, CP, México"
  let resultado = partes.join(', ');
  if (cp) resultado += ', ' + cp;
  resultado += ', México';

  return resultado;
}

// ---------- Render lista ----------
function renderPackages() {
  if (packages.length === 0) {
    packagesList.innerHTML = '<p class="empty">Aún no hay paquetes. Captura una etiqueta para comenzar.</p>';
    btnOptimize.disabled = true;
    return;
  }

  let html = '';
  if (ordenManual) {
    html += '<div class="orden-banner">' +
              '✋ Orden manual activo. Usa ▲▼ para ajustar.' +
              '<button id="btnResetOrden" class="reset-btn">🔄 Volver a orden óptimo</button>' +
            '</div>';
  }

  packages.forEach(function(p, i) {
    const esPrimero = (i === 0);
    const esUltimo  = (i === packages.length - 1);
    const titulo = p.recipient ? p.recipient : ('Paquete ' + (i + 1));
    html += '<div class="package-item" data-idx="' + i + '">' +
              '<div class="pkg-num">' + (i + 1) + '</div>' +
              '<div class="pkg-info">' +
                '<strong>' + titulo + '</strong>' +
                '<span>' + p.address + '</span>' +
              '</div>' +
              '<div class="pkg-controls">' +
                '<button class="pkg-move btn-up" data-idx="' + i + '" ' + (esPrimero ? 'disabled' : '') + '>▲</button>' +
                '<button class="pkg-move btn-down" data-idx="' + i + '" ' + (esUltimo ? 'disabled' : '') + '>▼</button>' +
                '<button class="pkg-delete" data-idx="' + i + '">🗑️</button>' +
              '</div>' +
            '</div>';
  });

  packagesList.innerHTML = html;

  document.querySelectorAll('.btn-up').forEach(function(btn) {
    btn.addEventListener('click', function(e) {
      const idx = parseInt(e.target.dataset.idx);
      if (idx > 0) moverPaquete(idx, idx - 1);
    });
  });
  document.querySelectorAll('.btn-down').forEach(function(btn) {
    btn.addEventListener('click', function(e) {
      const idx = parseInt(e.target.dataset.idx);
      if (idx < packages.length - 1) moverPaquete(idx, idx + 1);
    });
  });
  document.querySelectorAll('.pkg-delete').forEach(function(btn) {
    btn.addEventListener('click', function(e) {
      const idx = parseInt(e.target.dataset.idx);
      if (!confirm('¿Eliminar este paquete?')) return;
      packages.splice(idx, 1);
      savePackages();
      renderPackages();
    });
  });

  const btnReset = document.getElementById('btnResetOrden');
  if (btnReset) {
    btnReset.addEventListener('click', function() {
      ordenManual = false;
      renderPackages();
      alert('Orden manual desactivado. El próximo "Optimizar ruta" volverá a ordenar por cercanía.');
    });
  }

  btnOptimize.disabled = packages.length === 0;
}

function moverPaquete(fromIdx, toIdx) {
  if (fromIdx === toIdx) return;
  const temp = packages[fromIdx];
  packages[fromIdx] = packages[toIdx];
  packages[toIdx] = temp;
  ordenManual = true;
  savePackages();
  renderPackages();
}

// ---------- Captura ----------
btnCapture.addEventListener('click', function() {
  if (!getApiKey()) { alert('Primero configura tu API key de OCR.space en Ajustes ⚙️'); return; }
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

function limpiarDireccion(s) {
  return s
    // Quitar prefijos como "Dirección completa:"
    .replace(/direcci[oó]n\s*(completa)?[:\s]*/gi, '')
    .replace(/\s+/g, ' ')
    .replace(/\s*,\s*/g, ', ')
    .replace(/[.,;]+$/, '')
    .trim();
}

// Detección de dirección: toma desde "Dirección completa:" hasta otra sección
function detectarDireccion(texto) {
  let t = aplicarCorrecciones(texto).replace(/[""«»]/g, '"').replace(/[|]/g, 'I');
  const lineas = t.split('\n').map(function(l) { return l.trim(); }).filter(function(l) { return l.length > 1; });
  if (lineas.length === 0) return '';

  const stopWords = ['obs:', 'obs :', 'observaciones:', 'remitente:', 'destinatario:',
                     'tel:', 'teléfono:', 'guía:', 'guia:', 'pedido:', 'factura:',
                     'fecha:', 'hora:', 'peso:', 'bultos:', 'contenido:',
                     'referencia:', 'ref:', 'nota:', 'notas:', 'código:', 'codigo:'];

  let idxInicio = -1;
  for (let i = 0; i < lineas.length; i++) {
    if (/direcci[oó]n\s*(?:completa)?/i.test(lineas[i])) {
      idxInicio = i;
      // Quitar el prefijo "Dirección completa:" de esa línea
      lineas[i] = lineas[i].replace(/^.*?direcci[oó]n\s*(?:completa)?[:\s]*/i, '').trim();
      break;
    }
  }

  if (idxInicio > -1) {
    const resultado = [];
    for (let i = idxInicio; i < lineas.length; i++) {
      const low = lineas[i].toLowerCase();
      let esStop = false;
      for (let j = 0; j < stopWords.length; j++) {
        if (low.indexOf(stopWords[j]) === 0) { esStop = true; break; }
      }
      if (esStop) break;
      if (lineas[i].length > 1) resultado.push(lineas[i]);
    }
    if (resultado.length > 0) return limpiarDireccion(resultado.join(', '));
  }

  // Fallback: buscar CP y tomar algunas líneas antes + después
  const textoCompleto = lineas.join(' ');
  const matchCP = textoCompleto.match(/\b(\d{5})\b/);
  let idxCP = -1;
  if (matchCP) idxCP = lineas.findIndex(function(l) { return l.indexOf(matchCP[1]) !== -1; });
  if (idxCP > -1) {
    const inicio = Math.max(0, idxCP - 4);
    const fin = Math.min(lineas.length, idxCP + 2);
    return limpiarDireccion(lineas.slice(inicio, fin).join(', '));
  }

  return limpiarDireccion(lineas.slice(0, 6).join(', '));
}

function detectarNombre(texto) {
  const lineas = texto.split('\n').map(function(l) { return l.trim(); }).filter(function(l) { return l.length > 2; });
  if (lineas.length === 0) return '';
  for (let i = 0; i < lineas.length; i++) {
    const m = lineas[i].match(/destinatario[:\s]+(.+)/i);
    if (m && m[1].trim().length > 2) return m[1].trim();
  }
  for (let i = 0; i < lineas.length; i++) {
    const m = lineas[i].match(/nombre[:\s]+(.+)/i);
    if (m && m[1].trim().length > 2) return m[1].trim();
  }
  return '';
}

// ---------- Ajustes ----------
btnSettings.addEventListener('click', function() { inputApiKey.value = getApiKey(); settingsModal.hidden = false; });
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
    recipient: recipient, address: address, ocr: ocrResultText,
    coords: null, delivered: false, createdAt: Date.now()
  });
  savePackages();
  renderPackages();
  addressModal.hidden = true;
});

// ---------- Geocodificación por CP ----------
async function geocodificarConNominatim(consulta) {
  const url = 'https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=mx&q=' + encodeURIComponent(consulta);
  const r = await fetch(url, { cache: 'no-store' });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const data = await r.json();
  if (data && data[0]) {
    return { lat: parseFloat(data[0].lat), lon: parseFloat(data[0].lon), display: data[0].display_name, query: consulta };
  }
  return null;
}

// En México el CP es la clave: busca solo por CP
async function geocodificarDireccion(direccion) {
  const cp = extraerCP(direccion);
  if (!cp) {
    const err = new Error('No se encontró código postal en la dirección.');
    err.intentos = ['❌ Sin CP'];
    throw err;
  }

  const intentos = [];
  // Intentar 1: solo el CP
  try {
    const r1 = await geocodificarConNominatim(cp);
    if (r1) return r1;
    intentos.push('❌ "' + cp + '" → sin resultados');
  } catch (err) {
    intentos.push('⚠️ "' + cp + '" → ' + err.message);
  }

  // Intentar 2: CP + México
  await new Promise(function(res) { setTimeout(res, 1200); });
  try {
    const r2 = await geocodificarConNominatim(cp + ', México');
    if (r2) return r2;
    intentos.push('❌ "' + cp + ', México" → sin resultados');
  } catch (err) {
    intentos.push('⚠️ "' + cp + ', México" → ' + err.message);
  }

  const err = new Error('No se encontró el CP.\n' + intentos.join('\n'));
  err.intentos = intentos;
  throw err;
}

// ---------- Optimizar ruta ----------
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

    const irAlMapa = function() {
      savePackages();
      hideLoader();
      currentStopIndex = 0;
      mostrarVistaMapa();
      if (fallidos.length > 0) {
        setTimeout(function() { alert('Ruta lista. ' + fallidos.length + ' dirección(es) omitidas.'); }, 500);
      }
    };

    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        function(pos) {
          userLocation = { lat: pos.coords.latitude, lon: pos.coords.longitude };
          if (!ordenManual) ordenarPorVecinoMasCercano(userLocation, validos);
          irAlMapa();
        },
        function() {
          if (!ordenManual) ordenarPorVecinoMasCercano(validos[0].coords, validos);
          irAlMapa();
        }
      );
    } else {
      if (!ordenManual) ordenarPorVecinoMasCercano(validos[0].coords, validos);
      irAlMapa();
    }
  } catch (err) {
    hideLoader();
    alert('Error al optimizar: ' + err.message);
  }
});

// ---------- Vista mapa ----------
function mostrarVistaMapa() {
  viewHome.hidden = true;
  viewMap.hidden = false;
  window._mapFitted = false;
  window._lastNumStops = 0;
  if (mapInstance) {
    setTimeout(function() { mapInstance.invalidateSize(); redibujarRuta(); }, 150);
  } else {
    setTimeout(inicializarMapa, 150);
  }
  if (navigator.geolocation && !watchId) {
    watchId = navigator.geolocation.watchPosition(
      function(pos) {
        userLocation = { lat: pos.coords.latitude, lon: pos.coords.longitude };
        if (mapInstance) redibujarRuta();
      },
      function() {},
      { enableHighAccuracy: true, maximumAge: 10000, timeout: 15000 }
    );
  }
}

function inicializarMapa() {
  mapInstance = L.map('map').setView([19.4, -99.1], 12);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap', maxZoom: 19
  }).addTo(mapInstance);
  redibujarRuta();
}

function redibujarRuta() {
  if (!mapInstance) return;
  const validos = packages.filter(function(p) { return p.coords; });

  if (userLocation) {
    if (window._userMarker) mapInstance.removeLayer(window._userMarker);
    const userIcon = L.divIcon({
      className: 'user-marker',
      html: '🔵',
      iconSize: [20, 20],
      iconAnchor: [10, 10]
    });
    window._userMarker = L.marker([userLocation.lat, userLocation.lon], { icon: userIcon })
      .bindPopup('📍 Tu ubicación actual');
    window._userMarker.addTo(mapInstance);
  }

  const numActual = validos.length;
  if (window._lastNumStops !== numActual || mapMarkers.length !== numActual) {
    mapMarkers.forEach(function(m) { mapInstance.removeLayer(m); });
    mapMarkers = [];

    validos.forEach(function(p, i) {
      const icono = L.divIcon({
        className: 'stop-marker',
        html: '<div class="stop-pin"><span>' + (i + 1) + '</span></div>',
        iconSize: [30, 30], iconAnchor: [15, 30]
      });
      const titulo = p.recipient ? p.recipient : ('Paquete ' + (i + 1));
      const marker = L.marker([p.coords.lat, p.coords.lon], { icon: icono })
        .bindPopup(
          '<strong>' + (i + 1) + '. ' + titulo + '</strong><br>' + p.address,
          { autoClose: false, closeOnClick: false, closeButton: true, autoPan: true }
        );
      marker.addTo(mapInstance);
      mapMarkers.push(marker);
    });
    window._lastNumStops = numActual;
  }

  if (mapRouteLine) { mapInstance.removeLayer(mapRouteLine); mapRouteLine = null; }
  const coords = [];
  if (userLocation) coords.push([userLocation.lat, userLocation.lon]);
  validos.forEach(function(p) { coords.push([p.coords.lat, p.coords.lon]); });

  if (coords.length > 1) {
    mapRouteLine = L.polyline(coords, {
      color: '#22c55e', weight: 4, dashArray: '8, 8', opacity: 0.8
    }).addTo(mapInstance);
    if (!window._mapFitted) {
      mapInstance.fitBounds(mapRouteLine.getBounds(), { padding: [60, 60] });
      window._mapFitted = true;
    }
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

  let contenido = '';
  if (actual.recipient) {
    contenido += '<strong>' + actual.recipient + '</strong><br>';
  }
  contenido += '<small>' + actual.address + '</small>';
  navInstruction.innerHTML = contenido;

  if (userLocation) {
    const dist = distancia(userLocation, actual.coords);
    navDistance.textContent = '📏 ' + dist.toFixed(1) + ' km';
    navEta.textContent = '⏱️ ~' + Math.round((dist / 30) * 60) + ' min';
  } else {
    navDistance.textContent = '📏 —';
    navEta.textContent = '⏱️ —';
  }
}

// ---------- Botones navegación ----------
btnExitNav.addEventListener('click', function() {
  if (watchId) { navigator.geolocation.clearWatch(watchId); watchId = null; }
  viewMap.hidden = true;
  viewHome.hidden = false;
});

btnRepeat.addEventListener('click', function() {
  const validos = packages.filter(function(p) { return p.coords; });
  const actual = validos[currentStopIndex];
  if (!actual) return;
  if (!('speechSynthesis' in window)) { alert('Tu navegador no soporta voz.'); return; }
  let texto = 'Parada ' + (currentStopIndex + 1) + ' de ' + validos.length + '. ';
  if (actual.recipient) texto += 'Para ' + actual.recipient + '. ';
  texto += actual.address + '.';
  if (userLocation) texto += ' Está a ' + distancia(userLocation, actual.coords).toFixed(1) + ' kilómetros.';
  const utt = new SpeechSynthesisUtterance(texto);
  utt.lang = 'es-MX';
  utt.rate = 0.95;
  speechSynthesis.cancel();
  speechSynthesis.speak(utt);
});

// ---------- Copiar dirección ----------
btnCopy.addEventListener('click', async function() {
  const validos = packages.filter(function(p) { return p.coords; });
  const actual = validos[currentStopIndex];
  if (!actual) return;

  const texto = formatearParaGoogle(actual.address);

  try {
    await navigator.clipboard.writeText(texto);
    alert('📋 Dirección copiada:\n\n' + texto + '\n\nPégala en Google Maps, Waze o WhatsApp.');
  } catch (err) {
    const textarea = document.createElement('textarea');
    textarea.value = texto;
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    document.body.removeChild(textarea);
    alert('📋 Dirección copiada:\n\n' + texto);
  }
});

// ---------- Google Maps ----------
btnOpenMaps.addEventListener('click', function() {
  const validos = packages.filter(function(p) { return p.coords; });
  const actual = validos[currentStopIndex];
  if (!actual) return;

  const query = formatearParaGoogle(actual.address);
  const url = 'https://www.google.com/maps/search/?api=1&query=' +
              encodeURIComponent(query);
  window.open(url, '_blank');
});

btnNext.addEventListener('click', function() {
  const validos = packages.filter(function(p) { return p.coords; });
  const actual = validos[currentStopIndex];
  if (!actual) return;
  const titulo = actual.recipient || ('Paquete ' + (currentStopIndex + 1));
  if (!confirm('¿Marcar como entregado?\n\n' + titulo + '\n' + actual.address)) return;
  actual.delivered = true;
  const idx = packages.indexOf(actual);
  if (idx > -1) packages.splice(idx, 1);
  savePackages();
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
  if (currentStopIndex >= restantes.length) currentStopIndex = restantes.length - 1;
  window._lastNumStops = 0;
  redibujarRuta();
  renderPackages();
});

// ---------- Vecino más cercano ----------
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

document.addEventListener('DOMContentLoaded', function() { renderPackages(); });
console.log('app v24 cargado');