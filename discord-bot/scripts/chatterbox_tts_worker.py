import json
import os
import sys
from pathlib import Path

import torch
import torchaudio as ta
from chatterbox.mtl_tts import ChatterboxMultilingualTTS


REFERENCE_AUDIO = os.environ.get(
    "CHATTERBOX_REFERENCE_AUDIO",
    "assets/tts/chatterbox-reference.wav",
)
LANGUAGE_ID = os.environ.get("CHATTERBOX_LANGUAGE", "pt")
T3_MODEL = os.environ.get("CHATTERBOX_T3_MODEL", "v3")
DEVICE = os.environ.get(
    "CHATTERBOX_DEVICE",
    "cuda" if torch.cuda.is_available() else "cpu",
)


def log(message):
    print(f"[Chatterbox] {message}", file=sys.stderr, flush=True)


def load_model():
    log(f"carregando modelo multilíngue {T3_MODEL} em {DEVICE}")
    model = ChatterboxMultilingualTTS.from_pretrained(
        device=DEVICE,
        t3_model=T3_MODEL,
    )
    return model


def save_audio(path, waveform, sample_rate):
    output = Path(path)
    output.parent.mkdir(parents=True, exist_ok=True)
    audio = waveform.detach().float().cpu()
    if audio.ndim == 1:
        audio = audio.unsqueeze(0)
    ta.save(str(output), audio, sample_rate)


def generate(model, text, output_path):
    with torch.inference_mode():
        waveform = model.generate(
            text,
            language_id=LANGUAGE_ID,
            audio_prompt_path=REFERENCE_AUDIO,
        )
    save_audio(output_path, waveform, model.sr)


def main():
    model = load_model()

    if "--warmup" in sys.argv:
        if not Path(REFERENCE_AUDIO).is_file():
            raise FileNotFoundError(
                f"áudio de referência não encontrado: {REFERENCE_AUDIO}"
            )
        generate(model, "Olá, eu sou a voz do bot.", "/tmp/chatterbox-warmup.wav")
        log("warmup concluído")
        return

    for line in sys.stdin:
        if not line.strip():
            continue

        request = None
        try:
            request = json.loads(line)
            generate(model, str(request["text"]), request["outputPath"])
            result = {
                "id": request["id"],
                "ok": True,
                "outputPath": request["outputPath"],
            }
        except Exception as error:
            log(f"falha na síntese: {error}")
            result = {
                "id": request.get("id") if request else None,
                "ok": False,
                "code": "CHATTERBOX_SYNTHESIS_ERROR",
                "error": str(error),
            }
        print(json.dumps(result, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        log(f"worker não iniciou: {error}")
        raise