import { WorkDeckDatabase } from "@workdeck/db";

const filePath = process.env.WORKDECK_CONCURRENT_DB_PATH;
const projectId = process.env.WORKDECK_CONCURRENT_PROJECT_ID;
const workerId = process.env.WORKDECK_CONCURRENT_WORKER_ID;
const count = Number(process.env.WORKDECK_CONCURRENT_COUNT ?? 0);

if (!filePath || !projectId || !workerId || !Number.isInteger(count) || count < 1) {
  throw new Error("Concurrent SQLite worker input is incomplete");
}

const database = new WorkDeckDatabase(filePath);
let exitCode = 0;

try {
  for (let index = 0; index < count; index += 1) {
    database.createTask({
      projectId,
      title: `Concurrent ${workerId}-${index}`,
      status: "implementing",
      priority: "medium",
    });
  }
} catch (error) {
  exitCode = 1;
  console.error(error instanceof Error ? error.message : "Concurrent SQLite write failed");
} finally {
  database.close();
}

process.exitCode = exitCode;
