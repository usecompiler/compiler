import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const dbUrl = process.env.DATABASE_URL;

if (!dbUrl) {
  throw new Error("DATABASE_URL environment variable is required");
}

const connectionString = process.env.DATABASE_SSL === "true"
  ? (dbUrl.includes("?") ? `${dbUrl}&sslmode=require` : `${dbUrl}?sslmode=require`)
  : dbUrl;

const client = postgres(connectionString);
export const db = drizzle(client, { schema });
