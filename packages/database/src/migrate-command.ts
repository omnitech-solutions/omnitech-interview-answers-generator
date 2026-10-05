import { createPlatformDatabase } from "./connection";
import { migrateDatabase } from "./migrate";

const database = createPlatformDatabase();
try {
  await migrateDatabase(database);
} finally {
  await database.close();
}
