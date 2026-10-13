from datetime import datetime, timezone
from pathlib import Path

from rifthelper import config

ROLE_KEYS = ("teamPosition", "lane")


def _role(p: dict) -> str:
    return p.get("teamPosition") or p.get("lane") or ""


def match_accolades(match: dict, timeline: dict) -> dict[int, list[dict]]:
    """Award match highs/lows from explicit Match-V5 participant and timeline stats."""
    info = match.get("info", {}) or {}
    participants = info.get("participants", []) or []
    frames = (timeline.get("info", {}) or {}).get("frames", []) or []
    if not participants:
        return {}

    team_kills = {
        team: sum(p.get("kills", 0) or 0 for p in participants if p.get("teamId") == team)
        for team in {p.get("teamId") for p in participants}
    }
    gold10 = {}
    if frames and (frames[-1].get("timestamp", 0) or 0) >= 600_000:
        frame10 = min(frames, key=lambda f: abs((f.get("timestamp", 0) or 0) - 600_000))
        gold10 = (frame10.get("participantFrames", {}) or {})
    early_deaths = {p.get("participantId"): 0 for p in participants}
    first_blood = None
    for frame in frames:
        for event in frame.get("events", []) or []:
            if event.get("type") != "CHAMPION_KILL":
                continue
            pid = event.get("victimId")
            if (event.get("timestamp") or 0) < 600_000 and pid in early_deaths:
                early_deaths[pid] += 1
            if first_blood is None:
                first_blood = event.get("killerId")

    values: dict[int, dict[str, float]] = {}
    for p in participants:
        pid = p.get("participantId")
        team = p.get("teamId")
        kills = p.get("kills", 0) or 0
        deaths = p.get("deaths", 0) or 0
        assists = p.get("assists", 0) or 0
        duration = max(1, (info.get("gameDuration", 0) or 0) / 60)
        cs = (p.get("totalMinionsKilled", 0) or 0) + (p.get("neutralMinionsKilled", 0) or 0)
        gold = p.get("goldEarned", 0) or 0
        team_gold = sum((x.get("goldEarned", 0) or 0) for x in participants if x.get("teamId") == team)
        frame = (gold10.get(str(pid), {}) or {})
        lane_opponent = next((x for x in participants if x.get("teamId") != team and _role(x) == _role(p) and _role(p)), None)
        opponent_frame = (gold10.get(str(lane_opponent.get("participantId")), {}) or {}) if lane_opponent else {}
        damage = p.get("totalDamageDealtToChampions", 0) or 0
        kp = (kills + assists) / max(1, team_kills.get(team, 0))
        kda = (kills + assists) / max(1, deaths)
        values[pid] = {
            "kills": kills, "deaths": deaths, "assists": assists,
            "kda": kda, "damage": damage, "damage_taken": p.get("totalDamageTaken", 0) or 0,
            "vision": p.get("visionScore", 0) or 0, "cs_min": cs / duration,
            "gold": gold, "gold_share": gold / max(1, team_gold), "kp": kp,
            "objective_damage": p.get("damageDealtToObjectives", 0) or 0,
            "building_damage": p.get("damageDealtToBuildings", 0) or 0,
            "cc": p.get("timeCCingOthers", 0) or 0,
            "wards_placed": p.get("wardsPlaced", 0) or 0,
            "wards_killed": p.get("wardsKilled", 0) or 0,
            "multikill": p.get("largestMultiKill", 0) or 0,
            "steals": p.get("objectivesStolen", 0) or 0,
            "healing": p.get("totalHealsOnTeammates", 0) or 0,
            "early_deaths": early_deaths.get(pid, 0),
            "level": p.get("champLevel", 0) or 0,
            "gold_diff10": (
                (frame.get("totalGold", 0) or 0) - (opponent_frame.get("totalGold", 0) or 0)
                if lane_opponent and str(pid) in gold10 and str(lane_opponent.get("participantId")) in gold10
                else None
            ),
        }

    # Each definition creates one positive or negative accolade for the relevant extreme.
    awards: dict[int, list[dict]] = {pid: [] for pid in values}
    rules = [
        ("kda_beast", "kda", "max", "positive"),
        ("team_carry", "gold_share", "max", "positive"),
        ("damage_dealer", "damage", "max", "positive"),
        ("damage_sponge", "damage_taken", "max", "positive"),
        ("visionary", "vision", "max", "positive"),
        ("cs_machine", "cs_min", "max", "positive"),
        ("gold_hoarder", "gold", "max", "positive"),
        ("kill_securer", "kills", "max", "positive"),
        ("assist_king", "assists", "max", "positive"),
        ("untouchable", "deaths", "min", "positive"),
        ("objective_hunter", "objective_damage", "max", "positive"),
        ("demolition_crew", "building_damage", "max", "positive"),
        ("cc_controller", "cc", "max", "positive"),
        ("ward_setter", "wards_placed", "max", "positive"),
        ("ward_cleaner", "wards_killed", "max", "positive"),
        ("multikill_machine", "multikill", "max", "positive"),
        ("epic_stealer", "steals", "max", "positive"),
        ("teamfight_presence", "kp", "max", "positive"),
        ("big_healer", "healing", "max", "positive"),
        ("death_magnet", "deaths", "max", "negative"),
        ("rough_start", "early_deaths", "max", "negative"),
        ("low_kda", "kda", "min", "negative"),
        ("low_damage", "damage", "min", "negative"),
        ("low_vision", "vision", "min", "negative"),
        ("farm_behind", "cs_min", "min", "negative"),
        ("low_participation", "kp", "min", "negative"),
        ("gold_starved", "gold_share", "min", "negative"),
        ("objective_ghost", "objective_damage", "min", "negative"),
        ("structure_shy", "building_damage", "min", "negative"),
        ("wardless", "wards_placed", "min", "negative"),
        ("no_vision_control", "wards_killed", "min", "negative"),
        ("slow_start", "gold_diff10", "min", "negative"),
    ]
    for key, metric, direction, polarity in rules:
        candidates = [(pid, v[metric]) for pid, v in values.items() if v[metric] is not None]
        if not candidates:
            continue
        extreme = (max if direction == "max" else min)(value for _, value in candidates)
        if max(value for _, value in candidates) <= 0 and key != "slow_start":
            continue
        for pid, value in candidates:
            if value == extreme:
                rank = (
                    1 + sum(1 for _, other in candidates if other > value)
                    if direction == "max"
                    else 1 + sum(1 for _, other in candidates if other < value)
                )
                awards[pid].append(
                    {
                        "key": key,
                        "metric": metric,
                        "direction": direction,
                        "value": round(value, 2),
                        "rank": rank,
                        "polarity": polarity,
                    }
                )

    if first_blood in awards:
        awards[first_blood].append({"key": "first_blood", "metric": "first_blood", "direction": "special", "value": 1, "rank": 1, "polarity": "positive"})
    for p in participants:
        pid = p.get("participantId")
        if values[pid]["level"] >= 18:
            awards[pid].append({"key": "max_level", "metric": "max_level", "direction": "special", "value": 18, "rank": 1, "polarity": "positive"})
    return awards


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

    team_kills = {
        team: sum(p.get("kills", 0) or 0 for p in participants if p.get("teamId") == team)
        for team in {p.get("teamId") for p in participants}
    }
    team_gold = {
        team: sum(p.get("goldEarned", 0) or 0 for p in participants if p.get("teamId") == team)
        for team in {p.get("teamId") for p in participants}
    }
    duration_min = max(1, (info.get("gameDuration", 0) or 0) / 60)
    players = []
    for p in participants:
        pid = p.get("participantId")
        champ = champ_info.get(p.get("championId"), {})
        image = champ.get("image")
        series = {"gold": [], "damage": [], "damage_taken": [], "xp": [], "cs": []}
        for i in idx:
            pf = (frames[i].get("participantFrames", {}) or {}).get(str(pid), {}) or {}
            stats = pf.get("damageStats", {}) or {}
            series["gold"].append(pf.get("totalGold") or 0)
            series["damage"].append(stats.get("totalDamageDoneToChampions") or 0)
            series["damage_taken"].append(stats.get("totalDamageTaken") or 0)
            series["xp"].append(pf.get("xp") or 0)
            series["cs"].append(
                (pf.get("minionsKilled") or 0) + (pf.get("jungleMinionsKilled") or 0)
            )
        kills = p.get("kills", 0) or 0
        deaths = p.get("deaths", 0) or 0
        assists = p.get("assists", 0) or 0
        cs_total = (p.get("totalMinionsKilled", 0) or 0) + (p.get("neutralMinionsKilled", 0) or 0)
        players.append(
            {
                "participant_id": pid,
                "team": p.get("teamId", 0),
                "champion": champ.get("name", f"ID {p.get('championId')}"),
                "champion_icon": f"{config.SITE_URL}/assets/champions/{image}" if image else None,
                "is_player": p.get("puuid") == puuid,
                "summary": {
                    "kda": round((kills + assists) / max(1, deaths), 2),
                    "cs_min": round(cs_total / duration_min, 2),
                    "kp": round((kills + assists) / max(1, team_kills.get(p.get("teamId"), 0)) * 100, 1),
                    "damage": p.get("totalDamageDealtToChampions", 0) or 0,
                    "damage_taken": p.get("totalDamageTaken", 0) or 0,
                    "vision": p.get("visionScore", 0) or 0,
                    "gold_share": round((p.get("goldEarned", 0) or 0) / max(1, team_gold.get(p.get("teamId"), 0)) * 100, 1),
                    "objectives": p.get("damageDealtToObjectives", 0) or 0,
                },
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
        "champion_icon": f"{config.SITE_URL}/assets/champions/{image}" if image else None,
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
                        "position": {
                            "x": (ev.get("position") or {}).get("x"),
                            "y": (ev.get("position") or {}).get("y"),
                        } if ev.get("position") else None,
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
