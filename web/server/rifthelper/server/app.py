







import sys
from pathlib import Path

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from rifthelper import config
from rifthelper.services.riot import RiotAPIError
from rifthelper.server import api as api_service
from rifthelper.services import champions as champions_service

WEB_DIST = config.WEB_DIST
ASSETS_DIR = config.ASSETS_DIR

app = FastAPI(title="RiftHelper API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.mount("/assets", StaticFiles(directory=str(ASSETS_DIR)), name="assets")


@app.get("/health")
def health() -> dict:
    return {"status": "ok", "version": "1.0.0"}


@app.get("/api/summoner")
async def get_summoner(
    name: str = Query(..., min_length=1),
    tag: str = Query(..., min_length=1),
    count: int = Query(api_service.MATCH_COUNT, ge=1, le=50),
    start: int = Query(0, ge=0),
):
    try:
        return await api_service.fetch_profile(name.strip(), tag.strip(), count=count, start=start)
    except RiotAPIError as e:
        raise HTTPException(status_code=e.status or 502, detail=str(e)) from e
    except RuntimeError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e


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


@app.get("/api/champions")
def get_champions():
    return {"champions": champions_service.list_champions()}


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
