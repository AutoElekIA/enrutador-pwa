# Portafolio AutoElekIA

Inventario completo de productos del ecosistema AutoElekIA. Cada
producto es independiente, pero todos comparten marca, iconografía y
estandares de calidad.

## Estandar de calidad

Todos los productos deben cumplir con:

- [ ] Repositorio en GitHub (privado)
- [ ] README claro con descripcion y stack
- [ ] Carpeta docs/ con: vision, arquitectura, roadmap, decisiones
- [ ] Iconos del kit oficial (autoelekia-brand)
- [ ] URL publica de demo (si aplica)
- [ ] Versionado semantico (tags)
- [ ] Documentacion del modelo de negocio

## Productos

### 1. Transporte Escolar

**Descripcion:** SaaS multi-tenant para empresas de transporte escolar.
Gestiona alumnos, tutores, colegios, rutas, unidades, choferes,
cobranza, GPS y PWAs (chofer y tutor).

**Estado:** Backend en produccion, bloqueado por bug de IP de ZevCloud.

**Repos:**
- Backend: autoelekia-transporte-escolar
- Frontend: autoelekia-admin

**URL produccion:** admin.autoelekia.lat

**Stack:** Flask + MySQL + Vue 3 + Cloudflare Pages

**Prioridad:** Alta (bloqueante externo pendiente)

---

### 2. Compras del Hogar

**Descripcion:** PWA colaborativa para listas de compras familiares,
con entrega a domicilio por choferes de la red escolar. Modelo B2B2C
(familias gratis, comercios pagan comision via Stripe Connect).

**Estado:** MVP funcional sin comercios integrados. Documentacion
completa.

**Repos:**
- App: compras-hogar

**URL produccion:** (pendiente, esta en GitHub Pages)

**Stack:** Firebase (Firestore + Auth) + Stripe Connect

**Fases pendientes:**
- Fase 0: piloto manual (10 pedidos reales)
- Fase 2: multi-hogar
- Fase 3: pilotos con restaurantes
- Fase 4-7: comercios, choferes, pagos, escala

**Prioridad:** Alta (documentado y listo para piloto)

---

### 3. Enrutador PWA

**Descripcion:** App movil para choferes de reparto. Escanea tickets,
geocodifica direcciones, genera rutas optimizadas y guia
turn-by-turn con voz.

**Estado:** App madura (v35). Sin documentacion. Sin backend.

**Repos:**
- App: enrutador-pwa

**URL produccion:** (pendiente)

**Stack:** Vanilla JS + Leaflet + Nominatim + OCR.space + html5-qrcode

**Features:**
- Escaneo QR/codigo de barras
- OCR de etiquetas de direccion
- Geocodificacion Mexico (formato Google)
- Dedupe inteligente de direcciones
- Ruta por vecino mas cercano
- Navegacion turn-by-turn con voz
- Integracion con Google Maps

**Prioridad:** Alta (falta documentacion)

---

### 4. ERP Contable

**Descripcion:** ERP contable-administrativo. Recien encontrado en
disco externo.

**Estado:** Por evaluar (recien encontrado).

**Repos:** (pendiente)

**Stack:** (por determinar)

**Prioridad:** Alta (respaldar en GitHub cuanto antes)

---

### 5. Mike - ERP de Condominios

**Descripcion:** SaaS ERP para administracion de condominios,
torres, manzanas, supermanzanas, cabañas y todo tipo de propiedades.
Gestiona amenidades (albercas, areas verdes, canchas, club, salones,
auditorios), mantenimiento, cuotas, condominos, arrendadores,
arrendatarios y propietarios.

**Estado:** Codigo empezado, incompleto. Stack no confirmado.

**Repos:** mike-saas

**Stack:** (por determinar)

**Alcance:**
- Tipos de propiedad: vertical, horizontal, supermanzana, cabañas
- Amenidades: albercas, areas verdes, canchas, club, salones,
  auditorios, etc.
- Gestion: mantenimiento, cuotas, condominos, arrendadores,
  arrendatarios, propietarios
- Finanzas: cobranza, presupuestos, reportes

**Prioridad:** Media (reactivar cuando haya tiempo)

---

### 6. Liga SaaS

**Descripcion:** SaaS para administracion de ligas de futbol.
Gestiona equipos, jugadores, torneos, arbitros, cobros y calendario.

**Estado:** Documentacion completa, codigo pendiente.

**Repos:** liga-saas

**Stack planificado:** Node.js + TypeScript + NestJS + PostgreSQL +
React + Next.js

**Prioridad:** Baja (documentado, espera desarrollo)

---

### 7. AutoElekIA Brand

**Descripcion:** Kit oficial de marca. Iconos, logos, paleta de
colores y reglas de uso para todo el ecosistema.

**Estado:** Completo y en produccion.

**Repos:** autoelekia-brand

**Stack:** SVG + PNG

**Prioridad:** Completada

---

## Prioridades de consolidacion

Por orden de impacto:

1. **ERP Contable** - Respaldar en GitHub (alto valor, riesgo de perdida)
2. **Enrutador PWA** - Documentar (app madura, sin docs)
3. **Mike** - Evaluar codigo y documentar
4. **Liga SaaS** - Esperar desarrollo
5. **Transporte Escolar** - Esperar respuesta de ZevCloud
6. **Compras del Hogar** - Piloto Fase 0

## Reglas del portafolio

1. **Nada vive solo en un disco.** Todo va a GitHub.
2. **Todo tiene README.** Si no esta documentado, no existe.
3. **Iconografia unificada.** Todos usan autoelekia-brand.
4. **Commits y pusheos frecuentes.** Codespaces se resetea.
5. **Un producto, un repo.** No monorepos (a menos que sea necesario).
6. **Documentar antes de construir.** Regla adoptada el 2026-10-11.
7. **Regla pastel:** 5% de algo mejor que 35% de nada.

## Autor

Equipo AutoElekIA (c) 2026
