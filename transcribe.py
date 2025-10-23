import sys
from faster_whisper import WhisperModel

audio_path = sys.argv[1]

# Load the model (base or small recommended for low memory)
model = WhisperModel("base", device="cpu")

segments, info = model.transcribe(audio_path)
text = " ".join([segment.text for segment in segments])

print(text)
