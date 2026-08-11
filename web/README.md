# RiftHelper · Web (React)

Frontend profesional tipo op.gg/u.gg con tema **neon** para consultar partidas de
cualquier invocador de LoL (EUW): los 10 jugadores por partida con runas, build,
oro, farm, daño y KDA.

## Backend (API + assets)

```
cd web/server
poetry install          # solo la primera vez
poetry run rifthelper-web   # o: poetry run python -m rifthelper.server
```

Servidor en `http://127.0.0.1:8000`. Sirve la API y el frontend construido.

- `GET /api/summoner?name=Elensito&tag=01234&count=20` → perfil + partidas
- `GET /assets/...` → iconos (campeones, runas, items, ranks, profileicons)

## Frontend (React + Vite)

### Ejecutar

```powershell
cd web
npm install        # solo la primera vez
npm run dev        # http://localhost:5173 (proxy al backend)
```

### Construir (producción)

```powershell
cd web
npm run build      # genera web/dist, servido por el backend en :8000
```

## Uso

1. Arranca el backend (`poetry run rifthelper-web` desde `web/server`).
2. Abre `http://127.0.0.1:8000`.
3. Busca un invocador por **Nombre#tag** (ej. `Elensito` `01234`) y pulsa **Buscar**.
4. **⟳ Actualizar** recarga las partidas más recientes.
5. Pulsa la flecha de una partida para ver el detalle de los 10 jugadores
   (runa clave + runas completas, build, oro, farm, daño y KDA).

También puedes compartir enlaces directos: `http://127.0.0.1:8000/?name=Elensito&tag=01234`.

## Estructura

```
web/
  server/                backend FastAPI (poetry: rifthelper-web-server)
    rifthelper/
      server/            app.py (API, assets y frontend) + api.py (payload)
      services/          riot.py (RiotClient) + stats.py (análisis)
  src/components/        SearchBar, ProfileHeader, MatchCard, PlayerRow
  src/styles.css         tema neon
  dist/                  build de producción (servido por el backend)
```
