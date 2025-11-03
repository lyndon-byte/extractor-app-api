import os
import json
import argparse
from faster_whisper import WhisperModel
import torchaudio
import torch
from pyannote.audio import Pipeline
from pyannote.audio.pipelines.utils.hook import ProgressHook



def transcribe_audio(audio_path, enable_speaker=False, enable_word_timestamps=False, hf_token=""):

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
    
    if enable_speaker:

            pipeline = Pipeline.from_pretrained(
                "pyannote/speaker-diarization-community-1",
                token=hf_token
            )
         
            diarization_result = pipeline(audio_path)           

            speaker_diarization_data = []

            for turn, speaker in diarization_result.itertracks(yield_label=True):
                speaker_diarization_data.append({
                    "speaker": speaker,
                    "start": turn.start,
                    "end": turn.end,
                })


    # Prepare base output
    output = {
        "language": info.language,
        "duration": round(info.duration, 2),
        "text": " ".join([s["text"] for s in results]),
        "segments": results,
    }

    # Attach diarization data if available
    if enable_speaker:
        output["diarization"] = speaker_diarization_data
    

    return output


def ensure_16k_mono(audio_path):

    waveform, sample_rate = torchaudio.load(audio_path)

    # Convert to mono if stereo
    if waveform.shape[0] > 1:
        waveform = torch.mean(waveform, dim=0, keepdim=True)

    # Resample to 16kHz if needed
    if sample_rate != 16000:
        resampler = torchaudio.transforms.Resample(orig_freq=sample_rate, new_freq=16000)
        waveform = resampler(waveform)

    # Define upload folder (absolute path)
    output_dir = "./uploads"
    os.makedirs(output_dir, exist_ok=True)

    # Get base name only (no directories or extensions)
    base_name = os.path.splitext(os.path.basename(audio_path))[0]

    # New WAV file path
    output_path = os.path.join(output_dir, f"{base_name}.wav")

    # Round length to nearest multiple of 160 (16kHz * 0.01s)
    total_samples = waveform.shape[1]
    expected_multiple = int(16000 * 0.01)
    trim_length = (total_samples // expected_multiple) * expected_multiple
    waveform = waveform[:, :trim_length]

    # Save the processed file
    torchaudio.save(output_path, waveform, 16000)

    # Return the full path to the new file
    return output_path

if __name__ == "__main__":

    
    parser = argparse.ArgumentParser()
    parser.add_argument("audio_path", help="Path to the audio file")
    parser.add_argument("--speaker", action="store_true", help="Enable speaker diarization")
    parser.add_argument("--words", action="store_true", help="Enable word-level timestamps")
    parser.add_argument("--hf_key", help="Hugging Face API key")
    args = parser.parse_args()
    
    audio_path = ensure_16k_mono(args.audio_path)
    result = transcribe_audio(audio_path, args.speaker, args.words, args.hf_key)
    print(json.dumps(result, ensure_ascii=False))



