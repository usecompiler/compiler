import { defineConfig } from "drizzle-kit";

const isHeroku = !!process.env.DYNO;

export default defineConfig({
  schema: "./app/lib/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL!,
    ssl: isHeroku || process.env.DATABASE_SSL === "true",
  },
});
