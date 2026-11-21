import { eq } from 'drizzle-orm';
import { readSchoolSettings, type SchoolSettings, type UpdateSchoolSettings } from '@sinf/shared';
import { schema, type Db } from '../db/index.js';

/**
 * The rules of a school (stage 5, A1; ADR-021), read from `schools.settings` with every default
 * filled in. A class without a school — a teacher's personal one — follows the defaults.
 */

export function schoolSettings(school: { settings: Record<string, unknown> }): SchoolSettings {
  return readSchoolSettings(school.settings);
}

export function settingsOfSchool(db: Db, schoolId: string | null): SchoolSettings {
  const school = schoolId
    ? db
        .select({ settings: schema.schools.settings })
        .from(schema.schools)
        .where(eq(schema.schools.id, schoolId))
        .get()
    : undefined;
  return readSchoolSettings(school?.settings);
}

export function settingsForClass(db: Db, classId: string): SchoolSettings {
  const cls = db
    .select({ schoolId: schema.classes.schoolId })
    .from(schema.classes)
    .where(eq(schema.classes.id, classId))
    .get();
  return settingsOfSchool(db, cls?.schoolId ?? null);
}

/** Merges a change into the stored rules; unknown old keys are dropped on the way. */
export function updateSchoolSettings(
  db: Db,
  schoolId: string,
  change: UpdateSchoolSettings,
): SchoolSettings {
  const next = readSchoolSettings({ ...settingsOfSchool(db, schoolId), ...change });
  db.update(schema.schools).set({ settings: next }).where(eq(schema.schools.id, schoolId)).run();
  return next;
}
