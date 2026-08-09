from datetime import datetime, timezone

import discord
from discord import app_commands
from discord.ext import commands

from rifthelper import config, presentation
from rifthelper.services import excel, stats as stats_service
from rifthelper.services.riot import RiotAPIError

MIN_MATCHES = 1
MAX_MATCHES = 50
DEFAULT_MATCHES = 10

MODE_LABELS = {0: "Todas (Ranked)", 420: "Solo/Dúo", 440: "Flex"}


class StatsCog(commands.Cog):
    """Comando /stats: genera un Excel con stats de la temporada."""

    @app_commands.command(
        name="estadisticas",
        description="Genera un Excel descargable con tus stats de la temporada (oro diff y CS/min)",
    )
    @app_commands.describe(
        partidas=f"Número de partidas a analizar ({MIN_MATCHES}-{MAX_MATCHES})",
        tipo="Qué colas clasificatorias incluir en el Excel",
    )
    @app_commands.choices(
        tipo=[
            app_commands.Choice(name="Todas (Ranked)", value=0),
            app_commands.Choice(name="Solo/Dúo", value=420),
            app_commands.Choice(name="Flex", value=440),
        ]
    )
    async def stats(
        self,
        interaction: discord.Interaction,
        partidas: app_commands.Range[int, MIN_MATCHES, MAX_MATCHES] = DEFAULT_MATCHES,
        tipo: int = 0,
    ):
        data = interaction.client.storage.get_user(interaction.user.id)
        if not data:
            await interaction.response.send_message(
                embed=presentation.not_verified_embed(), ephemeral=True
            )
            return

        await interaction.response.defer()
        try:
            summoner = await interaction.client.riot.get_summoner_by_puuid(data["region"], data["puuid"])
            summoner.setdefault("gameName", data["game_name"])
            summoner.setdefault("tagLine", data["tag"])
            rank = await interaction.client.riot.get_solo_rank(data["region"], data["puuid"])
        except RiotAPIError as e:
            await interaction.followup.send(
                embed=presentation.error_embed("❌ No se pudo obtener tu cuenta", str(e))
            )
            return

        start_ts = int(datetime(datetime.now().year, 1, 1, tzinfo=timezone.utc).timestamp())

        try:
            match_ids = await interaction.client.riot.get_match_ids(
                data["region"], data["puuid"], partidas, start_ts, queue=None if tipo == 0 else tipo
            )
        except RiotAPIError as e:
            await interaction.followup.send(
                embed=presentation.error_embed("❌ No se pudo obtener tus partidas", str(e))
            )
            return

        if not match_ids:
            await interaction.followup.send(
                embed=presentation.error_embed(
                    "📭 Sin partidas",
                    f"No hay partidas clasificatorias de esta temporada ({MODE_LABELS.get(tipo, '')}) para analizar.",
                )
            )
            return

        champ_info = await interaction.client.riot.get_champion_info()
        results = []
        for i, match_id in enumerate(match_ids, 1):
            await interaction.edit_original_response(
                content=f"⏳ Analizando partida {i}/{len(match_ids)}..."
            )
            try:
                match = await interaction.client.riot.get_match(data["region"], match_id)
                timeline = await interaction.client.riot.get_match_timeline(data["region"], match_id)
            except RiotAPIError:
                continue
            stat = stats_service.compute_match_stats(match, timeline, data["puuid"], champ_info)
            if stat:
                results.append(stat)

        tier = (rank or {}).get("tier", "UNRANKED")
        rank_icon = config.RANK_ICONS.get(tier.upper()) or config.RANK_ICONS["UNRANKED"]
        full_name = f"{data['game_name']}#{data['tag']}"
        mode_label = MODE_LABELS.get(tipo, "")
        xlsx = excel.generate_stats_excel(full_name, rank_icon, results, mode_label)

        await interaction.edit_original_response(
            content=f"📄 **{full_name}** · {len(results)} partidas analizadas ({mode_label})"
        )
        await interaction.followup.send(
            file=discord.File(xlsx, filename=f"stats_{data['game_name']}.xlsx")
        )


async def setup(bot: commands.Bot):
    await bot.add_cog(StatsCog(bot))
