// ============================================
//  Enrutador PWA — Lógica principal (v7)
//  OCR con desenfoque mediano + spa+eng + PSM 6
// ============================================

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js')
    .then(() => console.log('SW registrado'))
    .catch(err => console.log('Error SW:', err));
}

let packages = JSON.parse(localStorage.getItem('packages') || '[]');
let ocrResultText = '';
let cropperInstance = null;

const btnCapture   = document.getElementById('btnCapture');
const btnOptimize  = document.getElementById('btnOptimize');
const cameraInput  = document.getElementById('cameraInput');
const packagesList = document.getElementById('packagesList');

const cropModal      = document.getElementById('cropModal');
const cropImage      = document.getElementById('cropImage');
const btnCancelCrop  = document.getElementById('btnCancelCrop');
const btnConfirmCrop = document.getElementById('btnConfirmCrop');

const addressModal    = document.getElementById('addressModal');
const labelPreview    = document.getElementById('labelPreview');
const inputRecipient  = document.getElementById('inputRecipient');
const inputAddress    = document.getElementById('inputAddress');
const ocrText         = document.getElementById('ocrText');
const btnCancelAddress = document.getElementById('btnCancelAddress');
const btnSaveAddress   = document.getElementById('btnSaveAddress');

const loader     = document.getElementById('loader');
const loaderText = document.getElementById('loaderText');

function showLoader(msg) { loaderText.textContent = msg || 'Procesando…'; loader.hidden = false; }
function hideLoader() { loader.hidden = true; }
function savePackages() { localStorage.setItem('packages', JSON.stringify(packages)); }

// ---------- PREPROCESAMIENTO ----------
// Escala de grises + estirado de contraste + desenfoque mediano 3x3
// (el desenfoque elimina el ruido tipo "puntitos" sin borrar los bordes del texto)
function preprocesarCanvas(canvasOriginal) {
  const w = canvasOriginal.width;
  const h = canvasOriginal.height;
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(canvasOriginal, 0, 0);

  const imageData = ctx.getImageData(0, 0, w, h);
  const data = imageData.data;

  // 1) Escala de grises
  const gray = new Uint8ClampedArray(w * h);
  let min = 255, max = 0;
  for (let i = 0, j = 0; i < data.length; i += 4, j++) {
    const g = Math.round(0.299 * data[i] + 0.587 * data[i+1] + 0.114 * data[i+2]);
    gray[j] = g;
    if (g < min) min = g;
    if (g > max) max = g;
  }

  // 2) Estirar contraste al rango completo SIN binarizar
  const range = (max - min) || 1;
  const stretched = new Uint8ClampedArray(w * h);
  for (let j = 0; j < gray.length; j++) {
    stretched[j] = ((gray[j] - min) / range) * 255;
  }

  // 3) Desenfoque mediano 3x3 (elimina ruido puntual tipo moiré)
  const blurred = medianBlur3x3(stretched, w, h);

  // 4) Umbralización SUAVE: solo empujo los extremos, dejo el medio
  const out = ctx.createImageData(w, h);
  const od = out.data;
  for (let j = 0, k = 0; j < blurred.length; j++, k += 4) {
    let v = blurred[j];
    if (v < 80) v = 0;
    else if (v > 190) v = 255;
    // El resto se queda tal cual (gris), Tesseract lo maneja bien
    od[k] = v; od[k+1] = v; od[k+2] = v; od[k+3] = 255;
  }
  ctx.putImageData(out, 0, 0);
  return canvas;
}

function medianBlur3x3(src, w, h) {
  const dst = new Uint8ClampedArray(w * h);
  const ventana = new Array(9);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let n = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx, ny = y + dy;
          if (nx >= 0 && nx < w && ny >= 0 && ny < h) {
            ventana[n++] = src[ny * w + nx];
          }
        }
      }
      // Ordenar solo los primeros n
      const sub = ventana.slice(0, n).sort((a, b) => a - b);
      dst[y * w + x] = sub[Math.floor(sub.length / 2)];
    }
  }
  return dst;
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

// ---------- Captura ----------
btnCapture.addEventListener('click', () => cameraInput.click());

cameraInput.addEventListener('change', (e) => {
  if (!e.target.files || e.target.files.length === 0) return;
  const file = e.target.files[0];
  const reader = new FileReader();
  reader.onload = (ev) => {
    cropImage.src = ev.target.result;
    cropModal.hidden = false;
    if (cropperInstance) { cropperInstance.destroy(); cropperInstance = null; }
    setTimeout(() => {
      cropperInstance = new Cropper(cropImage, {
        viewMode: 1, autoCropArea: 0.8, movable: true, zoomable: true,
        rotatable: true, scalable: false, background: false, responsive: true
      });
    }, 100);
  };
  reader.readAsDataURL(file);
});

btnCancelCrop.addEventListener('click', () => {
  if (cropperInstance) { cropperInstance.destroy(); cropperInstance = null; }
  cropModal.hidden = true;
  cameraInput.value = '';
});

// ---------- OCR ----------
btnConfirmCrop.addEventListener('click', async () => {
  if (!cropperInstance) return;

  const canvasRecortado = cropperInstance.getCroppedCanvas({
    maxWidth: 2200, maxHeight: 2200,
    imageSmoothingEnabled: true, imageSmoothingQuality: 'high'
  });
  if (!canvasRecortado) { alert('No se pudo recortar la imagen.'); return; }

  const canvasProcesado = preprocesarCanvas(canvasRecortado);
  labelPreview.src = canvasProcesado.toDataURL('image/jpeg', 0.92);

  cropperInstance.destroy();
  cropperInstance = null;
  cropModal.hidden = true;

  inputRecipient.value = '';
  inputAddress.value = '';
  ocrText.textContent = '';
  addressModal.hidden = false;

  showLoader('Preparando imagen…');
  let cancelado = false;
  const timeoutId = setTimeout(() => {
    cancelado = true; hideLoader();
    alert('El OCR tardó demasiado. Intenta con una foto más cercana o mejor luz.');
  }, 120000);

  try {
    const blob = await new Promise(res => canvasProcesado.toBlob(res, 'image/png'));

    // PSM 6 = "asume un bloque uniforme de texto" (ideal para etiquetas)
    const resultado = await Tesseract.recognize(blob, 'spa+eng', {
      tessedit_pageseg_mode: '6',
      preserve_interword_spaces: '1',
      logger: m => {
        if (cancelado) return;
        if (m.status === 'loading tesseract core')             loaderText.textContent = 'Cargando motor OCR…';
        else if (m.status === 'loading language traineddata')  loaderText.textContent = 'Descargando idioma (1ª vez)…';
        else if (m.status === 'initializing api')              loaderText.textContent = 'Inicializando…';
        else if (m.status === 'recognizing text')              loaderText.textContent = `Leyendo… ${Math.round(m.progress * 100)}%`;
      }
    });

    clearTimeout(timeoutId);
    if (cancelado) return;

    ocrResultText = resultado.data.text || '';
    ocrText.textContent = ocrResultText;

    inputAddress.value   = detectarDireccion(ocrResultText);
    inputRecipient.value = detectarNombre(ocrResultText);

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
function detectarDireccion(texto) {
  let t = texto
    .replace(/[“”«»]/g, '"')
    .replace(/[^\S\n]+/g, ' ')
    .replace(/[|]/g, 'I');
  const lineas = t.split('\n').map(l => l.trim()).filter(l => l.length > 2);
  if (lineas.length === 0) return '';
  const textoCompleto = lineas.join(' ');

  const matchDir = textoCompleto.match(/(?:direcci[oó]n\s*(?:completa)?[:\s]+)(.+)/i);
  if (matchDir && matchDir[1].trim().length > 10) {
    return limpiarDireccion(matchDir[1].trim());
  }
  const idxCP = lineas.findIndex(l => /\b\d{5}\b/.test(l));
  if (idxCP > -1) {
    const inicio = Math.max(0, idxCP - 3);
    const fin = Math.min(lineas.length, idxCP + 1);
    return limpiarDireccion(lineas.slice(inicio, fin).join(', '));
  }
  const claves = ['calle', 'av', 'avenida', 'col', 'colonia', 'cp', 'c.p',
                  'no.', 'núm', 'num', 'código postal', 'mz', 'lt',
                  'manzana', 'lote', 'andador', 'priv', 'privada', 'calz',
                  'camino', 'carretera', 'blvd', 'bulevar'];
  const relevantes = lineas.filter(l => {
    const low = l.toLowerCase();
    return claves.some(k => low.includes(k)) || /\d{3,}/.test(l);
  });
  if (relevantes.length > 0) return limpiarDireccion(relevantes.join(', '));
  return limpiarDireccion(lineas.slice(-3).join(', '));
}

function limpiarDireccion(s) {
  return s.replace(/\s+/g, ' ').replace(/\s*,\s*/g, ', ').replace(/[.,;]+$/, '').trim();
}

function detectarNombre(texto) {
  const lineas = texto.split('\n').map(l => l.trim()).filter(l => l.length > 2);
  if (lineas.length === 0) return '';
  for (const l of lineas) {
    const m = l.match(/(?:destinatario|nombre|para|sr\.?|sra\.?)[:\s]+(.+)/i);
    if (m && m[1].trim().length > 2) return m[1].trim();
  }
  const prohibidas = ['direcc', 'calle', 'colonia', 'envio', 'envío',
                      'guia', 'guía', 'paquete', 'remitente', 'cp',
                      'código', 'codigo', 'tel', 'teléfono', 'camino',
                      'av.', 'avenida', 'metepec', 'méxico', 'mexico'];
  for (const l of lineas.slice(0, 4)) {
    const low = l.toLowerCase();
    const tiene = prohibidas.some(k => low.includes(k));
    const nombre = /^[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+(\s+[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+){1,3}$/.test(l);
    if (nombre && !tiene) return l;
  }
  for (const l of lineas.slice(0, 3)) {
    const low = l.toLowerCase();
    if (!/\d/.test(l) && l.length > 3 && l.length < 45 &&
        !prohibidas.some(k => low.includes(k))) return l;
  }
  return '';
}

// ---------- Guardar ----------
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