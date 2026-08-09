import asyncio
import sys

import discord
from discord.ext import commands

from rifthelper import config
from rifthelper.services.riot import RiotClient
from rifthelper.services.storage import Storage
from rifthelper.services.verification import PendingVerificationStore


def build_bot() -> commands.Bot:
    intents = discord.Intents.default()
    bot = commands.Bot(command_prefix="!", intents=intents)

    # Servicios inyectados en el bot para que los cogs los compartan.
    bot.riot = RiotClient()
    bot.storage = Storage()
    bot.pending = PendingVerificationStore()

    @bot.event
    async def on_ready():
        print(f"[OK] {bot.user} conectado. Sincronizando comandos...")
        try:
            await bot.tree.sync()
            print("[OK] Comandos sincronizados correctamente.")
        except Exception as e:
            print(f"[WARN] No se pudieron sincronizar los comandos: {e}")

    return bot


async def run() -> None:
    bot = build_bot()
    await bot.load_extension("rifthelper.cogs.verify")
    await bot.load_extension("rifthelper.cogs.profile")
    await bot.load_extension("rifthelper.cogs.mastery")
    await bot.load_extension("rifthelper.cogs.stats")
    await bot.start(config.DISCORD_TOKEN)


def main() -> None:
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except AttributeError:
        pass

    if not config.DISCORD_TOKEN:
        raise SystemExit("[ERROR] DISCORD_TOKEN no está configurado. Rellena el archivo .env")
    if not config.RIOT_API_KEY:
        raise SystemExit("[ERROR] RIOT_API_KEY no está configurada. Rellena el archivo .env")

    asyncio.run(run())


if __name__ == "__main__":
    main()
