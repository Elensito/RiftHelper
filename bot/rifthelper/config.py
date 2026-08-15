import os
from pathlib import Path

from dotenv import load_dotenv

ROOT_DIR = Path(__file__).resolve().parents[2]
load_dotenv(ROOT_DIR / ".env")


DISCORD_TOKEN = os.getenv("DISCORD_TOKEN", "")
RIOT_API_KEY = os.getenv("RIOT_API_KEY", "")


RIOT_REGION = os.getenv("RIOT_REGION", "euw1").strip().lower()
REGION_LABEL = "EUW · Europa Oeste"
SITE_URL = os.getenv("SITE_URL", "https://rift-helper.com")


BASE_DIR = Path(__file__).resolve().parent.parent
DATA_FILE = BASE_DIR / "data.json"
ASSETS_DIR = ROOT_DIR / "assets"


BRAND = {
    "name": "RiftHelper",
    "accent": 0xC89B3C,
    "blue": 0x0A1428,
    "green": 0x2ECC71,
    "red": 0xE74C3C,
    "gold": 0xF0C868,
}


DDG_VERSION = "16.15.1"
ICON_URL = f"https://ddragon.leagueoflegends.com/cdn/{DDG_VERSION}/img/profileicon/{{icon_id}}.png"
CHAMPIONS_URL = f"https://ddragon.leagueoflegends.com/cdn/{DDG_VERSION}/data/en_US/champion.json"
CHAMPION_ICON_URL = f"https://ddragon.leagueoflegends.com/cdn/{DDG_VERSION}/img/champion/{{image}}"
CHAMPIONS_CACHE = BASE_DIR / "champions_cache.json"
CHAMPIONS_DIR = ASSETS_DIR / "champions"



VERIFICATION_ICONS = {
    0: {"name": "Default", "file": ASSETS_DIR / "icon_0.png"},
    2: {"name": "Default II", "file": ASSETS_DIR / "icon_2.png"},
    28: {"name": "Tibbers", "file": ASSETS_DIR / "icon_28.png"},
}


RANK_ROLES = {
    "UNRANKED": os.getenv("RANK_ROLE_UNRANKED", ""),
    "IRON": os.getenv("RANK_ROLE_IRON", ""),
    "BRONZE": os.getenv("RANK_ROLE_BRONZE", ""),
    "SILVER": os.getenv("RANK_ROLE_SILVER", ""),
    "GOLD": os.getenv("RANK_ROLE_GOLD", ""),
    "PLATINUM": os.getenv("RANK_ROLE_PLATINUM", ""),
    "EMERALD": os.getenv("RANK_ROLE_EMERALD", ""),
    "DIAMOND": os.getenv("RANK_ROLE_DIAMOND", ""),
    "MASTER": os.getenv("RANK_ROLE_MASTER", ""),
    "GRANDMASTER": os.getenv("RANK_ROLE_GRANDMASTER", ""),
    "CHALLENGER": os.getenv("RANK_ROLE_CHALLENGER", ""),
}
RANK_ROLE_IDS = {int(v) for v in RANK_ROLES.values() if v}


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
