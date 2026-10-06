// ============================================
//  Enrutador PWA — Lógica principal (v32)
//  - Escáner QR/código de barras para número de orden
//  - Formato dirección estilo Google México (sin "Méx")
//  - Tarjeta: código arriba, dirección con negritas abajo
// ============================================

const MI_VERSION = 'v32-2026-10-06';

// ---------- DOM ----------
const btnCapture   = document.getElementById('btnCapture');
const btnOptimize  = document.getElementById('btnOptimize');
const btnSettings  = document.getElementById('btnSettings');
const cameraInput  = document.getElementById('cameraInput');
const packagesList = document.getElementById('packagesList');
const viewHome = document.getElementById('viewHome');
const viewMap  = document.getElementById('viewMap');
const btnExitNav = document.getElementById('btnExitNav');

const scanModal = document.getElementById('scanModal');
const scannerContainer = document.getElementById('scanner-container');
const btnSkipScan = document.getElementById('btnSkipScan');

const cropModal = document.getElementById('cropModal');
const cropImage = document.getElementById('cropImage');
const btnCancelCrop = document.getElementById('btnCancelCrop');
const btnConfirmCrop = document.getElementById('btnConfirmCrop');
const btnRotate = document.getElementById('btnRotate');
const btnWide = document.getElementById('btnWide');
const btnSquare = document.getElementById('btnSquare');
const btnFree = document.getElementById('btnFree');

const addressModal = document.getElementById('addressModal');
const labelPreview = document.getElementById('labelPreview');
const inputOrderNumber = document.getElementById('inputOrderNumber');
const inputRecipient = document.getElementById('inputRecipient');
const inputAddress = document.getElementById('inputAddress');
const ocrText = document.getElementById('ocrText');
const btnCancelAddress = document.getElementById('btnCancelAddress');
const btnSaveAddress = document.getElementById('btnSaveAddress');

const settingsModal = document.getElementById('settingsModal');
const inputApiKey = document.getElementById('inputApiKey');
const btnCancelSettings = document.getElementById('btnCancelSettings');
const btnSaveSettings = document.getElementById('btnSaveSettings');

const previewModal = document.getElementById('previewModal');
const previewTitle = document.getElementById('previewTitle');
const previewMap = document.getElementById('previewMap');
const previewAddress = document.getElementById('previewAddress');
const btnClosePreview = document.getElementById('btnClosePreview');
const btnPreviewMaps = document.getElementById('btnPreviewMaps');

const loader = document.getElementById('loader');
const loaderText = document.getElementById('loaderText');
const navCurrentStop = document.getElementById('navCurrentStop');
const navInstruction = document.getElementById('navInstruction');
const navDistance = document.getElementById('navDistance');
const navEta = document.getElementById('navEta');
const btnRepeat = document.getElementById('btnRepeat');
const btnCopy = document.getElementById('btnCopy');
const btnOpenMaps = document.getElementById('btnOpenMaps');
const btnNext = document.getElementById('btnNext');

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
let previewMapInstance = null;
let previewMapMarker = null;
let previewPackageIndex = -1;

// Estado del escáner
let scannerInstance = null;
let currentOrderNumber = '';

// ---------- Utilidades ----------
function showLoader(msg) { loaderText.textContent = msg || 'Procesando…'; loader.hidden = false; }
function hideLoader() { loader.hidden = true; }
function savePackages() { localStorage.setItem('packages', JSON.stringify(packages)); }
function getApiKey() { return localStorage.getItem('ocrspace_key') || ''; }
function setApiKey(key) { localStorage.setItem('ocrspace_key', key.trim()); }

function escapeHtml(s) {
  if (!s) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// ---------- Sanitizar número de orden ----------
function sanitizarNumeroOrden(texto) {
  if (!texto) return '';
  let t = String(texto).trim();

  // Si es URL, extraer el último segmento alfanumérico significativo
  if (/^https?:\/\//i.test(t)) {
    const partes = t.split(/[\/=?#&]/);
    let mejor = '';
    for (let i = partes.length - 1; i >= 0; i--) {
      const p = partes[i];
      if (p && /^[A-Za-z0-9\-_]{5,}$/.test(p) && p.length > mejor.length) {
        mejor = p;
      }
    }
    t = mejor || t;
  }

  // Quitar espacios y caracteres extraños, conservar letras/números/guiones
  t = t.replace(/[\s]+/g, '').replace(/[^A-Za-z0-9\-_]/g, '');

  // Limitar a 30 caracteres
  if (t.length > 30) t = t.substring(0, 30);

  return t;
}

// ---------- Imagen: reducir peso ----------
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
    const e = new Error('OCR.space error: ' + msg); e.detalleDebug = true; throw e;
  }
  if (!data.ParsedResults || !data.ParsedResults.length) {
    const e = new Error('Sin resultados.'); e.detalleDebug = true; throw e;
  }
  return data.ParsedResults[0].ParsedText || '';
}

// ---------- Extraer CP ----------
function extraerCP(texto) {
  const m = texto.match(/\b(\d{5})\b/);
  return m ? m[1] : '';
}

// ---------- TITLE CASE con artículos en minúscula ----------
function titleCaseMx(s) {
  const minusculas = ['de', 'del', 'la', 'las', 'los', 'y', 'o', 'el', 'en', 'a', 'con', 'por', 'para', 'al'];
  return s.split(/\s+/).map(function(w, i) {
    if (w.length === 0) return w;
    const low = w.toLowerCase();
    if (i > 0 && minusculas.indexOf(low) !== -1) return low;
    if (w.length <= 2 && w === w.toUpperCase()) return w.toUpperCase();
    if (w === w.toUpperCase() && w.length > 2) return w.charAt(0) + w.slice(1).toLowerCase();
    return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
  }).join(' ');
}

// ---------- Formatear dirección estilo México ----------
// Formato final: "Calle Num, Colonia, CP Municipio"  (sin "Méx", solo se usa en México)
function formatearParaGoogle(direccion) {
  if (!direccion || !direccion.trim()) return '';
  let d = direccion.replace(/\s+/g, ' ').trim();
  d = d.replace(/direcci[oó]n\s*(completa)?\s*:?\s*/i, '');
  const cpMatch = d.match(/\b(\d{5})\b/);
  const cp = cpMatch ? cpMatch[1] : '';
  d = d.replace(/([A-ZÁÉÍÓÚÑ]{3,})\s*CP\.?\s*\d{5}\b/gi, '$1');
  d = d.replace(/\bCP\.?\s*\d{5}\b/gi, '');
  d = d.replace(/\b\d{5}\b/g, '');
  d = d.replace(/estado\s+de\s+m[eé]xico/gi, '');
  d = d.replace(/\bm[eé]xico\b/gi, '');
  d = d.replace(/\s*,\s*/g, ', ').replace(/,+/g, ',').replace(/^\s*,\s*/, '').replace(/\s*,\s*$/, '').replace(/\s+/g, ' ').trim();
  let partes = d.split(',').map(function(s) { return s.trim(); }).filter(function(s) { return s.length > 0; });
  if (partes.length === 0) return direccion.trim();
  let idxNum = -1;
  for (let i = 1; i < partes.length; i++) {
    if (/^\d+[A-Za-z]?$/.test(partes[i])) { idxNum = i; break; }
  }
  let resultado = [];
  if (idxNum > 0) {
    let calle = partes.slice(0, idxNum).join(' ');
    let numero = partes[idxNum];
    calle = calle.replace(/\bBoulevard\b/gi, 'Blvd.')
                 .replace(/\bBulevar\b/gi, 'Blvd.')
                 .replace(/\bAvenida\b/gi, 'Av.')
                 .replace(/\bProlongaci[oó]n\b/gi, 'Prol.')
                 .replace(/\bCalzada\b/gi, 'Calz.')
                 .replace(/\bCarretera\b/gi, 'Carret.');
    calle = titleCaseMx(calle);
    resultado.push(calle + ' ' + numero);
    let resto = partes.slice(idxNum + 1);
    if (resto.length > 0) resultado.push(titleCaseMx(resto[0]));
    if (resto.length > 1) {
      let mun = titleCaseMx(resto.slice(1).join(' '));
      resultado.push(cp ? (cp + ' ' + mun) : mun);
    } else if (cp) {
      resultado.push(cp);
    }
  } else {
    partes.forEach(function(p) { resultado.push(titleCaseMx(p)); });
    if (cp && resultado.indexOf(cp) === -1) resultado.push(cp);
  }
  return resultado.join(', ');
}

// ---------- Formatear dirección en HTML (con negritas) ----------
function formatearDireccionHTML(direccion) {
  if (!direccion) return '';
  const partes = direccion.split(',').map(function(s) { return s.trim(); });
  if (partes.length <= 1) return escapeHtml(direccion);
  const esc = partes.map(escapeHtml);
  const negritas = esc.slice(0, 3).map(function(p) { return '<strong>' + p + '</strong>'; });
  const normal = esc.slice(3);
  return negritas.join(', ') + (normal.length > 0 ? ', ' + normal.join(', ') : '');
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
    html += '<div class="orden-banner">✋ Orden manual activo. Usa ▲▼ para ajustar.' +
            '<button id="btnResetOrden" class="reset-btn">🔄 Volver a orden óptimo</button></div>';
  }
  packages.forEach(function(p, i) {
    const esPrimero = (i === 0);
    const esUltimo  = (i === packages.length - 1);

    let ordenHtml;
    if (p.orderNumber) {
      ordenHtml = '<div class="pkg-order" data-idx="' + i + '" title="Toca para editar">#' + escapeHtml(p.orderNumber) + '</div>';
    } else {
      ordenHtml = '<div class="pkg-order sin-orden" data-idx="' + i + '" title="Toca para agregar">Paquete ' + (i + 1) + ' (sin orden)</div>';
    }

    const dirHtml = formatearDireccionHTML(p.address);

    html += '<div class="package-item" data-idx="' + i + '">' +
              '<div class="pkg-row-top">' +
                ordenHtml +
                '<div class="pkg-controls">' +
                  '<button class="pkg-move btn-up" data-idx="' + i + '" ' + (esPrimero ? 'disabled' : '') + '>▲</button>' +
                  '<button class="pkg-move btn-down" data-idx="' + i + '" ' + (esUltimo ? 'disabled' : '') + '>▼</button>' +
                  '<button class="pkg-delete" data-idx="' + i + '">🗑️</button>' +
                '</div>' +
              '</div>' +
              '<div class="pkg-address" data-idx="' + i + '">' + dirHtml + '</div>' +
            '</div>';
  });
  packagesList.innerHTML = html;

  // Click en el código de orden → editar
  document.querySelectorAll('.pkg-order').forEach(function(el) {
    el.addEventListener('click', function(e) {
      e.stopPropagation();
      const idx = parseInt(e.target.dataset.idx);
      const p = packages[idx];
      if (!p) return;
      const actual = p.orderNumber || '';
      const nuevo = prompt('Editar número de orden:', actual);
      if (nuevo !== null) {
        p.orderNumber = sanitizarNumeroOrden(nuevo);
        savePackages();
        renderPackages();
      }
    });
  });

  // Click en la dirección → vista previa del mapa
  document.querySelectorAll('.pkg-address').forEach(function(el) {
    el.addEventListener('click', function(e) {
      const idx = parseInt(e.target.dataset.idx);
      if (!isNaN(idx)) abrirVistaPrevia(idx);
    });
  });

  document.querySelectorAll('.btn-up').forEach(function(btn) {
    btn.addEventListener('click', function(e) {
      e.stopPropagation();
      const idx = parseInt(e.target.dataset.idx);
      if (idx > 0) moverPaquete(idx, idx - 1);
    });
  });
  document.querySelectorAll('.btn-down').forEach(function(btn) {
    btn.addEventListener('click', function(e) {
      e.stopPropagation();
      const idx = parseInt(e.target.dataset.idx);
      if (idx < packages.length - 1) moverPaquete(idx, idx + 1);
    });
  });
  document.querySelectorAll('.pkg-delete').forEach(function(btn) {
    btn.addEventListener('click', function(e) {
      e.stopPropagation();
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
      alert('Orden manual desactivado.');
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

// ============================================
//  ESCÁNER DE CÓDIGO DE BARRAS / QR
// ============================================
function abrirScanner() {
  currentOrderNumber = '';
  scanModal.hidden = false;

  setTimeout(function() {
    if (scannerInstance) {
      scannerInstance.clear().catch(function() {});
      scannerInstance = null;
    }

    scannerInstance = new Html5Qrcode("scanner-container");

    const config = {
      fps: 10,
      qrbox: function(viewfinderWidth, viewfinderHeight) {
        const minEdge = Math.min(viewfinderWidth, viewfinderHeight);
        return {
          width: Math.floor(viewfinderWidth * 0.85),
          height: Math.floor(minEdge * 0.5)
        };
      },
      aspectRatio: 1.0
    };

    scannerInstance.start(
      { facingMode: "environment" },
      config,
      function(decodedText) {
        currentOrderNumber = sanitizarNumeroOrden(decodedText);
        cerrarScanner(function() {
          inputOrderNumber.value = currentOrderNumber;
          cameraInput.click();
        });
      },
      function(errorMessage) {
        // Ignorar errores de "no encontrado"
      }
    ).catch(function(err) {
      console.error('Error al iniciar escáner:', err);
      alert('No se pudo iniciar la cámara del escáner.\n\n' + err.message);
      cerrarScanner(function() {
        cameraInput.click();
      });
    });
  }, 200);
}

function cerrarScanner(callback) {
  if (scannerInstance) {
    scannerInstance.stop().then(function() {
      scannerInstance.clear().catch(function() {});
      scannerInstance = null;
      scanModal.hidden = true;
      if (callback) callback();
    }).catch(function() {
      scannerInstance = null;
      scanModal.hidden = true;
      if (callback) callback();
    });
  } else {
    scanModal.hidden = true;
    if (callback) callback();
  }
}

btnSkipScan.addEventListener('click', function() {
  currentOrderNumber = '';
  cerrarScanner(function() {
    cameraInput.click();
  });
});

// ---------- Vista previa ----------
async function abrirVistaPrevia(idx) {
  const p = packages[idx];
  if (!p) return;
  previewPackageIndex = idx;
  previewTitle.textContent = p.recipient ? p.recipient : ('Paquete ' + (idx + 1));
  previewAddress.textContent = p.address;
  previewModal.hidden = false;

  if (!p.coords) {
    showLoader('Ubicando dirección…');
    try {
      const resultado = await geocodificarDireccion(p.address);
      p.coords = { lat: resultado.lat, lon: resultado.lon };
      savePackages();
      hideLoader();
    } catch (err) {
      hideLoader();
      previewModal.hidden = true;
      alert('No se pudo ubicar esta dirección.\n\n' + (err.message || ''));
      return;
    }
  }

  setTimeout(function() {
    if (previewMapInstance) { previewMapInstance.remove(); previewMapInstance = null; }
    previewMapInstance = L.map('previewMap', { zoomControl: true }).setView([p.coords.lat, p.coords.lon], 16);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OSM', maxZoom: 19 }).addTo(previewMapInstance);
    const icono = L.divIcon({
      className: 'stop-marker',
      html: '<div class="stop-pin"><span>' + (idx + 1) + '</span></div>',
      iconSize: [30, 30], iconAnchor: [15, 30]
    });
    previewMapMarker = L.marker([p.coords.lat, p.coords.lon], { icon: icono }).addTo(previewMapInstance);
    previewMapInstance.invalidateSize();
  }, 150);
}

btnClosePreview.addEventListener('click', function() {
  if (previewMapInstance) { previewMapInstance.remove(); previewMapInstance = null; }
  previewModal.hidden = true;
});

btnPreviewMaps.addEventListener('click', function() {
  const p = packages[previewPackageIndex];
  if (!p) return;
  const url = 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(p.address);
  window.open(url, '_blank');
});

// ---------- Captura ----------
btnCapture.addEventListener('click', function() {
  if (!getApiKey()) { alert('Primero configura tu API key de OCR.space en Ajustes ⚙️'); return; }
  abrirScanner();
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

  inputOrderNumber.value = currentOrderNumber;
  inputRecipient.value = '';
  inputAddress.value = '';
  ocrText.textContent = '';
  addressModal.hidden = false;

  showLoader('Enviando a OCR.space…');
  try {
    const texto = await ocrSpaceReconocer(canvasRecortado, getApiKey());
    ocrResultText = texto;
    ocrText.textContent = texto;
    inputAddress.value   = formatearParaGoogle(detectarDireccion(texto));
    if (!inputRecipient.value) inputRecipient.value = detectarNombre(texto);
  } catch (err) {
    console.error('Error OCR:', err);
    ocrText.textContent = err.detalleDebug ? err.message : ('Error: ' + err.message);
    alert('OCR falló. Toca "Texto OCR completo" para ver detalles.');
  } finally {
    hideLoader();
    cameraInput.value = '';
    currentOrderNumber = '';
  }
});

// ---------- Detección de dirección ----------
function detectarDireccion(texto) {
  let t = texto.replace(/[""«»]/g, '"').replace(/[|]/g, 'I');
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
    if (resultado.length > 0) return resultado.join(' ');
  }
  const textoCompleto = lineas.join(' ');
  const matchCP = textoCompleto.match(/\b(\d{5})\b/);
  let idxCP = -1;
  if (matchCP) idxCP = lineas.findIndex(function(l) { return l.indexOf(matchCP[1]) !== -1; });
  if (idxCP > -1) {
    const inicio = Math.max(0, idxCP - 4);
    const fin = Math.min(lineas.length, idxCP + 2);
    return lineas.slice(inicio, fin).join(' ');
  }
  return lineas.slice(0, 6).join(' ');
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
  const orderNumber = sanitizarNumeroOrden(inputOrderNumber.value);
  const recipient = inputRecipient.value.trim();
  const address   = inputAddress.value.trim();
  if (!address) { alert('Debes escribir una dirección.'); return; }
  packages.push({
    orderNumber: orderNumber,
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

async function geocodificarDireccion(direccion) {
  const cp = extraerCP(direccion);
  if (!cp) {
    const err = new Error('Sin código postal en la dirección.');
    err.intentos = ['❌ Sin CP'];
    throw err;
  }
  const intentos = [];
  try {
    const r1 = await geocodificarConNominatim(cp);
    if (r1) return r1;
    intentos.push('❌ "' + cp + '" → sin resultados');
  } catch (err) { intentos.push('⚠️ "' + cp + '" → ' + err.message); }
  await new Promise(function(res) { setTimeout(res, 1200); });
  try {
    const r2 = await geocodificarConNominatim(cp + ', México');
    if (r2) return r2;
    intentos.push('❌ "' + cp + ', México" → sin resultados');
  } catch (err) { intentos.push('⚠️ "' + cp + ', México" → ' + err.message); }
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
    if (validos.length === 0) { hideLoader(); alert('No se pudo geocodificar ninguna dirección.'); return; }
    const irAlMapa = function() {
      savePackages(); hideLoader(); currentStopIndex = 0; mostrarVistaMapa();
      if (fallidos.length > 0) setTimeout(function() { alert('Ruta lista. ' + fallidos.length + ' omitidas.'); }, 500);
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
  } catch (err) { hideLoader(); alert('Error al optimizar: ' + err.message); }
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
    const userIcon = L.divIcon({ className: 'user-marker', html: '🔵', iconSize: [20, 20], iconAnchor: [10, 10] });
    window._userMarker = L.marker([userLocation.lat, userLocation.lon], { icon: userIcon }).bindPopup('📍 Tu ubicación');
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
      let titulo = p.recipient ? p.recipient : ('Paquete ' + (i + 1));
      if (p.orderNumber) titulo = '#' + p.orderNumber + ' · ' + titulo;
      const marker = L.marker([p.coords.lat, p.coords.lon], { icon: icono })
        .bindPopup('<strong>' + (i + 1) + '. ' + titulo + '</strong><br>' + p.address,
          { autoClose: false, closeOnClick: false, closeButton: true, autoPan: true });
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
    mapRouteLine = L.polyline(coords, { color: '#22c55e', weight: 4, dashArray: '8, 8', opacity: 0.8 }).addTo(mapInstance);
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
    navDistance.textContent = '—'; navEta.textContent = '—'; return;
  }
  let encabezado = 'Parada ' + (currentStopIndex + 1) + ' de ' + validos.length;
  if (actual.orderNumber) encabezado = '#' + actual.orderNumber + ' · ' + encabezado;
  navCurrentStop.textContent = encabezado;

  let contenido = '';
  if (actual.recipient) contenido += '<strong>' + actual.recipient + '</strong><br>';
  contenido += '<small>' + actual.address + '</small>';
  navInstruction.innerHTML = contenido;
  if (userLocation) {
    const dist = distancia(userLocation, actual.coords);
    navDistance.textContent = '📏 ' + dist.toFixed(1) + ' km';
    navEta.textContent = '⏱️ ~' + Math.round((dist / 30) * 60) + ' min';
  } else { navDistance.textContent = '📏 —'; navEta.textContent = '⏱️ —'; }
}

// ---------- Botones navegación ----------
btnExitNav.addEventListener('click', function() {
  if (watchId) { navigator.geolocation.clearWatch(watchId); watchId = null; }
  viewMap.hidden = true; viewHome.hidden = false;
});

btnRepeat.addEventListener('click', function() {
  const validos = packages.filter(function(p) { return p.coords; });
  const actual = validos[currentStopIndex];
  if (!actual) return;
  if (!('speechSynthesis' in window)) { alert('Tu navegador no soporta voz.'); return; }
  let texto = 'Parada ' + (currentStopIndex + 1) + ' de ' + validos.length + '. ';
  if (actual.orderNumber) texto += 'Orden número ' + actual.orderNumber + '. ';
  if (actual.recipient) texto += 'Para ' + actual.recipient + '. ';
  texto += actual.address + '.';
  if (userLocation) texto += ' Está a ' + distancia(userLocation, actual.coords).toFixed(1) + ' kilómetros.';
  const utt = new SpeechSynthesisUtterance(texto);
  utt.lang = 'es-MX'; utt.rate = 0.95;
  speechSynthesis.cancel(); speechSynthesis.speak(utt);
});

btnCopy.addEventListener('click', async function() {
  const validos = packages.filter(function(p) { return p.coords; });
  const actual = validos[currentStopIndex];
  if (!actual) return;
  let texto = '';
  if (actual.orderNumber) texto += 'Orden: ' + actual.orderNumber + '\n';
  if (actual.recipient) texto += 'Destinatario: ' + actual.recipient + '\n';
  texto += actual.address;
  try {
    await navigator.clipboard.writeText(texto);
    alert('📋 Copiado:\n\n' + texto);
  } catch (err) {
    const textarea = document.createElement('textarea');
    textarea.value = texto;
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    document.body.removeChild(textarea);
    alert('📋 Copiado:\n\n' + texto);
  }
});

btnOpenMaps.addEventListener('click', function() {
  const validos = packages.filter(function(p) { return p.coords; });
  const actual = validos[currentStopIndex];
  if (!actual) return;
  const url = 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(actual.address);
  window.open(url, '_blank');
});

btnNext.addEventListener('click', function() {
  const validos = packages.filter(function(p) { return p.coords; });
  const actual = validos[currentStopIndex];
  if (!actual) return;
  const titulo = actual.recipient || ('Paquete ' + (currentStopIndex + 1));
  const ordenTxt = actual.orderNumber ? '#' + actual.orderNumber + ' · ' : '';
  if (!confirm('¿Marcar como entregado?\n\n' + ordenTxt + titulo + '\n' + actual.address)) return;
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
      viewMap.hidden = true; viewHome.hidden = false;
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
console.log('app v32 cargado');