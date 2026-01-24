import { BocItem } from "../services/boc.js";
import { defineQueue, defineQueues } from "./registry.js";

export const Queues = defineQueues({
  refinery: defineQueue("refinery-queue", BocItem),
});
