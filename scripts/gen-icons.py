from PIL import Image
import os

src = os.path.join(os.path.dirname(__file__), '..', 'assets', 'logo.jpeg')
out_dir = os.path.join(os.path.dirname(__file__), '..', 'assets')

sizes = {
    'icon-192.png': 192,
    'icon-512.png': 512,
}

img = Image.open(src).convert('RGBA')

# Make background transparent (use logo bg or white)
# If the logo has no transparency, create a circular crop
size = min(img.size)
mask = Image.new('L', (size, size), 0)
from PIL import ImageDraw
draw = ImageDraw.Draw(mask)
draw.ellipse((0, 0, size, size), fill=255)

for name, sz in sizes.items():
    resized = img.resize((sz, sz), Image.LANCZOS)
    # If we need circular, use mask
    out = Image.new('RGBA', (sz, sz), (0, 0, 0, 0))
    mask_resized = mask.resize((sz, sz), Image.LANCZOS)
    out.paste(resized, (0, 0), mask_resized)
    out.save(os.path.join(out_dir, name), 'PNG')
    print(f'Created {name} ({sz}x{sz})')
