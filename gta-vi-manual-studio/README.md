# THE RANDOM REEL — Subida manual de Shorts

Implementación añadida al panel privado ya desplegado en Vercel.

- **Web principal:** https://gta-vi-viral-engine.vercel.app
- **Producción validada:** `dpl_6SKpvqJXSwaEBzAP5keMrNfYmfph` (23/11/2026, READY)
- **Despliegue de prueba:** `dpl_CQbwN52UPPokXqwZF48PkZNuWEwi`
- **Versión de rollback de la web:** `dpl_4yAFuAkxaV32552QyjFV69geub2k`
- **Autenticación:** misma sesión firmada del dashboard. No se crean contraseñas secundarias ni se publica sin clic explícito.

## Qué ofrece

1. Botón **+ Subir Short** en el lateral, en Resumen y en Shorts.
2. Selección, arrastrar/soltar y vista previa local de MP4/MOV/WebM de hasta 150 MB.
3. Título, descripción y confirmación de derechos.
4. Subida directa desde navegador a **Vercel Blob privado** con barra de progreso y creación de borrador.
5. Listado de borradores con vídeo previsualizable únicamente tras autenticación.
6. Envío manual opcional a YouTube mediante la conexión OAuth ya existente; visibilidad **private** siempre, con confirmación explícita previa y enlace al vídeo.

## Integración y conservación

Este repo guarda los **8 archivos nuevos o reemplazados**; el despliegue de Vercel reutiliza por SHA los otros 46 archivos del despliegue original, conservando su código y rutas. `api/admin.js` intercepta la salida HTML del antiguo controlador (copiado por referencia SHA como `lib/admin-base.js`) e inyecta `manual-short-ui.js` sólo en el dashboard autenticado.

El archivo `vercel.json` mantiene las 4 reglas cron originales, las 5 reescrituras y las cabeceras de seguridad. Añade un máximo de duración para la función de subida manual a YouTube.

Los metadatos nuevos se guardan en `state/manual_shorts_drafts.json` y **no modifican** las listas del worker ni alteran los vídeos existentes.

## Comprobaciones

- Preview Vercel: build READY con 53 archivos y backend construido.
- Producción: READY, alias original conservado.
- Ruta `/`: HTTP 200 y pantalla de login original.
- `/manual-short-ui.js`: HTTP 200 y `node --check` correcto.
- Rutas de borradores/medios, POST de subida y de publicación: rechazan acceso sin sesión, HTTP 401.
- CDN del cliente Blob (esm.sh): HTTP 200.

**Pendiente de comprobar con sesión real:** cliente Blob + almacenamiento de un MP4 privado, lectura del borrador y subida OAuth privada a YouTube. No se han enviado vídeos a YouTube durante estas pruebas. Si el flujo de subida falla, la interfaz muestra el error; no activa publicación automática.

## Seguridad / mantenimiento

Mantener `DASHBOARD_SESSION_SECRET` y `BLOB_READ_WRITE_TOKEN` exclusivamente en variables de entorno de Vercel. No crear endpoints que devuelvan cookies OAuth ni tokens. La API de subida acepta callbacks firmados por Vercel Blob. No configurar publicación pública sin aprobación explícita. Mantener el deploy anterior disponible como rollback.
