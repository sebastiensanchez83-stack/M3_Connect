import type { SVGProps } from 'react';

/**
 * Four harbour pictograms for the "How it works" channel, drawn in the same
 * stroke as the buoy glyph (1.6 px, round ends, currentColor): a mooring line
 * (sign up), a berth number (your company's berth), the harbour office stamp
 * (checked by M3) and an open boom gate (the whole platform). Decorative.
 */
type Props = SVGProps<SVGSVGElement> & { className?: string };

function Frame({ children, ...props }: Props) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {children}
    </svg>
  );
}

/** A bollard with a line made fast around it. */
export function MooringLinePictogram(props: Props) {
  return (
    <Frame {...props}>
      <path d="M8 21h8M9 21v-9h6v9" />
      <path d="M7.5 12h9a1.5 1.5 0 0 0 0-3h-9a1.5 1.5 0 0 0 0 3z" />
      <path d="M2.5 6.5c3 0 5.5 1.2 6.5 3.5M9 10c1.4 1.4 4.6 1.4 6 0" />
      <path d="M2.5 9.5c2 0 3.6.6 4.6 1.6" />
    </Frame>
  );
}

/** A berth number plate on a pontoon post. */
export function BerthNumberPictogram(props: Props) {
  return (
    <Frame {...props}>
      <rect x="4" y="3.5" width="16" height="11" rx="1.5" />
      <path d="M10 6.8v5.4M10 6.8l-1.4 1M13.5 7.2a1.6 1.6 0 1 1 2.6 1.3l-2.8 3.7h3.1" />
      <path d="M12 14.5V21M7 21h10" />
    </Frame>
  );
}

/** The harbour office stamp: a round stamp with a check. */
export function HarbourStampPictogram(props: Props) {
  return (
    <Frame {...props}>
      <circle cx="12" cy="11" r="7.5" />
      <circle cx="12" cy="11" r="5" strokeDasharray="1.6 2" />
      <path d="M9.6 11.2l1.7 1.7 3.2-3.6" />
      <path d="M7 20.5h10" />
    </Frame>
  );
}

/** An open boom gate at the harbour entrance. */
export function OpenBoomPictogram(props: Props) {
  return (
    <Frame {...props}>
      <path d="M4 21V12h4v9M3 21h6" />
      <path d="M8 13 19.5 4.5" />
      <path d="M11 10.8l1.6 1.6M14 8.6l1.6 1.6M17 6.4l1.6 1.6" />
      <path d="M13 21h8" strokeDasharray="2 2.4" />
    </Frame>
  );
}
