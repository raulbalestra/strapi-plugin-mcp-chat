/**
 * Logos dos stacks de frontend suportados pela provisão (Next.js + TanStack Start).
 * SVG inline (sem assets externos) para não depender do bundler/CSP.
 */

const NextLogo = ({ size = 28 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 180 180" fill="none" xmlns="http://www.w3.org/2000/svg" aria-label="Next.js">
    <mask id="nextmask" style={{ maskType: 'alpha' }} maskUnits="userSpaceOnUse" x="0" y="0" width="180" height="180">
      <circle cx="90" cy="90" r="90" fill="black" />
    </mask>
    <g mask="url(#nextmask)">
      <circle cx="90" cy="90" r="90" fill="black" />
      <path d="M149.508 157.52 69.142 54H54v71.97h12.114V69.384l73.885 95.461a90.304 90.304 0 0 0 9.509-7.325Z" fill="url(#nextfill0)" />
      <rect x="115" y="54" width="12" height="72" fill="url(#nextfill1)" />
    </g>
    <defs>
      <linearGradient id="nextfill0" x1="109" y1="116.5" x2="144.5" y2="160.5" gradientUnits="userSpaceOnUse">
        <stop stopColor="white" />
        <stop offset="1" stopColor="white" stopOpacity="0" />
      </linearGradient>
      <linearGradient id="nextfill1" x1="121" y1="54" x2="120.799" y2="106.875" gradientUnits="userSpaceOnUse">
        <stop stopColor="white" />
        <stop offset="1" stopColor="white" stopOpacity="0" />
      </linearGradient>
    </defs>
  </svg>
);

const TanStackLogo = ({ size = 28 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" aria-label="TanStack">
    <defs>
      <linearGradient id="tsgrad" x1="0" y1="0" x2="64" y2="64" gradientUnits="userSpaceOnUse">
        <stop stopColor="#6BDAFF" />
        <stop offset="0.5" stopColor="#F9FFB5" />
        <stop offset="1" stopColor="#FFA770" />
      </linearGradient>
    </defs>
    <circle cx="32" cy="32" r="30" fill="url(#tsgrad)" stroke="#0B1722" strokeWidth="3" />
    <ellipse cx="24" cy="27" rx="6" ry="7" fill="#0B1722" />
    <ellipse cx="40" cy="27" rx="6" ry="7" fill="#0B1722" />
    <circle cx="26" cy="26" r="2" fill="#fff" />
    <circle cx="42" cy="26" r="2" fill="#fff" />
    <path d="M20 42c4 5 20 5 24 0" stroke="#0B1722" strokeWidth="3" strokeLinecap="round" fill="none" />
  </svg>
);

const chip: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 8,
  border: '1px solid #dcdce4', background: '#fff', borderRadius: 8,
  padding: '6px 12px', fontSize: 13, fontWeight: 600, color: '#32324d',
};

export const StackLogos = () => (
  <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
    <span style={chip}><NextLogo /> Next.js</span>
    <span style={chip}><TanStackLogo /> TanStack Start</span>
  </div>
);

export { NextLogo, TanStackLogo };
