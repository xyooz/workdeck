import { createApp, WorkDeckService } from "./app.js";
import { WorkDeckDatabase } from "@workdeck/db";

const port = Number(process.env.PORT ?? 4100);
const database = new WorkDeckDatabase();
database.seedDemo();
const app = createApp(new WorkDeckService(database));

const server = app.listen(port, () => {
  console.log(`WorkDeck API listening on http://localhost:${port}`);
  console.log(`SQLite: ${database.filePath}`);
});

const shutdown = () => {
  server.close(() => {
    database.close();
    process.exit(0);
  });
};

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
