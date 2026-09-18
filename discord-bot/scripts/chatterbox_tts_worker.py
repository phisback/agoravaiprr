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
    import gc
    import torch
    from huggingface_hub import snapshot_download
    from safetensors import safe_open
    from chatterbox.mtl_tts import ChatterboxMultilingualTTS, Conditionals
    from chatterbox.models.s3gen import S3Gen
    from chatterbox.models.t3 import T3
    from chatterbox.models.t3.modules.t3_config import T3Config
    from chatterbox.models.tokenizers import MTLTokenizer
    from chatterbox.models.voice_encoder import VoiceEncoder

    log(f"carregando modelo multilíngue {T3_MODEL} em {DEVICE}")
    try:
        torch.set_num_threads(max(1, int(os.environ.get("CHATTERBOX_TORCH_THREADS", "1"))))
        torch.set_num_interop_threads(1)
    except RuntimeError:
        # PyTorch não permite alterar essas opções depois que a computação
        # começou; nesse caso, seguimos com a configuração já ativa.
        pass

    t3_models = {
        "v2": "t3_mtl23ls_v2.safetensors",
        "t3_mtl23ls_v2": "t3_mtl23ls_v2.safetensors",
        "v3": "t3_mtl23ls_v3.safetensors",
        "t3_mtl23ls_v3": "t3_mtl23ls_v3.safetensors",
    }
    t3_model_file = t3_models.get(T3_MODEL, T3_MODEL)
    if not t3_model_file.endswith(".safetensors"):
        raise ValueError(f"Modelo multilíngue desconhecido: {T3_MODEL}")

    checkpoint_dir = Path(
        snapshot_download(
            repo_id="ResembleAI/chatterbox",
            repo_type="model",
            revision="main",
            allow_patterns=[
                "ve.pt",
                t3_model_file,
                "s3gen.pt",
                "grapheme_mtl_merged_expanded_v1.json",
                "conds.pt",
                "Cangjie5_TC.json",
            ],
            token=os.getenv("HF_TOKEN"),
        ),
    )

    # O carregador padrão mantém o checkpoint T3 inteiro na memória enquanto
    # carrega o S3Gen. Em CPU isso cria um pico de vários GB e o Railway mata
    # o worker com SIGKILL. O carregamento tensor a tensor evita esse pico.
    ve = VoiceEncoder()
    ve.load_state_dict(
        torch.load(checkpoint_dir / "ve.pt", map_location="cpu", weights_only=True),
    )
    ve.to(DEVICE).eval()
    gc.collect()

    t3 = T3(T3Config.multilingual())
    t3_state = t3.state_dict()
    loaded_t3_keys = set()
    with safe_open(str(checkpoint_dir / t3_model_file), framework="pt", device="cpu") as file:
        with torch.no_grad():
            for key in file.keys():
                if key == "__metadata__":
                    continue
                target_key = key[6:] if key.startswith("model.") else key
                if target_key not in t3_state:
                    continue
                t3_state[target_key].copy_(file.get_tensor(key))
                loaded_t3_keys.add(target_key)
    missing_t3_keys = set(t3_state) - loaded_t3_keys
    if missing_t3_keys:
        raise RuntimeError(
            f"Checkpoint T3 incompleto; faltam {len(missing_t3_keys)} tensores",
        )
    del t3_state
    t3.to(DEVICE).eval()
    gc.collect()

    s3gen = S3Gen()
    s3gen_state = torch.load(
        checkpoint_dir / "s3gen.pt",
        map_location="cpu",
        weights_only=True,
        mmap=True,
    )
    s3gen.load_state_dict(s3gen_state)
    del s3gen_state
    s3gen.to(DEVICE).eval()
    gc.collect()

    tokenizer = MTLTokenizer(
        str(checkpoint_dir / "grapheme_mtl_merged_expanded_v1.json"),
    )
    conds = None
    builtin_voice = checkpoint_dir / "conds.pt"
    if builtin_voice.exists():
        conds = Conditionals.load(builtin_voice, map_location=torch.device("cpu")).to(DEVICE)

    return ChatterboxMultilingualTTS(
        t3,
        s3gen,
        ve,
        tokenizer,
        DEVICE,
        conds=conds,
    )


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