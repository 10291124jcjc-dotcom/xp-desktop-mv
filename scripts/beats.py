"""Stage 1: beat grid fitted to kick-drum onsets. Writes analysis/beats.json + beats.png + beat_zoom.png.

librosa's beat tracker alone gave 147.8 BPM and drifted up to +/-50 ms against the kick,
so the grid is fitted directly to kick onsets on a half-beat lattice (kicks also land on 8ths).
"""
import json, subprocess
from pathlib import Path
import numpy as np
import librosa
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

ROOT = Path(__file__).resolve().parent.parent
WAV = ROOT / "analysis" / "audio.wav"
if not WAV.exists():
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(ROOT / "source.mp4"),
                    "-ac", "1", "-ar", "22050", str(WAV)], check=True)

y, sr = librosa.load(WAV, sr=22050)
dur = len(y) / sr
HOP = 128
S = np.abs(librosa.stft(y, n_fft=2048, hop_length=HOP))
freqs = librosa.fft_frequencies(sr=sr, n_fft=2048)
t_env = librosa.frames_to_time(np.arange(S.shape[1]), sr=sr, hop_length=HOP)

def band_env(lo, hi):
    band = S[(freqs >= lo) & (freqs < hi)].sum(axis=0)
    env = np.maximum(0, np.diff(np.log1p(band), prepend=0))
    return env / (env.max() + 1e-9)

kick = band_env(30, 150)
snare = band_env(1500, 5000)
hat = band_env(6000, 11000)

def onsets(env, delta):
    p = librosa.util.peak_pick(env, pre_max=20, post_max=20, pre_avg=40, post_avg=40, delta=delta, wait=25)
    return t_env[p]

kicks = onsets(kick, 0.12)

# 1) Coarse tempo guess from librosa, 2) grid search period+phase on half-beat lattice, 3) LSQ refine
tempo0 = float(np.atleast_1d(librosa.feature.tempo(y=y, sr=sr, hop_length=HOP))[0])
P0 = 60.0 / tempo0
best = None
for P in np.linspace(P0 * 0.98, P0 * 1.02, 401):
    for ph in np.linspace(0, P / 2, 40, endpoint=False):
        r = kicks - (ph + np.round((kicks - ph) / (P / 2)) * P / 2)
        sc = np.sum(np.exp(-(r / 0.015) ** 2))
        if best is None or sc > best[0]:
            best = (sc, P, ph)
_, P, ph = best
k = np.round((kicks - ph) / (P / 2))
inl = np.abs(kicks - (ph + k * P / 2)) < 0.03
half, ph = np.polyfit(k[inl], kicks[inl], 1)
period = 2 * half
residual_ms = (kicks[inl] - (ph + k[inl] * half)) * 1000

# Which half-lattice is the beat? The one where the snare also hits (backbeats are on beats, not 8ths).
def strength(env, t, w=3):
    i = np.clip(np.searchsorted(t_env, t), 0, len(env) - 1)
    return env[max(0, i - w): i + w + 1].max()

cands = []
for off in (0.0, half):
    g = ph + off + period * np.arange(-2, int(dur / period) + 3)
    g = g[(g >= -1e-6) & (g <= dur)]
    cands.append((np.mean([strength(snare, t) for t in g]) + np.mean([strength(kick, t) for t in g]), g))
grid = max(cands, key=lambda c: c[0])[1]

ks = np.array([strength(kick, t) for t in grid])
ss = np.array([strength(snare, t) for t in grid])
# Downbeat phase: kick-heavy on 1&3, snare-heavy on 2&4, and position 0 has the strongest kick of the bar
def phase_score(p):
    pos = (np.arange(len(grid)) - p) % 4
    return (ks[pos == 0].mean() + ks[pos == 2].mean() - ks[pos % 2 == 1].mean()
            + ss[pos % 2 == 1].mean() - ss[pos % 2 == 0].mean() + 0.5 * (ks[pos == 0].mean() - ks[pos == 2].mean()))
phase = int(np.argmax([phase_score(p) for p in range(4)]))

# Section changes: bar-level timbre/loudness novelty, keep the strongest few that are >=4 bars apart
bars = [t for i, t in enumerate(grid) if (i - phase) % 4 == 0]
mel = librosa.power_to_db(librosa.feature.melspectrogram(y=y, sr=sr, hop_length=512, n_mels=40))
t_mel = librosa.frames_to_time(np.arange(mel.shape[1]), sr=sr, hop_length=512)
bar_feat = []
for a, b in zip(bars, bars[1:] + [dur]):
    m = (t_mel >= a) & (t_mel < b)
    bar_feat.append(mel[:, m].mean(axis=1) if m.any() else mel[:, -1])
bar_feat = np.array(bar_feat)
nov = np.r_[0, np.linalg.norm(np.diff(bar_feat, axis=0), axis=1)]
order = np.argsort(-nov)
# Robust threshold (median + MAD) so one huge break doesn't hide the other changes
med = np.median(nov[1:]); mad = 1.4826 * np.median(np.abs(nov[1:] - med))
sections = []
for i in order:
    if nov[i] < med + 1.0 * mad:
        break
    if all(abs(i - j) >= 4 for j in sections):
        sections.append(int(i))
sections = sorted(round(float(bars[i]), 4) for i in sections)

beats = []
for i, t in enumerate(grid):
    pos = (i - phase) % 4
    beats.append({"i": i, "t": round(float(t), 4), "bar": (i - phase) // 4, "bar_pos": int(pos),
                  "downbeat": pos == 0, "strong": pos in (0, 2),
                  "kick": round(float(ks[i]), 3), "snare": round(float(ss[i]), 3)})

out = {
    "bpm": round(60.0 / period, 3),
    "period": round(float(period), 6),
    "duration": round(dur, 3),
    "method": "kick-onset lattice fit (librosa tracker drifted +/-50 ms)",
    "librosa_tempo_guess": round(tempo0, 2),
    "kick_residual_ms": {"median": round(float(np.median(residual_ms)), 2),
                         "p90_abs": round(float(np.percentile(np.abs(residual_ms), 90)), 2),
                         "n": int(inl.sum())},
    "downbeat_phase": phase,
    "bar_starts": [round(float(t), 4) for t in bars],
    "sections": sections,
    "beats": beats,
}
(ROOT / "analysis" / "beats.json").write_text(json.dumps(out, indent=1, ensure_ascii=False), encoding="utf-8")

# Overview plot
fig, axes = plt.subplots(3, 1, figsize=(20, 7), sharex=True)
times = np.arange(len(y)) / sr
axes[0].plot(times[::20], y[::20], lw=0.3, color="#d81b72"); axes[0].set_ylabel("wave")
axes[1].plot(t_env, kick, lw=0.5, color="k"); axes[1].set_ylabel("kick")
axes[2].plot(t_env, snare, lw=0.5, color="#888"); axes[2].set_ylabel("snare")
for ax in axes:
    for b in beats:
        ax.axvline(b["t"], color="#ff1f8a" if b["downbeat"] else "#ffc0dc", lw=1.4 if b["downbeat"] else 0.6)
    for s in sections:
        ax.axvline(s, color="#1a8a5a", lw=2.5, ls="--")
axes[0].set_title(f"{out['bpm']} BPM   kick residual median {out['kick_residual_ms']['median']} ms, "
                  f"90% within +/-{out['kick_residual_ms']['p90_abs']} ms   |  light pink=beat, hot pink=bar start, green dashed=section change")
axes[2].set_xticks(np.arange(0, dur + 1, 1)); axes[2].set_xlim(0, dur); axes[2].set_xlabel("seconds")
plt.tight_layout(); plt.savefig(ROOT / "analysis" / "beats.png", dpi=90); plt.close()

# Zoom plot: start / middle / end, proves no drift
g = np.array([b["t"] for b in beats]); down = {b["t"] for b in beats if b["downbeat"]}
fig, axes = plt.subplots(3, 1, figsize=(18, 7))
for ax, (lo, hi) in zip(axes, [(1, 5), (18.5, 22.5), (36.5, 40.77)]):
    m = (t_env >= lo) & (t_env <= hi)
    ax.plot(t_env[m], kick[m], color="k", lw=0.8, label="kick")
    ax.plot(t_env[m], -snare[m], color="#888", lw=0.8, label="snare (inverted)")
    for t in g[(g >= lo) & (g <= hi)]:
        ax.axvline(t, color="#ff1f8a" if t in down else "#ff9cc9", lw=1.6 if t in down else 0.9)
    ax.set_xlim(lo, hi); ax.set_ylim(-1.05, 1.05); ax.legend(loc="upper right", fontsize=8)
    ax.set_title(f"{lo}-{hi}s   grid lines should sit on the kick/snare attacks")
plt.tight_layout(); plt.savefig(ROOT / "analysis" / "beat_zoom.png", dpi=80); plt.close()

print(json.dumps({k: v for k, v in out.items() if k not in ("beats", "bar_starts")}, ensure_ascii=False))
print("bar starts:", out["bar_starts"])

