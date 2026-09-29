// ============================================
//  Enrutador PWA — Lógica principal (v10)
//  Preprocesamiento mínimo + doble OCR (crudo y gris)
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

// ---------- Preprocesamiento MÍNIMO ----------
// Solo escala 1.5x + grises suave. Sin binarizar, sin nitidez.
function preprocesarCanvas(canvasOriginal) {
  const escala = 1.5;
  const w = Math.round(canvasOriginal.width * escala);
  const h = Math.round(canvasOriginal.height * escala);

  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(canvasOriginal, 0, 0, w, h);

  const imageData = ctx.getImageData(0, 0, w, h);
  const data = imageData.data;

  // Grises con contraste suave
  let min = 255, max = 0;
  const gray = new Uint8ClampedArray(w * h);
  for (let i = 0, j = 0; i < data.length; i += 4, j++) {
    const g = Math.round(0.299 * data[i] + 0.587 * data[i+1] + 0.114 * data[i+2]);
    gray[j] = g;
    if (g < min) min = g;
    if (g > max) max = g;
  }
  const range = (max - min) || 1;
  for (let j = 0, k = 0; j < gray.length; j++, k += 4) {
    const v = ((gray[j] - min) / range) * 255;
    data[k] = v; data[k+1] = v; data[k+2] = v; data[k+3] = 255;
  }
  ctx.putImageData(imageData, 0, 0);
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
        aspectRatio: 2.5,
        autoCropArea: 0.9,
        movable: true, zoomable: true, rotatable: true,
        scalable: false, background: false, responsive: true
      });
    }, 100);
  };
  reader.readAsDataURL(file);
});

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

// ---------- OCR ----------
btnConfirmCrop.addEventListener('click', async () => {
  if (!cropperInstance) return;

  // Recorte en resolución moderada (sin exagerar; a veces MENOS es MÁS)
  const canvasRecortado = cropperInstance.getCroppedCanvas({
    maxWidth: 1400, maxHeight: 1400,
    imageSmoothingEnabled: true, imageSmoothingQuality: 'high'
  });
  if (!canvasRecortado) { alert('No se pudo recortar la imagen.'); return; }

  const canvasGris = preprocesarCanvas(canvasRecortado);
  labelPreview.src = canvasGris.toDataURL('image/jpeg', 0.9);

  cropperInstance.destroy();
  cropperInstance = null;
  cropModal.hidden = true;
  rotacionActual = 0;

  inputRecipient.value = '';
  inputAddress.value = '';
  ocrText.textContent = '';
  addressModal.hidden = false;

  showLoader('Iniciando OCR…');
  let cancelado = false;
  const timeoutId = setTimeout(() => {
    cancelado = true; hideLoader();
    alert('El OCR tardó demasiado.');
  }, 150000);

  try {
    const blobCrudo = await new Promise(res => canvasRecortado.toBlob(res, 'image/png'));
    const blobGris  = await new Promise(res => canvasGris.toBlob(res, 'image/png'));

    // ---- Pasada 1: imagen ORIGINAL (sin procesar) ----
    loaderText.textContent = 'Lectura 1/2 (original)…';
    const r1 = await Tesseract.recognize(blobCrudo, 'spa', {
      tessedit_pageseg_mode: '4',
      logger: m => {
        if (cancelado) return;
        if (m.status === 'recognizing text') loaderText.textContent = `Lectura 1/2… ${Math.round(m.progress * 100)}%`;
        else if (m.status === 'loading language traineddata') loaderText.textContent = 'Descargando idioma…';
      }
    });
    if (cancelado) return;

    // ---- Pasada 2: imagen en grises ----
    loaderText.textContent = 'Lectura 2/2 (grises)…';
    const r2 = await Tesseract.recognize(blobGris, 'spa', {
      tessedit_pageseg_mode: '4',
      logger: m => {
        if (cancelado) return;
        if (m.status === 'recognizing text') loaderText.textContent = `Lectura 2/2… ${Math.round(m.progress * 100)}%`;
      }
    });
    if (cancelado) return;

    clearTimeout(timeoutId);

    const t1 = (r1.data.text || '').trim();
    const t2 = (r2.data.text || '').trim();

    // Score: contar palabras "españolas válidas" + presencia de CP + números de calle
    const score = (t) => {
      const palabras = (t.match(/\b[A-Za-zÁÉÍÓÚÑáéíóúñ]{4,}\b/g) || []).length;
      const cp = /\b\d{5}\b/.test(t) ? 10 : 0;
      const numCalle = /\b\d{2,4}\b/.test(t) ? 3 : 0;
      return palabras + cp + numCalle;
    };
    const s1 = score(t1), s2 = score(t2);

    // Elegir el mejor, o unir si son complementarios
    ocrResultText = s1 >= s2 ? t1 : t2;

    ocrText.textContent = `--- Original (${s1}) ---\n${t1}\n\n--- Grises (${s2}) ---\n${t2}\n\n>>> ELEGIDA: ${s1 >= s2 ? 'Original' : 'Grises'}`;

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