import os
import json
import logging
import argparse
from faster_whisper import WhisperModel
import torchaudio
import torch
import subprocess



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
    diarization_data = []

    if enable_speaker:

        hf_token = os.getenv("HF_AUTH_TOKEN")
        if not hf_token:
            raise ValueError("Missing Hugging Face access token. Set HF_AUTH_TOKEN in your environment.")

        # Load pipeline
        diarization_pipeline = Pipeline.from_pretrained(
            "pyannote/speaker-diarization-community-1",
            token=hf_token
        )

        # # If GPU available, use it
        # if torch.cuda.is_available():
        #     diarization_pipeline.to(torch.device("cuda"))
        # else:
        #     diarization_pipeline.to(torch.device("cpu"))

        # Run diarization
        diarization_result = diarization_pipeline(audio_path)

        # Process diarization output
        for turn, speaker in diarization_result.speaker_diarization:
            diarization_data.append({
                "speaker": speaker,
                "start": round(turn.start, 2),
                "end": round(turn.end, 2)
            })

            # Tag Whisper segments with speaker label when overlap detected
            # for seg in results:
            #     if seg["start"] >= turn.start and seg["end"] <= turn.end:
            #         seg["speaker"] = speaker

        # Group results by speaker
        # for seg in results:
        #     spk = seg.get("speaker", "unknown")
        #     if spk not in speaker_map:
        #         speaker_map[spk] = []
        #     speaker_map[spk].append(seg)

    # ------------------------------------------------------------
    # 📦 FINAL OUTPUT
    # ------------------------------------------------------------
    output = {
        "language": info.language,
        "duration": round(info.duration, 2),
        "text": " ".join([s["text"] for s in results]),
        "segments": results,
    }

    if enable_speaker:
        output["diarization"] = diarization_data
    

    return output


def ensure_16k_mono(audio_path):

    temp_path = f"{os.path.splitext(audio_path)[0]}_16k.wav"

    try:
        waveform, sample_rate = torchaudio.load(audio_path)

        # Convert to mono
        if waveform.shape[0] > 1:
            waveform = torch.mean(waveform, dim=0, keepdim=True)

        # Resample if not 16kHz
        if sample_rate != 16000:
            resampler = torchaudio.transforms.Resample(orig_freq=sample_rate, new_freq=16000)
            waveform = resampler(waveform)

        torchaudio.save(temp_path, waveform, 16000)
        return temp_path

    except Exception as e:
        print(f"[ensure_16k_mono] torchaudio failed: {e}, falling back to ffmpeg...")
        # Fallback to ffmpeg if torchaudio can't load
        command = [
            "ffmpeg", "-y", "-i", audio_path,
            "-ar", "16000", "-ac", "1", temp_path
        ]
        subprocess.run(command, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        return temp_path

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("audio_path", help="Path to the audio file")
    parser.add_argument("--speaker", action="store_true", help="Enable speaker diarization")
    parser.add_argument("--words", action="store_true", help="Enable word-level timestamps")

    args = parser.parse_args()
    audio_path = ensure_16k_mono(args.audio_path)
    result = transcribe_audio(audio_path, args.speaker, args.words)
    print(json.dumps(result, ensure_ascii=False))


