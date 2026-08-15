





from datetime import datetime, timezone
import json
from pathlib import Path
import time

from rifthelper import config
from rifthelper.services import stats as stats_service
from rifthelper.services.riot import RiotAPIError, RiotClient

MATCH_COUNT = 30
MASTERY_CACHE_TTL = 300
_mastery_cache: dict[str, tuple[float, dict]] = {}



DEFAULT_PROFILE_ICON_ID = 0


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


async def ensure_profile_icon(icon_id) -> Path | None:





    if icon_id is None:
        return None
    base_dir = config.ASSETS_DIR / "profileicons"
    base_dir.mkdir(parents=True, exist_ok=True)
    path = base_dir / f"{icon_id}.png"
    if path.is_file():
        return path
    import aiohttp

    url = config.ICON_URL.format(icon_id=icon_id)
    try:
        async with aiohttp.ClientSession() as session:
            async with session.get(url) as resp:
                if resp.status == 200:
                    path.write_bytes(await resp.read())
                    return path
    except Exception:
        return None
    return None


async def _ensure_rune_icons(rune_ids: set[int], runes_info: dict) -> None:

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
    summoner_spells: dict[int, dict],
    spell_images: set[str],
) -> dict:
    champ = champ_info.get(p.get("championId"), {})
    items = [p.get(f"item{i}", 0) or 0 for i in range(7)]
    is_adc = (p.get("teamPosition") or "").upper() == "BOTTOM"
    role_boots = p.get("roleBoundItem", 0) or 0
    runes = _runes_of(p)
    cs = p.get("totalMinionsKilled", 0) + p.get("totalEnemiesSlain", 0)

    spell_sids = [p.get("summoner1Id"), p.get("summoner2Id")]
    spells = []
    for sid in spell_sids:
        sp = summoner_spells.get(sid, {})
        simage = sp.get("image")
        if simage:
            spell_images.add(simage)
        spells.append(
            {
                "src": f"/assets/spells/{simage}" if simage else None,
                "name": sp.get("name") or {"en": "", "es": ""},
            }
        )

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
        "level": p.get("champLevel", 0),
        "vision": round(p.get("visionScore", 0) or 0, 1),
        "gold": p.get("goldEarned", 0),
        "damage": p.get("totalDamageDealtToChampions", 0),
        "win": bool(p.get("win")),
        "keystone": _runed(runes[0], rune_names) if runes else None,
        "runes": [_runed(r, rune_names) for r in runes],
        "spells": spells,
        "items": [_itemd(i, item_names) for i in items[:6]],
        "boots": _itemd(role_boots, item_names) if is_adc else None,
        "trinket": _itemd(items[6], item_names) if items[6] else None,
    }


def _carry_score(p: dict, team_kills: int, team_damage: int) -> int:
    kills = p.get("kills", 0)
    deaths = p.get("deaths", 0)
    assists = p.get("assists", 0)
    kp = (kills + assists) / max(1, team_kills)
    dmg = p.get("damage", 0) / max(1, team_damage)
    kda = min(1.5, (kills + assists) / max(1, deaths)) / 1.5
    return min(100, round(100 * (kp + dmg + kda) / 3))


def _mark_mvps(players: list[dict]) -> None:
    teams: dict[int, list[dict]] = {100: [], 200: []}
    for p in players:
        teams.setdefault(p.get("team", 0), []).append(p)
    for plist in teams.values():
        if not plist:
            continue
        team_kills = sum(p.get("kills", 0) for p in plist)
        team_damage = sum(p.get("damage", 0) for p in plist)
        best = plist[0]
        for p in plist:
            score = _carry_score(p, team_kills, team_damage)
            p["carry_score"] = score
            if score > best.get("carry_score", 0):
                best = p
        best["mvp"] = True


def build_match(
    match: dict,
    timeline: dict,
    puuid: str,
    champ_info: dict[int, dict],
    rune_names: dict,
    item_names: dict,
    summoner_spells: dict[int, dict],
    spell_images: set[str],
) -> dict | None:
    player = stats_service.compute_match_stats(match, timeline, puuid, champ_info)
    if player is None:
        return None

    info = match.get("info", {})
    duration_sec = info.get("gameDuration", 0) or 0
    duration_min = duration_sec / 60 if duration_sec else 1
    participants = info.get("participants", [])
    players = [
        _participant_summary(p, champ_info, duration_min, puuid, rune_names, item_names, summoner_spells, spell_images)
        for p in participants
    ]
    _mark_mvps(players)
    me = next((p for p in players if p["is_player"]), {})

    return {
        "match_id": (match.get("metadata", {}) or {}).get("matchId", ""),
        "queue": info.get("queueId"),
        "date": player["date"],
        "duration": _fmt_duration(duration_sec),
        "duration_sec": duration_sec,
        "win": player["win"],
        "remake": bool(duration_sec and duration_sec < 240),
        "player": {
            "champion": me.get("champion", player["player_champion"]),
            "champion_icon": me.get("champion_icon"),
            "keystone": me.get("keystone"),
            "spells": me.get("spells"),
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


def _profile_cache_path(name: str, tag: str, start: int) -> Path:
    n = " ".join(name.strip().lower().split())
    tg = " ".join(tag.strip().lower().split())
    key = f"{config.RIOT_REGION}#{n}#{tg}__{start}"
    safe = "".join(c if c.isalnum() else "_" for c in key)
    return config.PROFILE_CACHE_DIR / f"{safe}.json"


def _profile_cache_get(name: str, tag: str, start: int) -> dict | None:
    path = _profile_cache_path(name, tag, start)
    if not path.is_file():
        return None
    try:
        if time.time() - path.stat().st_mtime > config.PROFILE_CACHE_TTL:
            return None
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


def _profile_cache_set(name: str, tag: str, start: int, data: dict) -> None:
    try:
        config.PROFILE_CACHE_DIR.mkdir(parents=True, exist_ok=True)
        _profile_cache_path(name, tag, start).write_text(
            json.dumps(data, ensure_ascii=False), encoding="utf-8"
        )
    except OSError:
        pass


async def fetch_profile(
    name: str, tag: str, count: int = MATCH_COUNT, start: int = 0, refresh: bool = False
) -> dict:

    if not refresh:
        cached = _profile_cache_get(name, tag, start)
        if cached is not None:
            return cached

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
    spells_info = await riot.get_summoner_spells_info()

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


    profile_icon_id = summoner.get("profileIconId") or DEFAULT_PROFILE_ICON_ID
    await ensure_profile_icon(profile_icon_id)

    start_ts = int(datetime(datetime.now().year, 1, 1, tzinfo=timezone.utc).timestamp())
    match_ids = await riot.get_match_ids(region, puuid, count, start_ts, start=start)

    matches = []
    rune_ids: set[int] = set()
    spell_images: set[str] = set()
    for match_id in match_ids:
        try:
            match = await riot.get_match(region, match_id)
            timeline = await riot.get_match_timeline(region, match_id)
        except RiotAPIError:
            continue
        for p in (match.get("info", {}) or {}).get("participants", []) or []:
            rune_ids.update(_runes_of(p))
        payload = build_match(match, timeline, puuid, champ_info, rune_names, item_names, spells_info, spell_images)
        if payload:
            matches.append(payload)

    await _ensure_rune_icons(rune_ids, runes_en)
    await _ensure_spell_icons(spell_images)

    wins = (rank or {}).get("wins", 0)
    losses = (rank or {}).get("losses", 0)
    tier = (rank or {}).get("tier", "UNRANKED")
    division = (rank or {}).get("rank", "")

    result = {
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
        "has_more": len(match_ids) == count,
    }

    _profile_cache_set(name, tag, start, result)
    return result


async def fetch_match_metrics(match_id: str, puuid: str | None = None) -> dict:

    region = config.RIOT_REGION
    riot = RiotClient()
    try:
        match = await riot.get_match(region, match_id)
        timeline = await riot.get_match_timeline(region, match_id)
    except RiotAPIError as e:
        raise RiotAPIError(f"Partida {match_id} no disponible: {e}", 404) from e
    champ_info = await riot.get_champion_info()
    return stats_service.timeline_metrics(match, timeline, champ_info, puuid or "")


async def fetch_match_events(match_id: str, puuid: str | None = None) -> dict:

    region = config.RIOT_REGION
    riot = RiotClient()
    try:
        match = await riot.get_match(region, match_id)
        timeline = await riot.get_match_timeline(region, match_id)
    except RiotAPIError as e:
        raise RiotAPIError(f"Partida {match_id} no disponible: {e}", 404) from e
    champ_info = await riot.get_champion_info()
    payload = stats_service.timeline_events(match, timeline, champ_info, puuid or "")
    images: set[str] = set()
    for ev in payload.get("events", []):
        refs = [ev.get("killer"), ev.get("victim")]
        refs.extend(ev.get("assisters") or [])
        for ref in refs:
            icon = ref and ref.get("champion_icon")
            if icon:
                images.add(icon.rsplit("/", 1)[-1])
    await _ensure_champion_icons(images)
    return payload


SKILL_SLOT_KEYS = ["Q", "W", "E", "R"]


def _skill_order(timeline: dict, participant_id: int) -> list[int]:

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


async def _ensure_champion_icons(images: set[str]) -> None:

    if not images:
        return
    out_dir = config.CHAMPIONS_DIR
    out_dir.mkdir(parents=True, exist_ok=True)
    import aiohttp

    async with aiohttp.ClientSession() as session:
        for image in sorted(images):
            path = out_dir / image
            if path.is_file():
                continue
            async with session.get(config.CHAMPION_ICON_URL.format(image=image)) as resp:
                if resp.status == 200:
                    try:
                        path.write_bytes(await resp.read())
                    except OSError:
                        pass


async def fetch_match_build(match_id: str, puuid: str | None = None) -> dict:





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


async def fetch_mastery(name: str, tag: str) -> dict:

    region = config.RIOT_REGION
    riot = RiotClient()

    account = await riot.get_account_by_riot_id(region, name, tag)
    puuid = account.get("puuid", "")
    if not puuid:
        raise RuntimeError("No se encontró esa cuenta en EUW. Revisa el Nombre#tag.")
    game_name = account.get("gameName") or name
    tag_line = account.get("tagLine") or tag

    cached = _mastery_cache.get(puuid)
    if cached and time.time() - cached[0] < MASTERY_CACHE_TTL:
        return cached[1]

    data = await riot.get_champion_mastery(region, puuid)
    champ_info = await riot.get_champion_info()

    total_points = sum(m.get("championPoints", 0) for m in data)
    champions = []
    images: set[str] = set()
    for m in data:
        champ = champ_info.get(m.get("championId"), {})
        image = champ.get("image")
        if image:
            images.add(image)
        champions.append(
            {
                "champion_id": m.get("championId"),
                "name": champ.get("name", f"ID {m.get('championId')}"),
                "icon": _champ_url(champ),
                "level": m.get("championLevel", 0),
                "points": m.get("championPoints", 0),
                "points_since_last_level": m.get("championPointsSinceLastLevel", 0),
                "points_until_next": m.get("championPointsUntilNextLevel", 0),
                "chest_granted": bool(m.get("chestGranted")),
                "tokens": m.get("tokensEarned", 0),
                "last_played": m.get("lastPlayTime", 0),
            }
        )
    await _ensure_champion_icons(images)

    result = {
        "summoner": {
            "name": game_name,
            "tag": tag_line,
            "puuid": puuid,
        },
        "summary": {
            "total_points": total_points,
            "champion_count": len(data),
        },
        "mastery": champions,
    }
    _mastery_cache[puuid] = (time.time(), result)
    return result


async def fetch_live_game(name: str, tag: str) -> dict:

    region = config.RIOT_REGION
    riot = RiotClient()

    account = await riot.get_account_by_riot_id(region, name, tag)
    puuid = account.get("puuid", "")
    if not puuid:
        raise RuntimeError("No se encontró esa cuenta en EUW. Revisa el Nombre#tag.")

    summoner = await riot.get_summoner_by_puuid(region, puuid)
    game = await riot.get_active_game(region, puuid)
    if not game:
        return {"in_game": False}

    champ_info = await riot.get_champion_info()
    runes_en = await riot.get_runes_info("en_US")
    runes_es = await riot.get_runes_info("es_ES")
    spells_info = await riot.get_summoner_spells_info()

    rune_names = {
        rid: {"en": runes_en.get(rid, {}).get("name", ""), "es": runes_es.get(rid, {}).get("name", "")}
        for rid in runes_en
    }
    for rid, names in STAT_MOD_NAMES.items():
        rune_names[rid] = names

    my_id = summoner.get("id", "")
    teams = {100: [], 200: []}
    rune_ids: set[int] = set()
    spell_images: set[str] = set()
    champ_images: set[str] = set()

    for p in game.get("participants", []) or []:
        team_id = p.get("teamId", 0)
        champ = champ_info.get(p.get("championId"), {})
        image = champ.get("image")
        if image:
            champ_images.add(image)
        perks = p.get("perks", {}) or {}
        perk_ids = perks.get("perkIds", []) or []
        rune_ids.update(perk_ids)
        spell_sids = p.get("spells") or [p.get("spell1Id"), p.get("spell2Id")]
        spells = []
        for sid in spell_sids[:2]:
            sp = spells_info.get(sid, {})
            simage = sp.get("image")
            if simage:
                spell_images.add(simage)
            spells.append(
                {
                    "src": f"/assets/spells/{simage}" if simage else None,
                    "name": sp.get("name") or {"en": "", "es": ""},
                }
            )
        riot_id = p.get("riotId") or ""
        if riot_id and "#" in riot_id:
            r_name, r_tag = riot_id.rsplit("#", 1)
        else:
            r_name = p.get("summonerName") or p.get("riotIdGameName", "")
            r_tag = p.get("riotIdTagline", "")
        teams.setdefault(team_id, []).append(
            {
                "summoner_name": r_name,
                "summoner_tag": r_tag,
                "champion": champ.get("name", f"ID {p.get('championId')}"),
                "champion_icon": _champ_url(champ),
                "spells": spells,
                "keystone": _runed(perk_ids[0], rune_names) if perk_ids else None,
                "runes": [_runed(r, rune_names) for r in perk_ids],
                "is_player": (p.get("puuid") == puuid) or (p.get("summonerId") == my_id),
            }
        )

    bans = {100: [], 200: []}
    for b in game.get("bannedChampions", []) or []:
        champ = champ_info.get(b.get("championId"), {})
        image = champ.get("image")
        if image:
            champ_images.add(image)
        bans.setdefault(b.get("teamId", 0), []).append(
            {
                "champion": champ.get("name", f"ID {b.get('championId')}"),
                "champion_icon": _champ_url(champ),
            }
        )

    await _ensure_champion_icons(champ_images)
    await _ensure_rune_icons(rune_ids, runes_en)
    await _ensure_spell_icons(spell_images)

    return {
        "in_game": True,
        "game": {
            "queue": game.get("gameQueueConfigId"),
            "map": game.get("mapId"),
            "mode": game.get("gameMode", ""),
            "length_sec": game.get("gameLength", 0) or 0,
            "started": game.get("gameStartTime"),
        },
        "bans": bans,
        "teams": [{"team_id": tid, "players": teams.get(tid, [])} for tid in (100, 200)],
    }
