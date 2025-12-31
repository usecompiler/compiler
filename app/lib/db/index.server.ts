import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL environment variable is required");
}

const isHeroku = !!process.env.DYNO;
const client = postgres(connectionString, {
  ssl: isHeroku || process.env.DATABASE_SSL === "true",
});
export const db = drizzle(client, { schema });
