// FARO — config de drizzle-kit. Sin URLs hardcodeadas (DEP-02): la conexión
// sale de DATABASE_URL del entorno (dev: .env; compose: env del service).
import "dotenv/config";
import { defineConfig } from "drizzle-kit";

const url = process.env.DATABASE_URL;
if (!url) {
  throw new Error("[FARO] DATABASE_URL no definida — drizzle-kit no puede conectarse");
}

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  dbCredentials: { url },
});
