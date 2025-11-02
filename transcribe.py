import os
import json
import sys
import logging
import argparse
from faster_whisper import WhisperModel
import torchaudio
import torch


try:
    from pyannote.audio import Pipeline
except ImportError:
    Pipeline = None  # fallback if not installed

logging.getLogger("pyannote").setLevel(logging.ERROR)
logging.getLogger("transformers").setLevel(logging.ERROR)

def transcribe_audio(audio_path, enable_speaker=False, enable_word_timestamps=False):
    model = WhisperModel("base", device="cpu")

    segments, info = model.transcribe(audio_path, word_timestamps=enable_word_timestamps)

    results = []
    for segment in segments:
        segment_data = {
            "start": round(segment.start, 2),
            "end": round(segment.end, 2),
            "text": segment.text.strip()
        }

        if enable_word_timestamps and hasattr(segment, "words"):
            segment_data["words"] = [
                {
                    "word": w.word,
                    "start": round(w.start, 2),
                    "end": round(w.end, 2)
                }
                for w in segment.words
            ]

        results.append(segment_data)

    # Speaker diarization
    speaker_map = {}
    diarization_data = []

    if enable_speaker:
        if Pipeline is None:
            raise ImportError("pyannote.audio is not installed. Please install it for speaker diarization.")

        hf_token = os.getenv("HF_AUTH_TOKEN")
        if not hf_token:
            raise ValueError("Missing Hugging Face access token for diarization. Please set HF_AUTH_TOKEN in your environment.")

        diarization_pipeline = Pipeline.from_pretrained(
            "pyannote/speaker-diarization-community-1",
            token=hf_token,
        )
        diarization_result = diarization_pipeline(audio_path)

        # Assign speaker labels
        for turn, _, speaker in diarization_result.itertracks(yield_label=True):
            diarization_data.append({
                "speaker": speaker,
                "start": round(turn.start, 2),
                "end": round(turn.end, 2)
            })
            for seg in results:
                if seg["start"] >= turn.start and seg["end"] <= turn.end:
                    seg["speaker"] = speaker

        # Group by speaker
        for seg in results:
            spk = seg.get("speaker", "unknown")
            if spk not in speaker_map:
                speaker_map[spk] = []
            speaker_map[spk].append(seg)

    # Combine into full output
    output = {
        "language": info.language,
        "duration": round(info.duration, 2),
        "text": " ".join([s["text"] for s in results]),
        "segments": results,
    }

    if enable_speaker:
        output["grouped_by_speaker"] = speaker_map
        output["diarization"] = diarization_data

    # Print clean JSON only
    sys.stdout.write(json.dumps(output))
    sys.stdout.flush()

def ensure_16k_mono(audio_path):
    waveform, sample_rate = torchaudio.load(audio_path)

    # Convert to mono
    if waveform.shape[0] > 1:
        waveform = torch.mean(waveform, dim=0, keepdim=True)

    # Resample if not 16kHz
    if sample_rate != 16000:
        resampler = torchaudio.transforms.Resample(orig_freq=sample_rate, new_freq=16000)
        waveform = resampler(waveform)

    # Round length to nearest multiple of 160 (16kHz * 0.01s)
    # This prevents fractional chunk issues
    total_samples = waveform.shape[1]
    expected_multiple = int(16000 * 0.01)
    trim_length = (total_samples // expected_multiple) * expected_multiple
    waveform = waveform[:, :trim_length]

    temp_path = f"{audio_path}_16k.wav"
    torchaudio.save(temp_path, waveform, 16000)
    return temp_path

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("audio_path", help="Path to the audio file")
    parser.add_argument("--speaker", action="store_true", help="Enable speaker diarization")
    parser.add_argument("--words", action="store_true", help="Enable word-level timestamps")

    args = parser.parse_args()
    audio_path = ensure_16k_mono(args.audio_path)

    print("✅ Python script started", file=sys.stderr)  # debug
    transcribe_audio(audio_path, args.speaker, args.words)
    print("✅ Transcription complete", file=sys.stderr)  # debug



