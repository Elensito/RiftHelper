import html
import json
import re

import aiohttp

from rifthelper import config

_LRU: dict = {}

_TAG_RE = re.compile(r"<(/?)([a-zA-Z0-9-]+)((?:\s+[^<>]*?)?)(/?)>")
_AT_TAG_RE = re.compile(r"<@[^<>]*>")
_TOKEN_RE = re.compile(r"\{\{[^}]*\}\}")


_PARTYPE = {
    "Mana": {"en": "Mana", "es": "Maná"},
    "Maná": {"en": "Mana", "es": "Maná"},
    "Energy": {"en": "Energy", "es": "Energía"},
    "Energía": {"en": "Energy", "es": "Energía"},
    "Rage": {"en": "Rage", "es": "Furia"},
    "Furia": {"en": "Rage", "es": "Furia"},
    "Health": {"en": "Health", "es": "Vida"},
    "Vida": {"en": "Health", "es": "Vida"},
    "Manaless": {"en": "Manaless", "es": "Sin maná"},
    "Sin maná": {"en": "Manaless", "es": "Sin maná"},
    "Grit": {"en": "Grit", "es": "Determinación"},
    "Determinación": {"en": "Determination", "es": "Determinación"},
    "Shield": {"en": "Shield", "es": "Escudo"},
    "Escudo": {"en": "Shield", "es": "Escudo"},
    "Courage": {"en": "Courage", "es": "Coraje"},
    "Coraje": {"en": "Courage", "es": "Coraje"},
    "Ferocity": {"en": "Ferocity", "es": "Ferocidad"},
    "Ferocidad": {"en": "Ferocity", "es": "Ferocidad"},
    "Explosion": {"en": "Explosion", "es": "Explosión"},
    "Explosión": {"en": "Explosion", "es": "Explosión"},
}


def _resource_label(partype: str, lang: str) -> str:
    partype = (partype or "").strip()
    if not partype:
        return ""
    mapped = _PARTYPE.get(partype)
    if mapped:
        return mapped.get(lang) or partype
    return partype


def _read_json(path):
    if path.is_file():
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except (ValueError, OSError):
            return {}
    return {}


def _cache_path(kind: str, lang: str):
    if kind == "item":
        return config.ITEMS_CACHE if lang == "en" else config.ITEMS_CACHE_ES
    return config.RUNES_CACHE if lang == "en" else config.RUNES_CACHE_ES


def _data(kind: str, lang: str) -> dict:
    key = (kind, lang, config.DDG_VERSION)
    if key not in _LRU:
        _LRU[key] = _read_json(_cache_path(kind, lang))
    return _LRU[key]


_TAG_HTML = {
    "stats": ('<span class="tt-stats">', "</span>"),
    "attention": ('<span class="tt-attn">', "</span>"),
    "passive": ('<span class="tt-passive">', "</span>"),
    "rules": ('<span class="tt-rules">', "</span>"),
    "active": ('<span class="tt-active">', "</span>"),
    "effect": ('<span class="tt-effect">', "</span>"),
    "keyword": ('<span class="tt-keyword">', "</span>"),
    "keywords": ('<span class="tt-keyword">', "</span>"),
    "magicdamage": ('<span class="tt-magic">', "</span>"),
    "physicaldamage": ('<span class="tt-physical">', "</span>"),
    "truedamage": ('<span class="tt-true">', "</span>"),
    "shield": ('<span class="tt-shield">', "</span>"),
    "attackspeed": ('<span class="tt-as">', "</span>"),
    "onhit": ('<span class="tt-keyword">', "</span>"),
    "slow": ('<span class="tt-keyword">', "</span>"),
    "status": ('<span class="tt-keyword">', "</span>"),
    "b": ("<b>", "</b>"),
    "i": ("<i>", "</i>"),
}

_STATS_RE = re.compile(r"<stats>(.*?)</stats>", re.DOTALL)
_ATTN_RE = re.compile(r"<attention>(.*?)</attention>(.*)", re.DOTALL)
_BR_RE = re.compile(r"<br\s*/?>", re.IGNORECASE)


def _strip_tags(text: str) -> str:
    return _TAG_RE.sub("", text)


def _stat_rows(description: str) -> list[dict]:
    m = _STATS_RE.search(description)
    if not m:
        return []
    rows = []
    for line in _BR_RE.split(m.group(1)):
        line = line.strip()
        if not line:
            continue
        am = _ATTN_RE.search(line)
        if am:
            value = html.unescape(am.group(1)).strip()
            label = html.unescape(_strip_tags(am.group(2))).strip()
            if label:
                rows.append({"value": value, "label": label})
    return rows


def _to_html(text: str) -> str:
    text = html.unescape(text)
    if text is None:
        return ""
    out = []
    last = 0
    for m in _TAG_RE.finditer(text):
        out.append(text[last : m.start()])
        last = m.end()
        close, tag, _attrs, selfclose = m.group(1), m.group(2).lower(), m.group(3), m.group(4)
        if tag == "br":
            out.append("<br>")
            continue
        if selfclose:
            continue
        if tag in _TAG_HTML:
            out.append(_TAG_HTML[tag][1] if close else _TAG_HTML[tag][0])
    out.append(text[last:])
    result = "".join(out)
    result = re.sub(r"(<br>\s*){3,}", "<br><br>", result)
    return result.strip()


def _body_html(description: str) -> str:
    body = _STATS_RE.sub("", description)
    html_body = _to_html(body)
    html_body = re.sub(r"^(?:<br>\s*)+", "", html_body)
    html_body = re.sub(r"(?:\s*<br>)+$", "", html_body)
    return html_body


def item_tooltip(item_id, lang: str) -> dict | None:
    lang_code = "es" if lang == "es" else "en"
    item = _data("item", lang_code).get(str(item_id))
    if not item:
        return None
    description = item.get("description", "")
    gold = item.get("gold") or {}
    return {
        "kind": "item",
        "id": item_id,
        "name": item.get("name", ""),
        "image": f"/assets/items/{item_id}.png",
        "gold": gold.get("total"),
        "sell": gold.get("sell"),
        "stats": _stat_rows(description),
        "plaintext": item.get("plaintext", ""),
        "description": _body_html(description),
        "version": config.DDG_VERSION,
    }


def rune_tooltip(rune_id, lang: str) -> dict | None:
    lang_code = "es" if lang == "es" else "en"
    rune = _data("rune", lang_code).get(str(rune_id))
    if not rune:
        return None
    desc = rune.get("longDesc") or rune.get("shortDesc") or ""
    return {
        "kind": "rune",
        "id": rune_id,
        "name": rune.get("name", ""),
        "image": f"/assets/runes/{rune_id}.png",
        "description": _to_html(desc),
        "version": config.DDG_VERSION,
    }


def spell_tooltip(spell_key, lang: str, spells: dict) -> dict | None:
    sp = spells.get(int(spell_key))
    if not sp:
        return None
    lang_code = "es" if lang == "es" else "en"
    name = sp.get("name") or {}
    desc = sp.get("description") or {}
    lore = _to_html(desc.get(lang_code) or desc.get("en", ""))
    return {
        "kind": "spell",
        "id": spell_key,
        "name": name.get(lang_code) or name.get("en", ""),
        "image": f"/assets/spells/{sp.get('image', '')}" if sp.get("image") else None,
        "description": lore,
        "lore": lore,
        "cooldown": sp.get("cooldown", ""),
        "cost": sp.get("cost", ""),
        "version": config.DDG_VERSION,
    }


async def _champion_data(champ_key: str, lang: str) -> dict:
    key = ("champ", champ_key, lang, config.DDG_VERSION)
    if key not in _LRU:
        locale = "es_ES" if lang == "es" else "en_US"
        url = config.CHAMPION_URL.format(locale=locale, key=champ_key)
        data = {}
        try:
            async with aiohttp.ClientSession() as session:
                async with session.get(url) as resp:
                    if resp.status == 200:
                        payload = await resp.json()
                        data = (payload.get("data") or {}).get(champ_key, {}) or {}
        except Exception:
            data = {}
        _LRU[key] = data
    return _LRU[key]


async def ability_tooltip(champ_key: str, slot: int, lang: str) -> dict | None:
    champ = await _champion_data(champ_key, lang)
    spells = champ.get("spells") or []
    if not champ or not 0 <= slot < len(spells):
        return None
    sp = spells[slot]
    partype = champ.get("partype", "")
    cost_label = _resource_label(partype, lang) if partype else ""
    desc = sp.get("description", "") or ""
    desc = _AT_TAG_RE.sub("", desc)
    desc = _TOKEN_RE.sub("", desc)
    range_burn = sp.get("rangeBurn", "")
    if range_burn in ("self", "0", "N/A", ""):
        range_burn = ""
    image = (sp.get("image") or {}).get("full", "")
    description = _to_html(desc)
    return {
        "kind": "ability",
        "id": slot,
        "champ": champ_key,
        "name": sp.get("name", ""),
        "image": f"/assets/spells/{image}" if image else None,
        "description": description,
        "cooldown": sp.get("cooldownBurn", ""),
        "cost": sp.get("costBurn", ""),
        "cost_label": cost_label,
        "range": range_burn,
        "maxrank": sp.get("maxrank"),
        "version": config.DDG_VERSION,
    }
