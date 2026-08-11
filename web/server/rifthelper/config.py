import os
from pathlib import Path

from dotenv import load_dotenv

ROOT_DIR = Path(__file__).resolve().parents[3]
load_dotenv(ROOT_DIR / ".env")

# --- Secretos ---
RIOT_API_KEY = os.getenv("RIOT_API_KEY", "")

# --- Región fija: solo se buscan partidas en EUW ---
RIOT_REGION = os.getenv("RIOT_REGION", "euw1").strip().lower()

# --- Rutas del proyecto ---
BASE_DIR = Path(__file__).resolve().parent.parent
ASSETS_DIR = ROOT_DIR / "assets"
WEB_DIST = ROOT_DIR / "web" / "dist"

# --- DataDragon ---
DDG_VERSION = "16.15.1"
ICON_URL = f"https://ddragon.leagueoflegends.com/cdn/{DDG_VERSION}/img/profileicon/{{icon_id}}.png"
CHAMPIONS_URL = f"https://ddragon.leagueoflegends.com/cdn/{DDG_VERSION}/data/en_US/champion.json"
CHAMPION_ICON_URL = f"https://ddragon.leagueoflegends.com/cdn/{DDG_VERSION}/img/champion/{{image}}"
CHAMPIONS_CACHE = BASE_DIR / "champions_cache.json"
CHAMPIONS_DIR = ASSETS_DIR / "champions"

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

# --- Caché de partidas (match-v5) ---
CACHE_DIR = BASE_DIR / "cache"
MATCH_CACHE_DIR = CACHE_DIR / "matches"
TIMELINE_CACHE_DIR = CACHE_DIR / "timelines"

# Cluster regional de cada servidor (para account-v1 y match-v5).
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
