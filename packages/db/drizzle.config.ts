import { defineConfig } from "drizzle-kit";

const url = process.env["DATABASE_URL"];
if (url === undefined || url === "") {
  throw new Error("DATABASE_URL não definida — copie .env.example para .env");
}

export default defineConfig({
  schema: "./src/schema.ts",
  out: "./migrations",
  dialect: "postgresql",
  dbCredentials: { url },
  verbose: true,
  strict: true,
});
