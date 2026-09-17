"""Valida no build que o pacote local do XTTS pode ser importado."""

import torch
import torchaudio
from TTS.api import TTS


print(
    "XTTS Python package loaded: "
    f"{TTS.__name__} (torch={torch.__version__}, torchaudio={torchaudio.__version__})"
)