/**
 * D20 faceted logo mark — exact SVG paths from the design handoff README.
 * Three path groups on a 100×100 viewBox, stroked in currentColor (ember by default).
 * Use at 40px (login), 30px (lobby bar), 26px (table bar).
 */
interface D20LogoProps {
  size?: number;
  className?: string;
}

export function D20Logo({ size = 40, className = '' }: D20LogoProps) {
  return (
    <svg
      viewBox="0 0 100 100"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {/* Outer hex */}
      <path
        d="M50 4 L90 27 L90 73 L50 96 L10 73 L10 27 Z"
        strokeWidth="3"
      />
      {/* Top facet */}
      <path
        d="M50 4 L72 38 L50 60 L28 38 Z"
        strokeWidth="2.4"
      />
      {/* Inner facets */}
      <path
        d="M28 38 L10 27 M72 38 L90 27 M50 60 L50 96 M28 38 L18 70 L50 60 M72 38 L82 70 L50 60 M18 70 L10 73 M82 70 L90 73"
        strokeWidth="1.7"
        strokeOpacity="0.55"
      />
    </svg>
  );
}
