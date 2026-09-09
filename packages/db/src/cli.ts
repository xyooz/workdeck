import { WorkDeckDatabase } from "./index.js";

const database = new WorkDeckDatabase();
const seeded = process.argv.includes("--seed") ? database.seedDemo() : false;
console.log(`WorkDeck database ready at ${database.filePath}`);
console.log(`Migrations: ${database.migrationVersions.join(", ") || "none"}`);
if (process.argv.includes("--seed")) console.log(seeded ? "Demo data inserted." : "Demo data already present; nothing changed.");
database.close();
