import json
import random

from rifthelper import config

_LRU: dict = {}


def _load_json(path, key):
    if key in _LRU:
        return _LRU[key]
    if path.is_file():
        try:
            _LRU[key] = json.loads(path.read_text(encoding="utf-8"))
            return _LRU[key]
        except (ValueError, OSError):
            pass
    _LRU[key] = {}
    return _LRU[key]


def _champions() -> dict[str, dict]:
    return _load_json(config.CHAMPIONS_CACHE, "champions")


def _unique_champions() -> list[dict]:
    seen = set()
    out = []
    for key, c in sorted(_champions().items(), key=lambda kv: int(kv[0])):
        name = c.get("name", "")
        if name in seen:
            continue
        seen.add(name)
        out.append(
            {
                "key": int(key),
                "id": c.get("id", name),
                "name": name,
                "image": f"/assets/champions/{c.get('image', '')}",
            }
        )
    return out


def list_champions() -> list[dict]:
    return _unique_champions()


ROLES = [
    {"id": "top", "key": 0, "tier": "S"},
    {"id": "jungle", "key": 1, "tier": "A"},
    {"id": "mid", "key": 2, "tier": "S"},
    {"id": "bot", "key": 3, "tier": "B"},
    {"id": "support", "key": 4, "tier": "A"},
]

KEYS = ["Conqueror", "Press the Attack", "Lethal Tempo", "Fleet Footwork", "Electrocute", "Dark Harvest", "Grasp of the Undying", "Arcane Comet"]

PRIMARY = [
    "Triumph",
    "Legend: Haste",
    "Last Stand",
    "Cheap Shot",
    "Taste of Blood",
    "Conditioning",
    "Second Wind",
]

SECONDARY = ["Revitalize", "Bone Plating", "Overgrowth", "Eyeball Collection", "Ingenious Hunter", "Presence of Mind"]

STARTING = [
    "Doran's Blade",
    "Doran's Ring",
    "Doran's Shield",
    "Long Sword",
    "Amplifying Tome",
    "Relic Shield",
    "Spellthief's Edge",
]

CORE = [
    "Spear of Shojin",
    "Black Cleaver",
    "Sundered Sky",
    "Eclipse",
    "Stridebreaker",
    "Liandry's Torment",
    "Rabadon's Deathcap",
    "Trinity Force",
]


def _rng(champ_key: int) -> random.Random:
    return random.Random(1000 + champ_key)


def champion_detail(champ_key: int) -> dict | None:
    champs = _unique_champions()
    champ = next((c for c in champs if c["key"] == champ_key), None)
    if champ is None:
        return None

    rng = _rng(champ_key)
    role = rng.choice(ROLES)

    winrate = round(rng.uniform(47.0, 54.5), 2)
    pick = round(rng.uniform(1.5, 9.0), 1)
    ban = round(rng.uniform(0.5, 12.0), 1)
    matches = int(rng.uniform(3000, 30000))

    keystone = rng.choice(KEYS)
    primary = rng.sample(PRIMARY, 3)
    secondary = rng.sample(SECONDARY, 2)
    rune_page = {
        "keystone": keystone,
        "primary": [keystone] + primary,
        "secondary": secondary,
        "shards": ["Adaptive Force", "Adaptive Force", "Health"],
    }

    starting = rng.sample(STARTING, 2)
    core_items = rng.sample(CORE, 3)

    others = [c for c in champs if c["key"] != champ_key]
    rng.shuffle(others)
    tough = []
    for c in others[:8]:
        tough.append(
            {
                "key": c["key"],
                "name": c["name"],
                "image": c["image"],
                "winrate": round(rng.uniform(35.0, 49.5), 1),
                "matches": int(rng.uniform(50, 1500)),
            }
        )
    tough.sort(key=lambda m: m["winrate"])

    return {
        "key": champ_key,
        "id": champ["id"],
        "name": champ["name"],
        "image": champ["image"],
        "role": role["id"],
        "role_tier": role["tier"],
        "tier": role["tier"],
        "winrate": winrate,
        "pick_rate": pick,
        "ban_rate": ban,
        "matches": matches,
        "rank": int(rng.uniform(1, 61)),
        "summoner_spells": rng.choice(
            [
                ["Flash", "Ignite"],
                ["Flash", "Teleport"],
                ["Flash", "Ghost"],
                ["Flash", "Exhaust"],
            ]
        ),
        "runes": rune_page,
        "runes_winrate": round(winrate + rng.uniform(-0.5, 3.5), 2),
        "runes_matches": int(matches * rng.uniform(0.25, 0.5)),
        "starting_items": starting,
        "core_items": core_items,
        "skill_priority": rng.choice(["Q > E > W", "Q > W > E", "E > Q > W", "W > Q > E"]),
        "skill_path": rng.choice(["QWEQ", "QWQE", "EQWQ", "WQEQ"]),
        "toughest_matchups": tough,
    }
