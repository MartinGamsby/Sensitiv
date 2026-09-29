import type { CSSProperties, ReactNode } from "react";

// The app's own hand-rolled stroke icons (`apps/web/src/components/ui/
// icon.tsx`), path for path, so the recreated UI wears the same glyphs.

export interface IconProps {
  size?: number;
  color?: string;
  strokeWidth?: number;
  style?: CSSProperties;
}

function Icon({
  size = 16,
  color = "currentColor",
  strokeWidth = 1.75,
  style,
  children,
}: IconProps & { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke={color}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ flexShrink: 0, display: "block", ...style }}
    >
      {children}
    </svg>
  );
}

export const ChevronIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="m9 5 7 7-7 7" />
  </Icon>
);
export const PinIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 21s7-6.3 7-11a7 7 0 1 0-14 0c0 4.7 7 11 7 11Z" />
    <circle cx="12" cy="10" r="2.5" />
  </Icon>
);
export const CrosshairIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="7" />
    <circle cx="12" cy="12" r="1.5" />
    <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
  </Icon>
);
export const MapIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="m9 4-6 2.5v13.5L9 17.5m0-13.5 6 2.5m-6-2.5v13.5m6-11 6-2.5v13.5L15 20m0-13.5V20m-6-2.5L15 20" />
  </Icon>
);
export const SearchIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="11" cy="11" r="6.5" />
    <path d="m16 16 4.5 4.5" />
  </Icon>
);
export const SlidersIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4 7h10M18 7h2M4 17h4M12 17h8" />
    <circle cx="16" cy="7" r="2" />
    <circle cx="10" cy="17" r="2" />
  </Icon>
);
export const CheckIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="m5 12.5 4.5 4.5L19 7" />
  </Icon>
);
export const AlertIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M10.3 3.9 2.6 17a2 2 0 0 0 1.7 3h15.4a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
    <path d="M12 9v4.5M12 17.2v.01" />
  </Icon>
);
export const InfoIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 11v5M12 7.8v.01" />
  </Icon>
);
export const ClockIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5.2l3.2 2" />
  </Icon>
);
export const ExternalIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M14 4h6v6M20 4l-8.5 8.5" />
    <path d="M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4" />
  </Icon>
);
export const QuoteIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M9 7C6.8 8.3 5.5 10.4 5.5 13v4h5v-5H8c0-1.6.5-2.9 1.8-3.7L9 7ZM19 7c-2.2 1.3-3.5 3.4-3.5 6v4h5v-5H18c0-1.6.5-2.9 1.8-3.7L19 7Z" />
  </Icon>
);
export const WheatIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 21V10" />
    <path d="M12 10c0-2 1.3-3.4 3-4 .3 2-.6 3.6-3 4ZM12 10c0-2-1.3-3.4-3-4-.3 2 .6 3.6 3 4Z" />
    <path d="M12 15c0-2 1.3-3.4 3-4 .3 2-.6 3.6-3 4ZM12 15c0-2-1.3-3.4-3-4-.3 2 .6 3.6 3 4Z" />
  </Icon>
);
export const PeanutIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M9 4a4 4 0 0 1 3.4 6.1A4.5 4.5 0 1 1 6.6 16 4 4 0 0 1 9 4Z" />
    <path d="m16 6 5 5M21 6l-5 5" />
  </Icon>
);
export const DropletIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 3.5c3 3.6 5.5 6.4 5.5 9.4a5.5 5.5 0 1 1-11 0c0-3 2.5-5.8 5.5-9.4Z" />
  </Icon>
);
export const LeafIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4 20c0-8 5-14 16-15 1 10-4 15-11 15H4Z" />
    <path d="M9 15c2-3 4.5-5 8-6.5" />
  </Icon>
);
export const AccessIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="12" cy="4.5" r="1.8" />
    <path d="M9 9h6M12 9v5h4l2.5 6" />
    <path d="M12 14a5 5 0 1 0 3.6 8.5" />
  </Icon>
);
export const SunIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
  </Icon>
);
export const MoonIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z" />
  </Icon>
);
export const MonitorIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="2.5" y="4" width="19" height="12.5" rx="2" />
    <path d="M8.5 20.5h7M12 16.5v4" />
  </Icon>
);
export const CloseIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="m6 6 12 12M18 6 6 18" />
  </Icon>
);
export const ListIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M8 6h13M8 12h13M8 18h13" />
    <path d="M3.5 6h.01M3.5 12h.01M3.5 18h.01" />
  </Icon>
);
export const LockIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="5" y="11" width="14" height="9" rx="2" />
    <path d="M8 11V8a4 4 0 0 1 8 0v3" />
  </Icon>
);
export const GlobeIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M3 12h18M12 3c2.5 2.7 3.8 5.7 3.8 9s-1.3 6.3-3.8 9c-2.5-2.7-3.8-5.7-3.8-9S9.5 5.7 12 3Z" />
  </Icon>
);
export const BookIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5v-15Z" />
    <path d="M4 20.5A2.5 2.5 0 0 1 6.5 18H20v3H6.5" />
  </Icon>
);

/** The requirement glyphs, keyed by catalog id; an unknown id gets none. */
export const REQUIREMENT_ICON: Record<string, (p: IconProps) => ReactNode> = {
  celiac: WheatIcon,
  allergy: PeanutIcon,
  mold: DropletIcon,
  diet: LeafIcon,
  access: AccessIcon,
};
