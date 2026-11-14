// Seeds the demo data (STAGE1.md §5). `pnpm seed` fills an empty database; `pnpm seed --reset` wipes and seeds again.
import { loadConfig, loadDotEnv } from '../config.js';
import { openDatabase } from '../db/index.js';
import { runMigrations } from '../db/migrate.js';
import { isDatabaseEmpty, resetDemo, seedDemo } from '../db/seed.js';

function main(): void {
  const reset = process.argv.includes('--reset');
  loadDotEnv();
  const config = loadConfig();
  const database = openDatabase(config.databasePath);
  try {
    runMigrations(database.db);
    const options = { teacherPassword: config.demoTeacherPassword };
    if (reset) {
      const result = resetDemo(database.db, options);
      console.log(`Demo data reset: ${result.students} students (${config.databasePath})`);
    } else if (isDatabaseEmpty(database.db)) {
      const result = seedDemo(database.db, options);
      console.log(`Demo data seeded: ${result.students} students (${config.databasePath})`);
    } else {
      console.log(
        `Database already has data, nothing done (${config.databasePath}). Use --reset to start over.`,
      );
    }
  } finally {
    database.close();
  }
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
