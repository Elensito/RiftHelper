import discord
from discord import app_commands
from discord.ext import commands

from rifthelper import presentation
from rifthelper.services.riot import RiotAPIError


class MasteryCog(commands.Cog):


    @app_commands.command(
        name="maestria", description="Muestra los 10 campeones con más maestría de tu cuenta"
    )
    async def mastery(self, interaction: discord.Interaction):
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
            masters = await interaction.client.riot.get_champion_mastery(data["region"], data["puuid"])
            champ_info = await interaction.client.riot.get_champion_info()
        except RiotAPIError as e:
            await interaction.followup.send(
                embed=presentation.error_embed("❌ No se pudo obtener tu maestría", str(e))
            )
            return

        embed = presentation.mastery_embed(summoner, masters, champ_info)
        await interaction.followup.send(embed=embed)


async def setup(bot: commands.Bot):
    await bot.add_cog(MasteryCog(bot))
