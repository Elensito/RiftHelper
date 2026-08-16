







import asyncio
from contextlib import asynccontextmanager
import sys
from pathlib import Path
import time

import aiohttp

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles

from rifthelper import config
from rifthelper.services.riot import RiotAPIError
from rifthelper.server import api as api_service
from rifthelper.services import champions as champions_service
from rifthelper.services import ddragon as ddragon_service

WEB_DIST = config.WEB_DIST
ASSETS_DIR = config.ASSETS_DIR


@asynccontextmanager
async def lifespan(_app: FastAPI):
    await asyncio.to_thread(ddragon_service.latest_version)
    yield


app = FastAPI(title="RiftHelper API", version="1.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://tauri.localhost",
        "https://tauri.localhost",
    ],
    allow_origin_regex="https?://(tauri\\.localhost|[^/]*tauri[^/]*\\.localhost)(:\\d+)?",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/assets/profileicons/{icon_id}.png")
async def get_profile_icon(icon_id: int):
    path = await api_service.ensure_profile_icon(icon_id)
    if not path:
        raise HTTPException(status_code=404, detail="Icono no disponible.")
    return FileResponse(path)

app.mount("/assets", StaticFiles(directory=str(ASSETS_DIR)), name="assets")


@app.get("/health")
def health() -> dict:
    return {"status": "ok", "version": "1.0.0"}


_LATEST_RELEASE_URL = (
    "https://api.github.com/repos/Elensito/RiftHelper/releases/latest"
)
_INSTALLER_CACHE_TTL = 300
_installer_cache: dict = {"url": None, "expires": 0}


async def _latest_installer_url() -> str:
    now = time.monotonic()
    if _installer_cache["url"] and _installer_cache["expires"] > now:
        return _installer_cache["url"]
    async with aiohttp.ClientSession() as session:
        async with session.get(
            _LATEST_RELEASE_URL,
            headers={"Accept": "application/vnd.github+json"},
            timeout=aiohttp.ClientTimeout(total=10),
        ) as resp:
            resp.raise_for_status()
            data = await resp.json()
    for asset in data.get("assets", []) or []:
        if (asset.get("name") or "").endswith("-setup.exe"):
            url = asset.get("browser_download_url")
            if url:
                _installer_cache["url"] = url
                _installer_cache["expires"] = now + _INSTALLER_CACHE_TTL
                return url
    raise RuntimeError("No se encontró el instalador en el release.")


@app.get("/download")
async def download() -> RedirectResponse:
    try:
        url = await _latest_installer_url()
    except Exception:
        url = "https://github.com/Elensito/RiftHelper/releases/latest"
    return RedirectResponse(url, status_code=303)


@app.get("/api/summoner")
async def get_summoner(
    name: str = Query(..., min_length=1),
    tag: str = Query(..., min_length=1),
    count: int = Query(api_service.MATCH_COUNT, ge=1, le=50),
    start: int = Query(0, ge=0),
    refresh: bool = Query(False),
):
    try:
        return await api_service.fetch_profile(
            name.strip(), tag.strip(), count=count, start=start, refresh=refresh
        )
    except RiotAPIError as e:
        raise HTTPException(status_code=e.status or 502, detail=str(e)) from e
    except RuntimeError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e


@app.get("/api/summoner/by-puuid")
async def get_summoner_by_puuid(
    puuid: str = Query(..., min_length=1),
    region: str | None = Query(default=None),
):
    try:
        return await api_service.fetch_summoner_by_puuid(puuid, region)
    except RiotAPIError as e:
        raise HTTPException(status_code=e.status or 502, detail=str(e)) from e
    except RuntimeError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e


@app.get("/api/summoner/check")
async def check_new_matches(
    name: str = Query(..., min_length=1),
    tag: str = Query(..., min_length=1),
):
    try:
        latest = await api_service.fetch_latest_match_id(name, tag)
        return {"latest_match_id": latest}
    except RiotAPIError as e:
        raise HTTPException(status_code=e.status or 502, detail=str(e)) from e


@app.get("/api/match/{match_id}/metrics")
async def get_match_metrics(match_id: str, puuid: str | None = Query(default=None)):
    try:
        return await api_service.fetch_match_metrics(match_id, puuid)
    except RiotAPIError as e:
        raise HTTPException(status_code=e.status or 502, detail=str(e)) from e


@app.get("/api/match/{match_id}/build")
async def get_match_build(match_id: str, puuid: str | None = Query(default=None)):
    try:
        return await api_service.fetch_match_build(match_id, puuid)
    except RiotAPIError as e:
        raise HTTPException(status_code=e.status or 502, detail=str(e)) from e


@app.get("/api/match/{match_id}/events")
async def get_match_events(match_id: str, puuid: str | None = Query(default=None)):
    try:
        return await api_service.fetch_match_events(match_id, puuid)
    except RiotAPIError as e:
        raise HTTPException(status_code=e.status or 502, detail=str(e)) from e


@app.get("/api/live-game")
async def get_live_game(
    name: str = Query(..., min_length=1),
    tag: str = Query(..., min_length=1),
):
    try:
        return await api_service.fetch_live_game(name.strip(), tag.strip())
    except RiotAPIError as e:
        raise HTTPException(status_code=e.status or 502, detail=str(e)) from e
    except RuntimeError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e


@app.get("/api/mastery")
async def get_mastery(
    name: str = Query(..., min_length=1),
    tag: str = Query(..., min_length=1),
):
    try:
        return await api_service.fetch_mastery(name.strip(), tag.strip())
    except RiotAPIError as e:
        raise HTTPException(status_code=e.status or 502, detail=str(e)) from e
    except RuntimeError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e


@app.get("/api/champions")
def get_champions():
    return {"champions": champions_service.list_champions()}


@app.get("/api/tooltip")
async def get_tooltip(
    kind: str = Query(..., pattern="^(item|rune|spell|ability)$"),
    id: int = Query(..., ge=0),
    lang: str = Query("es", pattern="^(en|es)$"),
    champ: str | None = Query(None),
):
    try:
        return await api_service.fetch_tooltip(kind, id, lang, champ)
    except RuntimeError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e


@app.get("/api/champion/{champ_key}")
def get_champion(champ_key: int):
    detail = champions_service.champion_detail(champ_key)
    if detail is None:
        raise HTTPException(status_code=404, detail="Campeón no encontrado.")
    return detail


if WEB_DIST.is_dir() and (WEB_DIST / "index.html").is_file():
    app.mount("/", StaticFiles(directory=str(WEB_DIST), html=True), name="web")
else:
    @app.get("/")
    def index():
        return {"message": "RiftHelper API. Frontend no construido: ejecuta 'npm run build' en web/."}


def main() -> int:
    import uvicorn

    uvicorn.run(app, host="127.0.0.1", port=8000, log_level="info")
    return 0


if __name__ == "__main__":
    sys.exit(main())
