import discord
from discord import app_commands
from discord.ext import commands

from rifthelper import presentation
from rifthelper.services.riot import RiotAPIError


class ProfileCog(commands.Cog):


    @app_commands.command(name="perfil", description="Muestra tu rango y LP de League of Legends")
    async def profile(self, interaction: discord.Interaction):
        data = interaction.client.storage.get_user(interaction.user.id)
        if not data:
            await interaction.response.send_message(
                embed=presentation.not_verified_embed(), ephemeral=True
            )
            return

        await interaction.response.defer()
        try:
            summoner = await interaction.client.riot.get_summoner_by_puuid(data["region"], data["puuid"])
            rank = await interaction.client.riot.get_solo_rank(data["region"], data["puuid"])
        except RiotAPIError as e:
            await interaction.followup.send(
                embed=presentation.error_embed("❌ No se pudo obtener tu perfil", str(e))
            )
            return

        embed, file = presentation.profile_embed(data, rank, summoner)
        await interaction.followup.send(embed=embed, file=file)


async def setup(bot: commands.Bot):
    await bot.add_cog(ProfileCog(bot))
