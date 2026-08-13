import json
import random
from datetime import datetime, timezone

from rifthelper import config

_LRU: dict = {}

ROLE_LABELS = {
    "top": "Top",
    "jungle": "Jungle",
    "mid": "Mid",
    "bot": "Bot",
    "support": "Support",
    "other": "Other",
}


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


def _items() -> dict[str, dict]:
    return _load_json(config.ITEMS_CACHE, "items")


def _items_es() -> dict[str, dict]:
    return _load_json(config.ITEMS_CACHE_ES, "items_es")


def _runes() -> dict[str, dict]:
    return _load_json(config.RUNES_CACHE, "runes")


def _runes_es() -> dict[str, dict]:
    return _load_json(config.RUNES_CACHE_ES, "runes_es")


def _aggregates() -> dict | None:
    stats_path = config.PATCH_STATS_DIR / "champions.json"
    data = _load_json(stats_path, "patch_stats")
    return data if data else None


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


def _item_name(item_id) -> dict | None:
    key = str(item_id)
    en = _items().get(key, {}).get("name")
    es = _items_es().get(key, {}).get("name")
    if not en:
        return None
    return {"en": en, "es": es or en}


def _rune_name(rune_id) -> str | None:
    key = str(rune_id)
    en = _runes().get(key, {}).get("name")
    if not en:
        return None
    return en


def _names(items) -> list[str]:
    out = []
    for i in items:
        name = _rune_name(i)
        if name:
            out.append(name)
    return out


# ---------------------------------------------------------------------------
# Datos reales del parche (aggregator)
# ---------------------------------------------------------------------------

def _real_detail(champ_key: int, champ: dict, stats: dict) -> dict | None:
    roles = stats.get("champions", {}).get(str(champ_key), [])
    if not roles:
        return None
    main = roles[0]

    def runes_pages():
        out = []
        for p in main.get("runes_pages", []) or []:
            keystone = p.get("keystone")
            out.append(
                {
                    "keystone": _rune_name(keystone) or str(keystone),
                    "primary": _names([keystone] + list(p.get("primary", [])[1:])),
                    "secondary": _names(p.get("secondary", [])),
                    "shards": _names(p.get("shards", [])),
                    "wr": p.get("wr"),
                    "matches": p.get("matches"),
                }
            )
        return out

    def named(items_list):
        return [
            {"items": [n["en"] for n in (_item_name(i) for i in it) if n], "wr": r["wr"], "matches": r["matches"]}
            for it, r in ((x.get("items"), x) for x in items_list)
        ]

    spells = [
        {
            "spells": [
                _spell_name(s) or str(s)
                for s in x.get("spells", [])
            ],
            "wr": x.get("wr"),
            "matches": x.get("matches"),
        }
        for x in main.get("spells", []) or []
    ]

    matchups = []
    for m in main.get("matchups", []) or []:
        c = next((c for c in _unique_champions() if c["key"] == m.get("champion")), None)
        if c:
            matchups.append(
                {
                    "key": c["key"],
                    "name": c["name"],
                    "image": c["image"],
                    "winrate": m.get("wr"),
                    "matches": m.get("matches"),
                }
            )
    matchups.sort(key=lambda x: x["winrate"] or 100)

    skills = [
        {"max": " > ".join(list(x.get("max", ""))), "wr": x.get("wr"), "matches": x.get("matches")}
        for x in main.get("skills", []) or []
    ]
    skill_paths = [
        {"path": x.get("path", ""), "wr": x.get("wr"), "matches": x.get("matches")}
        for x in main.get("skill_paths", []) or []
    ]

    return {
        "key": champ_key,
        "id": champ["id"],
        "name": champ["name"],
        "image": champ["image"],
        "patch": stats.get("patch"),
        "patch_total_matches": stats.get("total_matches"),
        "generated_at": stats.get("generated_at"),
        "role": main.get("role"),
        "tier": main.get("tier"),
        "winrate": main.get("winrate"),
        "pick_rate": main.get("pick_rate"),
        "ban_rate": main.get("ban_rate"),
        "matches": main.get("games"),
        "rank": main.get("rank"),
        "roles": [
            {
                "role": r.get("role"),
                "games": r.get("games"),
                "wins": r.get("wins"),
                "winrate": r.get("winrate"),
                "pick_rate": r.get("pick_rate"),
                "ban_rate": r.get("ban_rate"),
                "rank": r.get("rank"),
                "tier": r.get("tier"),
            }
            for r in roles
        ],
        "runes_pages": runes_pages(),
        "spells": spells,
        "builds": named(main.get("builds", []) or []),
        "final_builds": named(main.get("final_builds", []) or []),
        "starting_items": named(main.get("starting_items", []) or []),
        "skills": skills,
        "skill_paths": skill_paths,
        "matchups": matchups,
    }


_SPELL_NAMES = {
    "1": "Cleanse",
    "3": "Exhaust",
    "4": "Flash",
    "6": "Ghost",
    "7": "Heal",
    "11": "Smite",
    "12": "Teleport",
    "13": "Clarity",
    "14": "Ignite",
    "21": "Barrier",
    "30": "To the King!",
    "32": "Mark",
    "39": "Snowball",
}


def _spell_name(spell_id) -> str | None:
    return _SPELL_NAMES.get(str(spell_id))


# ---------------------------------------------------------------------------
# Datos de prueba (fallback)
# ---------------------------------------------------------------------------

ROLES = [
    {"id": "top", "tier": "S"},
    {"id": "jungle", "tier": "A"},
    {"id": "mid", "tier": "S"},
    {"id": "bot", "tier": "B"},
    {"id": "support", "tier": "A"},
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


def _test_detail(champ: dict) -> dict:
    champ_key = champ["key"]
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

    others = [c for c in _unique_champions() if c["key"] != champ_key]
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
        "test_data": True,
    }


def champion_detail(champ_key: int) -> dict | None:
    champ = next((c for c in _unique_champions() if c["key"] == champ_key), None)
    if champ is None:
        return None
    stats = _aggregates()
    if stats:
        real = _real_detail(champ_key, champ, stats)
        if real:
            return real
    return _test_detail(champ)
