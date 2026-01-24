import { Schema } from "effect";
import { defineQueue, defineQueues } from "../../src/queues/registry.js";

describe("queue registry", () => {
  it("defines queues with names", () => {
    const refinery = defineQueue(
      "refinery",
      Schema.Struct({
        id: Schema.String,
      }),
    );

    const queues = defineQueues({ refinery });

    expect(refinery.name).toBe("refinery");
    expect(queues.refinery.name).toBe("refinery");
  });
});
