// ============================================
//  Enrutador PWA — Lógica principal (v12)
//  OCR.space + correcciones OCR + mejor detección de destinatario
// ============================================

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js')
    .then(() => console.log('SW registrado'))
    .catch(err => console.log('Error SW:', err));
}

let packages = JSON.parse(localStorage.getItem('packages') || '[]');
let ocrResultText = '';
let cropperInstance = null;
let rotacionActual = 0;

// ---------- DOM ----------
const btnCapture   = document.getElementById('btnCapture');
const btnOptimize  = document.getElementById('btnOptimize');
const btnSettings  = document.getElementById('btnSettings');
const cameraInput  = document.getElementById('cameraInput');
const packagesList = document.getElementById('packagesList');

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

function showLoader(msg) { loaderText.textContent = msg || 'Procesando…'; loader.hidden = false; }
function hideLoader() { loader.hidden = true; }
function savePackages() { localStorage.setItem('packages', JSON.stringify(packages)); }

// ---------- API key ----------
function getApiKey() { return localStorage.getItem('ocrspace_key') || ''; }
function setApiKey(key) { localStorage.setItem('ocrspace_key', key.trim()); }

// ---------- Reducir imagen a <1MB (requisito de OCR.space gratis) ----------
async function canvasABlobLigero(canvas) {
  let calidad = 0.85;
  let blob = await new Promise(res => canvas.toBlob(res, 'image/jpeg', calidad));
  while (blob && blob.size > 950000 && calidad > 0.3) {
    calidad -= 0.1;
    blob = await new Promise(res => canvas.toBlob(res, 'image/jpeg', calidad));
  }
  return blob;
}

// ---------- Llamada a OCR.space ----------
async function ocrSpaceReconocer(canvas, apiKey) {
  const blob = await canvasABlobLigero(canvas);

  const formData = new FormData();
  formData.append('apikey', apiKey);
  formData.append('language', 'spa');
  formData.append('isOverlayRequired', 'false');
  formData.append('OCREngine', '2');            // motor 2 = mejor para texto pequeño
  formData.append('scale', 'true');             // reescala internamente
  formData.append('detectOrientation', 'true');
  formData.append('file', blob, 'etiqueta.jpg');

  const resp = await fetch('https://api.ocr.space/parse/image', {
    method: 'POST',
    body: formData
  });
  const data = await resp.json();

  if (data.IsErroredOnProcessing) {
    throw new Error((data.ErrorMessage && data.ErrorMessage[0]) || 'Error en OCR.space');
  }
  if (!data.ParsedResults || !data.ParsedResults.length) {
    throw new Error('OCR.space no devolvió texto.');
  }
  return data.ParsedResults[0].ParsedText || '';
}

// ---------- Preprocesamiento visual (solo para mostrar al usuario) ----------
function prepararVistaPrevia(canvasOriginal) {
  const w = canvasOriginal.width;
  const h = canvasOriginal.height;
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(canvasOriginal, 0, 0);
  return canvas;
}

// ---------- Render ----------
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

// ---------- Captura ----------
btnCapture.addEventListener('click', () => {
  if (!getApiKey()) {
    alert('Primero configura tu API key de OCR.space en Ajustes ⚙️');
    return;
  }
  cameraInput.click();
});

cameraInput.addEventListener('change', (e) => {
  if (!e.target.files || e.target.files.length === 0) return;
  const file = e.target.files[0];
  const reader = new FileReader();
  reader.onload = (ev) => {
    cropImage.src = ev.target.result;
    cropModal.hidden = false;
    rotacionActual = 0;
    if (cropperInstance) { cropperInstance.destroy(); cropperInstance = null; }
    setTimeout(() => {
      cropperInstance = new Cropper(cropImage, {
        viewMode: 1,
        aspectRatio: 2.5,
        autoCropArea: 0.9,
        movable: true, zoomable: true, rotatable: true,
        scalable: false, background: false, responsive: true
      });
    }, 100);
  };
  reader.readAsDataURL(file);
});

// ---------- Controles del recorte ----------
btnRotate.addEventListener('click', () => {
  if (!cropperInstance) return;
  rotacionActual = (rotacionActual + 90) % 360;
  cropperInstance.rotate(rotacionActual);
});
btnWide.addEventListener('click', () => { if (cropperInstance) cropperInstance.setAspectRatio(2.5); });
btnSquare.addEventListener('click', () => { if (cropperInstance) cropperInstance.setAspectRatio(1); });
btnFree.addEventListener('click', () => { if (cropperInstance) cropperInstance.setAspectRatio(NaN); });

btnCancelCrop.addEventListener('click', () => {
  if (cropperInstance) { cropperInstance.destroy(); cropperInstance = null; }
  cropModal.hidden = true;
  cameraInput.value = '';
  rotacionActual = 0;
});

// ---------- Confirmar recorte → OCR.space ----------
btnConfirmCrop.addEventListener('click', async () => {
  if (!cropperInstance) return;

  const canvasRecortado = cropperInstance.getCroppedCanvas({
    maxWidth: 2000, maxHeight: 2000,
    imageSmoothingEnabled: true, imageSmoothingQuality: 'high'
  });
  if (!canvasRecortado) { alert('No se pudo recortar la imagen.'); return; }

  const canvasVista = prepararVistaPrevia(canvasRecortado);
  labelPreview.src = canvasVista.toDataURL('image/jpeg', 0.9);

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
    ocrText.textContent = 'Error: ' + err.message;
    alert('Error de OCR: ' + err.message);
  } finally {
    hideLoader();
    cameraInput.value = '';
  }
});

// ---------- Correcciones de errores típicos de OCR ----------
const CORRECCIONES_OCR = [
  // METEPECCP → METEPEC, CP
  [/\bMETEPECCP\b/gi, 'METEPEC, CP'],
  [/\b([A-ZÁÉÍÓÚÑ]{4,})CP\s*(\d{5})/g, '$1, CP $2'],
  // CP sin espacio después
  [/\bCP(\d{5})/gi, 'CP $1'],
  // Ciudades pegadas al CP
  [/\bMETEPEC\s*(\d{5})/gi, 'METEPEC, CP $1'],
  // SAN MIGUEL / SANTA MARIA bien formateados
  [/\bSANTA\s+MARIA\b/gi, 'Santa María'],
  [/\bSAN\s+MIGUEL\b/gi, 'San Miguel'],
  // Múltiples espacios colapsados
  [/\s{2,}/g, ' '],
];

function aplicarCorrecciones(texto) {
  let t = texto;
  for (const [re, sub] of CORRECCIONES_OCR) t = t.replace(re, sub);
  return t;
}

// ---------- Heurísticas ----------
function detectarDireccion(texto) {
  let t = aplicarCorrecciones(texto).replace(/[“”«»]/g, '"').replace(/[|]/g, 'I');
  const lineas = t.split('\n').map(l => l.trim()).filter(l => l.length > 2);
  if (lineas.length === 0) return '';
  const textoCompleto = lineas.join(' ');

  const matchDir = textoCompleto.match(/(?:direcci[oó]n\s*(?:completa)?[:\s]+)(.+)/i);
  if (matchDir && matchDir[1].trim().length > 10) return limpiarDireccion(matchDir[1].trim());

  const matchCP = textoCompleto.match(/\b(\d{5})\b/);
  const idxCP = matchCP ? lineas.findIndex(l => l.includes(matchCP[1])) : -1;
  if (idxCP > -1) {
    const inicio = Math.max(0, idxCP - 3);
    const fin = Math.min(lineas.length, idxCP + 1);
    return limpiarDireccion(lineas.slice(inicio, fin).join(', '));
  }
  return limpiarDireccion(lineas.slice(0, 5).join(', '));
}

function limpiarDireccion(s) {
  return s.replace(/\s+/g, ' ').replace(/\s*,\s*/g, ', ').replace(/[.,;]+$/, '').trim();
}

function detectarNombre(texto) {
  const lineas = texto.split('\n').map(l => l.trim()).filter(l => l.length > 2);
  if (lineas.length === 0) return '';

  // Buscar "destinatario:" / "nombre:" explícito
  for (const l of lineas) {
    const m = l.match(/(?:destinatario|nombre|para|sr\.?|sra\.?)[:\s]+(.+)/i);
    if (m && m[1].trim().length > 2) return m[1].trim();
  }

  // Palabras que NUNCA son un nombre de persona
  const prohibidas = ['direcc', 'calle', 'colonia', 'envio', 'envío',
                      'guia', 'guía', 'paquete', 'remitente', 'cp',
                      'código', 'codigo', 'tel', 'teléfono', 'camino',
                      'av.', 'avenida', 'metepec', 'méxico', 'mexico',
                      'santa', 'san', 'maría', 'magdalena', 'zacango',
                      'forestal', 'dreams', 'lagoons', 'privada',
                      'framboyanes', 'totocuitlapilco', 'toluca'];

  // Solo aceptar líneas que parezcan "Nombre Apellido" (2-3 palabras capitalizadas)
  for (const l of lineas.slice(0, 5)) {
    const low = l.toLowerCase();
    const tieneProhibida = prohibidas.some(k => low.includes(k));
    const sinNumeros = !/\d/.test(l);
    const tieneForma = /^[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+(\s+[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+){1,3}$/.test(l);
    if (!tieneProhibida && sinNumeros && tieneForma) return l;
  }
  return '';
}

// ---------- Ajustes (API key) ----------
btnSettings.addEventListener('click', () => {
  inputApiKey.value = getApiKey();
  settingsModal.hidden = false;
});

btnCancelSettings.addEventListener('click', () => { settingsModal.hidden = true; });

btnSaveSettings.addEventListener('click', () => {
  const key = inputApiKey.value.trim();
  if (!key) { alert('Ingresa una key válida.'); return; }
  setApiKey(key);
  settingsModal.hidden = true;
  alert('Key guardada correctamente.');
});

// ---------- Guardar paquete ----------
btnCancelAddress.addEventListener('click', () => { addressModal.hidden = true; });
btnSaveAddress.addEventListener('click', () => {
  const recipient = inputRecipient.value.trim();
  const address   = inputAddress.value.trim();
  if (!address) { alert('Debes escribir una dirección.'); return; }
  packages.push({
    recipient, address, ocr: ocrResultText,
    coords: null, delivered: false, createdAt: Date.now()
  });
  savePackages();
  renderPackages();
  addressModal.hidden = true;
});

// ---------- Optimizar ruta ----------
// ---------- Geocodificación robusta ----------
function limpiarParaGeocodificar(direccion) {
  let d = direccion
    .replace(/\s*,\s*/g, ', ')
    .replace(/,\s*CP\s*\d{5}/gi, '')        // quita "CP 52161"
    .replace(/\bCP\s*\d{5}\b/gi, '')         // quita "CP52161"
    .replace(/\bMetepec\s*,?\s*Metepec\b/gi, 'Metepec')  // quita duplicados
    .replace(/\s{2,}/g, ' ')
    .replace(/,\s*,/g, ',')
    .replace(/,\s*$/, '')
    .trim();
  return d;
}

function extraerCP(direccion) {
  const m = direccion.match(/\b(\d{5})\b/);
  return m ? m[1] : '';
}

function extraerCiudad(direccion) {
  const ciudades = ['Metepec', 'Toluca', 'Zinacantepec', 'San Mateo Atenco',
                    'Lerma', 'Calimaya', 'Mexicaltzingo', 'Chapultepec'];
  for (const c of ciudades) {
    if (new RegExp(`\\b${c}\\b`, 'i').test(direccion)) return c;
  }
  return '';
}

async function geocodificarDireccion(direccion) {
  const limpia = limpiarParaGeocodificar(direccion);
  const cp = extraerCP(direccion);
  const ciudad = extraerCiudad(direccion) || 'Metepec'; // Metepec por defecto para tu zona

  // Variantes reordenadas: CP PRIMERO (porque ya probamos que funciona)
  const variantes = [
    cp ? `${cp}, ${ciudad}, Estado de México, México` : null,  // 1. Solo CP + ciudad ⭐
    cp ? `${cp}, México` : null,                                // 2. Solo CP
    `${limpia}, ${ciudad}, Estado de México, México`,           // 3. Dirección + ciudad + estado
    `${limpia}, México`,                                         // 4. Dirección + México
    `${ciudad}, Estado de México, México`                        // 5. Solo ciudad
  ].filter(Boolean);

  const intentos = [];   // para diagnóstico

  for (let i = 0; i < variantes.length; i++) {
    const consulta = variantes[i];
    try {
      const resultado = await geocodificarConNominatim(consulta);
      if (resultado) {
        console.log(`✅ Variante ${i + 1} OK:`, consulta);
        console.log(`   → ${resultado.display}`);
        return resultado;
      } else {
        intentos.push(`❌ "${consulta}" → sin resultados`);
      }
    } catch (err) {
      intentos.push(`⚠️ "${consulta}" → ${err.message}`);
    }
    // Respetar el rate limit de Nominatim (1 req/seg)
    await new Promise(res => setTimeout(res, 1200));
  }

  // Si TODO falló, lanzar error con detalles
  const err = new Error('Nominatim no encontró la dirección.\n\nIntentos:\n' + intentos.join('\n'));
  err.intentos = intentos;
  throw err;
}

// ---------- Optimizar ruta ----------
btnOptimize.addEventListener('click', async () => {
  if (packages.length === 0) return;
  showLoader('Geocodificando direcciones…');
  const errores = [];

  try {
    for (let i = 0; i < packages.length; i++) {
      const p = packages[i];
      if (p.coords) continue;
      loaderText.textContent = `Geocodificando ${i + 1}/${packages.length}…`;

      try {
        const resultado = await geocodificarDireccion(p.address);
        p.coords = { lat: resultado.lat, lon: resultado.lon };
        p.geocodedAs = resultado.display;
      } catch (err) {
        errores.push({
          address: p.address,
          detalles: err.intentos || [err.message]
        });
      }
    }

    const validos = packages.filter(p => p.coords);
    const fallidos = packages.filter(p => !p.coords);

    if (validos.length === 0) {
      hideLoader();
      // Mostrar detalle de los intentos en la consola
      console.group('🔍 Diagnóstico de geocodificación');
      errores.forEach(e => {
        console.log('Dirección:', e.address);
        e.detalles.forEach(d => console.log('  ', d));
      });
      console.groupEnd();
      alert('No se pudo geocodificar ninguna dirección.\n\nAbre la consola (F12 o menú → Más herramientas → Consola) para ver los intentos.');
      return;
    }

    const continuar = (origen) => {
      ordenarPorVecinoMasCercano(origen, validos);
      savePackages();
      renderPackages();
      hideLoader();
      if (fallidos.length > 0) {
        alert(`Ruta optimizada con ${validos.length} parada(s).\n\n⚠️ ${fallidos.length} dirección(es) no se pudieron ubicar y se omitieron.`);
      } else {
        alert(`Ruta optimizada con ${validos.length} parada(s). Lista para navegar.`);
      }
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
  const restantes = [...lista]; const orden = []; let actual = inicio;
  while (restantes.length > 0) {
    let mejorIdx = 0, mejorDist = Infinity;
    for (let i = 0; i < restantes.length; i++) {
      const d = distancia(actual, restantes[i].coords);
      if (d < mejorDist) { mejorDist = d; mejorIdx = i; }
    }
    const elegido = restantes.splice(mejorIdx, 1)[0];
    orden.push(elegido); actual = elegido.coords;
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

document.addEventListener('DOMContentLoaded', () => renderPackages());