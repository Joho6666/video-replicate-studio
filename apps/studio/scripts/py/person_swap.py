#!/usr/bin/env python
"""Image-heavy steps of the person-swap composite (OpenCV + numpy + onnxruntime). Driven by lib/swap-compose.mjs.

  matte   <frames_dir> <pattern> <n> <out_dir> [--model rvm.onnx] [--ratio 0.4]
          Robust Video Matting over numbered frames -> 8-bit alpha PNGs 00001.png ... (recurrent state carried across frames)
  compose <orig_dir> <swap_dir> <matte_new_dir> <matte_old_dir> <out_dir> <n> [--grow 7] [--feather 5] [--relight]
          The swapped person is pasted onto the ORIGINAL frames: the area is the union of the new and the old person's
          matte (so no ghost of the old person), colours of the swapped frame are fitted to the original on background
          pixels only, and every pixel outside that area is the original's own pixel. With --relight (off by default: judged
          worse than the plain composite on the first real clip) the new person also gets the original person's low-frequency lighting.
  finish  <composed_dir> <upscaled_dir|-> <out_dir> <n> --width W --height H [--mix 0.6] [--grain 2.6]
          Optional: blends the AI-upscaled frames with a plain Lanczos upscale, resizes to the target size, adds grain.
Frames are named 0001.png (orig / swap) and 00001.png (mattes, composed, finished) -- see FILES below.
"""
import argparse, os, shutil, sys
import cv2
import numpy as np

# FILES: orig/swap frames are %04d.png (1-based); matte, composed and finished frames are %05d.png


def _fit_channels(s, o, exclude):
    """Per-channel gain/offset taking s to o, fitted on pixels outside `exclude` (0..1), robust to leftovers."""
    ss = cv2.resize(s, (180, 320)).reshape(-1, 3).astype(np.float32)
    oo = cv2.resize(o, (180, 320)).reshape(-1, 3).astype(np.float32)
    keep = cv2.resize(exclude, (180, 320)).ravel() < 0.02
    out = np.zeros(s.shape, np.float32)
    if keep.sum() < 200:                       # almost no background left: leave the colours alone
        return s.astype(np.float32)
    for c in range(3):
        w = keep.astype(np.float32)
        g, off = 1.0, 0.0
        for _ in range(3):
            A = np.stack([ss[:, c], np.ones(len(ss), np.float32)], 1) * w[:, None]
            g, off = np.linalg.lstsq(A, oo[:, c] * w, rcond=None)[0]
            r = np.abs(g * ss[:, c] + off - oo[:, c])
            w = (keep & (r < max(5.0, float(np.median(r[keep])) * 3))).astype(np.float32)
        out[..., c] = g * s[..., c].astype(np.float32) + off
    return np.clip(out, 0, 255)


def _lab(x):
    return cv2.cvtColor(x, cv2.COLOR_BGR2LAB).astype(np.float32)


def _masked_blur(x, m, sigma):
    num = cv2.GaussianBlur(x * m, (0, 0), sigma)
    den = cv2.GaussianBlur(m, (0, 0), sigma)
    return num / np.maximum(den, 1e-3)


def relight(o, comp, a_new, a_old, shade=0.7, exposure=0.15, soften=0.7, grain=1.8, sigma=22, seed=1):
    """Make the pasted person look lit by the scene: the poses of the old and the new person match, so the low-frequency
    shading (light side / shadow side) of the ORIGINAL person is transferred to the new one (luminance only: no chroma
    shift, which turned skin green), then a little softness and grain like the footage. Only touches the new person."""
    pn = (a_new > 0.5).astype(np.float32)
    po = (a_old > 0.5).astype(np.float32)
    if pn.sum() < 500 or po.sum() < 500:
        return comp
    Lc, Lo = _lab(comp), _lab(o)
    lo_lp = _masked_blur(Lo[..., 0], po, sigma)
    lo_mean = float((Lo[..., 0] * po).sum() / po.sum())
    nw_lp = _masked_blur(Lc[..., 0], pn, sigma)
    nw_mean = float((Lc[..., 0] * pn).sum() / pn.sum())
    lo_lp = np.where(po > 0, lo_lp, _masked_blur(Lo[..., 0], po, sigma * 2.5))      # under the new silhouette where the old one is absent
    ratio = np.clip((lo_lp / max(lo_mean, 1.0)) / (np.maximum(nw_lp, 1.0) / max(nw_mean, 1.0)), 0.7, 1.35) ** shade
    out = Lc.copy()
    out[..., 0] = np.where(pn > 0, Lc[..., 0] * ratio + (lo_mean - nw_mean) * exposure, Lc[..., 0])
    res = cv2.cvtColor(np.clip(out, 0, 255).astype(np.uint8), cv2.COLOR_LAB2BGR).astype(np.float32)
    if soften > 0:
        res = cv2.GaussianBlur(res, (0, 0), soften)
    if grain > 0:
        res = res + np.random.default_rng(seed).normal(0, grain, res.shape[:2]).astype(np.float32)[..., None]
    w = cv2.GaussianBlur(pn, (0, 0), 1.5)[..., None]
    return np.clip(comp.astype(np.float32) * (1 - w) + res * w, 0, 255).astype(np.uint8)


def compose_frame(o, s, a_new, a_old, grow=7, feather=5, light=False):
    """o, s: BGR uint8 same size; a_new, a_old: float 0..1 mattes. Returns BGR uint8."""
    if s.shape != o.shape:
        s = cv2.resize(s, (o.shape[1], o.shape[0]))
    union = np.maximum(a_new, a_old)
    sa = _fit_channels(s, o, cv2.dilate(union, np.ones((9, 9), np.uint8)))
    area = cv2.dilate((union > 0.02).astype(np.uint8) * 255, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * grow + 1, 2 * grow + 1)))
    area = cv2.GaussianBlur(area, (0, 0), feather).astype(np.float32) / 255
    area = np.maximum(area, union)             # never less than the matte itself
    comp = np.clip(sa * area[..., None] + o.astype(np.float32) * (1 - area[..., None]), 0, 255).astype(np.uint8)
    return relight(o, comp, a_new, a_old) if light else comp


def cmd_compose(a):
    shutil.rmtree(a.out_dir, ignore_errors=True)
    os.makedirs(a.out_dir)
    for i in range(1, a.n + 1):
        o = cv2.imread(f'{a.orig_dir}/{i:04d}.png')
        s = cv2.imread(f'{a.swap_dir}/{i:04d}.png')
        an = cv2.imread(f'{a.matte_new_dir}/{i:05d}.png', 0).astype(np.float32) / 255
        ao = cv2.imread(f'{a.matte_old_dir}/{i:05d}.png', 0).astype(np.float32) / 255
        cv2.imwrite(f'{a.out_dir}/{i:05d}.png', compose_frame(o, s, an, ao, a.grow, a.feather, light=a.relight))
    print(f'composed {a.n}')


def cmd_matte(a):
    import onnxruntime as ort
    os.makedirs(a.out_dir, exist_ok=True)
    sess = ort.InferenceSession(a.model, providers=['CPUExecutionProvider'])
    rec = [np.zeros((1, 1, 1, 1), np.float32) for _ in range(4)]
    ratio = np.array([a.ratio], np.float32)
    for i in range(1, a.n + 1):
        im = cv2.imread(os.path.join(a.frames_dir, a.pattern % i))
        src = (cv2.cvtColor(im, cv2.COLOR_BGR2RGB).astype(np.float32) / 255).transpose(2, 0, 1)[None]
        _fgr, pha, *rec = sess.run(None, {'src': src, 'r1i': rec[0], 'r2i': rec[1], 'r3i': rec[2], 'r4i': rec[3], 'downsample_ratio': ratio})
        cv2.imwrite(os.path.join(a.out_dir, f'{i:05d}.png'), (pha[0, 0] * 255).astype(np.uint8))
    print(f'matted {a.n}')


def cmd_finish(a):
    shutil.rmtree(a.out_dir, ignore_errors=True)
    os.makedirs(a.out_dir)
    rng = np.random.default_rng(3)
    for i in range(1, a.n + 1):
        base = cv2.imread(f'{a.composed_dir}/{i:05d}.png')
        if a.upscaled_dir != '-':
            up = cv2.imread(f'{a.upscaled_dir}/{i:05d}.png')
            lan = cv2.resize(base, (up.shape[1], up.shape[0]), interpolation=cv2.INTER_LANCZOS4)
            m = a.mix * up.astype(np.float32) + (1 - a.mix) * lan.astype(np.float32)
        else:
            m = base.astype(np.float32)
        m = cv2.resize(m, (a.width, a.height), interpolation=cv2.INTER_AREA if m.shape[1] >= a.width else cv2.INTER_LANCZOS4)
        if a.grain > 0:
            m = m + rng.normal(0, a.grain, m.shape[:2]).astype(np.float32)[..., None]
        cv2.imwrite(f'{a.out_dir}/{i:05d}.png', np.clip(m, 0, 255).astype(np.uint8))
    print(f'finished {a.n}')


def main(argv):
    p = argparse.ArgumentParser()
    sub = p.add_subparsers(dest='cmd', required=True)
    m = sub.add_parser('matte'); m.add_argument('frames_dir'); m.add_argument('pattern'); m.add_argument('n', type=int); m.add_argument('out_dir')
    m.add_argument('--model', required=True); m.add_argument('--ratio', type=float, default=0.4); m.set_defaults(fn=cmd_matte)
    c = sub.add_parser('compose')
    for k in ('orig_dir', 'swap_dir', 'matte_new_dir', 'matte_old_dir', 'out_dir'): c.add_argument(k)
    c.add_argument('n', type=int); c.add_argument('--grow', type=int, default=7); c.add_argument('--feather', type=float, default=5); c.add_argument('--relight', action='store_true'); c.set_defaults(fn=cmd_compose)
    f = sub.add_parser('finish')
    for k in ('composed_dir', 'upscaled_dir', 'out_dir'): f.add_argument(k)
    f.add_argument('n', type=int); f.add_argument('--width', type=int, required=True); f.add_argument('--height', type=int, required=True)
    f.add_argument('--mix', type=float, default=0.6); f.add_argument('--grain', type=float, default=2.6); f.set_defaults(fn=cmd_finish)
    a = p.parse_args(argv)
    a.fn(a)


if __name__ == '__main__':
    main(sys.argv[1:])
