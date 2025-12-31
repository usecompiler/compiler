import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./app/lib/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL!,
    ssl: {
      rejectUnauthorized: false, // Essential for Heroku's self-signed certs
    },
  },
});
