"""Converts the background music loop for the game.

Trims leading/trailing silence (so the loop doesn't hiccup), levels the peak,
and writes a stereo 128k MP3 to assets/sounds/music-loop.mp3. Uses Blender's
bundled aud library.

Run (from the repo root):
  "C:/Program Files/Blender Foundation/Blender 5.2/blender.exe" -b --factory-startup \
      -P tools/blender/convert_music.py -- "C:/Users/brian/Downloads/Game Loop.mp3"
"""
import aud, os, sys
import numpy as np

SRC = sys.argv[sys.argv.index("--") + 1]
REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
OUT = os.path.join(REPO, "assets", "sounds", "music-loop.mp3")

snd = aud.Sound(SRC)
rate = int(snd.specs[0])
data = snd.data()
if data.ndim == 1:
    data = data.reshape(-1, 1)
if data.shape[1] == 1:
    data = np.repeat(data, 2, axis=1)
data = data[:, :2]
print(f"MUSIC source {len(data) / rate:.1f}s at {rate} Hz, peak {np.abs(data).max():.3f}")
env = np.abs(data).max(axis=1)
idx = np.nonzero(env > 0.002)[0]
clip = data[idx[0]: idx[-1] + 1].astype(np.float32)
clip *= 0.85 / max(1e-6, np.abs(clip).max())
buf = aud.Sound.buffer(np.ascontiguousarray(clip), rate)
buf.write(OUT, rate=44100, channels=aud.CHANNELS_STEREO,
          container=aud.CONTAINER_MP3, codec=aud.CODEC_MP3, bitrate=128000)
print(f"MUSIC wrote {len(clip) / rate:.1f}s (trimmed {idx[0] / rate:.3f}s lead, {(len(data) - idx[-1] - 1) / rate:.3f}s tail)")
print("MUSIC_OK")
