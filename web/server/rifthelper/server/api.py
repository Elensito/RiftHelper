"""API de datos para la web: cuenta + partidas recientes con detalle de los 10 jugadores.

Reutiliza RiotClient y el análisis de stats.py. Genera URLs relativas (/assets/...) que
el frontend pide al mismo servidor FastAPI. Para cada ítem/runa se incluye el nombre en
inglés y español (DataDragon por locale) para los tooltips de la web.
"""
from datetime import datetime, timezone

from rifthelper import config
from rifthelper.services import stats as stats_service
from rifthelper.services.riot import RiotAPIError, RiotClient

MATCH_COUNT = 20

# Icono por defecto que muestra el cliente cuando la API reporta profileIconId=0
# (cuentas que nunca han elegido icono): el minion azul con escudo (id 28).
DEFAULT_PROFILE_ICON_ID = 28

# Las runas de atributos (5001-5014) no vienen en runesReforged.json: sus iconos
STAT_MODS = {
    5001: "perk-images/StatMods/StatModsHealthScalingIcon.png",
    5002: "perk-images/StatMods/StatModsArmorIcon.png",
    5003: "perk-images/StatMods/StatModsMagicResIcon.png",
    5004: "perk-images/StatMods/StatModsArmorIcon.png",
    5005: "perk-images/StatMods/StatModsAttackSpeedIcon.png",
    5007: "perk-images/StatMods/StatModsCDRScalingIcon.png",
    5008: "perk-images/StatMods/StatModsAdaptiveForceIcon.png",
    5010: "perk-images/StatMods/StatModsMovementSpeedIcon.png",
    5011: "perk-images/StatMods/StatModsHealthPlusIcon.png",
    5013: "perk-images/StatMods/StatModsTenacityIcon.png",
    5014: "perk-images/StatMods/StatModsMovementSpeedIcon.png",
}

STAT_MOD_NAMES = {
    5001: {"en": "Scaling Health", "es": "Vida por nivel"},
    5002: {"en": "Armor", "es": "Armadura"},
    5003: {"en": "Magic Resist", "es": "Resistencia mágica"},
    5004: {"en": "Armor", "es": "Armadura"},
    5005: {"en": "Attack Speed", "es": "Velocidad de ataque"},
    5007: {"en": "Ability Haste", "es": "Aceleración de habilidad"},
    5008: {"en": "Adaptive Force", "es": "Fuerza adaptable"},
    5010: {"en": "Move Speed", "es": "Velocidad de movimiento"},
    5011: {"en": "Health", "es": "Vida"},
    5013: {"en": "Tenacity & Slow Resist", "es": "Tenacidad y resistencia a la ralentización"},
    5014: {"en": "Move Speed", "es": "Velocidad de movimiento"},
}


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


def _runed(rune_id, rune_names: dict) -> dict | None:
    if not rune_id:
        return None
    name = rune_names.get(rune_id, {})
    return {
        "src": f"/assets/runes/{rune_id}.png",
        "en": name.get("en", ""),
        "es": name.get("es", ""),
    }


def _itemd(item_id, item_names: dict) -> dict | None:
    if not item_id:
        return None
    name = item_names.get(item_id, {})
    return {
        "src": f"/assets/items/{item_id}.png",
        "en": name.get("en", ""),
        "es": name.get("es", ""),
    }


async def _ensure_profile_icon(icon_id) -> None:
    """Descarga el icono de perfil del invocador si no está en disco.

    icon_id puede ser None (sin dato): entonces no se hace nada. El valor 0 ya
    se resuelve antes de llamar (cuentas sin icono -> minion por defecto, id 28).
    """
    if icon_id is None:
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


async def _ensure_rune_icons(rune_ids: set[int], runes_info: dict) -> None:
    """Descarga en disco las runas (incluidas las de atributos) que falten."""
    if not rune_ids:
        return
    out_dir = config.ASSETS_DIR / "runes"
    out_dir.mkdir(parents=True, exist_ok=True)
    import aiohttp

    async with aiohttp.ClientSession() as session:
        for rid in rune_ids:
            path = out_dir / f"{rid}.png"
            if path.is_file():
                continue
            icon = STAT_MODS.get(rid) or (runes_info.get(rid, {}) or {}).get("icon")
            if not icon:
                continue
            url = config.RUNE_ICON_URL.format(icon=icon)
            try:
                async with session.get(url) as resp:
                    if resp.status == 200:
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
    p: dict,
    champ_info: dict[int, dict],
    duration_min: float,
    puuid: str,
    rune_names: dict,
    item_names: dict,
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
        "participant_id": p.get("participantId"),
        "champion": champ.get("name", f"ID {p.get('championId')}"),
        "champion_icon": _champ_url(champ),
        "player_name": p.get("riotIdGameName") or p.get("summonerName") or "",
        "player_tag": p.get("riotIdTagline") or "",
        "role": p.get("teamPosition") or p.get("lane") or "?",
        "kills": p.get("kills", 0),
        "deaths": p.get("deaths", 0),
        "assists": p.get("assists", 0),
        "cs": cs,
        "cs_per_min": round(cs / duration_min, 1) if duration_min else 0,
        "gold": p.get("goldEarned", 0),
        "damage": p.get("totalDamageDealtToChampions", 0),
        "win": bool(p.get("win")),
        "keystone": _runed(runes[0], rune_names) if runes else None,
        "runes": [_runed(r, rune_names) for r in runes],
        "items": [_itemd(i, item_names) for i in items[:6]],
        "boots": _itemd(role_boots, item_names) if is_adc else None,
        "trinket": _itemd(items[6], item_names) if items[6] else None,
    }


def build_match(
    match: dict,
    timeline: dict,
    puuid: str,
    champ_info: dict[int, dict],
    rune_names: dict,
    item_names: dict,
) -> dict | None:
    player = stats_service.compute_match_stats(match, timeline, puuid, champ_info)
    if player is None:
        return None

    info = match.get("info", {})
    duration_sec = info.get("gameDuration", 0) or 0
    duration_min = duration_sec / 60 if duration_sec else 1
    participants = info.get("participants", [])
    players = [
        _participant_summary(p, champ_info, duration_min, puuid, rune_names, item_names)
        for p in participants
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
            "keystone": me.get("keystone"),
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
    items_en = await riot.get_items_info("en_US")
    items_es = await riot.get_items_info("es_ES")
    runes_en = await riot.get_runes_info("en_US")
    runes_es = await riot.get_runes_info("es_ES")

    rune_names = {
        rid: {"en": runes_en.get(rid, {}).get("name", ""), "es": runes_es.get(rid, {}).get("name", "")}
        for rid in runes_en
    }
    for rid, names in STAT_MOD_NAMES.items():
        rune_names[rid] = names
    item_names = {
        iid: {"en": items_en.get(iid, {}).get("name", ""), "es": items_es.get(iid, {}).get("name", "")}
        for iid in items_en
    }

    summoner = await riot.get_summoner_by_puuid(region, puuid)
    rank = await riot.get_solo_rank(region, puuid)
    # profileIconId=0 (cuenta sin icono elegido): el cliente muestra el icono por
    # defecto (minion azul, id 28), así que mapeamos 0 -> 28.
    profile_icon_id = summoner.get("profileIconId") or DEFAULT_PROFILE_ICON_ID
    await _ensure_profile_icon(profile_icon_id)

    start_ts = int(datetime(datetime.now().year, 1, 1, tzinfo=timezone.utc).timestamp())
    match_ids = await riot.get_match_ids(region, puuid, count, start_ts)

    matches = []
    rune_ids: set[int] = set()
    for match_id in match_ids:
        try:
            match = await riot.get_match(region, match_id)
            timeline = await riot.get_match_timeline(region, match_id)
        except RiotAPIError:
            continue
        for p in (match.get("info", {}) or {}).get("participants", []) or []:
            rune_ids.update(_runes_of(p))
        payload = build_match(match, timeline, puuid, champ_info, rune_names, item_names)
        if payload:
            matches.append(payload)

    await _ensure_rune_icons(rune_ids, runes_en)

    wins = (rank or {}).get("wins", 0)
    losses = (rank or {}).get("losses", 0)
    tier = (rank or {}).get("tier", "UNRANKED")
    division = (rank or {}).get("rank", "")

    return {
        "summoner": {
            "name": game_name,
            "tag": tag_line,
            "puuid": puuid,
            "region": region.upper().rstrip("0123456789"),
            "level": summoner.get("summonerLevel", 0),
            "profile_icon": f"/assets/profileicons/{profile_icon_id}.png",
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


async def fetch_match_metrics(match_id: str, puuid: str | None = None) -> dict:
    """Series temporales (oro, daño, XP, CS) de una partida, muestreadas cada 2 min."""
    region = config.RIOT_REGION
    riot = RiotClient()
    try:
        match = await riot.get_match(region, match_id)
        timeline = await riot.get_match_timeline(region, match_id)
    except RiotAPIError as e:
        raise RiotAPIError(f"Partida {match_id} no disponible: {e}", 404) from e
    champ_info = await riot.get_champion_info()
    return stats_service.timeline_metrics(match, timeline, champ_info, puuid or "")


SKILL_SLOT_KEYS = ["Q", "W", "E", "R"]


def _skill_order(timeline: dict, participant_id: int) -> list[int]:
    """Orden de habilidades del jugador (1=Q, 2=W, 3=E, 4=R) desde los eventos del timeline."""
    order: list[int] = []
    frames = timeline.get("info", {}).get("frames", []) or []
    for frame in frames:
        for event in frame.get("events", []) or []:
            if (
                event.get("type") == "SKILL_LEVEL_UP"
                and event.get("participantId") == participant_id
                and event.get("timestamp")
                and event.get("skillSlot") in (1, 2, 3, 4)
            ):
                order.append(event["skillSlot"])
    return order


async def _ensure_spell_icons(images: set[str]) -> None:
    """Descarga en disco los iconos de habilidades que falten."""
    if not images:
        return
    out_dir = config.SPELLS_DIR
    out_dir.mkdir(parents=True, exist_ok=True)
    import aiohttp

    async with aiohttp.ClientSession() as session:
        for image in sorted(images):
            path = out_dir / image
            if path.is_file():
                continue
            async with session.get(config.SPELL_ICON_URL.format(image=image)) as resp:
                if resp.status == 200:
                    try:
                        path.write_bytes(await resp.read())
                    except OSError:
                        pass


async def fetch_match_build(match_id: str, puuid: str | None = None) -> dict:
    """Spells (Q/W/E/R) y orden de habilidades de cada jugador de una partida.

    Las runas de cada jugador ya viajan en el payload de /api/summoner; el frontend
    las une por participant_id. Aquí se aporta lo que solo da el timeline: el skill order.
    """
    region = config.RIOT_REGION
    riot = RiotClient()
    try:
        match = await riot.get_match(region, match_id)
        timeline = await riot.get_match_timeline(region, match_id)
    except RiotAPIError as e:
        raise RiotAPIError(f"Partida {match_id} no disponible: {e}", 404) from e

    participants = (match.get("info", {}) or {}).get("participants", []) or []
    spells_map = await riot.get_champion_spells(
        [p.get("championId") for p in participants if p.get("championId")]
    )
    player_ids = {p.get("participantId") for p in participants}
    players = []
    images: set[str] = set()
    for p in participants:
        pid = p.get("participantId")
        champ = spells_map.get(p.get("championId"), [])
        spells = []
        for i, s in enumerate(champ[:4]):
            if not s.get("image"):
                continue
            image = s["image"]
            images.add(image)
            spells.append(
                {
                    "key": SKILL_SLOT_KEYS[i],
                    "name": s.get("name", ""),
                    "icon": f"/assets/spells/{image}",
                }
            )
        players.append(
            {
                "participant_id": pid,
                "team": p.get("teamId", 0),
                "champion": p.get("championName", f"ID {p.get('championId')}"),
                "spells": spells,
                "skill_order": _skill_order(timeline, pid) if pid in player_ids else [],
            }
        )

    await _ensure_spell_icons(images)
    return {"players": players}
