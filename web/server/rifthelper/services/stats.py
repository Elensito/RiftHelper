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
    for i in range(8):
        item_id = target.get(f"item{i}", 0) or 0
        item_ids.append(item_id)

    is_adc = (target.get("teamPosition") or "").upper() == "BOTTOM"
    if is_adc:
        role_boots = target.get("roleBoundItem", 0) or 0
        item_ids[7] = role_boots or item_ids[7]

    keystone = None
    styles = (target.get("perks", {}) or {}).get("styles", []) or []
    if styles:
        selections = styles[0].get("selections", []) or []
        if selections:
            keystone = selections[0].get("perk")

    return {
        "created": created,
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
        "is_adc": is_adc,
    }


def _icon_path(champ: dict) -> Path | None:
    image = champ.get("image")
    if not image:
        return None
    path = config.CHAMPIONS_DIR / image
    return path if path.is_file() else None


METRIC_STEP = 2


def timeline_metrics(
    match: dict, timeline: dict, champ_info: dict[int, dict], puuid: str
) -> dict:






    info = match.get("info", {}) or {}
    participants = info.get("participants", []) or []
    frames = timeline.get("info", {}).get("frames", []) or []

    idx = list(range(0, len(frames), METRIC_STEP))
    if frames and idx[-1] != len(frames) - 1:
        idx.append(len(frames) - 1)

    players = []
    for p in participants:
        pid = p.get("participantId")
        champ = champ_info.get(p.get("championId"), {})
        image = champ.get("image")
        series = {"gold": [], "damage": [], "xp": [], "cs": []}
        for i in idx:
            pf = (frames[i].get("participantFrames", {}) or {}).get(str(pid), {}) or {}
            stats = pf.get("damageStats", {}) or {}
            series["gold"].append(pf.get("totalGold") or 0)
            series["damage"].append(stats.get("totalDamageDoneToChampions") or 0)
            series["xp"].append(pf.get("xp") or 0)
            series["cs"].append(
                (pf.get("minionsKilled") or 0) + (pf.get("jungleMinionsKilled") or 0)
            )
        players.append(
            {
                "participant_id": pid,
                "team": p.get("teamId", 0),
                "champion": champ.get("name", f"ID {p.get('championId')}"),
                "champion_icon": f"/assets/champions/{image}" if image else None,
                "is_player": p.get("puuid") == puuid,
                **series,
            }
        )

    return {
        "buckets": [int(frames[i].get("timestamp", 0) / 60000) for i in idx],
        "players": players,
    }


def _player_ref(p: dict, champ_info: dict[int, dict], puuid: str) -> dict:
    champ = champ_info.get(p.get("championId"), {})
    image = champ.get("image")
    return {
        "participant_id": p.get("participantId"),
        "team": p.get("teamId", 0),
        "champion": champ.get("name", f"ID {p.get('championId')}"),
        "champion_icon": f"/assets/champions/{image}" if image else None,
        "name": p.get("riotIdGameName") or p.get("summonerName") or "",
        "tag": p.get("riotIdTagline") or "",
        "is_player": p.get("puuid") == puuid,
    }


def timeline_events(match: dict, timeline: dict, champ_info: dict[int, dict], puuid: str) -> dict:
    info = match.get("info", {}) or {}
    participants = info.get("participants", []) or []
    by_id = {p.get("participantId"): p for p in participants}
    frames = timeline.get("info", {}).get("frames", []) or []

    events = []
    first_kill_done = False
    for frame in frames:
        for ev in frame.get("events", []) or []:
            ts = ev.get("timestamp")
            if ts is None:
                continue
            minute = int(ts // 60000)
            time = f"{minute}:{str(int((ts % 60000) // 1000)).zfill(2)}"
            etype = ev.get("type")

            if etype == "CHAMPION_KILL":
                killer_id = ev.get("killerId")
                victim_id = ev.get("victimId")
                killer = by_id.get(killer_id)
                victim = by_id.get(victim_id)
                events.append(
                    {
                        "ts": ts,
                        "minute": minute,
                        "time": time,
                        "type": "kill",
                        "team": killer.get("teamId", 0) if killer else 0,
                        "killer": _player_ref(killer, champ_info, puuid) if killer else None,
                        "victim": _player_ref(victim, champ_info, puuid) if victim else None,
                        "assists": len(ev.get("assistingParticipantIds", []) or []),
                        "assisters": [
                            _player_ref(by_id.get(pid), champ_info, puuid)
                            for pid in (ev.get("assistingParticipantIds", []) or [])
                        ],
                        "first_blood": not first_kill_done,
                        "shutdown": (ev.get("killStreak", 0) or 0) >= 3,
                    }
                )
                first_kill_done = True

            elif etype == "ELITE_MONSTER_KILL":
                killer = by_id.get(ev.get("killerId"))
                events.append(
                    {
                        "ts": ts,
                        "minute": minute,
                        "time": time,
                        "type": "objective",
                        "team": ev.get("killerTeamId") or 0,
                        "monster": ev.get("monsterType") or "",
                        "dragon_type": ev.get("dragonType") or None,
                        "killer": _player_ref(killer, champ_info, puuid) if killer else None,
                    }
                )

            elif etype == "BUILDING_KILL":
                killer = by_id.get(ev.get("killerId"))
                lane = (ev.get("lane") or (killer.get("teamPosition") if killer else "") or "").replace(
                    "_LANE", ""
                )
                lane = {
                    "MIDDLE": "MID",
                    "BOTTOM": "BOT",
                    "UTILITY": "BOT",
                    "JUNGLE": "",
                }.get(lane, lane)
                events.append(
                    {
                        "ts": ts,
                        "minute": minute,
                        "time": time,
                        "type": "building",
                        "team": ev.get("teamId") or 0,
                        "lane": lane,
                        "building": "INHIBITOR"
                        if ev.get("buildingType") == "INHIBITOR_BUILDING"
                        else "TOWER",
                        "tower": ev.get("towerType") or None,
                        "killer": _player_ref(killer, champ_info, puuid) if killer else None,
                    }
                )

    events.sort(key=lambda e: e["ts"])
    for e in events:
        e.pop("ts", None)
    duration_min = int((info.get("gameDuration") or 0) / 60)

    return {
        "duration_min": duration_min,
        "players": [_player_ref(p, champ_info, puuid) for p in participants],
        "events": events,
    }
