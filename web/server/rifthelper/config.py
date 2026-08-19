import os
from pathlib import Path

from dotenv import load_dotenv

ROOT_DIR = Path(__file__).resolve().parents[3]
load_dotenv(ROOT_DIR / ".env")


RIOT_API_KEY = os.getenv("RIOT_API_KEY", "")
MISTRAL_API_KEY = os.getenv("MISTRAL_API_KEY", "")


RIOT_REGION = os.getenv("RIOT_REGION", "euw1").strip().lower()

SITE_URL = os.getenv("SITE_URL", "https://rift-helper.com").strip().rstrip("/")


PATCH = os.getenv("PATCH", "16.16").strip()
PATCH_START = int(os.getenv("PATCH_START", "1785888000"))
CRAWL_RATE_PER_SEC = float(os.getenv("CRAWL_RATE_PER_SEC", "40"))
CRAWL_TIMELINE_BUDGET = int(os.getenv("CRAWL_TIMELINE_BUDGET", "150000"))


BASE_DIR = Path(__file__).resolve().parent.parent
ASSETS_DIR = ROOT_DIR / "assets"
WEB_DIST = ROOT_DIR / "web" / "dist"


DDG_VERSION = "16.16.1"
DDG_VERSION_CACHE = BASE_DIR / "ddragon_version.json"


def _build_urls() -> None:
    global ICON_URL, CHAMPIONS_URL, CHAMPION_ICON_URL, CHAMPION_SPELLS_URL, CHAMPION_URL
    global SPELL_ICON_URL, ITEMS_URL, ITEM_ICON_URL, RUNES_URL, RUNE_ICON_URL, SUMMONER_SPELLS_URL
    v = DDG_VERSION
    ICON_URL = f"https://ddragon.leagueoflegends.com/cdn/{v}/img/profileicon/{{icon_id}}.png"
    CHAMPIONS_URL = f"https://ddragon.leagueoflegends.com/cdn/{v}/data/en_US/champion.json"
    CHAMPION_ICON_URL = f"https://ddragon.leagueoflegends.com/cdn/{v}/img/champion/{{image}}"
    CHAMPION_SPELLS_URL = f"https://ddragon.leagueoflegends.com/cdn/{v}/data/en_US/champion/{{id}}.json"
    CHAMPION_URL = f"https://ddragon.leagueoflegends.com/cdn/{v}/data/{{locale}}/champion/{{key}}.json"
    SPELL_ICON_URL = f"https://ddragon.leagueoflegends.com/cdn/{v}/img/spell/{{image}}"
    ITEMS_URL = f"https://ddragon.leagueoflegends.com/cdn/{v}/data/{{locale}}/item.json"
    ITEM_ICON_URL = f"https://ddragon.leagueoflegends.com/cdn/{v}/img/item/{{image}}"
    RUNES_URL = f"https://ddragon.leagueoflegends.com/cdn/{v}/data/{{locale}}/runesReforged.json"
    RUNE_ICON_URL = "https://ddragon.leagueoflegends.com/cdn/img/{icon}"
    SUMMONER_SPELLS_URL = f"https://ddragon.leagueoflegends.com/cdn/{v}/data/{{locale}}/summoner.json"


_build_urls()


def set_dd_version(version: str) -> None:
    global DDG_VERSION
    DDG_VERSION = version
    _build_urls()


CHAMPIONS_CACHE = BASE_DIR / "champions_cache.json"
CHAMPIONS_DIR = ASSETS_DIR / "champions"

CHAMPION_SPELLS_CACHE = BASE_DIR / "champions_spells_cache.json"
SPELLS_DIR = ASSETS_DIR / "spells"

ITEMS_CACHE = BASE_DIR / "items_cache.json"
ITEMS_CACHE_ES = BASE_DIR / "items_cache_es.json"
ITEMS_DIR = ASSETS_DIR / "items"

RUNES_CACHE = BASE_DIR / "runes_cache.json"
RUNES_CACHE_ES = BASE_DIR / "runes_cache_es.json"
RUNES_DIR = ASSETS_DIR / "runes"
RUNES_TREES_CACHE = BASE_DIR / "runes_trees_cache.json"
RUNES_TREES_CACHE_ES = BASE_DIR / "runes_trees_cache_es.json"
RUNE_TREES_DIR = ASSETS_DIR / "runetrees"


CACHE_DIR = BASE_DIR / "cache"
MATCH_CACHE_DIR = CACHE_DIR / "matches"
TIMELINE_CACHE_DIR = CACHE_DIR / "timelines"
PROFILE_CACHE_DIR = CACHE_DIR / "profiles"
PROFILE_CACHE_TTL = int(os.getenv("PROFILE_CACHE_TTL", "300"))

PATCH_DIR = CACHE_DIR / f"patch_{PATCH}"
PATCH_MATCHES_DIR = PATCH_DIR / "matches"
PATCH_ROWS_DIR = PATCH_DIR / "rows"
PATCH_TIMELINES_DIR = PATCH_DIR / "timelines"
PATCH_RAW_TIMELINES_DIR = PATCH_TIMELINES_DIR / "raw"
PATCH_EXTRACTED_DIR = PATCH_TIMELINES_DIR / "extracted"
PATCH_STATS_DIR = PATCH_DIR / "stats"
CRAWL_DB = PATCH_DIR / "crawl.db"


REGIONAL_ROUTING = {
    "euw1": "europe",
    "eun1": "europe",
    "tr1": "europe",
    "ru": "europe",
    "na1": "americas",
    "br1": "americas",
    "la1": "americas",
    "la2": "americas",
    "oc1": "americas",
    "kr": "asia",
    "jp1": "asia",
    "sea": "sea",
}
