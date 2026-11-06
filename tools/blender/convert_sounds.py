"""Converts the Kenney Casino Audio pack (CC0) to MP3 for the game.

Ogg isn't reliably playable in Safari (iPhone/iPad), so everything ships as
MP3. Uses Blender's bundled audio library (aud), so no ffmpeg install needed.

Run (from the repo root):
  "C:/Program Files/Blender Foundation/Blender 5.2/blender.exe" -b --factory-startup \
      -P tools/blender/convert_sounds.py -- "C:/Users/brian/Downloads/kenney_casino-audio/Audio"

Also prints each clip's length and the times of its distinct hits (transients),
which is what the game uses to line samples up with physics impacts.
"""
import aud, os, sys, json
import numpy as np

SRC = sys.argv[sys.argv.index("--") + 1]
REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
OUT = os.path.join(REPO, "assets", "sounds")
os.makedirs(OUT, exist_ok=True)

info = {}
for name in sorted(os.listdir(SRC)):
    if not name.endswith(".ogg"):
        continue
    stem = name[:-4]
    snd = aud.Sound(os.path.join(SRC, name))
    data = snd.data()                       # (samples, channels) float32
    rate = snd.specs[0]
    mono = data.mean(axis=1) if data.ndim == 2 else data
    # Trim leading/trailing near-silence so playback is tight to the event.
    env = np.abs(mono)
    thr = env.max() * 0.02
    idx = np.nonzero(env > thr)[0]
    start = max(0, idx[0] - int(rate * 0.004))
    end = min(len(mono), idx[-1] + int(rate * 0.03))
    clip = mono[start:end]
    # Onsets: 10 ms RMS frames; a frame that jumps well above the recent
    # level counts as a new hit.
    hop = int(rate * 0.01)
    rms = np.array([np.sqrt(np.mean(clip[i:i + hop] ** 2)) for i in range(0, len(clip) - hop, hop)])
    onsets, floor = [], 0.0
    for i, r in enumerate(rms):
        if r > 0.25 * rms.max() and r > floor * 2.2:
            if not onsets or i - onsets[-1][0] > 4:
                onsets.append((i, float(r / rms.max())))
        floor = max(floor * 0.85, r)
    info[stem] = {
        "dur": round(len(clip) / rate, 3),
        "hits": [[round(i * 0.01, 3), round(s, 2)] for i, s in onsets],
    }
    trimmed = aud.Sound.buffer(clip.reshape(-1, 1).astype(np.float32), rate)
    trimmed.write(os.path.join(OUT, stem + ".mp3"), rate=44100, channels=aud.CHANNELS_MONO,
                  container=aud.CONTAINER_MP3, codec=aud.CODEC_MP3, bitrate=96000)

with open(os.path.join(OUT, "sounds.json"), "w") as f:
    json.dump(info, f, indent=1)
for k, v in info.items():
    print(f"SND {k:24s} {v['dur']:.2f}s hits={v['hits']}")
print("CONVERT_OK", len(info))
