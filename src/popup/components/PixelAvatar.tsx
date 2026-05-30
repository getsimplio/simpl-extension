// src/popup/components/PixelAvatar.tsx
// Deterministic 5×5 mirrored pixel avatar generated from an address or string seed.

export type PixelAvatarVariant = "signer" | "watch" | "selected";

type PixelAvatarProps = {
  seed: string;
  size?: number;
  label?: string;
  variant?: PixelAvatarVariant;
};

// FNV-1a 32-bit hash — fast, well-distributed, no dependencies.
function fnv32a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h * 0x01000193) & 0xffffffff;
  }
  return h >>> 0;
}

// Build a 5×5 boolean grid mirrored horizontally.
// Only the left 3 columns are unique; column 3 mirrors column 1, column 4 mirrors column 0.
function buildGrid(seed: string): boolean[][] {
  const h = fnv32a(seed);
  return Array.from({ length: 5 }, (_, row) => {
    const c0 = Boolean((h >> (row * 3 + 4)) & 1);
    const c1 = Boolean((h >> (row * 3 + 5)) & 1);
    const c2 = Boolean((h >> (row * 3 + 6)) & 1);
    return [c0, c1, c2, c1, c0]; // symmetry
  });
}

// Derive a foreground and background color pair from the seed.
// Keeps saturation and lightness in a comfortable range for readability.
function deriveColors(seed: string): { fg: string; bg: string } {
  const h = fnv32a(seed);
  const hue = h % 360;
  const sat = 38 + ((h >> 8) % 24); // 38–61 %
  const lig = 32 + ((h >> 16) % 16); // 32–47 %
  return {
    fg: `hsl(${hue}, ${sat}%, ${lig}%)`,
    bg: `hsl(${hue}, ${Math.max(10, Math.round(sat * 0.35))}%, 93%)`,
  };
}

export function PixelAvatar({
  seed,
  size = 38,
  label,
  variant,
}: PixelAvatarProps) {
  const grid = buildGrid(seed);
  const { fg, bg } = deriveColors(seed);
  const ariaLabel = label ? `${label} avatar` : `Avatar for ${seed.slice(0, 8)}`;
  const padding = Math.round(size * 0.13);
  const gap = Math.max(1, Math.round(size * 0.04));

  return (
    <div
      className={`pixel-avatar${variant ? ` pixel-avatar--${variant}` : ""}`}
      role="img"
      aria-label={ariaLabel}
      title={ariaLabel}
      style={{ width: size, height: size, minWidth: size, background: bg }}
    >
      <div
        className="pixel-avatar-grid"
        style={{ padding, gap }}
      >
        {grid.flat().map((on, i) => (
          <div
            key={i}
            className="pixel-avatar-cell"
            style={on ? { background: fg } : undefined}
          />
        ))}
      </div>
    </div>
  );
}

export default PixelAvatar;
