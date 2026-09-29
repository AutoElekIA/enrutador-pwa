// ============================================
//  Enrutador PWA — Lógica principal (v9)
//  + Rotación y aspect ratio en el recorte
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

const btnCapture   = document.getElementById('btnCapture');
const btnOptimize  = document.getElementById('btnOptimize');
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

const loader     = document.getElementById('loader');
const loaderText = document.getElementById('loaderText');

function showLoader(msg) { loaderText.textContent = msg || 'Procesando…'; loader.hidden = false; }
function hideLoader() { loader.hidden = true; }
function savePackages() { localStorage.setItem('packages', JSON.stringify(packages)); }

// ---------- PREPROCESAMIENTO ----------
function preprocesarCanvas(canvasOriginal) {
  const escala = 2;
  const w = canvasOriginal.width * escala;
  const h = canvasOriginal.height * escala;

  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(canvasOriginal, 0, 0, w, h);

  const imageData = ctx.getImageData(0, 0, w, h);
  const data = imageData.data;

  const gray = new Float32Array(w * h);
  let min = 255, max = 0;
  for (let i = 0, j = 0; i < data.length; i += 4, j++) {
    const g = 0.299 * data[i] + 0.587 * data[i+1] + 0.114 * data[i+2];
    gray[j] = g;
    if (g < min) min = g;
    if (g > max) max = g;
  }

  const range = (max - min) || 1;
  const stretched = new Float32Array(w * h);
  for (let j = 0; j < gray.length; j++) stretched[j] = ((gray[j] - min) / range) * 255;

  const blurred = medianBlur3x3(stretched, w, h);
  const suave = gaussianBlur3x3(blurred, w, h);
  const nitida = new Float32Array(w * h);
  for (let j = 0; j < blurred.length; j++) {
    const v = blurred[j] + (blurred[j] - suave[j]) * 1.2;
    nitida[j] = Math.max(0, Math.min(255, v));
  }

  const out = ctx.createImageData(w, h);
  const od = out.data;
  for (let j = 0, k = 0; j < nitida.length; j++, k += 4) {
    let v = nitida[j];
    if (v < 90) v = 0;
    else if (v > 170) v = 255;
    od[k] = v; od[k+1] = v; od[k+2] = v; od[k+3] = 255;
  }
  ctx.putImageData(out, 0, 0);
  return canvas;
}

function medianBlur3x3(src, w, h) {
  const dst = new Float32Array(w * h);
  const ventana = new Array(9);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let n = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx >= 0 && nx < w && ny >= 0 && ny < h) ventana[n++] = src[ny * w + nx];
      }
      const sub = ventana.slice(0, n).sort((a, b) => a - b);
      dst[y * w + x] = sub[Math.floor(sub.length / 2)];
    }
  }
  return dst;
}

function gaussianBlur3x3(src, w, h) {
  const dst = new Float32Array(w * h);
  const k = [1, 2, 1, 2, 4, 2, 1, 2, 1];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let suma = 0, peso = 0, idx = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++, idx++) {
        const nx = x + dx, ny = y + dy;
        if (nx >= 0 && nx < w && ny >= 0 && ny < h) { suma += src[ny * w + nx] * k[idx]; peso += k[idx]; }
      }
      dst[y * w + x] = suma / peso;
    }
  }
  return dst;
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
btnCapture.addEventListener('click', () => cameraInput.click());

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
        aspectRatio: 2.5,      // Por defecto: ancho (ideal etiquetas de paquetería)
        autoCropArea: 0.9,
        movable: true,
        zoomable: true,
        rotatable: true,
        scalable: false,
        background: false,
        responsive: true,
        guides: true,
        center: true,
        highlight: false
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

btnWide.addEventListener('click', () => {
  if (cropperInstance) cropperInstance.setAspectRatio(2.5);
});

btnSquare.addEventListener('click', () => {
  if (cropperInstance) cropperInstance.setAspectRatio(1);
});

btnFree.addEventListener('click', () => {
  if (cropperInstance) cropperInstance.setAspectRatio(NaN);
});

btnCancelCrop.addEventListener('click', () => {
  if (cropperInstance) { cropperInstance.destroy(); cropperInstance = null; }
  cropModal.hidden = true;
  cameraInput.value = '';
  rotacionActual = 0;
});

// ---------- OCR ----------
btnConfirmCrop.addEventListener('click', async () => {
  if (!cropperInstance) return;

  const canvasRecortado = cropperInstance.getCroppedCanvas({
    maxWidth: 1600, maxHeight: 1600,
    imageSmoothingEnabled: true, imageSmoothingQuality: 'high'
  });
  if (!canvasRecortado) { alert('No se pudo recortar la imagen.'); return; }

  const canvasProcesado = preprocesarCanvas(canvasRecortado);
  labelPreview.src = canvasProcesado.toDataURL('image/jpeg', 0.92);

  cropperInstance.destroy();
  cropperInstance = null;
  cropModal.hidden = true;
  rotacionActual = 0;

  inputRecipient.value = '';
  inputAddress.value = '';
  ocrText.textContent = '';
  addressModal.hidden = false;

  showLoader('Preparando imagen…');
  let cancelado = false;
  const timeoutId = setTimeout(() => {
    cancelado = true; hideLoader();
    alert('El OCR tardó demasiado. Intenta con una foto más cercana o mejor luz.');
  }, 150000);

  try {
    const blob = await new Promise(res => canvasProcesado.toBlob(res, 'image/png'));

    loaderText.textContent = 'Lectura 1/2…';
    const r1 = await Tesseract.recognize(blob, 'spa', {
      tessedit_pageseg_mode: '6',
      preserve_interword_spaces: '1',
      logger: m => {
        if (cancelado) return;
        if (m.status === 'recognizing text') loaderText.textContent = `Lectura 1/2… ${Math.round(m.progress * 100)}%`;
        else if (m.status === 'loading language traineddata') loaderText.textContent = 'Descargando idioma (1ª vez)…';
      }
    });
    if (cancelado) return;

    loaderText.textContent = 'Lectura 2/2…';
    const r2 = await Tesseract.recognize(blob, 'spa', {
      tessedit_pageseg_mode: '11',
      preserve_interword_spaces: '1',
      logger: m => {
        if (cancelado) return;
        if (m.status === 'recognizing text') loaderText.textContent = `Lectura 2/2… ${Math.round(m.progress * 100)}%`;
      }
    });
    if (cancelado) return;

    clearTimeout(timeoutId);

    const t1 = r1.data.text || '';
    const t2 = r2.data.text || '';
    const score = (t) => {
      const palabras = (t.match(/\b[A-Za-zÁÉÍÓÚÑáéíóúñ]{3,}\b/g) || []).length;
      const tieneCP = /\b\d{5}\b/.test(t) ? 5 : 0;
      return palabras + tieneCP;
    };
    ocrResultText = score(t2) > score(t1) ? t2 : t1;

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
const CORRECCIONES = [
  [/\bZACANGD\b/gi, 'ZACANGO'],
  [/\bMETEPECC?P\b/gi, 'METEPEC, CP'],
  [/\bMETEPEC\s*CP\b/gi, 'METEPEC, CP'],
  [/\bCP\s*(\d{5})/gi, 'CP $1'],
  [/\bMETEPEC\s+(\d{5})/gi, 'METEPEC, CP $1'],
];

function aplicarCorrecciones(texto) {
  let t = texto;
  for (const [re, sub] of CORRECCIONES) t = t.replace(re, sub);
  return t;
}

function detectarDireccion(texto) {
  let t = aplicarCorrecciones(texto)
    .replace(/[“”«»]/g, '"')
    .replace(/[^\S\n]+/g, ' ')
    .replace(/[|]/g, 'I');

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
  for (const l of lineas) {
    const m = l.match(/(?:destinatario|nombre|para|sr\.?|sra\.?)[:\s]+(.+)/i);
    if (m && m[1].trim().length > 2) return m[1].trim();
  }
  const prohibidas = ['direcc', 'calle', 'colonia', 'envio', 'envío', 'guia', 'guía',
                      'paquete', 'remitente', 'cp', 'código', 'codigo', 'tel',
                      'teléfono', 'camino', 'av.', 'avenida', 'metepec', 'méxico',
                      'mexico', 'santa', 'maría', 'magdalena', 'zacango'];
  for (const l of lineas.slice(0, 4)) {
    const low = l.toLowerCase();
    const tiene = prohibidas.some(k => low.includes(k));
    const nombre = /^[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+(\s+[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+){1,3}$/.test(l);
    if (nombre && !tiene) return l;
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
      if (data && data[0]) p.coords = { lat: parseFloat(data[0].lat), lon: parseFloat(data[0].lon) };
      await new Promise(res => setTimeout(res, 1100));
    }
    const validos = packages.filter(p => p.coords);
    if (validos.length === 0) { hideLoader(); alert('No se pudo geocodificar ninguna dirección.'); return; }
    const continuar = (origen) => {
      ordenarPorVecinoMasCercano(origen, validos);
      savePackages(); renderPackages(); hideLoader();
      alert('Ruta optimizada. Lista para navegar.');
    };
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        pos => continuar({ lat: pos.coords.latitude, lon: pos.coords.longitude }),
        () => continuar(validos[0].coords)
      );
    } else continuar(validos[0].coords);
  } catch (err) { hideLoader(); alert('Error al optimizar: ' + err.message); }
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