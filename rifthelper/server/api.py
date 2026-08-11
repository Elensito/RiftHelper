"""API de datos para la web: cuenta + partidas recientes con detalle de los 10 jugadores.

Reutiliza RiotClient y el análisis de stats.py. Genera URLs relativas (/assets/...) que
el frontend pide al mismo servidor FastAPI.
"""
from datetime import datetime, timezone

from rifthelper import config
from rifthelper.services import stats as stats_service
from rifthelper.services.riot import RiotAPIError, RiotClient

MATCH_COUNT = 20


def _fmt_duration(sec: int) -> str:
    sec = int(sec or 0)
    m, s = divmod(sec, 60)
    if m >= 60:
        h, m = divmod(m, 60)
        return f"{h}:{m:02d}:{s:02d}"
    return f"{m}:{s:02d}"


def _champ_url(champ: dict) -> str | None:
    image = champ.get("image")
    return f"/assets/champions/{image}" if image else None


def _item_url(item_id) -> str | None:
    if not item_id:
        return None
    return f"/assets/items/{item_id}.png"


def _rune_url(rune_id) -> str | None:
    if not rune_id:
        return None
    return f"/assets/runes/{rune_id}.png"


async def _ensure_profile_icon(icon_id) -> None:
    """Descarga el icono de perfil del invocador si no está en disco."""
    if not icon_id:
        return
    base_dir = config.ASSETS_DIR / "profileicons"
    base_dir.mkdir(parents=True, exist_ok=True)
    path = base_dir / f"{icon_id}.png"
    if path.is_file():
        return
    import aiohttp

    url = config.ICON_URL.format(icon_id=icon_id)
    async with aiohttp.ClientSession() as session:
        async with session.get(url) as resp:
            if resp.status == 200:
                try:
                    path.write_bytes(await resp.read())
                except OSError:
                    pass


def _runes_of(p: dict) -> list[int]:
    """IDs de todas las runas del jugador (keystone, menores y runas de atributos)."""
    runes: list[int] = []
    perks = p.get("perks", {}) or {}
    for style in perks.get("styles", []) or []:
        for sel in style.get("selections", []) or []:
            perk = sel.get("perk")
            if perk:
                runes.append(perk)
    stat = perks.get("statPerks", {}) or {}
    for key in ("defense", "flex", "offense"):
        value = stat.get(key)
        if value:
            runes.append(value)
    return runes


def _participant_summary(
    p: dict, champ_info: dict[int, dict], duration_min: float, puuid: str
) -> dict:
    champ = champ_info.get(p.get("championId"), {})
    items = [p.get(f"item{i}", 0) or 0 for i in range(7)]
    is_adc = (p.get("teamPosition") or "").upper() == "BOTTOM"
    role_boots = p.get("roleBoundItem", 0) or 0
    runes = _runes_of(p)
    cs = p.get("totalMinionsKilled", 0) + p.get("totalEnemiesSlain", 0)

    return {
        "is_player": p.get("puuid") == puuid,
        "team": p.get("teamId", 0),
        "champion": champ.get("name", f"ID {p.get('championId')}"),
        "champion_icon": _champ_url(champ),
        "role": p.get("teamPosition") or p.get("lane") or "?",
        "kills": p.get("kills", 0),
        "deaths": p.get("deaths", 0),
        "assists": p.get("assists", 0),
        "cs": cs,
        "cs_per_min": round(cs / duration_min, 1) if duration_min else 0,
        "gold": p.get("goldEarned", 0),
        "damage": p.get("totalDamageDealtToChampions", 0),
        "win": bool(p.get("win")),
        "keystone": runes[0] if runes else None,
        "keystone_icon": _rune_url(runes[0]) if runes else None,
        "runes": [_rune_url(r) for r in runes],
        "items": [_item_url(i) for i in items[:6]],
        "boots": _item_url(role_boots) if is_adc else None,
        "trinket": _item_url(items[6]) if items[6] else None,
    }


def build_match(
    match: dict,
    timeline: dict,
    puuid: str,
    champ_info: dict[int, dict],
) -> dict | None:
    player = stats_service.compute_match_stats(match, timeline, puuid, champ_info)
    if player is None:
        return None

    info = match.get("info", {})
    duration_sec = info.get("gameDuration", 0) or 0
    duration_min = duration_sec / 60 if duration_sec else 1
    participants = info.get("participants", [])
    players = [
        _participant_summary(p, champ_info, duration_min, puuid) for p in participants
    ]
    me = next((p for p in players if p["is_player"]), {})

    return {
        "match_id": (match.get("metadata", {}) or {}).get("matchId", ""),
        "queue": info.get("queueId"),
        "date": player["date"],
        "duration": _fmt_duration(duration_sec),
        "duration_sec": duration_sec,
        "win": player["win"],
        "player": {
            "champion": me.get("champion", player["player_champion"]),
            "champion_icon": me.get("champion_icon"),
            "keystone_icon": me.get("keystone_icon"),
            "kills": me.get("kills", 0),
            "deaths": me.get("deaths", 0),
            "assists": me.get("assists", 0),
            "cs": me.get("cs", 0),
            "cs_per_min": me.get("cs_per_min", 0),
            "gold": me.get("gold", 0),
            "damage": me.get("damage", 0),
            "kp": player["kp"],
            "role": me.get("role", "?"),
        },
        "players": players,
    }


async def fetch_profile(name: str, tag: str, count: int = MATCH_COUNT) -> dict:
    """Devuelve el perfil completo: summoner + partidas recientes con detalle."""
    region = config.RIOT_REGION
    riot = RiotClient()

    account = await riot.get_account_by_riot_id(region, name, tag)
    puuid = account.get("puuid", "")
    if not puuid:
        raise RuntimeError("No se encontró esa cuenta en EUW. Revisa el Nombre#tag.")
    game_name = account.get("gameName") or name
    tag_line = account.get("tagLine") or tag

    champ_info = await riot.get_champion_info()
    summoner = await riot.get_summoner_by_puuid(region, puuid)
    rank = await riot.get_solo_rank(region, puuid)
    await _ensure_profile_icon(summoner.get("profileIconId"))

    start_ts = int(datetime(datetime.now().year, 1, 1, tzinfo=timezone.utc).timestamp())
    match_ids = await riot.get_match_ids(region, puuid, count, start_ts)

    matches = []
    for match_id in match_ids:
        try:
            match = await riot.get_match(region, match_id)
            timeline = await riot.get_match_timeline(region, match_id)
        except RiotAPIError:
            continue
        payload = build_match(match, timeline, puuid, champ_info)
        if payload:
            matches.append(payload)

    wins = (rank or {}).get("wins", 0)
    losses = (rank or {}).get("losses", 0)
    tier = (rank or {}).get("tier", "UNRANKED")
    division = (rank or {}).get("rank", "")

    return {
        "summoner": {
            "name": game_name,
            "tag": tag_line,
            "puuid": puuid,
            "region": region.upper(),
            "level": summoner.get("summonerLevel", 0),
            "profile_icon": f"/assets/profileicons/{summoner.get('profileIconId', 0)}.png",
            "rank_icon": f"/assets/ranks/{tier.lower()}.png",
            "tier": tier,
            "division": division,
            "lp": (rank or {}).get("leaguePoints", 0),
            "wins": wins,
            "losses": losses,
            "winrate": round(wins / (wins + losses) * 100) if (wins + losses) else 0,
        },
        "matches": matches,
    }
