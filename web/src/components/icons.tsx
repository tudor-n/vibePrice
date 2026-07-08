/**
 * Hand-drawn-style inline line icons from the design handoff — 18px,
 * stroke 1.7, round caps/joins, drawn in currentColor. No icon library.
 * All decorative: rendered aria-hidden next to their text labels.
 */

import type { ReactNode } from 'react';

interface IconProps {
  size?: number;
}

function Icon({ size = 18, children }: IconProps & { children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 18 18"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

/** House-roof logo mark — gold on teal, cream on the login hero. */
export function LogoMark({ size = 27 }: IconProps) {
  return (
    <svg
      width={size}
      height={Math.round(size * (28 / 30))}
      viewBox="0 0 30 28"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M4 13 L15 4 L26 13" />
      <path d="M7 12 V24 H23 V12" />
      <rect x="12.5" y="16" width="5" height="8" />
    </svg>
  );
}

export function IconDashboard(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="2" y="2" width="6" height="6" rx="1" />
      <rect x="10" y="2" width="6" height="6" rx="1" />
      <rect x="2" y="10" width="6" height="6" rx="1" />
      <rect x="10" y="10" width="6" height="6" rx="1" />
    </Icon>
  );
}

export function IconRecommendations(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M9 2 L15 8 L9 16 L3 10 Z" />
      <circle cx="6.5" cy="6.5" r="1" />
    </Icon>
  );
}

export function IconCompetitors(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M2 16 V10 M7 16 V5 M12 16 V8 M16 16 V3" />
    </Icon>
  );
}

export function IconEvents(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="2.5" y="3.5" width="13" height="12" rx="2" />
      <path d="M2.5 7 H15.5 M6 2 V5 M12 2 V5" />
    </Icon>
  );
}

export function IconSettings(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="9" cy="9" r="3" />
      <path d="M9 1.5 V3 M9 15 V16.5 M1.5 9 H3 M15 9 H16.5 M3.8 3.8 L4.9 4.9 M13.1 13.1 L14.2 14.2 M14.2 3.8 L13.1 4.9 M4.9 13.1 L3.8 14.2" />
    </Icon>
  );
}

export function IconRefresh({ size = 16 }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M13.5 8 a5.5 5.5 0 1 1 -1.6 -3.9" />
      <path d="M13.5 2 V4.5 H11" />
    </svg>
  );
}

export function IconChevronLeft({ size = 14 }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M7.5 2.5 L4 6 L7.5 9.5" />
    </svg>
  );
}

export function IconChevronRight({ size = 14 }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M4.5 2.5 L8 6 L4.5 9.5" />
    </svg>
  );
}

/** Tiny spire glyph for the calendar's event-day pill. */
export function IconSpire({ size = 8 }: IconProps) {
  return (
    <svg
      width={size}
      height={Math.round(size * (9 / 8))}
      viewBox="0 0 8 9"
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M4 0 L8 4 H0 Z" />
      <rect x="2.5" y="4" width="3" height="5" />
    </svg>
  );
}

/** Wobbly hand-drawn terracotta underline for page/section titles. */
export function HandUnderline({ width = 188 }: { width?: number }) {
  return (
    <svg
      className="hand-underline"
      width={width}
      height="9"
      viewBox="0 0 210 9"
      preserveAspectRatio="none"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.6"
      strokeLinecap="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M2 6 Q54 1 105 5 T208 4" />
    </svg>
  );
}

/** Festive bunting swag for decorative card corners. */
export function Bunting() {
  return (
    <svg
      className="teaser-bunting"
      width="230"
      height="34"
      viewBox="0 0 230 34"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M4 6 Q115 28 226 6" stroke="#5a4a3a" strokeWidth="1.4" strokeOpacity="0.5" />
      <polygon points="26,8 40,8 33,21" fill="#c96f4a" />
      <polygon points="66,13 80,13 73,26" fill="#e0b25e" />
      <polygon points="108,16 122,16 115,29" fill="#6f9a86" />
      <polygon points="150,13 164,13 157,26" fill="#5e88a6" />
      <polygon points="190,8 204,8 197,21" fill="#d9a79f" />
    </svg>
  );
}
