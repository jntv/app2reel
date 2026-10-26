#!/usr/bin/env python3
"""Offline neural batch synthesis. JSON stdin/stdout; diagnostics go to stderr."""
import argparse
import contextlib
import json
import os
from pathlib import Path
import re
import sys
import tempfile
import unicodedata
import wave

# Melo's English lexicon stores a phone followed by a parallel English tone:
# consonant 7, unstressed vowel 8, primary vowel 9, secondary vowel 10.
# Unknown English names use the bundled, offline eSpeak G2P. They are never
# dropped, translated, or sent to a pronunciation service.
_IPA_PHONES = {
    "tʃ": "ch", "dʒ": "jh", "eɪ": "ey", "aɪ": "ay", "ɔɪ": "oy",
    "oʊ": "ow", "əʊ": "ow", "aʊ": "aw", "ɜː": "er", "ɑː": "aa",
    "ɔː": "ao", "iː": "iy", "uː": "uw", "ɚ": "er", "ɝ": "er",
    "æ": "ae", "ɑ": "aa", "ɒ": "aa", "ɔ": "ao", "ə": "ah",
    "ʌ": "ah", "ɐ": "ah", "ɛ": "eh", "ɜ": "er", "ɪ": "ih",
    "ʊ": "uh", "i": "iy", "u": "uw", "e": "eh", "o": "ow",
    "a": "aa", "ɹ": "r", "ɾ": "t", "ɫ": "l", "ŋ": "ng",
    "ʃ": "sh", "ʒ": "zh", "θ": "th", "ð": "dh", "ɡ": "g",
    "ʔ": "t", "ç": "hh", "ʋ": "v", "x": "k",
    **{phone: phone for phone in "bdfgklmnprstvwz"},
    "h": "hh", "j": "y",
}
_IPA_KEYS = sorted(_IPA_PHONES, key=len, reverse=True)
_VOWELS = {"aa", "ae", "ah", "ao", "aw", "ay", "eh", "er", "ey", "ih", "iy", "ow", "oy", "uh", "uw"}
_WORDS = re.compile(r"[A-Za-z]+(?:['’][A-Za-z]+)*|\d+(?:\.\d+)?")


def melo_text(text):
    text = text.replace("’", "'").replace("‘", "'")
    for symbol, spoken in {"&": " and ", "+": " plus ", "@": " at ", "%": " percent ", "$": " dollars ", "£": " pounds ", "€": " euros "}.items():
        text = text.replace(symbol, spoken)
    for char in text:
        kind = unicodedata.category(char)
        if (kind.startswith("L") and not re.fullmatch("[A-Za-z]", char)) or (kind.startswith("N") and char not in "0123456789") or kind.startswith("S"):
            raise ValueError("The Indian English voice needs English letters. Spell names or unsupported symbols in the narration text.")
    return text


def ipa_to_melo(ipa):
    phones, tones = [], []
    stress, index = 8, 0
    while index < len(ipa):
        char = ipa[index]
        if char in "ˈˌ":
            stress = 9 if char == "ˈ" else 10
            index += 1
            continue
        if char.isspace() or char in "ːˑ͜͡˞'’-_.,!?():;" or unicodedata.combining(char):
            index += 1
            continue
        key = next((key for key in _IPA_KEYS if ipa.startswith(key, index)), None)
        if key is None:
            raise ValueError("A name could not be pronounced locally. Spell its pronunciation in the narration text.")
        phone = _IPA_PHONES[key]
        phones.append(phone)
        tones.append(stress if phone in _VOWELS else 7)
        if phone in _VOWELS:
            stress = 8
        index += len(key)
    if not phones:
        raise ValueError("A name could not be pronounced locally. Spell its pronunciation in the narration text.")
    return phones, tones


def english_lexicon(source, texts, target):
    """Extend the installed CMU lexicon for this request, without modifying it."""
    entries = {}
    for line in source.read_text(encoding="utf-8").splitlines():
        parts = line.split()
        if not parts:
            continue
        half = (len(parts) - 1) // 2
        entries[parts[0]] = (parts[1:half + 1], [int(tone) for tone in parts[half + 1:]])
    words = {match.group(0) for text in texts for match in _WORDS.finditer(text)}
    missing = sorted(word for word in words if word.lower() not in entries)
    if not missing:
        return source
    from phonemizer.backend import EspeakBackend
    from phonemizer.backend.espeak.wrapper import EspeakWrapper
    import espeakng_loader
    EspeakWrapper.set_library(espeakng_loader.get_library_path())
    EspeakWrapper.set_data_path(espeakng_loader.get_data_path())
    backend = EspeakBackend("en-us", preserve_punctuation=False, with_stress=True)
    extra = []
    for word in missing:
        # Reuse known compound components before approximate G2P, e.g.
        # MyProduct / OpenAI. Brand-specific exceptions are not hardcoded.
        components = re.findall(r"[A-Z]+(?=[A-Z][a-z]|$)|[A-Z]?[a-z]+|[A-Z]+|\d+(?:\.\d+)?", word)
        if not components or "".join(components).lower() != word.replace("'", "").replace("’", "").lower():
            components = [word]
        phones, tones = [], []
        for component in components:
            pronunciation = entries.get(component.lower())
            if pronunciation is None:
                pronunciation = ipa_to_melo(backend.phonemize([component], strip=True)[0])
            phones.extend(pronunciation[0]); tones.extend(pronunciation[1])
        entries[word.lower()] = (phones, tones)
        extra.append(f"{word.lower()} {' '.join(phones)} {' '.join(map(str, tones))}\n")
    with target.open("w", encoding="utf-8") as output:
        output.write(source.read_text(encoding="utf-8"))
        output.write("\n" + "".join(extra))
    return target


def spoken_span(audio, rate, np):
    """Measure the audible span from 10 ms RMS windows, including quiet edges."""
    hop = max(1, rate // 100)
    count = (len(audio) + hop - 1) // hop
    padded = np.pad(audio, (0, count * hop - len(audio)))
    energy = np.sqrt(np.mean(padded.reshape(count, hop) ** 2, axis=1))
    threshold = max(0.0006, float(energy.max()) * 0.02)
    active = np.flatnonzero(energy >= threshold)
    if not len(active):
        raise ValueError("Local voice synthesis returned no audible speech.")
    return max(0.0, active[0] * hop / rate - 0.015), min(len(audio) / rate, (active[-1] + 1) * hop / rate + 0.015)


def write_audio(output, audio, rate, np):
    if not len(audio) or not np.isfinite(audio).all():
        raise ValueError("Local voice synthesis returned invalid audio.")
    output.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix=f".{output.name}.", suffix=".tmp", dir=output.parent)
    os.close(fd)
    try:
        with wave.open(temporary, "wb") as target:
            target.setnchannels(1); target.setsampwidth(2); target.setframerate(rate)
            target.writeframes((np.clip(audio, -1, 1) * 32767).astype("<i2").tobytes())
        os.replace(temporary, output)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--runtime-dir", default=os.environ.get("CAPTURE_VOICE_DIR", ".capture/voice-runtime"))
    args = parser.parse_args()
    runtime = Path(args.runtime_dir).expanduser().resolve()
    request = json.loads(sys.stdin.read(2_000_001))
    if not isinstance(request, dict):
        raise ValueError("Voice request must be a JSON object.")
    voice = request.get("voice", "melo_india")
    items = request.get("items")
    if voice not in ("melo_india", "af_heart", "am_michael"):
        raise ValueError("Choose a supported English natural voice.")
    if not isinstance(items, list) or not 1 <= len(items) <= 24:
        raise ValueError("Supply between one and 24 narration items.")
    for item in items:
        if not isinstance(item, dict) or not isinstance(item.get("text"), str) or not item["text"].strip() or len(item["text"]) > 4000:
            raise ValueError("Each narration item needs nonempty text of at most 4000 characters.")
        if not isinstance(item.get("file"), str) or not Path(item["file"]).is_absolute() or Path(item["file"]).suffix.lower() != ".wav":
            raise ValueError("Each narration output must be an absolute WAV path.")
    os.environ["ONNX_PROVIDER"] = "CPUExecutionProvider"
    os.environ["HF_HUB_OFFLINE"] = "1"
    os.environ["TRANSFORMERS_OFFLINE"] = "1"
    with contextlib.redirect_stdout(sys.stderr), tempfile.TemporaryDirectory(prefix="capture-voice-") as work:
        import numpy as np
        results = []
        if voice == "melo_india":
            import sherpa_onnx
            model = runtime / "models/melo-en"
            spoken_texts = [melo_text(item["text"]) for item in items]
            lexicon = english_lexicon(model / "lexicon.txt", spoken_texts, Path(work) / "lexicon.txt")
            config = sherpa_onnx.OfflineTtsConfig(model=sherpa_onnx.OfflineTtsModelConfig(
                vits=sherpa_onnx.OfflineTtsVitsModelConfig(model=str(model / "model.onnx"), lexicon=str(lexicon), tokens=str(model / "tokens.txt")),
                num_threads=2, provider="cpu"), max_num_sentences=1)
            if not config.validate():
                raise ValueError("The Indian English model is incomplete. Run voice setup again.")
            tts = sherpa_onnx.OfflineTts(config)
        else:
            from kokoro_onnx import Kokoro
            tts = Kokoro(str(runtime / "models/kokoro-v1.0.onnx"), str(runtime / "models/voices-v1.0.bin"))
            if voice not in tts.voices.files or not tts.has_timings:
                raise ValueError("The installed voice pack is incomplete. Run voice setup again.")
        try:
            for index, item in enumerate(items):
                text = item["text"]
                if voice == "melo_india":
                    generated = tts.generate(spoken_texts[index], sid=2, speed=1.0)
                    audio, rate = np.asarray(generated.samples, dtype=np.float32), generated.sample_rate
                    phonemes, word_phonemes = [], []
                else:
                    audio, rate, timings = tts.create_timed(text, voice=voice, speed=1.0, lang="en-us", sentence_pause=0.25, clause_pause=0.1)
                    phonemes = [{"phoneme": timing.phoneme, "start": timing.start, "end": timing.end} for timing in timings]
                    word_phonemes = [tts.tokenizer.phonemize(word, lang="en-us") for word in text.split()]
                if not len(audio) or not np.isfinite(audio).all():
                    raise ValueError("Local voice synthesis returned invalid audio.")
                start, end = spoken_span(audio, rate, np)
                output = Path(item["file"])
                write_audio(output, audio, rate, np)
                results.append({"file": str(output), "sampleRate": rate, "duration": len(audio) / rate,
                    "phonemes": phonemes, "wordPhonemes": word_phonemes,
                    "spokenStart": float(start), "spokenEnd": float(end)})
        finally:
            if voice != "melo_india":
                tts.voices.close()
    print(json.dumps({"results": results}, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(f"Local voice synthesis failed: {error}", file=sys.stderr)
        sys.exit(1)
