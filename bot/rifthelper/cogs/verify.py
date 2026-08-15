import random
from datetime import datetime, timezone

import discord
from discord import app_commands
from discord.ext import commands
from discord.ui import Modal, TextInput, View, button

from rifthelper import config, presentation
from rifthelper.services.riot import RiotAPIError


VERIFY_INTRO_BUTTON_ID = "verify:intro"


async def apply_rank_role(member: discord.Member, tier: str) -> discord.Role | None:
    tier = (tier or "UNRANKED").upper()
    role_id = config.RANK_ROLES.get(tier, "")
    role = member.guild.get_role(int(role_id)) if role_id else None
    current = [
        r for r in member.roles
        if r.id in config.RANK_ROLE_IDS and (role is None or r.id != role.id)
    ]
    try:
        if current:
            await member.remove_roles(*current, reason="Actualización de rol según rango de LoL")
        if role is not None:
            await member.add_roles(role, reason="Verificación de cuenta de League of Legends")
            return role
    except discord.HTTPException:
        return None
    return role


class VerifyModal(Modal):


    def __init__(self, region: str):
        self.region = region
        super().__init__(title=f"🔐 Verificación · {config.REGION_LABEL}", timeout=300)

        self.riot_id = TextInput(
            label="Riot ID completo",
            placeholder="Ej: Elensito#0123",
            min_length=3,
            max_length=45,
            required=True,
        )
        self.add_item(self.riot_id)

    @staticmethod
    def parse_riot_id(raw: str) -> tuple[str, str] | None:

        if "#" not in raw:
            return None
        game_name, tag = raw.rsplit("#", 1)
        game_name = game_name.strip()
        tag = tag.strip()
        if not game_name or not tag:
            return None
        return game_name, tag

    async def on_submit(self, interaction: discord.Interaction):
        await interaction.response.defer(ephemeral=False)

        parsed = self.parse_riot_id(self.riot_id.value)
        if parsed is None:
            await interaction.followup.send(
                embed=presentation.error_embed(
                    "❌ Formato incorrecto",
                    "Escribe tu **Riot ID completo** con la almohadilla (`#`), por ejemplo: **Elensito#0123**.",
                )
            )
            return
        game_name, tag = parsed

        try:
            summoner = await interaction.client.riot.get_summoner_by_riot_id(self.region, game_name, tag)
        except RiotAPIError as e:
            if e.status == 404:
                await interaction.followup.send(embed=presentation.account_not_found_embed())
            else:
                await interaction.followup.send(embed=presentation.error_embed("❌ Error de API", str(e)))
            return

        icon_id = random.choice(list(config.VERIFICATION_ICONS.keys()))

        interaction.client.pending.add(interaction.user.id, {
            "region": self.region,
            "game_name": summoner.get("gameName") or summoner.get("name") or "Invocador",
            "tag": summoner.get("tagLine", ""),
            "puuid": summoner.get("puuid", ""),
            "required_icon": icon_id,
            "summoner": summoner,
        })

        embed, file = presentation.verify_prompt_embed(summoner, icon_id)
        view = VerifyView(interaction.user.id)
        await interaction.followup.send(embed=embed, file=file, view=view)


class VerifyIntroView(View):


    def __init__(self):
        super().__init__(timeout=None)

    @button(
        label="Empezar verificación",
        style=discord.ButtonStyle.success,
        emoji="🔐",
        custom_id=VERIFY_INTRO_BUTTON_ID,
    )
    async def start_verify(self, interaction: discord.Interaction, _: discord.ui.Button):
        if not config.RIOT_API_KEY:
            await interaction.response.send_message(
                embed=presentation.error_embed(
                    "❌ API Key de Riot no configurada",
                    "El administrador debe rellenar `RIOT_API_KEY` en el archivo `.env`.",
                ),
                ephemeral=True,
            )
            return
        await interaction.response.send_modal(VerifyModal(config.RIOT_REGION))


class VerifyView(View):


    def __init__(self, user_id: int):
        super().__init__(timeout=600)
        self.user_id = user_id

    @button(label="Verificar", style=discord.ButtonStyle.success, emoji="✅")
    async def verify_button(self, interaction: discord.Interaction, _: discord.ui.Button):
        if interaction.user.id != self.user_id:
            await interaction.response.send_message(
                "⛔ Este botón no es para ti. Pulsa **🔐 Empezar verificación** "
                "en el canal de verificación para crear el tuyo.",
                ephemeral=True,
            )
            return
        if not interaction.client.pending.has(interaction.user.id):
            await interaction.response.send_message(
                "⚠️ Tu verificación ha expirado. Vuelve a pulsar **🔐 Empezar verificación** "
                "en el canal de verificación.",
                ephemeral=True,
            )
            return

        await interaction.response.defer(ephemeral=True)
        p = interaction.client.pending.get(interaction.user.id)
        try:
            summoner = await interaction.client.riot.get_summoner_by_puuid(p["region"], p["puuid"])
        except RiotAPIError as e:
            await interaction.followup.send(
                embed=presentation.error_embed("❌ No se pudo comprobar tu cuenta", str(e)),
                ephemeral=True,
            )
            return

        current_icon = summoner.get("profileIconId")
        required = p["required_icon"]

        if current_icon != required:
            await interaction.followup.send(
                embed=presentation.verify_fail_embed(),
                ephemeral=True,
            )
            return

        rank_label = "Sin rango"
        tier = "UNRANKED"
        try:
            rank = await interaction.client.riot.get_solo_rank(p["region"], p["puuid"])
            if rank:
                tier = rank.get("tier", "UNRANKED")
                rank_label = f"{tier.title()} {rank.get('rank', '')} · {rank.get('leaguePoints', 0)} LP"
        except RiotAPIError:
            pass

        profile = {
            "game_name": p["game_name"],
            "tag": p["tag"],
            "puuid": p["puuid"],
            "region": p["region"],
            "verified_at": datetime.now(timezone.utc).strftime("%d/%m/%Y"),
        }
        await interaction.client.storage.set_user(interaction.user.id, profile)
        interaction.client.pending.pop(interaction.user.id)

        role_name = None
        if isinstance(interaction.user, discord.Member):
            role = await apply_rank_role(interaction.user, tier)
            role_name = role.name if role else None

        embed = presentation.verify_success_embed(p["summoner"], rank_label)
        await interaction.message.edit(embed=embed, view=None)
        message = "✅ **¡Verificado!** Ya puedes usar **`/perfil`** para ver tu rango y LP."
        if role_name:
            message += f"\n🎖️ Se te ha asignado el rol **{role_name}**."
        await interaction.followup.send(message, ephemeral=True)


class VerifyCog(commands.Cog):


    def __init__(self, bot: commands.Bot):
        self.bot = bot

    async def cog_load(self):
        self.bot.add_view(VerifyIntroView())

    @app_commands.command(
        name="configurar-verificacion",
        description="Registra el canal donde se muestra el mensaje con el botón de verificación",
    )
    @app_commands.guild_only()
    @app_commands.default_permissions(manage_guild=True)
    async def setup_verification(self, interaction: discord.Interaction, canal: discord.TextChannel):
        if not config.RIOT_API_KEY:
            await interaction.response.send_message(
                embed=presentation.error_embed(
                    "❌ API Key de Riot no configurada",
                    "El administrador debe rellenar `RIOT_API_KEY` en el archivo `.env`.",
                ),
                ephemeral=True,
            )
            return

        await interaction.client.storage.set_config("verify_channel", str(canal.id))
        embed = presentation.verify_intro_embed()
        view = VerifyIntroView()
        try:
            await canal.send(embed=embed, view=view)
        except discord.HTTPException:
            await interaction.response.send_message(
                embed=presentation.error_embed(
                    "❌ No se pudo enviar el mensaje",
                    f"No tengo permisos para enviar mensajes en {canal.mention}. Revisa los permisos del bot.",
                ),
                ephemeral=True,
            )
            return

        await interaction.response.send_message(
            f"✅ Canal de verificación registrado: {canal.mention}\n"
            "El mensaje con el botón **🔐 Empezar verificación** ya está disponible para los usuarios.",
            ephemeral=True,
        )


async def setup(bot: commands.Bot):
    await bot.add_cog(VerifyCog(bot))
