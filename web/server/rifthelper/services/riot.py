import asyncio
import json
from typing import Any
from urllib.parse import quote

import aiohttp

from rifthelper import config

class RiotAPIError(Exception):


    def __init__(self, message: str, status: int = 0):
        super().__init__(message)
        self.status = status


class RiotClient:








    PLATFORM_BASE = "https://{region}.api.riotgames.com"
    REGIONAL_BASE = "https://{cluster}.api.riotgames.com"

    def __init__(self, api_key: str = None):
        self.api_key = api_key or config.RIOT_API_KEY
        self._champions: dict[int, dict] | None = None
        self._champion_spells: dict[int, list[dict]] | None = None
        self._items: dict[str, dict] = {}
        self._runes: dict[str, dict] = {}
        self._summoner_spells: dict[int, dict] | None = None

    def _cluster_for(self, region: str) -> str:
        return config.REGIONAL_ROUTING.get(region, region)

    async def _request(self, url: str) -> Any:
        headers = {"X-Riot-Token": self.api_key}
        for attempt in range(3):
            async with aiohttp.ClientSession() as session:
                async with session.get(url, headers=headers) as resp:
                    if resp.status == 200:
                        return await resp.json()
                    if resp.status == 429:
                        await asyncio.sleep(1.5 + attempt * 2)
                        continue
                    if resp.status == 401:
                        raise RiotAPIError(
                            "Tu API Key de Riot no es válida o ha caducado. Regénerala en developer.riotgames.com.",
                            401,
                        )
                    if resp.status == 403:
                        raise RiotAPIError(
                            "La API de Riot denegó la petición (403). La key puede no estar autorizada "
                            "para ese recurso/región. Regénerala en developer.riotgames.com.",
                            403,
                        )
                    if resp.status == 404:
                        raise RiotAPIError("No se encontró la cuenta en esa región.", 404)
                    raise RiotAPIError(f"Error de la API Riot ({resp.status}).", resp.status)
        raise RiotAPIError(
            "Límite de peticiones de la API Riot alcanzado (429). Inténtalo en unos minutos.", 429
        )

    async def _platform(self, region: str, path: str) -> dict:
        return await self._request(f"{self.PLATFORM_BASE.format(region=region)}{path}")

    async def _regional(self, region: str, path: str) -> dict:
        cluster = self._cluster_for(region)
        return await self._request(f"{self.REGIONAL_BASE.format(cluster=cluster)}{path}")

    async def _cached(self, cache_dir, match_id: str, url: str) -> Any:

        cache_dir.mkdir(parents=True, exist_ok=True)
        path = cache_dir / f"{match_id}.json"
        if path.is_file():
            return json.loads(path.read_text(encoding="utf-8"))
        data = await self._request(url)
        try:
            path.write_text(json.dumps(data), encoding="utf-8")
        except OSError:
            pass
        return data

    async def get_account_by_riot_id(self, region: str, game_name: str, tag: str) -> dict:
        name = quote(game_name.strip(), safe=" ")
        tagline = quote(tag.strip().lstrip("#"), safe=" ")
        return await self._regional(region, f"/riot/account/v1/accounts/by-riot-id/{name}/{tagline}")

    async def get_account_by_puuid(self, region: str, puuid: str) -> dict:
        return await self._regional(region, f"/riot/account/v1/accounts/by-puuid/{puuid}")

    async def get_summoner_by_riot_id(self, region: str, game_name: str, tag: str) -> dict:
        account = await self.get_account_by_riot_id(region, game_name, tag)
        puuid = account.get("puuid", "")
        summoner = await self._platform(region, f"/lol/summoner/v4/summoners/by-puuid/{puuid}")
        summoner["puuid"] = puuid
        summoner.setdefault("gameName", account.get("gameName") or game_name)
        summoner.setdefault("tagLine", account.get("tagLine") or tag)
        return summoner

    async def get_summoner_by_puuid(self, region: str, puuid: str) -> dict:
        summoner = await self._platform(region, f"/lol/summoner/v4/summoners/by-puuid/{puuid}")
        summoner["puuid"] = puuid
        return summoner

    async def get_solo_rank(self, region: str, puuid: str) -> dict | None:
        data = await self._platform(region, f"/lol/league/v4/entries/by-puuid/{puuid}")
        if not isinstance(data, list):
            return None
        for entry in data:
            if entry.get("queueType") == "RANKED_SOLO_5x5":
                return entry
        return None

    async def get_active_game(self, region: str, puuid: str) -> dict | None:
        try:
            return await self._platform(
                region, f"/lol/spectator/v5/active-games/by-summoner/{puuid}"
            )
        except RiotAPIError as e:
            if e.status == 404:
                return None
            raise

    async def get_champion_mastery(self, region: str, puuid: str) -> list[dict]:
        data = await self._platform(
            region, f"/lol/champion-mastery/v4/champion-masteries/by-puuid/{puuid}"
        )
        return data if isinstance(data, list) else []

    async def get_match_ids(
        self,
        region: str,
        puuid: str,
        count: int,
        start_time: int,
        start: int = 0,
        queue: int | None = None,
    ) -> list[str]:




        cluster = self._cluster_for(region)
        url = (
            f"{self.REGIONAL_BASE.format(cluster=cluster)}/lol/match/v5/matches/by-puuid/{puuid}/ids"
            f"?start={start}&count={count}&startTime={start_time}"
        )
        if queue is not None:
            url += f"&queue={queue}"
        data = await self._request(url)
        return [m for m in data] if isinstance(data, list) else []

    async def get_match(self, region: str, match_id: str) -> Any:
        cluster = self._cluster_for(region)
        url = f"{self.REGIONAL_BASE.format(cluster=cluster)}/lol/match/v5/matches/{match_id}"
        return await self._cached(config.MATCH_CACHE_DIR, match_id, url)

    async def get_match_timeline(self, region: str, match_id: str) -> Any:
        cluster = self._cluster_for(region)
        url = (
            f"{self.REGIONAL_BASE.format(cluster=cluster)}/lol/match/v5/matches/{match_id}/timeline"
        )
        return await self._cached(config.TIMELINE_CACHE_DIR, match_id, url)

    async def get_champion_info(self) -> dict[int, dict]:

        if self._champions is not None:
            return self._champions

        path = config.CHAMPIONS_CACHE
        if path.is_file():
            try:
                raw = json.loads(path.read_text(encoding="utf-8"))
                parsed = {int(k): v for k, v in raw.items()}
                if all("id" in v for v in parsed.values()):
                    self._champions = parsed
                    return self._champions
            except (ValueError, OSError):
                pass

        async with aiohttp.ClientSession() as session:
            async with session.get(config.CHAMPIONS_URL) as resp:
                if resp.status != 200:
                    raise RiotAPIError(
                        "No se pudo obtener la lista de campeones desde DataDragon.", resp.status
                    )
                data = await resp.json()

        self._champions = {
            int(c["key"]): {
                "id": c["id"],
                "name": c["name"],
                "image": c["image"]["full"],
            }
            for c in data.get("data", {}).values()
        }
        try:
            path.write_text(json.dumps(self._champions), encoding="utf-8")
        except OSError:
            pass
        return self._champions

    async def get_champion_spells(self, champion_ids: list[int]) -> dict[int, list[dict]]:





        if self._champion_spells is None:
            self._champion_spells = {}
            path = config.CHAMPION_SPELLS_CACHE
            if path.is_file():
                try:
                    raw = json.loads(path.read_text(encoding="utf-8"))
                    self._champion_spells = {int(k): v for k, v in raw.items()}
                except (ValueError, OSError):
                    pass

        missing = [cid for cid in champion_ids if cid not in self._champion_spells]
        if missing:
            champ_info = await self.get_champion_info()
            async with aiohttp.ClientSession() as session:
                for cid in missing:
                    champ_id = champ_info.get(cid, {}).get("id")
                    spells: list[dict] = []
                    if champ_id:
                        async with session.get(
                            config.CHAMPION_SPELLS_URL.format(id=champ_id)
                        ) as resp:
                            if resp.status == 200:
                                payload = await resp.json()
                        spells = [
                            {
                                "name": s.get("name", ""),
                                "image": s.get("image", {}).get("full", ""),
                            }
                            for s in payload.get("data", {}).get(champ_id, {}).get("spells", [])
                        ]
                    self._champion_spells[cid] = spells
            try:
                path.write_text(json.dumps(self._champion_spells), encoding="utf-8")
            except OSError:
                pass
        return self._champion_spells

    async def get_items_info(self, locale: str = "en_US") -> dict[int, dict]:

        if locale in self._items:
            return self._items[locale]

        path = config.ITEMS_CACHE if locale == "en_US" else config.ITEMS_CACHE_ES
        url = config.ITEMS_URL.format(locale=locale)
        raw = None
        if path.is_file():
            try:
                raw = json.loads(path.read_text(encoding="utf-8"))
            except (ValueError, OSError):
                raw = None
        if raw and raw.get("_v") == config.DDG_VERSION:
            self._items[locale] = {int(k): v for k, v in raw.items() if k.isdigit()}
            return self._items[locale]

        async with aiohttp.ClientSession() as session:
            async with session.get(url) as resp:
                if resp.status != 200:
                    raise RiotAPIError(
                        "No se pudo obtener la lista de objetos desde DataDragon.", resp.status
                    )
                data = await resp.json()

        self._items[locale] = {}
        for k, v in data.get("data", {}).items():
            self._items[locale][int(k)] = {
                "name": v.get("name", f"Item {k}"),
                "image": v.get("image", {}).get("full", ""),
                "gold": v.get("gold", {}),
                "stats": v.get("stats", {}),
                "plaintext": v.get("plaintext", ""),
                "description": v.get("description", ""),
                "tags": v.get("tags", []),
            }
        self._items[locale]["_v"] = config.DDG_VERSION
        try:
            path.write_text(json.dumps(self._items[locale]), encoding="utf-8")
        except OSError:
            pass
        return {int(k): v for k, v in self._items[locale].items() if isinstance(k, int)}

    async def get_runes_info(self, locale: str = "en_US") -> dict[int, dict]:

        if locale in self._runes:
            return self._runes[locale]

        path = config.RUNES_CACHE if locale == "en_US" else config.RUNES_CACHE_ES
        url = config.RUNES_URL.format(locale=locale)
        raw = None
        if path.is_file():
            try:
                raw = json.loads(path.read_text(encoding="utf-8"))
            except (ValueError, OSError):
                raw = None
        if raw and raw.get("_v") == config.DDG_VERSION:
            self._runes[locale] = {int(k): v for k, v in raw.items() if k.isdigit()}
            return self._runes[locale]

        async with aiohttp.ClientSession() as session:
            async with session.get(url) as resp:
                if resp.status != 200:
                    raise RiotAPIError(
                        "No se pudo obtener las runas desde DataDragon.", resp.status
                    )
                data = await resp.json()

        self._runes[locale] = {}
        for tree in data:
            for slot in tree.get("slots", []):
                for rune in slot.get("runes", []):
                    self._runes[locale][int(rune["id"])] = {
                        "name": rune.get("name", ""),
                        "icon": rune.get("icon", ""),
                        "longDesc": rune.get("longDesc", ""),
                        "shortDesc": rune.get("shortDesc", ""),
                    }
        self._runes[locale]["_v"] = config.DDG_VERSION
        try:
            path.write_text(json.dumps(self._runes[locale]), encoding="utf-8")
        except OSError:
            pass
        return {int(k): v for k, v in self._runes[locale].items() if isinstance(k, int)}

    async def get_rune_trees(self, locale: str = "en_US") -> dict[int, dict]:
        if not hasattr(self, "_trees"):
            self._trees = {}
        if locale in self._trees:
            return self._trees[locale]

        path = config.RUNES_TREES_CACHE if locale == "en_US" else config.RUNES_TREES_CACHE_ES
        url = config.RUNES_URL.format(locale=locale)
        raw = None
        if path.is_file():
            try:
                raw = json.loads(path.read_text(encoding="utf-8"))
            except (ValueError, OSError):
                raw = None
        if raw and raw.get("_v") == config.DDG_VERSION:
            self._trees[locale] = {int(k): v for k, v in raw.items() if k.isdigit()}
            return self._trees[locale]

        async with aiohttp.ClientSession() as session:
            async with session.get(url) as resp:
                if resp.status != 200:
                    raise RiotAPIError(
                        "No se pudieron obtener los árboles de runas desde DataDragon.", resp.status
                    )
                data = await resp.json()

        self._trees[locale] = {
            int(tree["id"]): {"name": tree.get("name", ""), "icon": tree.get("icon", "")}
            for tree in data
        }
        payload = dict(self._trees[locale])
        payload["_v"] = config.DDG_VERSION
        try:
            path.write_text(json.dumps(payload), encoding="utf-8")
        except OSError:
            pass
        return self._trees[locale]

    async def get_summoner_spells_info(self) -> dict[int, dict]:

        if self._summoner_spells is not None:
            return self._summoner_spells

        async def fetch(locale: str) -> dict:
            async with aiohttp.ClientSession() as session:
                async with session.get(config.SUMMONER_SPELLS_URL.format(locale=locale)) as resp:
                    if resp.status != 200:
                        raise RiotAPIError(
                            "No se pudieron obtener los hechizos de invocador desde DataDragon.",
                            resp.status,
                        )
                    return await resp.json()

        en = await fetch("en_US")
        es = await fetch("es_ES")

        self._summoner_spells = {
            int(s["key"]): {
                "name": {
                    "en": s.get("name", ""),
                    "es": es.get("data", {}).get(s["id"], {}).get("name", ""),
                },
                "image": s.get("image", {}).get("full", ""),
                "description": {
                    "en": s.get("description", ""),
                    "es": es.get("data", {}).get(s["id"], {}).get("description", ""),
                },
                "cooldown": s.get("cooldownBurn", ""),
                "cost": s.get("costBurn", ""),
            }
            for s in en.get("data", {}).values()
        }
        return self._summoner_spells
