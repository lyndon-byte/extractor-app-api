# import sys
# import json
# from faster_whisper import WhisperModel

# # Get the audio file path from command-line argument
# audio_path = sys.argv[1]

# # Load the model (choose "base" or "small" depending on your resources)
# model = WhisperModel("base", device="cpu")

# # Transcribe the audio
# segments, info = model.transcribe(audio_path)

# # Collect all segment details
# results = []
# for segment in segments:
#     results.append({
#         "start": round(segment.start, 2),
#         "end": round(segment.end, 2),
#         "text": segment.text.strip()
#     })

# # Print JSON so Node.js or other systems can parse it easily
# print(json.dumps({
#     "language": info.language,
#     "duration": round(info.duration, 2),
#     "text": " ".join([s["text"] for s in results]),
#     "segments": results
# }, ensure_ascii=False))


import sys
import json
from faster_whisper import WhisperModel

# Parse CLI args
audio_path = sys.argv[1]
enable_speaker = "--speaker" in sys.argv
enable_word_timestamps = "--words" in sys.argv

# Load model
model = WhisperModel("base", device="cpu")

# Transcribe
segments, info = model.transcribe(
    audio_path,
    word_timestamps=enable_word_timestamps,
)

# Initial result container
results = []
for segment in segments:
    seg_data = {
        "start": round(segment.start, 2),
        "end": round(segment.end, 2),
        "text": segment.text.strip()
    }

    if enable_word_timestamps and segment.words:
        seg_data["words"] = [
            {
                "word": w.word,
                "start": round(w.start, 2),
                "end": round(w.end, 2),
                "probability": round(w.probability, 3)
            }
            for w in segment.words
        ]

    results.append(seg_data)

output = {
    "language": info.language,
    "duration": round(info.duration, 2),
    "text": " ".join([s["text"] for s in results]),
    "segments": results,
}

# Speaker Diarization (optional)
if enable_speaker:
    try:
        from pyannote.audio import Pipeline

        # Load pretrained diarization model
        pipeline = Pipeline.from_pretrained("pyannote/speaker-diarization",use_auth_token="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")

        diarization = pipeline(audio_path)

        # Assign speakers to segments
        speaker_segments = []
        for turn, _, speaker in diarization.itertracks(yield_label=True):
            speaker_segments.append({
                "start": round(turn.start, 2),
                "end": round(turn.end, 2),
                "speaker": speaker
            })

        # Match each Whisper segment to a speaker (based on overlap)
        for seg in output["segments"]:
            for spk_seg in speaker_segments:
                if seg["start"] < spk_seg["end"] and seg["end"] > spk_seg["start"]:
                    seg["speaker"] = spk_seg["speaker"]
                    break
            if "speaker" not in seg:
                seg["speaker"] = "Unknown"

        # Group by speaker
        grouped = {}
        for seg in output["segments"]:
            speaker = seg["speaker"]
            if speaker not in grouped:
                grouped[speaker] = []
            grouped[speaker].append({
                "start": seg["start"],
                "end": seg["end"],
                "text": seg["text"]
            })

        output["grouped_by_speaker"] = grouped

    except Exception as e:
        output["speaker_error"] = str(e)

# Output JSON
print(json.dumps(output, ensure_ascii=False))


