from datetime import datetime, timezone
from pathlib import Path

from rifthelper import config

ROLE_KEYS = ("teamPosition", "lane")


def _role(p: dict) -> str:
    return p.get("teamPosition") or p.get("lane") or ""


def compute_match_stats(
    match: dict, timeline: dict, puuid: str, champ_info: dict[int, dict]
) -> dict | None:
    info = match.get("info", {})
    participants = info.get("participants", [])
    target = next((p for p in participants if p.get("puuid") == puuid), None)
    if not target:
        return None

    target_id = target.get("participantId")
    enemy = next(
        (
            p
            for p in participants
            if p.get("teamId") != target.get("teamId") and _role(p) == _role(target)
        ),
        None,
    )

    player_champ = champ_info.get(target.get("championId"), {})
    enemy_champ = champ_info.get(enemy.get("championId"), {}) if enemy else {}

    frames = timeline.get("info", {}).get("frames", []) or []

    def gold_at(participant_id: int, minute: int):
        if minute < len(frames):
            pf = frames[minute].get("participantFrames", {})
            return pf.get(str(participant_id), {}).get("totalGold")
        return None

    p10, p30 = gold_at(target_id, 10), gold_at(target_id, 30)
    e10 = e30 = None
    if enemy:
        eid = enemy.get("participantId")
        e10, e30 = gold_at(eid, 10), gold_at(eid, 30)

    diff10 = round(p10 - e10) if (p10 is not None and e10 is not None) else None
    diff30 = round(p30 - e30) if (p30 is not None and e30 is not None) else None

    duration_sec = info.get("gameDuration", 0) or 0
    duration_min = duration_sec / 60 if duration_sec else 1
    last = frames[-1].get("participantFrames", {}).get(str(target_id), {}) if frames else {}
    total_cs = last.get("minionsKilled", 0) + last.get("jungleMinionsKilled", 0)
    cs_min = round(total_cs / duration_min, 1)

    challenges = target.get("challenges", {}) or {}
    dmg_per_min = challenges.get("damagePerMinute")
    if dmg_per_min is None:
        dmg_per_min = target.get("totalDamageDealtToChampions", 0) / duration_min
    dmg_per_min = round(dmg_per_min, 1)

    total_damage = target.get("totalDamageDealtToChampions", 0)

    kp = challenges.get("killParticipation")
    if kp is None:
        kills = target.get("kills", 0)
        assists = target.get("assists", 0)
        team_kills = sum(
            p.get("kills", 0) for p in participants if p.get("teamId") == target.get("teamId")
        )
        kp = (kills + assists) / team_kills if team_kills else 0
    kp_pct = round(kp * 100)

    dmg_buildings = target.get("damageDealtToBuildings", 0)

    vision_per_min = challenges.get("visionScorePerMinute")
    if vision_per_min is None:
        vision_per_min = target.get("visionScore", 0) / duration_min
    vision_per_min = round(vision_per_min, 1)

    created = info.get("gameCreation", 0)
    date = (
        datetime.fromtimestamp(created / 1000, tz=timezone.utc).strftime("%d/%m/%Y")
        if created
        else "—"
    )

    item_ids = []
    for i in range(7):
        item_id = target.get(f"item{i}", 0) or 0
        item_ids.append(item_id)

    keystone = None
    styles = (target.get("perks", {}) or {}).get("styles", []) or []
    if styles:
        selections = styles[0].get("selections", []) or []
        if selections:
            keystone = selections[0].get("perk")

    return {
        "date": date,
        "duration_sec": duration_sec,
        "win": bool(target.get("win")),
        "player_champion": player_champ.get("name", f"ID {target.get('championId')}"),
        "player_icon": _icon_path(player_champ),
        "enemy_champion": enemy_champ.get("name", "—"),
        "enemy_icon": _icon_path(enemy_champ) if enemy_champ else None,
        "diff10": diff10,
        "diff30": diff30,
        "cs_min": cs_min,
        "dmg_per_min": dmg_per_min,
        "total_damage": total_damage,
        "kp": kp_pct,
        "dmg_buildings": dmg_buildings,
        "vision_per_min": vision_per_min,
        "item_ids": item_ids,
        "keystone": keystone,
    }


def _icon_path(champ: dict) -> Path | None:
    image = champ.get("image")
    if not image:
        return None
    path = config.CHAMPIONS_DIR / image
    return path if path.is_file() else None
