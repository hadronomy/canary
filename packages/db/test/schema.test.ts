import { describe, it, expect } from "bun:test";
import * as schema from "~/schema";

describe("Database Schema", () => {
  it("should export legislation table", () => {
    expect(schema).toHaveProperty("legislation");
  });

  it("should export chunks table", () => {
    expect(schema).toHaveProperty("chunks");
  });
});
