"""Cut the arrowhead out of a render and write the brand textures.

Input: a render of the arrowhead on near-black (the crop from fletch-banner.jpg).
Output, in public/brand/: arrow-photo.png (RGBA), arrow-albedo.jpg, arrow-alpha.png,
arrow-normal.jpg, all 1024x1024 with the arrow's bounding box centred and 6% padding.

    python3 scripts/brand/cut-arrow.py path/to/arrow-render.png
"""
import sys
from PIL import Image, ImageDraw, ImageFilter, ImageChops

PAD = 0.06
OUT = 1024
NORMAL_STRENGTH = 2.2


def cut(path: str) -> None:
    im = Image.open(path).convert("RGB")
    brightest = ImageChops.lighter(ImageChops.lighter(im.getchannel("R"), im.getchannel("G")), im.getchannel("B"))
    # Everything reachable from the corner through near-black is background; the
    # flood fill keeps dark bark interior that a plain threshold would punch out.
    candidate = brightest.point(lambda v: 0 if v > 26 else 255)
    ImageDraw.floodfill(candidate, (0, 0), 128)
    alpha = candidate.point(lambda v: 0 if v == 128 else 255)
    alpha = alpha.filter(ImageFilter.MinFilter(3)).filter(ImageFilter.MaxFilter(3)).filter(ImageFilter.GaussianBlur(0.7))

    bbox = alpha.point(lambda v: 255 if v > 40 else 0).getbbox()
    x0, y0, x1, y1 = bbox
    side = max(x1 - x0, y1 - y0)
    canvas = int(round(side / (1 - 2 * PAD)))
    ox, oy = (canvas - (x1 - x0)) // 2, (canvas - (y1 - y0)) // 2

    def square(img: Image.Image, fill):
        out = Image.new(img.mode, (canvas, canvas), fill)
        out.paste(img.crop(bbox), (ox, oy))
        return out.resize((OUT, OUT), Image.LANCZOS)

    rgb = square(im, (0, 0, 0))
    a = square(alpha, 0)
    rgba = rgb.copy()
    rgba.putalpha(a)
    rgba.save("public/brand/arrow-photo.png", optimize=True)
    rgb.save("public/brand/arrow-albedo.jpg", quality=88, optimize=True)
    a.save("public/brand/arrow-alpha.png", optimize=True)

    # Relief from luminance, inside the alpha only so the crop edge leaves no seam.
    lum = Image.composite(rgb.convert("L"), Image.new("L", rgb.size, 0), a).filter(ImageFilter.GaussianBlur(1.1))
    sx = lum.filter(ImageFilter.Kernel((3, 3), [-1, 0, 1, -2, 0, 2, -1, 0, 1], scale=1, offset=128))
    sy = lum.filter(ImageFilter.Kernel((3, 3), [-1, -2, -1, 0, 0, 0, 1, 2, 1], scale=1, offset=128))
    r = sx.point(lambda v: max(0, min(255, int(128 - (v - 128) * NORMAL_STRENGTH))))
    g = sy.point(lambda v: max(0, min(255, int(128 + (v - 128) * NORMAL_STRENGTH))))
    normal = Image.merge("RGB", (r, g, Image.new("L", rgb.size, 255)))
    ImageDraw.Draw(normal).rectangle((0, 0, OUT - 1, OUT - 1), outline=(128, 128, 255), width=2)
    normal.save("public/brand/arrow-normal.jpg", quality=90, optimize=True)


if __name__ == "__main__":
    cut(sys.argv[1])
