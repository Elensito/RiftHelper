import asyncio
import json
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

    def _cluster_for(self, region: str) -> str:
        return config.REGIONAL_ROUTING.get(region, region)

    async def _request(self, url: str):
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

    async def get_account_by_riot_id(self, region: str, game_name: str, tag: str) -> dict:
        name = quote(game_name.strip(), safe=" ")
        tagline = quote(tag.strip().lstrip("#"), safe=" ")
        return await self._regional(region, f"/riot/account/v1/accounts/by-riot-id/{name}/{tagline}")

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

    async def get_champion_mastery(self, region: str, puuid: str) -> list[dict]:
        data = await self._platform(
            region, f"/lol/champion-mastery/v4/champion-masteries/by-puuid/{puuid}"
        )
        return data if isinstance(data, list) else []

    async def get_champion_info(self) -> dict[int, dict]:

        if self._champions is not None:
            return self._champions

        path = config.CHAMPIONS_CACHE
        if path.is_file():
            try:
                raw = json.loads(path.read_text(encoding="utf-8"))
                self._champions = {int(k): v for k, v in raw.items()}
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
            int(c["key"]): {"name": c["name"], "image": c["image"]["full"]}
            for c in data.get("data", {}).values()
        }
        try:
            path.write_text(json.dumps(self._champions), encoding="utf-8")
        except OSError:
            pass
        return self._champions
