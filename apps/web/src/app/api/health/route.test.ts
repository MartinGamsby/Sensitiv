import { afterEach, describe, expect, it } from "vitest";
import { __setWebDeps } from "../../../server/deps.ts";
import { testEnv } from "../../../test-support/env.ts";
import { GET } from "./route.ts";

afterEach(() => {
  __setWebDeps(undefined);
});

describe("GET /api/health", () => {
  it("reports booleans / provider names only — never the key itself", async () => {
    __setWebDeps({ env: testEnv({ SOLARI_API_KEY: "secret", ANTHROPIC_API_KEY: "sk-ant-xxx" }) });
    const res = await GET();
    const body = await res.json();
    expect(body).toEqual({ solari: true, llm: "anthropic" });
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain("secret");
    expect(serialized).not.toContain("sk-ant-xxx");
  });

  it("reports solari:false and llm:fake for an empty env", async () => {
    __setWebDeps({ env: testEnv() });
    const res = await GET();
    expect(await res.json()).toEqual({ solari: false, llm: "fake" });
  });
});
