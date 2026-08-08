import { clsx } from 'clsx';

/* cyrb53 - 53-bit string hash */
const hashString = (str: string, seed = 0) => {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
};

/* mulberry32 — tiny seeded PRNG */
const mulberry32 = (a: number) => () => {
  a |= 0;
  a = (a + 0x6d2b79f5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

export type SpaghettiVariant = 'underline' | 'divider';

const DIMS = {
  // amp / pad reproduce the original hand-tuned curve family; everything
  // else (count, placement, endpoint heights, bend directions) is seeded.
  // sw: the divider renders at 4px (non-scaling stroke); the underline
  // stroke scales with its viewBox, so it needs more units to read equally
  underline: {
    width: 800,
    height: 72,
    amp: 10,
    pad: 28,
    inset: 6,
    sw: 7,
    minU: 6,
    maxU: 10,
  },
  divider: {
    width: 600,
    height: 24,
    amp: 8,
    pad: 10,
    inset: 8,
    sw: 4,
    minU: 4,
    maxU: 9,
  },
} as const;

type Noodle = { d: string; sw: string };

/**
 * The generator: a wave of hump-shaped undulations, each a single cubic
 * segment from one mid-line point to the next via a peak at ±amp. The
 * mid-line drifts from the start point to the end point, both of which
 * may sit anywhere along the svg's height. The first and last bends are
 * rolled independently (up or down); since bend direction alternates per
 * undulation, the undulation count's parity is chosen to satisfy both.
 * Only placement, count, and endpoints come from the seed — curve shape,
 * amplitude, and thickness are fixed.
 */
function generateNoodle(seedStr: string, variant: SpaghettiVariant): Noodle {
  const rand = mulberry32(hashString(seedStr));
  const { width, height, amp, pad, inset, sw, minU, maxU } = DIMS[variant];

  // start/end anywhere along the svg height (pad keeps peaks in-bounds)
  const startY = pad + rand() * (height - 2 * pad);
  const endY = pad + rand() * (height - 2 * pad);

  // first & last bends are independent: dir alternates per undulation, so
  // pick a count whose parity makes the final bend match the roll
  const dir0 = rand() < 0.5 ? 1 : -1; // 1 = bend up
  const dirN = rand() < 0.5 ? 1 : -1;
  const wantOdd = dir0 === dirN ? 1 : 0; // dir_{N-1} = dir0 · (-1)^(N-1)
  let undulations = minU + Math.floor(rand() * (maxU - minU + 1));
  if (undulations % 2 !== wantOdd) {
    undulations = undulations + 1 <= maxU ? undulations + 1 : undulations - 1;
  }

  // jitter each undulation's width (loose spacing), then re-normalize so
  // the wave spans exactly [inset, width - inset] — the inset keeps the
  // round caps clear of the svg's clipping edge
  const span = width - 2 * inset;
  const mean = span / undulations;
  const segs = Array.from({ length: undulations }, () => mean * (0.6 + rand() * 0.8));
  const scale = span / segs.reduce((a, b) => a + b, 0);

  let d = `M${inset} ${startY.toFixed(1)}`;
  let x = inset;
  for (let i = 0; i < undulations; i++) {
    const w = segs[i] * scale;
    const r0 = startY + ((endY - startY) * i) / undulations;
    const r1 = startY + ((endY - startY) * (i + 1)) / undulations;
    const peak = (r0 + r1) / 2 - (i % 2 === 0 ? dir0 : -dir0) * amp;
    d += ` C${(x + w / 3).toFixed(1)} ${peak.toFixed(1)} ${(x + (2 * w) / 3).toFixed(
      1,
    )} ${peak.toFixed(1)} ${(x + w).toFixed(1)} ${r1.toFixed(1)}`;
    x += w;
  }

  return { d, sw: sw.toFixed(1) };
}

type Props = {
  seed: string;
  variant: SpaghettiVariant;
  className?: string;
};

export const Spaghetti = ({ seed, variant, className }: Props) => {
  const { d, sw } = generateNoodle(seed, variant);
  const { width, height } = DIMS[variant];

  if (variant === 'underline') {
    // wrapper span carries the aspect ratio and contributes zero intrinsic
    // width, so the link shrink-fits to the TEXT at every breakpoint; the
    // svg fills the wrapper exactly (an inline svg alone would impose its
    // 300px default intrinsic width on the link at small sizes)
    return (
      <span
        aria-hidden="true"
        className={clsx(
          'pointer-events-none relative -mt-2 block aspect-[800/72] w-full',
          className,
        )}
      >
        <svg viewBox={`0 0 ${width} ${height}`} className="absolute inset-0 block h-full w-full">
          <path className="spaghetti-noodle" d={d} strokeWidth={sw} />
        </svg>
      </span>
    );
  }

  return (
    <svg
      aria-hidden="true"
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      className={clsx('mx-auto mt-8 w-[calc(100%-3rem)] max-w-3xl', className)}
    >
      <path className="spaghetti-noodle" vectorEffect="non-scaling-stroke" d={d} strokeWidth={sw} />
    </svg>
  );
};
