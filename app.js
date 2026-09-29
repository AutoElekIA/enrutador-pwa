// Registrar el Service Worker
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js')
    .then(() => console.log('Service Worker registrado'))
    .catch(err => console.log('Error SW:', err));
}

// Simular que la app está lista
document.addEventListener('DOMContentLoaded', () => {
  console.log('Enrutador PWA cargado correctamente.');
  
  const btnCapture = document.getElementById('btnCapture');
  btnCapture.addEventListener('click', () => {
    document.getElementById('cameraInput').click();
  });

  document.getElementById('cameraInput').addEventListener('change', (e) => {
    if (e.target.files.length > 0) {
      alert('¡Foto capturada! Aquí iría el OCR de Tesseract.js.');
    }
  });
});