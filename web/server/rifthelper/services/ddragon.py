import json
import time

from rifthelper import config

VERSIONS_URL = "https://ddragon.leagueoflegends.com/api/versions.json"
VERSION_TTL = 12 * 3600


def _read_cache() -> dict:
    path = config.DDG_VERSION_CACHE
    if not path.is_file():
        return {}
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


def _write_cache(version: str) -> None:
    try:
        config.DDG_VERSION_CACHE.parent.mkdir(parents=True, exist_ok=True)
        config.DDG_VERSION_CACHE.write_text(
            json.dumps({"version": version, "fetched_at": time.time()}), encoding="utf-8"
        )
    except OSError:
        pass


def latest_version() -> str:
    cached = _read_cache()
    if cached and time.time() - cached.get("fetched_at", 0) < VERSION_TTL:
        version = cached.get("version") or config.DDG_VERSION
    else:
        version = config.DDG_VERSION
        try:
            import urllib.request

            with urllib.request.urlopen(VERSIONS_URL, timeout=15) as resp:
                versions = json.load(resp)
            if versions:
                version = versions[0]
            _write_cache(version)
        except Exception:
            if cached:
                version = cached.get("version") or config.DDG_VERSION
    if config.DDG_VERSION != version:
        config.set_dd_version(version)
    return config.DDG_VERSION
