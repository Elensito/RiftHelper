







import asyncio
from contextlib import asynccontextmanager
import html
import json
import secrets
import sys
from pathlib import Path
import time

import aiohttp

from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

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


class AICoachRequest(BaseModel):
    messages: list[dict]
    model: str = "mistral-small-latest"
    max_tokens: int = 1500
    temperature: float = 0.7


MISTRAL_URL = "https://api.mistral.ai/v1/chat/completions"


@app.post("/api/ai-coach")
async def ai_coach(req: AICoachRequest):
    api_key = config.MISTRAL_API_KEY
    if not api_key:
        raise HTTPException(status_code=500, detail="Mistral API key not configured.")

    async with aiohttp.ClientSession() as session:
        async with session.post(
            MISTRAL_URL,
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {api_key}",
            },
            json={
                "model": req.model,
                "messages": req.messages,
                "max_tokens": req.max_tokens,
                "temperature": req.temperature,
            },
            timeout=aiohttp.ClientTimeout(total=30),
        ) as resp:
            if resp.status != 200:
                try:
                    err = await resp.json()
                except Exception:
                    err = {}
                detail = err.get("detail", f"Mistral API error {resp.status}")
                raise HTTPException(status_code=502, detail=detail)
            data = await resp.json()

    content = data.get("choices", [{}])[0].get("message", {}).get("content", "No response from AI.")
    return {"content": content}


def _valid_token(token: str) -> bool:
    return bool(token) and len(token) <= 64 and all(c.isalnum() or c in "-_" for c in token)


async def _read_body_limited(request: Request, limit: int) -> bytes:
    chunks = []
    total = 0
    async for chunk in request.stream():
        total += len(chunk)
        if total > limit:
            raise HTTPException(status_code=413, detail="El archivo es demasiado grande.")
        chunks.append(chunk)
    return b"".join(chunks)


FEEDBACK_TOPICS = {"bug", "request", "other", "feedback"}


def _feedback_path() -> Path:
    config.FEEDBACK_DIR.mkdir(parents=True, exist_ok=True)
    return config.FEEDBACK_FILE


def _load_feedback() -> list:
    try:
        return json.loads(_feedback_path().read_text(encoding="utf-8"))
    except Exception:
        return []


def _save_feedback(items: list) -> None:
    _feedback_path().write_text(
        json.dumps(items, ensure_ascii=False, indent=2), encoding="utf-8"
    )


@app.post("/api/feedback")
async def create_feedback(request: Request):
    """Store user feedback (topic + message) sent by the desktop app. The dev
    reads it later via GET /api/feedback?token=... , never exposed publicly."""
    body = await _read_body_limited(request, config.MAX_FEEDBACK_BYTES)
    try:
        data = json.loads(body.decode("utf-8"))
    except Exception:
        raise HTTPException(status_code=400, detail="JSON inválido.")
    if not isinstance(data, dict):
        raise HTTPException(status_code=400, detail="Cuerpo inválido.")
    topic = str(data.get("topic") or "feedback")[:40].lower()
    if topic not in FEEDBACK_TOPICS:
        topic = "feedback"
    message = str(data.get("message") or "")[:4000].strip()
    if not message:
        raise HTTPException(status_code=400, detail="El mensaje está vacío.")
    entry = {
        "id": secrets.token_urlsafe(8),
        "ts": int(time.time()),
        "topic": topic,
        "message": message,
        "contact": str(data.get("contact") or "")[:120],
    }
    items = _load_feedback()
    items.append(entry)
    _save_feedback(items)
    return {"ok": True, "id": entry["id"]}


@app.get("/api/feedback")
async def list_feedback(token: str = Query(default="")):
    """Dev-only: list all stored feedback. Protected by a token set in the
    server environment (FEEDBACK_VIEW_TOKEN)."""
    if not config.FEEDBACK_VIEW_TOKEN or not secrets.compare_digest(token, config.FEEDBACK_VIEW_TOKEN):
        raise HTTPException(status_code=403, detail="Acceso denegado.")
    return {"items": list(reversed(_load_feedback()))}


@app.post("/api/share")
async def create_share(request: Request):
    """Receive a clip/highlight mp4 uploaded by the desktop app and make it
    publicly reachable via a short share link (Discord-embeddable)."""
    kind = (request.query_params.get("kind") or "clip")[:40]
    name = (request.query_params.get("name") or "clip")[:120]
    content_type = request.headers.get("content-type", "").lower()
    if content_type and "video/" not in content_type and "octet-stream" not in content_type:
        raise HTTPException(status_code=415, detail="Solo se aceptan vídeos.")
    body = await _read_body_limited(request, config.MAX_SHARE_BYTES)
    if len(body) < 4096:
        raise HTTPException(status_code=400, detail="El vídeo está vacío o demasiado pequeño.")
    token = secrets.token_urlsafe(10)
    config.SHARE_DIR.mkdir(parents=True, exist_ok=True)
    (config.SHARE_DIR / f"{token}.mp4").write_bytes(body)
    return {
        "token": token,
        "kind": kind,
        "name": name,
        "share_url": f"{config.SITE_URL}/share/{token}",
        "video_url": f"{config.SITE_URL}/share/{token}.mp4",
        "thumb_url": "",
    }


@app.post("/api/share/{token}/thumb")
async def upload_share_thumb(token: str, request: Request):
    video = config.SHARE_DIR / f"{token}.mp4"
    if not _valid_token(token) or not video.exists():
        raise HTTPException(status_code=404, detail="Share no encontrado.")
    body = await _read_body_limited(request, config.MAX_SHARE_THUMB_BYTES)
    (config.SHARE_DIR / f"{token}.jpg").write_bytes(body)
    return {"thumb_url": f"{config.SITE_URL}/share/{token}.jpg"}


@app.get("/share/{token}.mp4")
async def share_video(token: str):
    path = config.SHARE_DIR / f"{token}.mp4"
    if not _valid_token(token) or not path.exists():
        raise HTTPException(status_code=404, detail="No encontrado.")
    return FileResponse(
        path,
        media_type="video/mp4",
        headers={"Accept-Ranges": "bytes", "Cache-Control": "public, max-age=86400"},
    )


@app.get("/share/{token}.jpg")
async def share_thumb(token: str):
    path = config.SHARE_DIR / f"{token}.jpg"
    if not _valid_token(token) or not path.exists():
        raise HTTPException(status_code=404, detail="No encontrado.")
    return FileResponse(
        path,
        media_type="image/jpeg",
        headers={"Cache-Control": "public, max-age=86400"},
    )


@app.get("/share/{token}")
async def share_page(token: str):
    video = config.SHARE_DIR / f"{token}.mp4"
    if not _valid_token(token) or not video.exists():
        raise HTTPException(status_code=404, detail="No encontrado.")
    thumb = config.SHARE_DIR / f"{token}.jpg"
    video_url = f"{config.SITE_URL}/share/{token}.mp4"
    thumb_url = f"{config.SITE_URL}/share/{token}.jpg" if thumb.exists() else ""
    meta = f'<meta property="og:video" content="{html.escape(video_url, quote=True)}"/>'
    if thumb_url:
        meta += f'\n<meta property="og:image" content="{html.escape(thumb_url, quote=True)}"/>'
    page = SHARE_PAGE_TEMPLATE.format(title=html.escape("Clip de RiftHelper"), meta=meta, video=html.escape(video_url, quote=True), thumb=html.escape(thumb_url, quote=True))
    return HTMLResponse(content=page)


SHARE_PAGE_TEMPLATE = """<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<meta property="og:title" content="{title}"/>
<meta property="og:description" content="Clip compartido con RiftHelper"/>
<meta property="og:video:type" content="video/mp4"/>
<meta property="og:video:width" content="1280"/>
<meta property="og:video:height" content="720"/>
{meta}
<meta name="twitter:card" content="player"/>
<meta name="twitter:title" content="{title}"/>
<title>{title}</title>
<style>
  * {{ box-sizing: border-box; margin: 0; padding: 0; }}
  body {{ background: #0b0e14; color: #e6ebf5; font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; min-height: 100vh; display: flex; flex-direction: column; align-items: center; padding: 28px 16px 40px; }}
  .brand {{ display: flex; align-items: center; gap: 8px; font-weight: 800; letter-spacing: .04em; color: #0ff; text-transform: uppercase; font-size: 13px; margin-bottom: 20px; }}
  .player {{ width: 100%; max-width: 900px; background: #000; border-radius: 14px; overflow: hidden; box-shadow: 0 20px 60px rgba(0,0,0,.6); border: 1px solid rgba(255,255,255,.08); }}
  video {{ display: block; width: 100%; max-height: 72vh; background: #000; }}
  .actions {{ display: flex; gap: 12px; margin-top: 18px; }}
  a.dl {{ color: #0ff; text-decoration: none; font-weight: 700; font-size: 13px; border: 1px solid rgba(0,243,255,.4); padding: 9px 16px; border-radius: 20px; background: rgba(0,243,255,.08); }}
  a.dl:hover {{ background: rgba(0,243,255,.18); }}
  .foot {{ margin-top: 22px; font-size: 12px; color: #7a8394; }}
</style>
</head>
<body>
  <div class="brand">RiftHelper</div>
  <div class="player">
    <video controls playsinline preload="metadata" src="{video}" poster="{thumb}"></video>
  </div>
  <div class="actions"><a class="dl" href="{video}" download>Descargar</a></div>
  <div class="foot">Compartido con RiftHelper · rift-helper.com</div>
</body>
</html>
"""


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
