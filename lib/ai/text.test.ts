import { describe, it, expect } from "vitest";
import {
  chunkText,
  detectAiTells,
  checkPlatformFormat,
  AI_TELLS,
} from "@/lib/ai/text";

describe("chunkText", () => {
  it("returns [] for empty/whitespace input", () => {
    expect(chunkText("")).toEqual([]);
    expect(chunkText("   \n  ")).toEqual([]);
  });

  it("returns a single chunk when text fits", () => {
    expect(chunkText("hello world", 100)).toEqual(["hello world"]);
  });

  it("collapses whitespace", () => {
    expect(chunkText("a   b\n\nc", 100)).toEqual(["a b c"]);
  });

  it("splits long text into overlapping windows", () => {
    const text = "x".repeat(2500);
    const chunks = chunkText(text, 1000, 150);
    expect(chunks.length).toBeGreaterThan(1);
    // every chunk within size
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(1000);
    // covers the whole string
    expect(chunks.join("").length).toBeGreaterThanOrEqual(2500);
  });

  it("advances by size - overlap", () => {
    const text = "abcdefghijklmnopqrstuvwxyz".repeat(4); // 104 chars
    const chunks = chunkText(text, 40, 10);
    // step = 30 → starts at 0,30,60,90
    expect(chunks.length).toBe(4);
  });
});

describe("detectAiTells", () => {
  it("flags a clean human sentence as empty", () => {
    expect(detectAiTells("I shipped a Go migration last week and it broke prod once.")).toEqual([]);
  });

  it("catches generic openers", () => {
    expect(detectAiTells("In today's fast-paced world, developers must adapt.")).toContain(
      "generic-opener",
    );
  });

  it("catches the not-just-but construction and hype adjectives", () => {
    expect(detectAiTells("This is not just a tool, but a game-changer.")).toEqual(
      expect.arrayContaining(["not-just-but", "hype-adjective"]),
    );
  });

  it("catches hedging and listicle filler", () => {
    expect(detectAiTells("Here are 5 ways to grow. It's worth noting the risks.")).toEqual(
      expect.arrayContaining(["listicle-filler", "hedging"]),
    );
  });

  it("every tell has a distinct label", () => {
    const labels = AI_TELLS.map((t) => t.label);
    expect(new Set(labels).size).toBe(labels.length);
  });
});

describe("checkPlatformFormat", () => {
  it("flags an over-limit X post", () => {
    const r = checkPlatformFormat("y".repeat(300), "x");
    expect(r.ok).toBe(false);
    expect(r.issues[0]).toMatch(/over 280/);
  });

  it("passes a short X post", () => {
    expect(checkPlatformFormat("a punchy take", "x").ok).toBe(true);
  });

  it("flags a LinkedIn wall of text with no breaks", () => {
    const r = checkPlatformFormat("a".repeat(400), "linkedin");
    expect(r.ok).toBe(false);
    expect(r.issues).toContain("no line breaks (wall of text)");
  });

  it("passes a scannable LinkedIn post", () => {
    const r = checkPlatformFormat(
      "A strong opening hook line here.\n\nA second paragraph.\n\nA question?",
      "linkedin",
    );
    expect(r.ok).toBe(true);
  });
});
