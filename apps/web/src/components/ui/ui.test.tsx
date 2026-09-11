import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { cn } from "@/lib/cn.ts";
import { Badge, type BadgeTone } from "./badge.tsx";
import { Card } from "./card.tsx";
import { EmptyState } from "./empty-state.tsx";

afterEach(() => {
  cleanup();
});

describe("cn()", () => {
  it("merges conflicting Tailwind utilities with the later one winning", () => {
    expect(cn("p-2", "p-4")).toBe("p-4");
  });

  it("drops falsy values", () => {
    expect(cn("p-2", false, undefined, null, "", "text-sm")).toBe(
      "p-2 text-sm",
    );
  });
});

describe("<Badge />", () => {
  const tones: BadgeTone[] = ["neutral", "ok", "warn", "danger", "info"];

  it.each(tones)("renders tone %s with a literal, non-empty class string", (tone) => {
    const { container } = render(<Badge tone={tone}>label</Badge>);
    const span = container.querySelector("span");
    expect(span).not.toBeNull();
    expect(span!.className.trim().length).toBeGreaterThan(0);
    expect(screen.getByText("label")).toBeTruthy();
  });

  it("renders the solid score-chip look for tone=neutral size=md", () => {
    const { container } = render(
      <Badge tone="neutral" size="md">
        Score 3
      </Badge>,
    );
    const span = container.querySelector("span")!;
    expect(span.className).toContain("bg-neutral-900");
  });
});

describe("<Card />", () => {
  it("renders as='li' as an <li> and forwards data-* attributes", () => {
    const { container } = render(
      <Card as="li" data-testid="card-li" data-conflicted="true">
        content
      </Card>,
    );
    const li = container.querySelector("li");
    expect(li).not.toBeNull();
    expect(li!.getAttribute("data-testid")).toBe("card-li");
    expect(li!.getAttribute("data-conflicted")).toBe("true");
  });

  it("defaults to a <div>", () => {
    const { container } = render(<Card>content</Card>);
    expect(container.querySelector("div")).not.toBeNull();
  });
});

describe("<EmptyState />", () => {
  it("renders a <p> carrying italic (the dossier.test.tsx contract)", () => {
    const { container } = render(<EmptyState>nothing here</EmptyState>);
    const p = container.querySelector("p.italic");
    expect(p).not.toBeNull();
    expect(p!.textContent).toContain("nothing here");
  });

  it("renders an optional trailing action", () => {
    render(
      <EmptyState action={<a href="/start">Start</a>}>Empty</EmptyState>,
    );
    expect(screen.getByText("Start")).toBeTruthy();
  });
});
