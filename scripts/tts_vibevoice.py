#!/usr/bin/env python3
"""VibeVoice TTS bridge — called by the Node.js voice service."""

import sys
import argparse
import tempfile
import subprocess
from pathlib import Path

try:
    from vibevoice.modular.modeling_vibevoice_streaming_inference import (
        VibeVoiceStreamingForConditionalGenerationInference,
    )
    from vibevoice.processor.vibevoice_streaming_processor import (
        VibeVoiceStreamingProcessor,
    )
except ImportError:
    print("VibeVoice not installed. Run: pip install -e .[streamingtts]", file=sys.stderr)
    sys.exit(1)


MODEL_ID = "microsoft/VibeVoice-Realtime-0.5B"


def main():
    parser = argparse.ArgumentParser(description="VibeVoice TTS")
    parser.add_argument("--text", required=True, help="Text to speak")
    parser.add_argument("--speaker", default="Carter", help="Speaker name")
    parser.add_argument("--output", help="Output WAV path (default: temp file)")
    args = parser.parse_args()

    output_path = args.output
    if not output_path:
        tmp = tempfile.NamedTemporaryFile(suffix=".wav", delete=False)
        output_path = tmp.name
        tmp.close()

    processor = VibeVoiceStreamingProcessor.from_pretrained(MODEL_ID)
    model = VibeVoiceStreamingForConditionalGenerationInference.from_pretrained(MODEL_ID)

    audio = model.generate(
        text=args.text,
        speaker_name=args.speaker,
        processor=processor,
    )

    processor.save_wav(audio, output_path)

    print(output_path)


if __name__ == "__main__":
    main()
