import asyncio
import json
import os

from rifthelper import config


class Storage:


    def __init__(self, path: str = None):
        self.path = path or str(config.DATA_FILE)
        self._lock = asyncio.Lock()
        self._data: dict = {}
        self._load()

    def _load(self):
        if os.path.exists(self.path):
            try:
                with open(self.path, "r", encoding="utf-8") as f:
                    self._data = json.load(f)
            except (json.JSONDecodeError, OSError):
                self._data = {}
        else:
            self._data = {}

    async def save(self):
        async with self._lock:
            tmp = f"{self.path}.tmp"
            with open(tmp, "w", encoding="utf-8") as f:
                json.dump(self._data, f, ensure_ascii=False, indent=2)
            os.replace(tmp, self.path)

    def get_user(self, discord_id: int) -> dict | None:
        return self._data.get(str(discord_id))

    def is_verified(self, discord_id: int) -> bool:
        return str(discord_id) in self._data

    async def set_user(self, discord_id: int, profile: dict):
        async with self._lock:
            self._data[str(discord_id)] = profile
        await self.save()
