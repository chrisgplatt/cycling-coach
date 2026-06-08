/**
 * The app logo (white road bike on the brand-blue rounded square) with wheels
 * that spin. Each wheel's spokes live in a group that rotates around its own hub
 * via Tailwind's `animate-spin`; the rim and frame stay put so only the wheels
 * turn. Honours `prefers-reduced-motion` (wheels hold still). Reusable at any
 * `size` — large on the startup splash, small in place of page/modal spinners.
 */
interface AnimatedLogoProps {
  /** Rendered size in px. The badge is square; `bare` keeps this as the width. */
  size?: number
  /** Whether the wheels spin. Default true. */
  spin?: boolean
  /**
   * Drop the blue rounded-square background and frame the bike tightly. Use on
   * dark/coloured surfaces (e.g. the startup splash) where the square would be
   * invisible and its padding would push the bike off-centre.
   */
  bare?: boolean
  className?: string
}

// Tight viewBox around the bike art (the badge art lives low in the 28×28 box).
// The right wheel's tyre reaches x≈28.25 (cx 22 + r 5.5 + half its 1.5 stroke) and
// the left's to x≈0.25, so the box is widened a touch past 0–28 on both sides —
// otherwise the SVG root's default overflow clip shears the right tyre flat.
const ART = { x: -0.5, y: 9, w: 29, h: 17.5 }

/** A spinning wheel: three diameter spokes that rotate around the hub. */
function Spokes({ cx, cy, spin }: { cx: number; cy: number; spin: boolean }) {
  // Endpoints are hub ± (dx, dy) at r≈4.6, every 60°, so the group's bounding-box
  // centre is the hub — `transform-origin: center` then spins about the axle.
  const r = 4.6
  const sin60 = r * 0.866
  const cos60 = r * 0.5
  return (
    <g
      style={{ transformBox: 'fill-box', transformOrigin: 'center' }}
      className={spin ? 'animate-spin motion-reduce:animate-none' : ''}
    >
      <line x1={cx - r} y1={cy} x2={cx + r} y2={cy} stroke="white" strokeWidth="0.5" strokeLinecap="round" opacity="0.9" />
      <line x1={cx - cos60} y1={cy - sin60} x2={cx + cos60} y2={cy + sin60} stroke="white" strokeWidth="0.5" strokeLinecap="round" opacity="0.9" />
      <line x1={cx + cos60} y1={cy - sin60} x2={cx - cos60} y2={cy + sin60} stroke="white" strokeWidth="0.5" strokeLinecap="round" opacity="0.9" />
    </g>
  )
}

export default function AnimatedLogo({ size = 28, spin = true, bare = false, className }: AnimatedLogoProps) {
  return (
    <svg
      width={size}
      height={bare ? (size * ART.h) / ART.w : size}
      viewBox={bare ? `${ART.x} ${ART.y} ${ART.w} ${ART.h}` : '0 0 28 28'}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      role="img"
      aria-label="My Cycling Coach"
    >
      {!bare && <rect width="28" height="28" rx="6" fill="#2563EB" />}

      {/* In the badge the bike is scaled in slightly (about the square's centre) so
          both wheels clear the edges; bare mode crops tight and needs no inset. */}
      <g transform={bare ? undefined : 'translate(1.12 1.12) scale(0.92)'}>
        {/* Wheels — rim, spinning spokes, hub */}
        <circle cx="6.5" cy="20" r="5.5" stroke="white" strokeWidth="1.5" fill="none" />
        <Spokes cx={6.5} cy={20} spin={spin} />
        <circle cx="6.5" cy="20" r="1.1" fill="white" />

        <circle cx="22" cy="20" r="5.5" stroke="white" strokeWidth="1.5" fill="none" />
        <Spokes cx={22} cy={20} spin={spin} />
        <circle cx="22" cy="20" r="1.1" fill="white" />

        {/* Frame */}
        <line x1="6.5" y1="20" x2="14.5" y2="20" stroke="white" strokeWidth="1.4" strokeLinecap="round" />
        <line x1="14.5" y1="20" x2="12" y2="11.5" stroke="white" strokeWidth="1.4" strokeLinecap="round" />
        <line x1="12" y1="11.5" x2="6.5" y2="20" stroke="white" strokeWidth="1.4" strokeLinecap="round" />
        <line x1="12" y1="11.5" x2="12" y2="10" stroke="white" strokeWidth="1.4" strokeLinecap="round" />
        <line x1="10.5" y1="10" x2="13.5" y2="10" stroke="white" strokeWidth="1.5" strokeLinecap="round" />
        <line x1="12" y1="11.5" x2="20.5" y2="13" stroke="white" strokeWidth="1.4" strokeLinecap="round" />
        <line x1="20.5" y1="13" x2="21.5" y2="15.5" stroke="white" strokeWidth="2" strokeLinecap="round" />
        <line x1="21.5" y1="15.5" x2="14.5" y2="20" stroke="white" strokeWidth="1.4" strokeLinecap="round" />
        <line x1="21.5" y1="15.5" x2="22" y2="20" stroke="white" strokeWidth="1.4" strokeLinecap="round" />
        <line x1="20.5" y1="13" x2="21" y2="11" stroke="white" strokeWidth="1.4" strokeLinecap="round" />
        <line x1="19" y1="11" x2="23" y2="11" stroke="white" strokeWidth="1.3" strokeLinecap="round" />
        <path d="M23 11 Q23.5 11.3 23.5 13" stroke="white" strokeWidth="1.3" fill="none" strokeLinecap="round" />
      </g>
    </svg>
  )
}
