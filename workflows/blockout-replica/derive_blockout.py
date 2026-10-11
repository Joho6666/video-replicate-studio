"""Auto-derived grey-box (白模) from a source video: no 3D modelling.
person (RVM matte) -> flat light-grey figure with soft form shading; scene -> grey, flattened (posterized + smoothed) so only
structure, layout, camera motion and timing survive -- no colour, texture, face or identity of the original.
usage: python derive_blockout.py <frames_dir> <matte_dir> <n> <out_dir>"""
import cv2, numpy as np, os, sys
fd, md, n, od = sys.argv[1], sys.argv[2], int(sys.argv[3]), sys.argv[4]
os.makedirs(od, exist_ok=True)
for i in range(1, n + 1):
    f = cv2.imread(f'{fd}/{i:04d}.png')
    a = cv2.imread(f'{md}/{i:05d}.png', 0).astype(np.float32) / 255
    g = cv2.cvtColor(f, cv2.COLOR_BGR2GRAY)
    # scene: edge-preserving smoothing, then 6 grey levels in a mid range (no deep blacks/whites), light blur
    s = cv2.bilateralFilter(g, 9, 60, 9)
    s = (np.floor(s / 256 * 6) / 5 * 120 + 70).astype(np.float32)
    s = cv2.GaussianBlur(s, (0, 0), 2.0)
    e = cv2.Canny(cv2.GaussianBlur(g, (0, 0), 2.2), 40, 110).astype(np.float32) / 255
    s = s * (1 - 0.35 * cv2.GaussianBlur(e, (0, 0), 0.8))          # faint structure lines
    # person: light grey with very smooth shading (form only, no face/clothing detail)
    p = cv2.GaussianBlur(g.astype(np.float32), (0, 0), 6)
    p = 185 + (p - p[a > 0.5].mean() if (a > 0.5).any() else 0) * 0.25
    w = cv2.GaussianBlur(a, (0, 0), 1.0)
    out = np.clip(s * (1 - w) + p * w, 0, 255).astype(np.uint8)
    cv2.imwrite(f'{od}/{i:04d}.png', cv2.cvtColor(out, cv2.COLOR_GRAY2BGR))
print('derived', n)
