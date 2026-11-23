# Galería de Shorts automáticos — The Random Reel

Fecha: 23 noviembre 2026.

## Desplegado
- **Producción**: https://gta-vi-viral-engine.vercel.app
- **Ruta autenticada**: https://gta-vi-viral-engine.vercel.app/api/automatic-shorts-studio
- **Deployment**: `dpl_BoTgHiSGH8zshdCaB7j5pdMhTSyy` (READY, alias oficial verificado)
- **Despliegue anterior conservado**: `dpl_7J9zSbc8X5BFdWhw7CWwnEJPzYDq`
- **Preview probada**: `dpl_Epgmk24QNRHqX1g76LLMf2tHfDnw`

## Contenido
- Acceso «▶ Ver Shorts generados» insertado en el menú del panel y en su pestaña Shorts, renderizado en el servidor.
- `GET /api/automatic-shorts-studio`: página privada con tarjetas y filtros.
- `GET /api/automatic-shorts-feed`: consulta estados reales de `state/worker_jobs.json`, `state/youtube_uploads.json` y MP4 retenidos en Blob bajo `renders/`, `rendered/`, `shorts/`, `videos/`.
- `GET /api/automatic-shorts-video?key=...`: reproduce únicamente archivos MP4 identificados en el inventario privado, tras comprobar el inicio de sesión.
- Si el MP4 se borró tras subirlo, la tarjeta muestra el enlace auténtico de YouTube cuando existe; no crea sustitutos simulados.
- No se han modificado colas, trabajos automáticos, edición FFmpeg, publicación ni privacidad de YouTube.

## Comprobaciones
- Preview y producción: **READY**.
- Con cookie de prueba firmada para una suite local (no sesión real): dashboard conserva apartados, incluye link y CTA, galería retorna HTML y carga JS, controles de acceso funcionan (6/6).
- Sin cookie real: `GET /api/automatic-shorts-studio` redirige al login, APIs de inventario y vídeo devuelven HTTP 401.
- `GET /automatic-shorts-ui.js`: HTTP 200 y `node --check` correcto, también en producción.
- **Limitación de verificación**: no ha sido posible consultar los datos de producción con la sesión real del propietario ni comprobar cuántos MP4 de los ya subidos permanecen en Blob. La galería se alimentará de registros reales, sin números inventados, cuando el propietario abra la página autenticado.

**Observación de implementación**: @vercel/blob `get()` no ofrece range parcial para blobs privados; el reproductor transmite el MP4 completo desde una función autenticada (sin fingir un 206). En archivos grandes o en móvil puede resultar más fiable el enlace de YouTube; habilitar un reproductor por rangos o una URL firmada de corta duración requiere otro cambio y pruebas.

**No confundir** con el servicio aislado `gta-vi-ai-shorts-smoke-2026.onrender.com`: aquella prueba solo generó un MP4 sintético y no está conectada a la generación real de GTA VI Viral Engine.
