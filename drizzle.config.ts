import { defineConfig } from "drizzle-kit";

const dbUrl = process.env.DATABASE_URL!;
const sslUrl = dbUrl.includes("?") ? `${dbUrl}&sslmode=require` : `${dbUrl}?sslmode=require`;

export default defineConfig({
  schema: "./app/lib/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_SSL === "false" ? dbUrl : sslUrl,
  },
});
