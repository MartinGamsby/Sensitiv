import type { SVGProps } from "react";

/**
 * Inline stroke icons. Deliberately hand-rolled rather than a dependency: the
 * app needs about a dozen glyphs, and a 24x24 stroke path costs less than an
 * icon package plus its tree-shaking caveats.
 *
 * All of them are decorative — every icon in this app sits beside its own text
 * label — so `aria-hidden` is baked in and there is no `title` prop.
 */
type IconProps = Omit<SVGProps<SVGSVGElement>, "children">;

function Icon({ className = "h-4 w-4", ...rest }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
      {...rest}
    />
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

export const DownloadIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 3v11M8 10.5l4 4 4-4" />
    <path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
  </Icon>
);

export const QuoteIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M9 7C6.8 8.3 5.5 10.4 5.5 13v4h5v-5H8c0-1.6.5-2.9 1.8-3.7L9 7ZM19 7c-2.2 1.3-3.5 3.4-3.5 6v4h5v-5H18c0-1.6.5-2.9 1.8-3.7L19 7Z" />
  </Icon>
);

// --- requirement glyphs (one per catalog chip id) ---------------------------

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
