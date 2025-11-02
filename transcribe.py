import os
import json
import argparse
from faster_whisper import WhisperModel

try:
    from pyannote.audio import Pipeline
except ImportError:
    Pipeline = None  # fallback if not installed


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
    if enable_speaker:
        if Pipeline is None:
            raise ImportError("pyannote.audio is not installed. Please install it for speaker diarization.")

        hf_token = os.getenv("HF_AUTH_TOKEN")
        if not hf_token:
            raise ValueError("Missing Hugging Face access token for diarization.")

        diarization_pipeline = Pipeline.from_pretrained(
            "pyannote/speaker-diarization",
            token=hf_token,
            revision="main"
        )
        diarization_result = diarization_pipeline(audio_path)

        # Assign speaker labels to each segment
        for turn, _, speaker in diarization_result.itertracks(yield_label=True):
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

    print(json.dumps(output, ensure_ascii=False))


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("audio_path", help="Path to the audio file")
    parser.add_argument("--speaker", action="store_true", help="Enable speaker diarization")
    parser.add_argument("--words", action="store_true", help="Enable word-level timestamps")

    args = parser.parse_args()

    transcribe_audio(args.audio_path, args.speaker, args.words)
