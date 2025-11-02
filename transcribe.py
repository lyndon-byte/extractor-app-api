import os
import json
import logging
import argparse
from faster_whisper import WhisperModel
import torchaudio
import torch
from pyannote.audio import Pipeline
import sys
import traceback


logging.basicConfig(
    filename="python_error.log",  # Creates this in same folder as the script
    level=logging.ERROR,
    format="%(asctime)s - %(levelname)s - %(message)s"
)

# ------------------------------------------------------------
# 2️⃣ Global exception hook (catches all uncaught errors)
# ------------------------------------------------------------
def log_unhandled_exception(exc_type, exc_value, exc_traceback):
    if issubclass(exc_type, KeyboardInterrupt):
        # Let Ctrl+C behave normally
        sys.__excepthook__(exc_type, exc_value, exc_traceback)
        return
    logging.error("Uncaught exception",
                  exc_info=(exc_type, exc_value, exc_traceback))

sys.excepthook = log_unhandled_exception

def transcribe_audio(audio_path, enable_speaker=False, enable_word_timestamps=False, hf_token=''):

    model = WhisperModel("base", device="cpu")

    segments, info = model.transcribe(audio_path, word_timestamps=enable_word_timestamps)

    results = []
    speaker_diarization_data = []


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
    
    if enable_speaker:

        try:

                pipeline = Pipeline.from_pretrained(
                    "pyannote/speaker-diarization-community-1",
                    token=hf_token)
                
                output = pipeline(audio_path)

                for turn, speaker in output.speaker_diarization:
                    speaker_diarization_data.append({

                        "speaker": speaker,
                        "start": round(turn.start, 2),
                        "end": round(turn.end, 2)

                    })

        except Exception as e:

            logging.exception("Error in transcribe_audio")
            return {"success": False, "error": str(e)}
            
    output = {
        "language": info.language,
        "duration": round(info.duration, 2),
        "text": " ".join([s["text"] for s in results]),
        "segments": results,
    }

    if enable_speaker:
        output["diarization"] = speaker_diarization_data
    

    return output


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
    try:
        parser = argparse.ArgumentParser()
        parser.add_argument("audio_path", help="Path to the audio file")
        parser.add_argument("--speaker", action="store_true", help="Enable speaker diarization")
        parser.add_argument("--words", action="store_true", help="Enable word-level timestamps")
        parser.add_argument("--hf_key", help="Hugging Face API key")


        args = parser.parse_args()
    
        audio_path = ensure_16k_mono(args.audio_path)
        result = transcribe_audio(audio_path, args.speaker, args.words, args.hf_key)
        print(json.dumps(result, ensure_ascii=False))

    except Exception as e:
        logging.exception("Error in __main__ block")


