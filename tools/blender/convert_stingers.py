"""Converts the card stinger clips (Pixabay, free license) for the game.

Trims leading/trailing silence, levels each clip to the same peak, and writes
a stereo 128k MP3 into assets/sounds/. Uses Blender's bundled aud library.

Run (from the repo root):
  "C:/Program Files/Blender Foundation/Blender 5.2/blender.exe" -b --factory-startup \
      -P tools/blender/convert_stingers.py -- "C:/Users/brian/Downloads"
"""
import aud, os, sys
import numpy as np

SRC = sys.argv[sys.argv.index("--") + 1]
REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
OUT = os.path.join(REPO, "assets", "sounds")

CLIPS = {
    "stinger-no-dice": "universfield-fail-trombone-229173.mp3",
    "stinger-must-bust": "cartoon_music-cartoon-game-upgrade-494470.mp3",
    "stinger-vengeance": "floraphonic-marimba-win-d-2-209683.mp3",
}
PEAK = 0.8  # common peak level so the three clips sit at the same loudness

for out_name, src_name in CLIPS.items():
    snd = aud.Sound(os.path.join(SRC, src_name))
    rate = int(snd.specs[0])
    data = snd.data()
    if data.ndim == 1:
        data = data.reshape(-1, 1)
    if data.shape[1] == 1:
        data = np.repeat(data, 2, axis=1)
    data = data[:, :2]
    env = np.abs(data).max(axis=1)
    idx = np.nonzero(env > env.max() * 0.01)[0]
    start = max(0, idx[0] - int(rate * 0.005))
    end = min(len(data), idx[-1] + int(rate * 0.05))
    clip = data[start:end].astype(np.float32)
    clip *= PEAK / max(1e-6, np.abs(clip).max())
    # Short fade-out so the trimmed tail never clicks.
    fade = min(len(clip), int(rate * 0.03))
    clip[-fade:] *= np.linspace(1, 0, fade, dtype=np.float32).reshape(-1, 1)
    buf = aud.Sound.buffer(np.ascontiguousarray(clip), rate)
    buf.write(os.path.join(OUT, out_name + ".mp3"), rate=44100, channels=aud.CHANNELS_STEREO,
              container=aud.CONTAINER_MP3, codec=aud.CODEC_MP3, bitrate=128000)
    print(f"STINGER {out_name:20s} {len(clip) / rate:.2f}s (trimmed {start / rate:.2f}s lead)")
print("STINGERS_OK")
