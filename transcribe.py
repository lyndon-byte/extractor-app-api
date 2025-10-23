import sys
import json
from faster_whisper import WhisperModel

# Get the audio file path from command-line argument
audio_path = sys.argv[1]

# Load the model (choose "base" or "small" depending on your resources)
model = WhisperModel("base", device="cpu")

# Transcribe the audio
segments, info = model.transcribe(audio_path)

# Collect all segment details
results = []
for segment in segments:
    results.append({
        "start": round(segment.start, 2),
        "end": round(segment.end, 2),
        "text": segment.text.strip()
    })

# Print JSON so Node.js or other systems can parse it easily
print(json.dumps({
    "language": info.language,
    "duration": round(info.duration, 2),
    "text": " ".join([s["text"] for s in results]),
    "segments": results
}, ensure_ascii=False))
