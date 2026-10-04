import "dotenv/config";

import { createApp } from "./app.js";

async function start() {

  const app = await createApp();
  const host = process.env.HOST ?? "0.0.0.0";
  const port = Number(process.env.PORT ?? 4001);
  await app.listen({ port, host });
  console.log(`Server running at http://localhost:${port}`);
}

start().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
