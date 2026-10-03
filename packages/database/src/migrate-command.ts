import { createPlatformDatabase } from "./connection.js";
import { migrateDatabase } from "./migrate.js";

const database = createPlatformDatabase();
try {
  await migrateDatabase(database);
} finally {
  await database.close();
}
