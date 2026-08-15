import discord
from discord import app_commands
from discord.ext import commands

from rifthelper import config, presentation
from rifthelper.cogs.verify import apply_rank_role
from rifthelper.services.riot import RiotAPIError


class ProfileCog(commands.Cog):


    @app_commands.command(name="profile", description="Muestra tu rango y LP de League of Legends")
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
        role_msg = None
        if isinstance(interaction.user, discord.Member):
            tier = (rank or {}).get("tier") or "UNRANKED"
            role, changed = await apply_rank_role(interaction.user, tier)
            if changed:
                role_msg = (
                    f"🎖️ Tu rol de rango se ha actualizado a **{role.name}**."
                    if role
                    else "🎖️ No tienes rol de rango (no hay rol configurado para tu rango actual)."
                )
        await interaction.followup.send(
            embed=embed, file=file, view=presentation.profile_view(data), content=role_msg
        )

    @app_commands.command(
        name="unlink",
        description="Desvincula tu cuenta de League of Legends de tu perfil de Discord",
    )
    async def unlink(self, interaction: discord.Interaction):
        data = interaction.client.storage.get_user(interaction.user.id)
        if not data:
            await interaction.response.send_message(
                embed=presentation.not_verified_embed(), ephemeral=True
            )
            return

        await interaction.response.defer(ephemeral=True)
        game_name = data.get("game_name", "")
        tag = data.get("tag", "")
        account = f"{game_name}#{tag}" if tag else (game_name or "tu cuenta")

        if isinstance(interaction.user, discord.Member):
            rank_roles = [r for r in interaction.user.roles if r.id in config.RANK_ROLE_IDS]
            if rank_roles:
                try:
                    await interaction.user.remove_roles(
                        *rank_roles, reason="Desvinculación de cuenta de League of Legends"
                    )
                except discord.HTTPException:
                    pass

        await interaction.client.storage.remove_user(interaction.user.id)
        interaction.client.pending.pop(interaction.user.id, None)

        await interaction.followup.send(embed=presentation.unlink_embed(account), ephemeral=True)


async def setup(bot: commands.Bot):
    await bot.add_cog(ProfileCog(bot))
