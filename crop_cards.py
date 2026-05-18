"""
Crop the 5 Coup character cards out of the source photo into clean PNGs.

Source layout (500x463):
  Top row:    Duke (left)   | Assassin (middle) | Ambassador (right)
  Bottom row: Captain (left, larger) | Contessa (right, larger)

Cards in the source are at slight angles. We use perspective transform to
extract clean upright rectangles for each card.
"""
from PIL import Image

SRC = "cards-source.png.webp"
OUT_W, OUT_H = 400, 560  # target card size (5:7 aspect, like real playing cards)

# 4 corners per card in the source image (top-left, top-right, bottom-right, bottom-left).
# Identified by inspection of the 500x463 source.
CARDS = {
    "duke":       [( 14,  10), (158,  12), (160, 222), ( 12, 220)],
    "assassin":   [(180,  12), (322,  10), (326, 220), (182, 222)],
    "ambassador": [(345,  10), (492,  14), (490, 220), (346, 220)],
    "captain":    [( 64, 234), (262, 234), (268, 460), ( 60, 458)],
    "contessa":   [(272, 234), (478, 238), (482, 462), (266, 460)],
}


def perspective_coeffs(src_corners, dst_size):
    """Return PIL perspective transform coefficients that map dst rect -> src quad."""
    w, h = dst_size
    dst_corners = [(0, 0), (w, 0), (w, h), (0, h)]
    # PIL needs the inverse mapping: for each (x,y) in dst, where to sample from src.
    # Solve 8 equations for 8 unknowns.
    import numpy as np
    A = []
    B = []
    for (xd, yd), (xs, ys) in zip(dst_corners, src_corners):
        A.append([xd, yd, 1, 0, 0, 0, -xs * xd, -xs * yd])
        A.append([0, 0, 0, xd, yd, 1, -ys * xd, -ys * yd])
        B.append(xs)
        B.append(ys)
    A = np.array(A, dtype=float)
    B = np.array(B, dtype=float)
    res = np.linalg.solve(A, B)
    return tuple(res)


def main():
    img = Image.open(SRC).convert("RGBA")
    for name, corners in CARDS.items():
        coeffs = perspective_coeffs(corners, (OUT_W, OUT_H))
        out = img.transform(
            (OUT_W, OUT_H),
            Image.PERSPECTIVE,
            coeffs,
            Image.BICUBIC,
        )
        out_path = f"cards/{name}.png"
        out.save(out_path, "PNG")
        print(f"wrote {out_path}")


if __name__ == "__main__":
    import os
    os.makedirs("cards", exist_ok=True)
    main()
