# RiftHelper

Herramientas de estadísticas de **League of Legends**: un **bot de Discord** y una **página web** para consultar partidas, invocadores y maestrías en el servidor **EUW**.

## Estado

En desarrollo activo. Ambas piezas comparten cliente de la API de Riot y assets de DataDragon.

## Discord bot

Comandos para verificar y enlazar invocadores, consultar el perfil y las maestrías de campeones dentro de Discord.

## Web

Buscador de invocadores al estilo op.gg con tema neon:

- Perfil con rango (color por tier), nivel, icono y winrate.
- Últimas 20 partidas con el detalle de los **10 jugadores**: runas, build, oro, farm, daño, visión, KDA y nivel final.
- Por partida: pestaña **General** (tablero de equipos), **Métricas** (curvas de oro, daño, XP y CS por minuto) y **Build** (habilidades Q/W/E/R y orden de habilidades del timeline).
- Enlaces compartibles: `/?name=Nombre&tag=1234`.

### Ejecutar la web

```powershell
# backend (FastAPI) en http://127.0.0.1:8000
cd web/server
poetry run python -m rifthelper.server

# frontend (desarrollo) en http://localhost:5173
cd web
npm install
npm run dev
```

## Estructura

```
bot/      bot de Discord (discord.py)
web/      web (React + Vite + FastAPI)
assets/   iconos servidos por la web (campeones, runas, ítems, rangos)
```

## Stack

- Python 3.12 · discord.py · FastAPI
- React 18 · Vite · recharts

## Aviso

RiftHelper no está afiliado a Riot Games. Los datos provienen de la API oficial de Riot y de DataDragon.
