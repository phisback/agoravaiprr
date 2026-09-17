"""Valida no build que o pacote local do XTTS pode ser importado."""

from TTS.api import TTS


print(f"XTTS Python package loaded: {TTS.__name__}")