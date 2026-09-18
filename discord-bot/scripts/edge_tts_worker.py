import asyncio
import json
import os
import sys

import edge_tts


VOICE = os.environ.get("EDGE_TTS_VOICE", "pt-BR-FranciscaNeural")
RATE = os.environ.get("EDGE_TTS_RATE", "+2%")
PITCH = os.environ.get("EDGE_TTS_PITCH", "+0Hz")


async def synthesize(request):
    communicate = edge_tts.Communicate(
        request["text"],
        voice=VOICE,
        rate=RATE,
        pitch=PITCH,
    )
    await communicate.save(request["outputPath"])


def main():
    if len(sys.argv) != 2:
        raise ValueError("o worker precisa receber o caminho do pedido")

    with open(sys.argv[1], "r", encoding="utf-8") as request_file:
        request = json.load(request_file)

    asyncio.run(synthesize(request))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)