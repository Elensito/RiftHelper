import os
from pathlib import Path

from dotenv import load_dotenv

ROOT_DIR = Path(__file__).resolve().parents[3]
load_dotenv(ROOT_DIR / ".env")


RIOT_API_KEY = os.getenv("RIOT_API_KEY", "")


RIOT_REGION = os.getenv("RIOT_REGION", "euw1").strip().lower()


# Prefijo del gameVersion real (p.ej. "16.16" de la temporada 26.16 de 2026).
PATCH = os.getenv("PATCH", "16.16").strip()
# Inicio del parche en segundos (epoch UTC). Ajustable desde .env si hace falta.
PATCH_START = int(os.getenv("PATCH_START", "1785888000"))
CRAWL_RATE_PER_SEC = float(os.getenv("CRAWL_RATE_PER_SEC", "40"))
CRAWL_TIMELINE_BUDGET = int(os.getenv("CRAWL_TIMELINE_BUDGET", "150000"))


BASE_DIR = Path(__file__).resolve().parent.parent
ASSETS_DIR = ROOT_DIR / "assets"
WEB_DIST = ROOT_DIR / "web" / "dist"


DDG_VERSION = "16.15.1"
ICON_URL = f"https://ddragon.leagueoflegends.com/cdn/{DDG_VERSION}/img/profileicon/{{icon_id}}.png"
CHAMPIONS_URL = f"https://ddragon.leagueoflegends.com/cdn/{DDG_VERSION}/data/en_US/champion.json"
CHAMPION_ICON_URL = f"https://ddragon.leagueoflegends.com/cdn/{DDG_VERSION}/img/champion/{{image}}"
CHAMPIONS_CACHE = BASE_DIR / "champions_cache.json"
CHAMPIONS_DIR = ASSETS_DIR / "champions"

CHAMPION_SPELLS_CACHE = BASE_DIR / "champions_spells_cache.json"
CHAMPION_SPELLS_URL = f"https://ddragon.leagueoflegends.com/cdn/{DDG_VERSION}/data/en_US/champion/{{id}}.json"
SPELL_ICON_URL = f"https://ddragon.leagueoflegends.com/cdn/{DDG_VERSION}/img/spell/{{image}}"
SPELLS_DIR = ASSETS_DIR / "spells"

ITEMS_URL = f"https://ddragon.leagueoflegends.com/cdn/{DDG_VERSION}/data/{{locale}}/item.json"
ITEM_ICON_URL = f"https://ddragon.leagueoflegends.com/cdn/{DDG_VERSION}/img/item/{{image}}"
ITEMS_CACHE = BASE_DIR / "items_cache.json"
ITEMS_CACHE_ES = BASE_DIR / "items_cache_es.json"
ITEMS_DIR = ASSETS_DIR / "items"

RUNES_URL = f"https://ddragon.leagueoflegends.com/cdn/{DDG_VERSION}/data/{{locale}}/runesReforged.json"
RUNE_ICON_URL = "https://ddragon.leagueoflegends.com/cdn/img/{icon}"
RUNES_CACHE = BASE_DIR / "runes_cache.json"
RUNES_CACHE_ES = BASE_DIR / "runes_cache_es.json"
RUNES_DIR = ASSETS_DIR / "runes"

SUMMONER_SPELLS_URL = f"https://ddragon.leagueoflegends.com/cdn/{DDG_VERSION}/data/{{locale}}/summoner.json"


CACHE_DIR = BASE_DIR / "cache"
MATCH_CACHE_DIR = CACHE_DIR / "matches"
TIMELINE_CACHE_DIR = CACHE_DIR / "timelines"

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
