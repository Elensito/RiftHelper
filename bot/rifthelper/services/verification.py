class PendingVerificationStore:
    """Verificaciones en curso, en memoria: {discord_user_id: datos}."""

    def __init__(self):
        self._pending: dict = {}

    def add(self, user_id: int, data: dict):
        self._pending[int(user_id)] = data

    def get(self, user_id: int) -> dict | None:
        return self._pending.get(int(user_id))

    def pop(self, user_id: int) -> dict | None:
        return self._pending.pop(int(user_id), None)

    def has(self, user_id: int) -> bool:
        return int(user_id) in self._pending
