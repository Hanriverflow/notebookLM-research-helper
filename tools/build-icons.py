from pathlib import Path
import struct
import zlib
import math

ROOT = Path(__file__).resolve().parents[1] / "extension" / "icons"
ROOT.mkdir(parents=True, exist_ok=True)

def line_distance(x, y, a, b):
    dx, dy = b[0] - a[0], b[1] - a[1]
    t = max(0, min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / (dx * dx + dy * dy)))
    return math.hypot(x - a[0] - t * dx, y - a[1] - t * dy)

def chunk(name, data):
    return struct.pack('!I', len(data)) + name + data + struct.pack('!I', zlib.crc32(name + data) & 0xffffffff)

outline = [(30, 28), (98, 28), (98, 82), (64, 106), (30, 82), (30, 28)]
chevron = [(49, 58), (64, 73), (79, 58)]
for size in (16, 32, 48, 128):
    rows = bytearray()
    for py in range(size):
        rows.append(0)
        for px in range(size):
            colors = []
            for sy in range(4):
                for sx in range(4):
                    x, y = (px + (sx + .5) / 4) * 128 / size, (py + (sy + .5) / 4) * 128 / size
                    inside = math.hypot(max(abs(x - 64) - 39, 0), max(abs(y - 64) - 39, 0)) <= 23
                    stroke = min(line_distance(x, y, a, b) for path in (outline, chevron) for a, b in zip(path, path[1:])) < 3.5
                    colors.append((230, 239, 184, 255) if stroke and inside else (39, 91, 67, 255) if inside else (0, 0, 0, 0))
            rows.extend(round(sum(c[i] for c in colors) / 16) for i in range(4))
    png = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('!2I5B', size, size, 8, 6, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(rows)) + chunk(b'IEND', b'')
    (ROOT / f'{size}.png').write_bytes(png)
print('Generated extension icons: 16, 32, 48, 128 px')
