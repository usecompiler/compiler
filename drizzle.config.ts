import { defineConfig } from "drizzle-kit";

const dbUrl = process.env.DATABASE_URL!;
const connectionString = process.env.DATABASE_SSL === "true"
  ? (dbUrl.includes("?") ? `${dbUrl}&sslmode=require` : `${dbUrl}?sslmode=require`)
  : dbUrl;

export default defineConfig({
  schema: "./app/lib/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: connectionString,
  },
});
