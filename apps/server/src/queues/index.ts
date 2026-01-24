import { BocItem } from "~/services/boc";

import { defineQueue, defineQueues } from "./registry";

export const Queues = defineQueues({
  refinery: defineQueue("refinery-queue", BocItem),
});
