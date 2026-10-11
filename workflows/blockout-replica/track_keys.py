"""Track a moving object in the source video (here: the wooden ceiling-fan blade sweeping right->left) and turn it into
rotation keyframes for the Blender grey-box, so the grey-box keeps the source's timing to the frame.
usage: python track_keys.py <source.mp4> <out fan_keys.json>
The colour range, band and hub position are those of the era-outfit case; adjust them for another video."""
import cv2, numpy as np, json, math, sys
src, out = sys.argv[1], sys.argv[2]
HUB, BAND, X0, X1 = (370, 20), (600, 760), 110, 710      # hub pixel, horizontal band the blade crosses, x range
cap = cv2.VideoCapture(src); rows = []; i = 0
while True:
    ok, f = cap.read()
    if not ok: break
    b = cv2.cvtColor(f, cv2.COLOR_BGR2HSV)[BAND[0]:BAND[1], X0:X1]
    m = ((b[..., 0] > 5) & (b[..., 0] < 22) & (b[..., 1] > 110) & (b[..., 2] > 110)).astype(np.uint8)
    cx = float((m.sum(0) * np.arange(m.shape[1])).sum() / max(m.sum(), 1)) + X0
    rows.append((i, i / 30, float(m.mean()), cx)); i += 1
# sweeps = runs where the blade covers the band; each sweep turns the fan by -120 deg (3 blades)
on = [r[2] > 0.05 for r in rows]; sweeps = []; k = 0
while k < len(rows):
    if on[k]:
        j = k
        while j < len(rows) and on[j]: j += 1
        if j - k > 10: sweeps.append((rows[k][1] - 0.1, rows[j - 1][1] + 0.1))
        k = j
    else: k += 1
keys = []
for n, (a, b) in enumerate(sweeps):
    keys.append([round(a * 30) + 1, -120 * n])
    for i, t, cov, cx in rows:
        if a < t < b and cov >= 0.2:
            th = math.degrees(math.atan2((BAND[0] + BAND[1]) / 2 - HUB[1] - 20, cx - HUB[0]))
            keys.append([i + 1, -(th - 25) - 120 * n])
    keys.append([round(b * 30) + 1, -120 * (n + 1)])
json.dump(keys, open(out, 'w'))
print('sweeps', [(round(a, 2), round(b, 2)) for a, b in sweeps], 'keys', len(keys))
