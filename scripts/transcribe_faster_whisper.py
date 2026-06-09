#!/usr/bin/env python3
import os
import sys
from pathlib import Path

def log(msg):
    print(msg, file=sys.stderr, flush=True)

def main():
    log('Python script started')
    if len(sys.argv) < 2:
        log('No audio path provided')
        print('', flush=True)
        return
    audio_path = Path(sys.argv[1])
    log(f'Received audio path: {audio_path}')
    if not audio_path.is_file():
        log(f'Audio file does not exist: {audio_path}')
        print('', flush=True)
        return
    size = audio_path.stat().st_size
    log(f'Audio file size: {size} bytes')
    model_name = os.getenv('WHISPER_MODEL', 'tiny')
    log(f'Loading Faster-Whisper model {model_name} (compute_type=int8)')
    try:
        from faster_whisper import WhisperModel
        model = WhisperModel(model_name, device='cpu', compute_type='int8')
        log('Model loaded')
        log('Starting transcription')
        segments, _ = model.transcribe(str(audio_path), language='en')
        transcript = ' '.join([seg.text for seg in segments])
        log(f'Transcription completed: {transcript}')
        print(transcript)
    except Exception as e:
        log(f'ERROR during transcription: {e}')
        sys.exit(1)

if __name__ == '__main__':
    main()
