import { sql } from "drizzle-orm";
import {
  pgTable,
  text,
  uuid,
  timestamp,
  vector,
  jsonb,
  customType,
  index,
} from "drizzle-orm/pg-core";

const tstzrange = customType<{ data: string }>({
  dataType() {
    return "tstzrange";
  },
});

export const legislation = pgTable("legislation", {
  id: uuid("id").primaryKey().defaultRandom(),
  uid: text("uid").notNull().unique(),
  title: text("title").notNull(),
  validity: tstzrange("validity").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const chunks = pgTable(
  "chunks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    lawId: uuid("law_id").references(() => legislation.id),
    content: text("content"),
    scoutVector: vector("scout_vector", { dimensions: 256 }),
    fullVector: vector("full_vector", { dimensions: 1024 }),
    multiVector: jsonb("multi_vector"),
  },
  (table) => ({
    scoutVectorIndex: index("scout_vector_index").using(
      "hnsw",
      sql`${table.scoutVector} vector_cosine_ops`,
    ),
  }),
);
