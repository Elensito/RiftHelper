import asyncio
import contextlib
import gzip
import json
import sqlite3
import time
from pathlib import Path

import aiohttp

from rifthelper import config
from rifthelper.services.riot import RiotAPIError, RiotClient

POLL_INTERVAL = 6 * 3600
LEAGUES = ["CHALLENGER", "GRANDMASTER", "MASTER"]
TRINKETS = {3340, 3363, 3364, 3513}
STARTERS = {1001, 1004, 1011, 1018, 1026, 1027, 1028, 1029, 1031, 1033, 1036, 1037,
            1038, 1039, 1042, 1043, 1051, 1052, 1053, 1054, 1055, 1056, 1057, 1058,
            2003, 2009, 2010, 2031, 2033, 2039, 2043, 2044, 2050, 2051, 2052, 2138,
            2139, 2137, 3006, 3047, 3101, 3154, 3200, 3222, 3508, 3360}


def _role_from_participant(p: dict) -> str:
    r = (p.get("individualPosition") or p.get("teamPosition") or "").upper()
    return {
        "TOP": "top",
        "JUNGLE": "jungle",
        "MIDDLE": "mid",
        "BOTTOM": "bot",
        "UTILITY": "support",
    }.get(r, "other")


def _skill_slot(ch: str) -> int:
    return {"Q": 1, "W": 2, "E": 3, "R": 4}.get(ch, 0)


class Crawler:
    def __init__(self, patch: str | None = None, rate: float | None = None):
        self.client = RiotClient()
        self.region = config.RIOT_REGION
        self.patch = patch or config.PATCH
        self.rate = rate or config.CRAWL_RATE_PER_SEC
        self.patch_start = config.PATCH_START
        self.matches_dir = config.PATCH_MATCHES_DIR
        self.rows_dir = config.PATCH_ROWS_DIR
        self.raw_tl_dir = config.PATCH_RAW_TIMELINES_DIR
        self.extract_dir = config.PATCH_EXTRACTED_DIR
        self.db_path = config.CRAWL_DB
        self._session: aiohttp.ClientSession | None = None
        self._next_slot = 0.0
        self.timeline_budget = config.CRAWL_TIMELINE_BUDGET

    def _ensure_dirs(self):
        for d in (self.matches_dir, self.rows_dir, self.raw_tl_dir, self.extract_dir, self.db_path.parent):
            d.mkdir(parents=True, exist_ok=True)

    @contextlib.contextmanager
    def _db(self):
        con = sqlite3.connect(self.db_path)
        try:
            con.execute(
                "CREATE TABLE IF NOT EXISTS matches"
                "(match_id TEXT PRIMARY KEY, version TEXT, fetched_at INTEGER)"
            )
            con.execute(
                "CREATE TABLE IF NOT EXISTS puuids(puuid TEXT PRIMARY KEY, last_poll INTEGER)"
            )
            con.execute(
                "CREATE TABLE IF NOT EXISTS timelines(match_id TEXT PRIMARY KEY)"
            )
            con.execute("CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY, value TEXT)")
            con.commit()
            yield con
            con.commit()
        finally:
            con.close()

    def _seen_match(self, match_id: str) -> bool:
        with self._db() as con:
            return con.execute("SELECT 1 FROM matches WHERE match_id=?", (match_id,)).fetchone() is not None

    def _add_match(self, match_id: str, version: str = ""):
        with self._db() as con:
            con.execute(
                "INSERT OR IGNORE INTO matches(match_id, version, fetched_at) VALUES (?,?,?)",
                (match_id, version, int(time.time())),
            )

    def _add_puuid(self, puuid: str):
        if not puuid:
            return
        with self._db() as con:
            con.execute("INSERT OR IGNORE INTO puuids(puuid, last_poll) VALUES (?,0)", (puuid,))

    def _poll_due(self, limit: int) -> list[str]:
        with self._db() as con:
            rows = con.execute(
                "SELECT puuid FROM puuids WHERE last_poll < ? ORDER BY last_poll LIMIT ?",
                (int(time.time()) - POLL_INTERVAL, limit),
            ).fetchall()
        return [r[0] for r in rows]

    def _set_polled(self, puuid: str):
        with self._db() as con:
            con.execute("UPDATE puuids SET last_poll=? WHERE puuid=?", (int(time.time()), puuid))

    def _count(self, table: str) -> int:
        with self._db() as con:
            return con.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]

    def _timeline_done(self) -> int:
        return self._count("timelines") if self._table_exists("timelines") else 0

    def _table_exists(self, table: str) -> bool:
        with self._db() as con:
            return con.execute(
                "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (table,)
            ).fetchone() is not None

    async def _throttle(self):
        now = time.monotonic()
        wait = self._next_slot - now
        if wait > 0:
            await asyncio.sleep(wait)
        self._next_slot = time.monotonic() + 1.0 / self.rate

    async def _fetch(self, url: str) -> dict:
        await self._throttle()
        if self._session is None:
            self._session = aiohttp.ClientSession()
        headers = {"X-Riot-Token": self.client.api_key}
        backoff = 5
        while True:
            try:
                async with self._session.get(url, headers=headers) as resp:
                    if resp.status == 200:
                        return await resp.json()
                    if resp.status == 429:
                        retry = resp.headers.get("Retry-After")
                        wait = float(retry) if retry else backoff
                        print(f"  429: durmiendo {wait:.0f}s...")
                        await asyncio.sleep(wait)
                        self.rate = max(self.rate * 0.7, 0.5)
                        backoff = min(backoff * 2, 120)
                        continue
                    if resp.status in (401, 403):
                        raise RiotAPIError(f"API denegada ({resp.status}).", resp.status)
                    if resp.status == 404:
                        raise RiotAPIError("No encontrado (404).", 404)
                    raise RiotAPIError(f"Error API ({resp.status}).", resp.status)
            except aiohttp.ClientError as e:
                print(f"  error de red, reintento en {backoff}s: {e}")
                await asyncio.sleep(backoff)

    def _save_json(self, path: Path, data):
        path.parent.mkdir(parents=True, exist_ok=True)
        with gzip.open(path, "wt", encoding="utf-8") as f:
            json.dump(data, f)

    def _load_json(self, path: Path):
        with gzip.open(path, "rt", encoding="utf-8") as f:
            return json.load(f)

    async def _seed_league(self, league: str):
        url = (f"https://{self.region}.api.riotgames.com/lol/league/v4/{league}"
               f"/by-queue/RANKED_SOLO_5x5")
        try:
            data = await self._fetch(url)
        except RiotAPIError:
            return
        for entry in data or []:
            sid = entry.get("summonerId")
            if not sid:
                continue
            try:
                s = await self._fetch(
                    f"https://{self.region}.api.riotgames.com/lol/summoner/v4/summoners/{sid}"
                )
            except RiotAPIError:
                continue
            self._add_puuid(s.get("puuid"))

    async def _seed_featured(self):
        try:
            data = await self._fetch(
                f"https://{self.region}.api.riotgames.com/lol/spectator/v5/featured-games"
            )
        except RiotAPIError:
            return
        for game in data.get("gameList", []) or []:
            for p in game.get("participants", []) or []:
                self._add_puuid(p.get("puuid"))

    async def seed(self):
        for league in LEAGUES:
            print(f"Sembrando {league}...")
            await self._seed_league(league)
        print("Sembrando partidas en vivo...")
        await self._seed_featured()

    async def discover_puuid(self, puuid: str) -> int:
        cluster = self.client._cluster_for(self.region)
        base = (f"https://{cluster}.api.riotgames.com/lol/match/v5/matches/by-puuid/{puuid}/ids"
                f"?startTime={self.patch_start}")
        new_matches = 0
        start = 0
        while True:
            data = await self._fetch(f"{base}&start={start}&count=100")
            ids = [m for m in data] if isinstance(data, list) else []
            if not ids:
                break
            for mid in ids:
                if not self._seen_match(mid):
                    self._add_match(mid)
                    new_matches += 1
            if len(ids) < 100:
                break
            start += 100
        return new_matches

    async def crawl_puuids(self, puuids: list[str]):
        for puuid in puuids:
            new = await self.discover_puuid(puuid)
            self._set_polled(puuid)
            if new:
                print(f"  puuid ...{puuid[-6:]}: +{new} nuevas")
        await self.fetch_pending()

    async def fetch_pending(self, limit: int = 500):
        for mid in [m[0] for m in self._pending_matches()][:limit]:
            await self._fetch_match(mid, {})

    def _pending_matches(self) -> list[tuple[str, str]]:
        with self._db() as con:
            return con.execute(
                "SELECT match_id, version FROM matches WHERE version='' LIMIT 500"
            ).fetchall()

    def _row_for_match(self, data: dict) -> dict:
        info = data.get("info", {}) or {}
        ps = []
        for p in info.get("participants", []) or []:
            perks = p.get("perks", {}) or {}
            styles = perks.get("styles", []) or []
            primary = styles[0] if styles else {}
            secondary = styles[1] if len(styles) > 1 else {}
            ps.append(
                {
                    "p": p.get("participantId"),
                    "t": p.get("teamId"),
                    "c": p.get("championId"),
                    "w": bool(p.get("win")),
                    "r": _role_from_participant(p),
                    "s": [p.get("summoner1Id"), p.get("summoner2Id")],
                    "rk": [x.get("perk") for x in (primary.get("selections", []) or [])],
                    "rt": primary.get("style"),
                    "sk": [x.get("perk") for x in (secondary.get("selections", []) or [])],
                    "st": secondary.get("style"),
                    "sh": [
                        (perks.get("statPerks", {}) or {}).get("defense"),
                        (perks.get("statPerks", {}) or {}).get("flex"),
                        (perks.get("statPerks", {}) or {}).get("offense"),
                    ],
                    "it": [p.get(f"item{i}") for i in range(7)],
                }
            )
        bans = []
        for t in info.get("teams", []) or []:
            for b in t.get("bans", []) or []:
                cid = b.get("championId")
                if cid not in (0, -1, None):
                    bans.append(cid)
        return {
            "m": data.get("metadata", {}).get("matchId", ""),
            "q": info.get("queueId"),
            "b": bans,
            "ps": ps,
        }

    async def _fetch_match(self, match_id: str, seen_versions: dict):
        cluster = self.client._cluster_for(self.region)
        url = f"https://{cluster}.api.riotgames.com/lol/match/v5/matches/{match_id}"
        data = await self._fetch(url)
        info = data.get("info", {}) or {}
        version = info.get("gameVersion", "") or ""
        if not version.startswith(self.patch):
            with self._db() as con:
                con.execute("UPDATE matches SET version=? WHERE match_id=?", ("skip", match_id))
            return
        self._save_json(self.matches_dir / f"{match_id}.json.gz", data)
        self._save_json(self.rows_dir / f"{match_id}.json.gz", self._row_for_match(data))
        with self._db() as con:
            con.execute(
                "UPDATE matches SET version=?, fetched_at=? WHERE match_id=?",
                (version, int(time.time()), match_id),
            )
        seen_versions[version] = seen_versions.get(version, 0) + 1
        for p in info.get("participants", []) or []:
            self._add_puuid(p.get("puuid"))

    def _extract_timeline(self, match_id: str, timeline: dict) -> dict:
        frames = (timeline.get("info", {}) or {}).get("frames", []) or []
        skills: dict[int, list[int]] = {}
        purchases: dict[int, list[int]] = {}
        for frame in frames:
            for ev in frame.get("events", []) or []:
                pid = ev.get("participantId")
                etype = ev.get("type")
                if etype == "SKILL_LEVEL_UP":
                    skills.setdefault(pid, []).append(ev.get("skillSlot", 0))
                elif etype == "ITEM_PURCHASED":
                    purchases.setdefault(pid, []).append(ev.get("itemId", 0))
        out = {}
        for pid, slots in skills.items():
            seq = "".join(
                {1: "Q", 2: "W", 3: "E", 4: "R"}.get(s, "") for s in slots
            )
            non_r = seq.replace("R", "")
            max_order = "".join(sorted(set(non_r), key=non_r.index))
            out[pid] = {
                "skills": seq,
                "max": max_order,
                "buy": [i for i in purchases.get(pid, []) if i not in TRINKETS],
            }
        return out

    async def timeline_pass(self, limit: int | None = None):
        budget = limit if limit is not None else self.timeline_budget
        done = self._timeline_done()
        if done >= budget:
            return
        with self._db() as con:
            pending = con.execute(
                "SELECT match_id FROM matches WHERE version != '' AND version != 'skip'"
                " AND match_id NOT IN (SELECT match_id FROM timelines) LIMIT 1000"
            ).fetchall()
        cluster = self.client._cluster_for(self.region)
        for (match_id,) in pending:
            if done >= budget:
                break
            if not (self.matches_dir / f"{match_id}.json.gz").is_file():
                continue
            url = f"https://{cluster}.api.riotgames.com/lol/match/v5/matches/{match_id}/timeline"
            raw = await self._fetch(url)
            ext = self._extract_timeline(match_id, raw)
            self._save_json(self.extract_dir / f"{match_id}.json.gz", ext)
            with self._db() as con:
                con.execute(
                    "INSERT OR IGNORE INTO timelines(match_id) VALUES (?)", (match_id,)
                )
            done += 1
            if done % 1000 == 0:
                print(f"  timelines: {done}/{budget}")
        print(f"Timelines procesadas: {done}")

    def cleanup_raw_timelines(self):
        deleted = 0
        for f in self.raw_tl_dir.glob("*.json.gz"):
            f.unlink()
            deleted += 1
        print(f"Timelines raw borradas: {deleted}")

    async def close(self):
        if self._session:
            await self._session.close()

    async def run_once(self, rounds: int = 200):
        self._ensure_dirs()
        print(f"Parche {self.patch} | region {self.region} | rate {self.rate} req/s")
        print("Sembrando puuids...")
        await self.seed()
        print("Crawl principal...")
        for r in range(rounds):
            due = self._poll_due(3000)
            if not due:
                print("Sin puuids pendientes por pollear.")
                break
            print(f"Ronda {r+1}: polleando {len(due)} puuids")
            await self.crawl_puuids(due)
            matches = self._count("matches")
            print(f"  total partidas registradas: {matches}")
            await self.timeline_pass()
        print("Crawl terminado.")

    async def incremental(self, minutes: int = 10):
        self._ensure_dirs()
        print(f"Modo incremental (cada {minutes} min) del parche {self.patch}")
        if self._count("puuids") == 0:
            await self.seed()
        while True:
            t0 = time.time()
            due = self._poll_due(4000)
            if due:
                print(f"Polling {len(due)} puuids...")
                await self.crawl_puuids(due)
            print(f"Timeline pass...")
            await self.timeline_pass()
            elapsed = time.time() - t0
            print(f"  done in {elapsed:.1f}s | partidas: {self._count('matches')}")
            await asyncio.sleep(max(0, minutes * 60 - elapsed))


async def main_crawl():
    import argparse

    parser = argparse.ArgumentParser(description="Crawl del parche de RiftHelper")
    parser.add_argument("--rate", type=float, default=config.CRAWL_RATE_PER_SEC)
    parser.add_argument("--rounds", type=int, default=200)
    args = parser.parse_args()
    c = Crawler(rate=args.rate)
    try:
        await c.run_once(rounds=args.rounds)
        c.cleanup_raw_timelines()
    finally:
        await c.close()


async def main_incremental():
    import argparse

    parser = argparse.ArgumentParser(description="Crawl incremental del parche")
    parser.add_argument("--rate", type=float, default=config.CRAWL_RATE_PER_SEC)
    parser.add_argument("--minutes", type=int, default=10)
    args = parser.parse_args()
    c = Crawler(rate=args.rate)
    try:
        await c.incremental(minutes=args.minutes)
    finally:
        await c.close()


def main_cli():
    asyncio.run(main_crawl())


def main_incremental_cli():
    asyncio.run(main_incremental())


if __name__ == "__main__":
    import sys

    if len(sys.argv) > 1 and sys.argv[1] == "incremental":
        sys.argv.pop(1)
        asyncio.run(main_incremental())
    else:
        asyncio.run(main_crawl())
