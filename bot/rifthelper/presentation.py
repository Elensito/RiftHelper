import discord
from urllib.parse import quote

from rifthelper import config


def base_embed(title: str, description: str = "", color: int = config.BRAND["accent"]) -> discord.Embed:
    embed = discord.Embed(title=title, description=description, color=color)
    embed.set_footer(
        text=config.BRAND["name"],
        icon_url="https://ddragon.leagueoflegends.com/cdn/img/champion/splash/Malphite_0.jpg",
    )
    return embed


def verify_intro_embed() -> discord.Embed:
    embed = base_embed(
        "🔐 Verificación de cuenta",
        "Vincula tu cuenta de **League of Legends** a tu perfil de Discord y obtén el rol de tu rango.",
    )
    embed.add_field(
        name="📋 Pasos a seguir",
        value=(
            "1️⃣ Pulsa el botón **🔐 Empezar verificación**\n"
            "2️⃣ Escribe tu **Riot ID** completo (`Nombre#TAG`)\n"
            "3️⃣ Equipa el icono que te mostrará el bot\n"
            "4️⃣ Confirma la verificación y recibirás el rol de tu rango"
        ),
        inline=False,
    )
    return embed


def verify_prompt_embed(summoner: dict, icon_id: int) -> tuple[discord.Embed, discord.File]:
    game_name = summoner.get("gameName") or summoner.get("name") or "Invocador"
    tag = summoner.get("tagLine", "")
    full_name = f"{game_name}#{tag}" if tag else game_name

    embed = base_embed(
        "🔐 Verificación requerida — Icono",
        f"Para confirmar que **{full_name}** es tu cuenta, necesitamos que equipes el icono que te mostramos a continuación.",
    )
    embed.add_field(name="👤 Cuenta detectada", value=f"```{full_name}```", inline=False)
    embed.add_field(
        name="📋 Pasos a seguir",
        value=(
            "1️⃣ Abre el cliente de League of Legends\n"
            "2️⃣ Ve a tu **Perfil** y pulsa sobre tu icono actual\n"
            "3️⃣ Equipa el icono de la imagen que tienes abajo\n"
            "4️⃣ Pulsa el botón **✅ Verificar**"
        ),
        inline=False,
    )
    embed.set_image(url="attachment://verification_icon.png")

    file = discord.File(config.VERIFICATION_ICONS[icon_id]["file"], filename="verification_icon.png")
    return embed, file


def verify_success_embed(summoner: dict, rank: str) -> discord.Embed:
    game_name = summoner.get("gameName") or summoner.get("name") or "Invocador"
    tag = summoner.get("tagLine", "")
    full_name = f"{game_name}#{tag}" if tag else game_name

    embed = base_embed(
        "✅ ¡Cuenta verificada!",
        f"¡Felicidades, **{full_name}**! Tu cuenta de League of Legends ha sido verificada correctamente.",
        color=config.BRAND["green"],
    )
    embed.add_field(name="👤 Cuenta", value=f"```{full_name}```", inline=True)
    embed.add_field(name="🖥️ Servidor", value=config.REGION_LABEL, inline=True)
    embed.add_field(name="📊 Rango", value=rank, inline=True)
    embed.add_field(
        name="🚀 Siguiente paso",
        value="Usa **`/profile`** para ver tu perfil con tu rango y LP.",
        inline=False,
    )
    return embed


def unlink_embed(account: str) -> discord.Embed:
    embed = base_embed(
        "🔓 Cuenta desvinculada",
        f"Se ha desvinculado **{account}** de tu perfil de Discord.",
        color=config.BRAND["green"],
    )
    embed.add_field(
        name="📌 ¿Quieres vincular otra?",
        value="Pulsa el botón **🔐 Empezar verificación** en el canal de verificación del servidor.",
        inline=False,
    )
    return embed


def verify_fail_embed() -> discord.Embed:
    embed = base_embed(
        "❌ Verificación fallida",
        "Aún no tenemos constancia de que tengas el icono requerido equipado.",
        color=config.BRAND["red"],
    )
    embed.add_field(
        name="🔄 ¿Qué hago ahora?",
        value=(
            "• Abre el cliente de LoL → **Perfil** → pulsa tu icono\n"
            "• Equipa el icono de la imagen de arriba\n"
            "• Espera **2-5 minutos** para que la API se actualice\n"
            "• Vuelve a pulsar **✅ Verificar**"
        ),
        inline=False,
    )
    return embed


def profile_url(data: dict) -> str:
    name = data.get("game_name", "")
    tag = data.get("tag", "")
    return f"{config.SITE_URL}/?name={quote(name)}&tag={quote(tag)}"


def profile_view(data: dict) -> discord.ui.View:
    view = discord.ui.View()
    view.add_item(
        discord.ui.Button(
            label="📊 Ver stats en RiftHelper",
            style=discord.ButtonStyle.url,
            url=profile_url(data),
        )
    )
    return view


def profile_embed(data: dict, rank: dict | None, summoner: dict | None) -> tuple[discord.Embed, discord.File | None]:
    game_name = data.get("game_name", "Invocador")
    tag = data.get("tag", "")
    full_name = f"{game_name}#{tag}" if tag else game_name

    icon_id = (summoner or {}).get("profileIconId", 0)
    level = (summoner or {}).get("summonerLevel", 0)
    icon_url = config.ICON_URL.format(icon_id=icon_id)

    rank_file: discord.File | None = None
    if rank:
        tier = rank.get("tier", "UNRANKED")
        division = rank.get("rank", "")
        lp = rank.get("leaguePoints", 0)
        wins = rank.get("wins", 0)
        losses = rank.get("losses", 0)
        winrate = round(wins / (wins + losses) * 100) if (wins + losses) else 0

        embed = base_embed(
            f"🏆 {tier.title()} {division} · {lp} LP · {winrate}% WR",
            color=config.BRAND["gold"],
        )

        icon_path = config.RANK_ICONS.get(tier.upper())
        if icon_path and icon_path.is_file():
            rank_file = discord.File(icon_path, filename="rank_icon.png")
            embed.set_thumbnail(url="attachment://rank_icon.png")
    else:
        embed = base_embed(
            "🎖️ Sin rango",
            color=config.BRAND["blue"],
        )
        icon_path = config.RANK_ICONS["UNRANKED"]
        if icon_path.is_file():
            rank_file = discord.File(icon_path, filename="rank_icon.png")
            embed.set_thumbnail(url="attachment://rank_icon.png")
        embed.add_field(
            name="⚠️ Sin clasificación",
            value="Esta cuenta aún no ha disputado **Cola Clasificatoria Solo/Dúo** esta temporada.",
            inline=False,
        )

    embed.set_author(name=f"{full_name} · Nivel {level}", icon_url=icon_url)
    return embed, rank_file


MEDALS = ["🥇", "🥈", "🥉", "4️⃣", "5️⃣", "6️⃣", "7️⃣", "8️⃣", "9️⃣", "🔟"]


def mastery_embed(summoner: dict, masters: list[dict], champ_info: dict[int, dict]) -> discord.Embed:
    game_name = summoner.get("gameName") or summoner.get("name") or "Invocador"
    tag = summoner.get("tagLine", "")
    full_name = f"{game_name}#{tag}" if tag else game_name

    embed = base_embed(
        "Maestría de campeones",
        f"Top 10 campeones con más maestría de **{full_name}**",
        color=config.BRAND["blue"],
    )

    if not masters:
        embed.description = "Aún no has obtenido puntos de maestría con ningún campeón."
        embed.set_author(
            name=f"{full_name} · Nivel {summoner.get('summonerLevel', 0)}",
            icon_url=config.ICON_URL.format(icon_id=summoner.get("profileIconId", 0)),
        )
        return embed

    lines = []
    for i, m in enumerate(masters[:10]):
        info = champ_info.get(m.get("championId"))
        cname = info["name"] if info else f"Campeón {m.get('championId')}"
        pts = f"{m.get('championPoints', 0):,}".replace(",", ".")
        lines.append(f"{MEDALS[i]} **{cname}** · M{m.get('championLevel')} · `{pts}` pts")
    embed.description = "\n".join(lines)

    top = champ_info.get(masters[0].get("championId"))
    if top:
        embed.set_thumbnail(url=config.CHAMPION_ICON_URL.format(image=top["image"]))

    embed.set_author(
        name=f"{full_name} · Nivel {summoner.get('summonerLevel', 0)}",
        icon_url=config.ICON_URL.format(icon_id=summoner.get("profileIconId", 0)),
    )
    return embed


def not_verified_embed() -> discord.Embed:
    embed = base_embed(
        "⚠️ No estás verificado",
        "Todavía no has vinculado ninguna cuenta de League of Legends a tu perfil de Discord.",
        color=config.BRAND["red"],
    )
    embed.add_field(
        name=        "📌 ¿Cómo verificarme?",
        value="Pulsa el botón **🔐 Empezar verificación** en el canal de verificación del servidor.",
        inline=False,
    )
    return embed


def error_embed(title: str, description: str) -> discord.Embed:
    return base_embed(title, description, color=config.BRAND["red"])


def account_not_found_embed() -> discord.Embed:
    embed = base_embed(
        "🔍 Cuenta no encontrada",
        "No pudimos encontrar esa cuenta en el servidor de EUW.",
        color=config.BRAND["red"],
    )
    embed.add_field(
        name="📌 Comprueba",
        value=(
            "• El **Riot ID** (Nombre#TAG) es exacto\n"
            "• Tu cuenta está en el servidor **EUW**\n"
            "• La cuenta existe (debe haber jugado al menos una partida)\n"
        ),
        inline=False,
    )
    return embed
