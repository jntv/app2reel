# Synthetic voice references

These two generic synthetic voices were created locally with Qwen3-TTS VoiceDesign. They do not contain a real person's recording. The requested voice descriptions, model revision, seed, transcript and exact WAV hashes are in `qwen-recipes.json`.

The app conditions its optional Qwen3-TTS Base model on these fixed references for every scene. It does not redesign the speaker for each sentence. "Indian English" describes the requested design; preview the actual voice to judge its accent and delivery.

The original Qwen3-TTS models and the pinned MLX community conversions declare Apache-2.0. Model weights are downloaded during explicit setup and are not included here. Source: https://huggingface.co/Qwen/Qwen3-TTS-12Hz-1.7B-VoiceDesign and https://huggingface.co/mlx-community/Qwen3-TTS-12Hz-1.7B-Base-4bit .
