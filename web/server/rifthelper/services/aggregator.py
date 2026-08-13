"""Agregador del parche: convierte las filas compactas (rows/) y los datos extraídos de
timeline en estadísticas por campeón-rol que sirve la API (/api/champion/{key}).
"""

import gzip
import json
import time
from collections import defaultdict
from pathlib import Path

from rifthelper import config

MIN_MATCHUP_GAMES = 80
MIN_RUNE_GAMES = 40
MIN_BUILD_GAMES = 30
MIN_SPELL_GAMES = 50
MIN_SKILL_GAMES = 50
TOP_BUILDS = 10
TOP_RUNES = 25
TOP_SPELLS = 5
TOP_SKILLS = 5
TOP_START = 5
TIER_BOUNDS = [0.10, 0.30, 0.60, 0.85]


def _pct(wins: int, games: int) -> float:
    return round(100.0 * wins / games, 2) if games else 0.0


def _load_rows(rows_dir: Path):
    for path in sorted(rows_dir.glob("*.json.gz")):
        with gzip.open(path, "rt", encoding="utf-8") as f:
            yield json.load(f)


def _load_extracted(extract_dir: Path) -> dict:
    out = {}
    for path in sorted(extract_dir.glob("*.json.gz")):
        with gzip.open(path, "rt", encoding="utf-8") as f:
            data = json.load(f)
        if isinstance(data, dict) and "m" in data:
            out[data["m"]] = data
        elif isinstance(data, dict):
            out[path.stem] = data
    return out


def aggregate(patch: str | None = None) -> Path:
    patch = patch or config.PATCH
    rows_dir = config.PATCH_ROWS_DIR
    extract_dir = config.PATCH_EXTRACTED_DIR
    stats_dir = config.PATCH_STATS_DIR
    stats_dir.mkdir(parents=True, exist_ok=True)

    print("Cargando datos extraídos de timeline...")
    extracted = _load_extracted(extract_dir)
    print(f"  {len(extracted)} matches con timeline")

    totals = {"matches": 0, "bans": 0}
    queues: dict = defaultdict(int)
    st = defaultdict(lambda: defaultdict(int))
    bans = defaultdict(int)
    roles_games = defaultdict(int)
    pick_games = defaultdict(int)
    runes = defaultdict(lambda: defaultdict(lambda: [0, 0]))
    spells = defaultdict(lambda: defaultdict(lambda: [0, 0]))
    final_builds = defaultdict(lambda: defaultdict(lambda: [0, 0]))
    builds = defaultdict(lambda: defaultdict(lambda: [0, 0]))
    start_items = defaultdict(lambda: defaultdict(lambda: [0, 0]))
    skills = defaultdict(lambda: defaultdict(lambda: [0, 0]))
    skill_paths = defaultdict(lambda: defaultdict(lambda: [0, 0]))
    matchups = defaultdict(lambda: defaultdict(lambda: [0, 0]))

    print("Procesando rows...")
    t0 = time.time()
    n = 0
    for row in _load_rows(rows_dir):
        n += 1
        if n % 20000 == 0:
            print(f"  {n} matches | {time.time()-t0:.0f}s | {len(st)} champ-roles")
        queues[row.get("q")] += 1
        totals["matches"] += 1
        for cid in row.get("b", []) or []:
            bans[cid] += 1
            totals["bans"] += 1
        tldata = extracted.get(row.get("m", ""), {})
        for p in row.get("ps", []) or []:
            champ, role = p.get("c"), p.get("r")
            if not champ or not role:
                continue
            key = (champ, role)
            wins = 1 if p.get("w") else 0
            st[key]["games"] += 1
            st[key]["wins"] += wins
            pick_games[champ] += 1

            rk = tuple(p.get("rk") or [])
            if rk:
                rpage = (rk, tuple(p.get("sk") or []), tuple(p.get("sh") or []))
                runes[key][rpage][0] += wins
                runes[key][rpage][1] += 1

            sp = tuple(sorted(x for x in (p.get("s") or []) if x))
            if sp:
                spells[key][sp][0] += wins
                spells[key][sp][1] += 1

            items = [i for i in (p.get("it") or []) if i]
            if items:
                final_builds[key][tuple(items)][0] += wins
                final_builds[key][tuple(items)][1] += 1

            for op in row.get("ps", []):
                if (
                    op.get("p") != p.get("p")
                    and op.get("r") == role
                    and op.get("t") != p.get("t")
                    and op.get("c")
                ):
                    matchups[key][(op.get("c"),)][0] += wins if not op.get("w") else 0
                    matchups[key][(op.get("c"),)][1] += 1

            tl = (tldata or {}).get(str(p.get("p")), {}) if tldata else {}
            buy = tl.get("buy") or []
            if buy:
                start_items[key][tuple(buy[:3])][0] += wins
                start_items[key][tuple(buy[:3])][1] += 1
                builds[key][tuple(buy)][0] += wins
                builds[key][tuple(buy)][1] += 1
            maxorder = tl.get("max")
            spath = tl.get("skills")
            if maxorder:
                skills[key][maxorder][0] += wins
                skills[key][maxorder][1] += 1
            if spath:
                skill_paths[key][spath[:4]][0] += wins
                skill_paths[key][spath[:4]][1] += 1

    print(f"Procesados {n} matches en {time.time()-t0:.0f}s")

    role_wr: dict[str, list[tuple[float, tuple]]] = defaultdict(list)
    for (champ, role), d in st.items():
        if d["games"] >= 300:
            role_wr[role].append((d["wins"] / d["games"], (champ, role)))
    rank_map: dict[tuple, int] = {}
    tier_map: dict[tuple, str] = {}
    for role, items in role_wr.items():
        items.sort(key=lambda x: x[0], reverse=True)
        for i, (_, key) in enumerate(items):
            rank_map[key] = i + 1
            q = (i + 1) / len(items)
            if q <= TIER_BOUNDS[0]:
                tier_map[key] = "S"
            elif q <= TIER_BOUNDS[1]:
                tier_map[key] = "A"
            elif q <= TIER_BOUNDS[2]:
                tier_map[key] = "B"
            elif q <= TIER_BOUNDS[3]:
                tier_map[key] = "C"
            else:
                tier_map[key] = "D"

    total_matches = max(totals["matches"], 1)
    total_bans = max(totals["bans"], 1)

    out = {"patch": patch, "generated_at": int(time.time()), "total_matches": totals["matches"]}

    def _top(counter, limit, min_games):
        res = []
        for k, v in counter.items():
            if v[1] >= min_games:
                res.append((_pct(v[0], v[1]), v[1], k))
        res.sort(key=lambda x: (-x[1], -x[0]))
        return res[:limit]

    champions: dict = {}
    for (champ, role), d in st.items():
        games = d["games"]
        if games < 50:
            continue
        key = (champ, role)
        entry = {
            "role": role,
            "games": games,
            "wins": d["wins"],
            "winrate": _pct(d["wins"], games),
            "pick_rate": round(100.0 * pick_games[champ] / total_matches, 2),
            "ban_rate": round(100.0 * bans[champ] / total_bans, 2),
            "rank": rank_map.get(key),
            "tier": tier_map.get(key, "D"),
            "runes_pages": [
                {"keystone": k[0][0], "primary": list(k[0]), "secondary": list(k[1]),
                 "shards": list(k[2]), "wr": r, "matches": m}
                for r, m, k in _top(runes[key], TOP_RUNES, MIN_RUNE_GAMES)
            ],
            "spells": [
                {"spells": list(k), "wr": r, "matches": m}
                for r, m, k in _top(spells[key], TOP_SPELLS, MIN_SPELL_GAMES)
            ],
            "builds": [
                {"items": list(k), "wr": r, "matches": m}
                for r, m, k in _top(builds[key], TOP_BUILDS, MIN_BUILD_GAMES)
            ],
            "final_builds": [
                {"items": list(k), "wr": r, "matches": m}
                for r, m, k in _top(final_builds[key], TOP_BUILDS, MIN_BUILD_GAMES)
            ],
            "starting_items": [
                {"items": list(k), "wr": r, "matches": m}
                for r, m, k in _top(start_items[key], TOP_START, MIN_BUILD_GAMES)
            ],
            "skills": [
                {"max": k, "wr": r, "matches": m}
                for r, m, k in _top(skills[key], TOP_SKILLS, MIN_SKILL_GAMES)
            ],
            "skill_paths": [
                {"path": k, "wr": r, "matches": m}
                for r, m, k in _top(skill_paths[key], TOP_SKILLS, MIN_SKILL_GAMES)
            ],
            "matchups": [
                {"champion": k[0], "wr": r, "matches": m}
                for r, m, k in _top(matchups[key], 200, MIN_MATCHUP_GAMES)
            ],
        }
        champions.setdefault(str(champ), []).append(entry)

    for champ, roles in champions.items():
        roles.sort(key=lambda r: r["games"], reverse=True)

    out["champions"] = champions
    out["queues"] = dict(queues)

    out_path = stats_dir / "champions.json"
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False)
    print(f"Aggregados escritos en {out_path} ({out_path.stat().st_size/1e6:.1f} MB)")
    return out_path


def main():
    import argparse

    parser = argparse.ArgumentParser(description="Agrega las stats del parche")
    parser.parse_args()
    aggregate()


if __name__ == "__main__":
    main()
