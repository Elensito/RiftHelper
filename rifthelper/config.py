import os
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()

# --- Secretos ---
DISCORD_TOKEN = os.getenv("DISCORD_TOKEN", "")
RIOT_API_KEY = os.getenv("RIOT_API_KEY", "")

# --- Región fija: solo se verifica en EUW ---
RIOT_REGION = os.getenv("RIOT_REGION", "euw1").strip().lower()
REGION_LABEL = "EUW · Europa Oeste"

# --- Rutas del proyecto ---
BASE_DIR = Path(__file__).resolve().parent.parent
DATA_FILE = BASE_DIR / "data.json"
ASSETS_DIR = BASE_DIR / "assets"

# --- Marca visual ---
BRAND = {
    "name": "RiftHelper",
    "accent": 0xC89B3C,
    "blue": 0x0A1428,
    "green": 0x2ECC71,
    "red": 0xE74C3C,
    "gold": 0xF0C868,
}

# --- DataDragon ---
DDG_VERSION = "16.15.1"
ICON_URL = f"https://ddragon.leagueoflegends.com/cdn/{DDG_VERSION}/img/profileicon/{{icon_id}}.png"
CHAMPIONS_URL = f"https://ddragon.leagueoflegends.com/cdn/{DDG_VERSION}/data/en_US/champion.json"
CHAMPION_ICON_URL = f"https://ddragon.leagueoflegends.com/cdn/{DDG_VERSION}/img/champion/{{image}}"
CHAMPIONS_CACHE = BASE_DIR / "champions_cache.json"
CHAMPIONS_DIR = ASSETS_DIR / "champions"

ITEMS_URL = f"https://ddragon.leagueoflegends.com/cdn/{DDG_VERSION}/data/en_US/item.json"
ITEM_ICON_URL = f"https://ddragon.leagueoflegends.com/cdn/{DDG_VERSION}/img/item/{{image}}"
ITEMS_CACHE = BASE_DIR / "items_cache.json"
ITEMS_DIR = ASSETS_DIR / "items"

RUNES_URL = f"https://ddragon.leagueoflegends.com/cdn/{DDG_VERSION}/data/en_US/runesReforged.json"
RUNE_ICON_URL = "https://ddragon.leagueoflegends.com/cdn/img/{icon}"
RUNES_CACHE = BASE_DIR / "runes_cache.json"
RUNES_DIR = ASSETS_DIR / "runes"

# --- Caché de partidas (match-v5) ---
CACHE_DIR = BASE_DIR / "cache"
MATCH_CACHE_DIR = CACHE_DIR / "matches"
TIMELINE_CACHE_DIR = CACHE_DIR / "timelines"

# Iconos que TODA cuenta desbloquea al crearla (desde 2009, siempre disponibles).
# Referencia: LoL Wiki / LoLMath - "Unlocked by creating an account".
VERIFICATION_ICONS = {
    0: {"name": "Default", "file": ASSETS_DIR / "icon_0.png"},
    2: {"name": "Default II", "file": ASSETS_DIR / "icon_2.png"},
    28: {"name": "Tibbers", "file": ASSETS_DIR / "icon_28.png"},
}

# Iconos individuales de cada rango (fuente: LoL Wiki - Season 2023 crests).
RANKS_DIR = ASSETS_DIR / "ranks"
RANK_ICONS = {
    "UNRANKED": RANKS_DIR / "unranked.png",
    "IRON": RANKS_DIR / "iron.png",
    "BRONZE": RANKS_DIR / "bronze.png",
    "SILVER": RANKS_DIR / "silver.png",
    "GOLD": RANKS_DIR / "gold.png",
    "PLATINUM": RANKS_DIR / "platinum.png",
    "EMERALD": RANKS_DIR / "emerald.png",
    "DIAMOND": RANKS_DIR / "diamond.png",
    "MASTER": RANKS_DIR / "master.png",
    "GRANDMASTER": RANKS_DIR / "grandmaster.png",
    "CHALLENGER": RANKS_DIR / "challenger.png",
}

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
