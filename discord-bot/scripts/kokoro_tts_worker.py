import json
import os
import sys
import wave

import numpy as np
from kokoro_onnx import Kokoro


MODEL_PATH = os.environ.get("KOKORO_MODEL_PATH", "data/tts/kokoro/kokoro-v1.0.onnx")
VOICES_PATH = os.environ.get("KOKORO_VOICES_PATH", "data/tts/kokoro/voices-v1.0.bin")
VOICE = os.environ.get("KOKORO_VOICE", "pf_dora")
SPEED = float(os.environ.get("KOKORO_SPEED", "1.04"))
LANGUAGE = os.environ.get("KOKORO_LANGUAGE", "pt-br")


def write_wav(path, samples, sample_rate):
    audio = np.asarray(samples, dtype=np.float32)
    audio = np.clip(audio, -1.0, 1.0)
    pcm = (audio * 32767.0).astype(np.int16)
    with wave.open(path, "wb") as output:
        output.setnchannels(1)
        output.setsampwidth(2)
        output.setframerate(sample_rate)
        output.writeframes(pcm.tobytes())


def main():
    kokoro = Kokoro(MODEL_PATH, VOICES_PATH)
    if "--warmup" in sys.argv:
        samples, sample_rate = kokoro.create(
            "Oi, eu sou a voz nova do bot.",
            voice=VOICE,
            speed=SPEED,
            lang=LANGUAGE,
        )
        write_wav("/tmp/kokoro-warmup.wav", samples, sample_rate)
        return

    for line in sys.stdin:
        if not line.strip():
            continue
        request = None
        try:
            request = json.loads(line)
            samples, sample_rate = kokoro.create(
                str(request["text"]),
                voice=VOICE,
                speed=SPEED,
                lang=LANGUAGE,
            )
            write_wav(request["outputPath"], samples, sample_rate)
            result = {
                "id": request["id"],
                "ok": True,
                "outputPath": request["outputPath"],
            }
        except Exception as error:
            result = {
                "id": request.get("id") if request else None,
                "ok": False,
                "code": "KOKORO_SYNTHESIS_ERROR",
                "error": str(error),
            }
        print(json.dumps(result, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    main()