import { describe, expect, it } from "vitest";
import {
  loadEnv,
  redactEnv,
  hasAnthropicKey,
  hasSolariKey,
} from "./env.ts";

describe("loadEnv", () => {
  it("loads an empty environment with defaults", () => {
    const env = loadEnv({});
    expect(env.LLM_PROVIDER).toBe("anthropic");
    expect(env.SOLARI_PROXY_COUNTRY).toBe("ca");
    expect(env.DATABASE_URL).toBe("file:./data/sensitiv.db");
    expect(env.WORKER_URL).toBe("http://127.0.0.1:8787");
    expect(env.WORKER_PORT).toBe(8787);
    expect(env.DEFAULT_JOB_TIMEOUT_SEC).toBe(480);
    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
  });

  it("treats empty-string values as unset (a scaffolded .env still loads)", () => {
    const env = loadEnv({ ANTHROPIC_API_KEY: "", SOLARI_API_KEY: "", WORKER_PORT: "" });
    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(env.WORKER_PORT).toBe(8787);
  });

  it("coerces numeric strings", () => {
    expect(loadEnv({ WORKER_PORT: "9000" }).WORKER_PORT).toBe(9000);
  });

  it("throws on a malformed WORKER_PORT", () => {
    expect(() => loadEnv({ WORKER_PORT: "abc" })).toThrow();
  });

  it("throws on a malformed SOLARI_PROXY_COUNTRY", () => {
    expect(() => loadEnv({ SOLARI_PROXY_COUNTRY: "canada" })).toThrow();
  });

  it("lowercases a valid proxy country", () => {
    expect(loadEnv({ SOLARI_PROXY_COUNTRY: "FR" }).SOLARI_PROXY_COUNTRY).toBe("fr");
  });

  it("returns a frozen object", () => {
    expect(Object.isFrozen(loadEnv({}))).toBe(true);
  });
});

describe("redactEnv", () => {
  it("never leaks a raw key value", () => {
    const secret = "sk-ant-super-secret-value-123";
    const env = loadEnv({ ANTHROPIC_API_KEY: secret, SOLARI_API_KEY: "solari-secret-xyz" });
    const redacted = redactEnv(env);
    expect(redacted.ANTHROPIC_API_KEY).toBe("<set>");
    expect(redacted.SOLARI_API_KEY).toBe("<set>");
    const serialized = JSON.stringify(redacted);
    expect(serialized).not.toContain(secret);
    expect(serialized).not.toContain("solari-secret-xyz");
  });

  it("marks absent keys as <unset>", () => {
    const redacted = redactEnv(loadEnv({}));
    expect(redacted.ANTHROPIC_API_KEY).toBe("<unset>");
    expect(redacted.SOLARI_API_KEY).toBe("<unset>");
  });
});

describe("feature gates", () => {
  it("reflect key presence", () => {
    expect(hasAnthropicKey(loadEnv({}))).toBe(false);
    expect(hasSolariKey(loadEnv({ SOLARI_API_KEY: "x" }))).toBe(true);
  });
});
