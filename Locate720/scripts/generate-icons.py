"""
Generate all required app icon variants from the Locate720 company icon.
Source: locate720-icon.png (1254x1254)
Outputs:
  - icon.png (1024x1024) — main app icon
  - favicon.png (48x48) — web favicon
  - splash-icon.png (200x200) — splash screen icon
  - android-icon-foreground.png (432x432) — adaptive icon foreground
  - android-icon-background.png (432x432) — adaptive icon background
  - android-icon-monochrome.png (432x432) — adaptive icon monochrome
"""
from PIL import Image, ImageDraw
import os

SRC = os.path.join(os.path.dirname(__file__), "..", "assets", "images", "locate720-icon.png")
OUT = os.path.join(os.path.dirname(__file__), "..", "assets", "images")

# Brand colors
BG_COLOR = (11, 18, 32)  # #0B1220 — dark navy

def save(img, name, size=None, bg=None):
    path = os.path.join(OUT, name)
    if size:
        img = img.resize((size, size), Image.LANCZOS)
    if bg is not None:
        # Composite onto background
        canvas = Image.new("RGBA", img.size, bg + (255,))
        canvas.paste(img, (0, 0), img if img.mode == "RGBA" else None)
        img = canvas
    img.save(path, "PNG")
    print(f"  saved {name} ({img.size[0]}x{img.size[1]})")

print("Loading source icon...")
src = Image.open(SRC).convert("RGBA")
print(f"  source size: {src.size}")

# Main icon — 1024x1024
save(src, "icon.png", 1024)

# Favicon — 48x48
save(src, "favicon.png", 48)

# Splash icon — 200x200
save(src, "splash-icon.png", 200)

# Android adaptive icon foreground — 432x432 with padding (icon occupies ~66%)
# The foreground image should have the logo centered with transparent padding
fg_size = 432
fg = Image.new("RGBA", (fg_size, fg_size), (0, 0, 0, 0))
icon_size = int(fg_size * 0.62)  # ~268px
icon_resized = src.resize((icon_size, icon_size), Image.LANCZOS)
offset = ((fg_size - icon_size) // 2, (fg_size - icon_size) // 2)
fg.paste(icon_resized, offset, icon_resized)
fg.save(os.path.join(OUT, "android-icon-foreground.png"), "PNG")
print(f"  saved android-icon-foreground.png ({fg_size}x{fg_size})")

# Android adaptive icon background — solid color 432x432
bg_img = Image.new("RGBA", (fg_size, fg_size), BG_COLOR + (255,))
bg_img.save(os.path.join(OUT, "android-icon-background.png"), "PNG")
print(f"  saved android-icon-background.png ({fg_size}x{fg_size})")

# Android monochrome — white silhouette 432x432
mono = src.resize((icon_size, icon_size), Image.LANCZOS)
# Convert to monochrome: make all non-transparent pixels white
mono_data = mono.getdata()
new_data = []
for item in mono_data:
    if item[3] > 0:  # non-transparent
        new_data.append((255, 255, 255, 255))
    else:
        new_data.append((0, 0, 0, 0))
mono.putdata(new_data)
mono_canvas = Image.new("RGBA", (fg_size, fg_size), (0, 0, 0, 0))
mono_canvas.paste(mono, offset, mono)
mono_canvas.save(os.path.join(OUT, "android-icon-monochrome.png"), "PNG")
print(f"  saved android-icon-monochrome.png ({fg_size}x{fg_size})")

print("\nAll icons generated successfully!")
