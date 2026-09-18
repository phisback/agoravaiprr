import json
import os
import sys
import traceback
from pathlib import Path

REFERENCE_AUDIO = os.environ.get(
    "CHATTERBOX_REFERENCE_AUDIO",
    "assets/tts/chatterbox-reference.wav",
)
LANGUAGE_ID = os.environ.get("CHATTERBOX_LANGUAGE", "pt")
T3_MODEL = os.environ.get("CHATTERBOX_T3_MODEL", "v3")
DEVICE = os.environ.get("CHATTERBOX_DEVICE", "cpu")


def log(message):
    print(f"[Chatterbox] {message}", file=sys.stderr, flush=True)


def load_model():
    # Os imports ficam dentro do worker para que uma falha de dependência
    # possa ser devolvida como resposta JSON, em vez de encerrar o processo
    # sem associar o erro ao pedido que o originou.
    import torch
    from chatterbox.mtl_tts import ChatterboxMultilingualTTS

    log(f"carregando modelo multilíngue {T3_MODEL} em {DEVICE}")
    model = ChatterboxMultilingualTTS.from_pretrained(
        device=DEVICE,
        t3_model=T3_MODEL,
    )
    return model


def save_audio(path, waveform, sample_rate):
    import torchaudio as ta

    output = Path(path)
    output.parent.mkdir(parents=True, exist_ok=True)
    audio = waveform.detach().float().cpu()
    if audio.ndim == 1:
        audio = audio.unsqueeze(0)
    ta.save(str(output), audio, sample_rate)


def generate(model, text, output_path):
    import torch

    with torch.inference_mode():
        waveform = model.generate(
            text,
            language_id=LANGUAGE_ID,
            audio_prompt_path=REFERENCE_AUDIO,
        )
    save_audio(output_path, waveform, model.sr)


def main():
    if "--warmup" in sys.argv:
        model = load_model()
        if not Path(REFERENCE_AUDIO).is_file():
            raise FileNotFoundError(
                f"áudio de referência não encontrado: {REFERENCE_AUDIO}"
            )
        generate(model, "Olá, eu sou a voz do bot.", "/tmp/chatterbox-warmup.wav")
        log("warmup concluído")
        return

    model = None
    model_error = None

    for line in sys.stdin:
        if not line.strip():
            continue

        request = None
        try:
            request = json.loads(line)
            if model is None:
                if model_error is not None:
                    raise RuntimeError(model_error)
                try:
                    model = load_model()
                except Exception as error:
                    model_error = f"{type(error).__name__}: {error}"
                    log(traceback.format_exc())
                    raise
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
                "code": "CHATTERBOX_MODEL_INIT_ERROR" if model is None else "CHATTERBOX_SYNTHESIS_ERROR",
                "error": str(error),
            }
        print(json.dumps(result, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        log(f"worker não iniciou: {error}")
        raise