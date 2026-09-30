import type { CSSProperties } from "react";
import { useVideo } from "../context.tsx";
import { fillTemplate, parseEmphasis } from "../lib/copy.ts";

/** Copy from the scenario: placeholders filled, *accents* in brand teal. */
export function RichText({ text, style }: { text: string; style?: CSSProperties }) {
  const { vars, theme } = useVideo();
  const segments = parseEmphasis(fillTemplate(text, vars));
  return (
    <span style={style}>
      {segments.map((s, i) =>
        s.accent ? (
          <span key={i} style={{ color: theme.brand }}>
            {s.text}
          </span>
        ) : (
          <span key={i}>{s.text}</span>
        ),
      )}
    </span>
  );
}
