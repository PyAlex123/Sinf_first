import { randomUUID } from 'node:crypto';
import { and, count, desc, eq, isNull, lte } from 'drizzle-orm';
import {
  FREE_PERSONAL_CLASSES,
  lessonDate,
  licenseStatus,
  type IssueLicense,
  type License,
  type LicenseTerms,
  type SchoolLicense,
} from '@sinf/shared';
import { schema, type Db } from '../db/index.js';
import { ApiHttpError } from '../errors.js';

/**
 * Licenses (PLAN.md 2.6–2.7; stage 6, B2; ADR-022): the one place that says what a school has paid
 * for. Gated by it: making a class of the school, a lesson on a classroom computer, the school's
 * reports. Free: everything a teacher does on the website, and one personal class.
 */

const today = (now = new Date()): string => lessonDate(now.toISOString());

type LicenseRow = typeof schema.licenses.$inferSelect;

const view = (row: LicenseRow): License => ({
  id: row.id,
  classesLimit: row.classesLimit,
  validFrom: row.validFrom,
  validTo: row.validTo,
  note: row.note,
  createdAt: row.createdAt,
  revokedAt: row.revokedAt,
});

/** The license that counts on `day`: begun, not taken back, the one that lasts longest. */
export function currentTerms(db: Db, schoolId: string, now = new Date()): LicenseTerms | null {
  const day = today(now);
  const begun = db
    .select()
    .from(schema.licenses)
    .where(
      and(
        eq(schema.licenses.schoolId, schoolId),
        isNull(schema.licenses.revokedAt),
        lte(schema.licenses.validFrom, day),
      ),
    )
    .orderBy(desc(schema.licenses.validTo))
    .get();
  // None begun yet: the next one to begin still tells the administrator what is coming.
  const row =
    begun ??
    db
      .select()
      .from(schema.licenses)
      .where(and(eq(schema.licenses.schoolId, schoolId), isNull(schema.licenses.revokedAt)))
      .orderBy(schema.licenses.validFrom)
      .get();
  return row
    ? { classesLimit: row.classesLimit, validFrom: row.validFrom, validTo: row.validTo }
    : null;
}

export function schoolClassCount(db: Db, schoolId: string): number {
  return (
    db
      .select({ n: count() })
      .from(schema.classes)
      .where(eq(schema.classes.schoolId, schoolId))
      .get()?.n ?? 0
  );
}

export function schoolLicense(db: Db, schoolId: string, now = new Date()): SchoolLicense {
  const terms = currentTerms(db, schoolId, now);
  return {
    terms,
    status: licenseStatus(terms, today(now)),
    classesUsed: schoolClassCount(db, schoolId),
  };
}

/** One more class of the school: only under a license in force, and within its classes. */
export function requireClassSeat(db: Db, schoolId: string, now = new Date()): void {
  const state = schoolLicense(db, schoolId, now);
  if (state.status !== 'active' || !state.terms) {
    throw new ApiHttpError(409, 'license_needed', 'The school has no license in force');
  }
  if (state.classesUsed >= state.terms.classesLimit) {
    throw new ApiHttpError(
      409,
      'license_limit',
      'The school has used all the classes it paid for',
      {
        limit: state.terms.classesLimit,
      },
    );
  }
}

/** The free plan: one personal class per teacher. */
export function requirePersonalSeat(db: Db, teacherId: string): void {
  const owned =
    db
      .select({ n: count() })
      .from(schema.classes)
      .where(and(eq(schema.classes.ownerId, teacherId), isNull(schema.classes.schoolId)))
      .get()?.n ?? 0;
  if (owned >= FREE_PERSONAL_CLASSES) {
    throw new ApiHttpError(409, 'free_limit', 'A teacher has one personal class for free');
  }
}

/**
 * A lesson on a classroom computer: a class of a school whose license is in force, or ended less
 * than the grace days ago (a computer without the internet keeps teaching). A personal class is a
 * website class.
 */
export function requireClassroomLesson(db: Db, classId: string, now = new Date()): void {
  const cls = db
    .select({ schoolId: schema.classes.schoolId })
    .from(schema.classes)
    .where(eq(schema.classes.id, classId))
    .get();
  if (!cls?.schoolId) {
    throw new ApiHttpError(
      409,
      'license_personal',
      'A personal class has its lessons on the website',
    );
  }
  const status = schoolLicense(db, cls.schoolId, now).status;
  if (status !== 'active' && status !== 'grace') {
    throw new ApiHttpError(409, 'license_needed', 'The school has no license in force');
  }
}

/** The school's reports: under a license in force. */
export function requireLicensedSchool(db: Db, schoolId: string, now = new Date()): void {
  const status = schoolLicense(db, schoolId, now).status;
  if (status !== 'active' && status !== 'grace') {
    throw new ApiHttpError(409, 'license_needed', 'The school has no license in force');
  }
}

// ---------- the superadmin

export function licensesOf(db: Db, schoolId: string): License[] {
  return db
    .select()
    .from(schema.licenses)
    .where(eq(schema.licenses.schoolId, schoolId))
    .orderBy(desc(schema.licenses.createdAt))
    .all()
    .map(view);
}

export function issueLicense(
  db: Db,
  schoolId: string,
  input: IssueLicense,
  by: string | null,
  now = new Date(),
): License {
  const row: LicenseRow = {
    id: randomUUID(),
    schoolId,
    classesLimit: input.classesLimit,
    validFrom: input.validFrom,
    validTo: input.validTo,
    note: input.note,
    createdBy: by,
    createdAt: now.toISOString(),
    revokedAt: null,
  };
  db.insert(schema.licenses).values(row).run();
  return view(row);
}

export function revokeLicense(db: Db, schoolId: string, licenseId: string, now = new Date()): void {
  db.update(schema.licenses)
    .set({ revokedAt: now.toISOString() })
    .where(and(eq(schema.licenses.id, licenseId), eq(schema.licenses.schoolId, schoolId)))
    .run();
}

/** A school computer's copy, from the roster: it replaces whatever was there. */
export function mirrorLicense(
  db: Db,
  schoolId: string,
  terms: LicenseTerms | null,
  now = new Date(),
): void {
  db.transaction((tx) => {
    tx.delete(schema.licenses).where(eq(schema.licenses.schoolId, schoolId)).run();
    if (terms) {
      tx.insert(schema.licenses)
        .values({
          id: `mirror-${schoolId}`,
          schoolId,
          ...terms,
          note: '',
          createdBy: null,
          createdAt: now.toISOString(),
          revokedAt: null,
        })
        .run();
    }
  });
}
