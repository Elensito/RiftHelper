# Publicar RiftHelper en Microsoft Store

RiftHelper se publica como **MSIX** empaquetado con la CLI oficial de Microsoft
(`winapp`) a partir del `.exe` que genera Tauri. Microsoft firma el MSIX al
subirlo a la Store (no necesitas certificado propio para la Store).

## Cómo se genera

Cada tag `v*` lanza `.github/workflows/desktop-build.yml`:

1. Build del frontend web -> `desktop/dist`.
2. `tauri build` -> instaladores NSIS (`-setup.exe`) y MSI para GitHub.
3. `winapp pack` -> MSIX firmado con certificado de desarrollo, subido como
   artefacto **RiftHelper-MSIX** del workflow.

Para descargar el MSIX: Actions -> último run -> *RiftHelper-MSIX* -> Download.

## Pasos en Partner Center

1. Regístrate como desarrollador en https://partner.microsoft.com (individual
   es gratis). Usa `storedeveloper.microsoft.com` para el dashboard.
2. **Nuevo producto** -> selecciona la opción de app *MSIX/MSI* o *EXE/MSI*
   (la de MSIX da experiencia nativa de Store).
3. Reserva el nombre **RiftHelper**.
4. Prepara el MSIX antes de subirlo:
   - En `desktop/msix/Package.appxmanifest`, el atributo `Publisher` debe
     coincidir con la **identidad de publicador** que te asigna Partner Center
     (formato `CN=...`). Cámbialo cada vez que cambies de cuenta.
   - Bump de `Version` (p. ej. `1.0.2.0`) en cada release: Windows exige
     versión mayor para actualizar un paquete instalado.
5. Sube el `.msix` del artefacto. La Store lo **firma por ti** y lo convierte
   en paquete instalable.
6. Rellena la ficha: descripción, capturas, iconos (ya incluidos), categoría,
   características del sistema (x64).
7. La revisión suele tardar entre 24 h y unos días.

## Notas

- El frontend va **empaquetado local** (`desktop/dist`); la API se llama a
  `https://rift-helper.com/api` (CORS habilitado para `http(s)://tauri.localhost`).
- El **updater de Tauri está desactivado**: la Store gestiona las
  actualizaciones. Los instaladores de GitHub se actualizan descargando el
  nuevo release.
- Las notificaciones nativas (`tauri-plugin-notification`) solo funcionan en
  apps instaladas; piden permiso al abrir la pestaña *Live*.

## Ruta alternativa (EXE/MSI)

La guía oficial de Tauri también admite publicar el **instalador** como
producto *EXE o MSI*:

- Usa la config `desktop/src-tauri/tauri.microsoftstore.conf.json`
  (instalador offline de WebView2):
  `npm run tauri bundle -- --config src-tauri/tauri.microsoftstore.conf.json`
- En Partner Center, parámetro de instalación silenciosa: `/S` (NSIS) o
  `/quiet` (MSI).
- En este caso el instalador **sí debe estar firmado** (política 10.2.9, SHA-256).
