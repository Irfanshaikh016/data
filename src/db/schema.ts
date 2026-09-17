import { integer, jsonb, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

/** One row per uploaded dataset session. */
export const datasets = pgTable("datasets", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  filePath: text("file_path").notNull(),
  totalRows: integer("total_rows").notNull().default(0),
  totalCols: integer("total_cols").notNull().default(0),
  fileBytes: integer("file_bytes").notNull().default(0),
  isDemo: integer("is_demo").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

/** Ordered cleaning steps (the user's "recipe") per dataset. */
export const recipeSteps = pgTable("recipe_steps", {
  id: serial("id").primaryKey(),
  datasetId: text("dataset_id").notNull(),
  position: integer("position").notNull(),
  op: jsonb("op").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

/** AI co-pilot conversation history. */
export const chatMessages = pgTable("chat_messages", {
  id: serial("id").primaryKey(),
  datasetId: text("dataset_id"),
  role: text("role").notNull(),
  content: text("content").notNull(),
  actions: jsonb("actions"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
