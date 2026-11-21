import { checkFile } from '@sinf/checkers';
import type { FastifyPluginCallback } from 'fastify';
import { z } from 'zod';
import { MAX_FILE_BYTES, PracticeTaskSchema, type CheckReport } from '@sinf/shared';
import { requireTeacher } from '../auth/teacher.js';
import { ApiHttpError } from '../errors.js';

/**
 * A practice task tried on a file (PLAN.md 3.7, stage 3 H13): the teacher's "check the reference
 * file", checked again here after the browser — the same checkers, so the two must agree (ADR-003).
 * A reference file is small; it comes in base64 inside the JSON, at most 15 MB.
 */
const MAX_REFERENCE_BYTES = Math.min(MAX_FILE_BYTES, 15 * 1024 * 1024);

const CheckRequestSchema = z.strictObject({
  task: PracticeTaskSchema,
  fileName: z.string().min(1).max(200),
  file: z
    .string()
    .min(1)
    .max(Math.ceil((MAX_REFERENCE_BYTES * 4) / 3) + 4),
});

export const practiceRoutes: FastifyPluginCallback = (app, _opts, done) => {
  app.post(
    '/practice/check',
    { preHandler: requireTeacher, bodyLimit: 21 * 1024 * 1024 },
    (request): CheckReport => {
      const body = CheckRequestSchema.parse(request.body);
      const bytes = Buffer.from(body.file, 'base64');
      if (bytes.length > MAX_REFERENCE_BYTES) {
        throw new ApiHttpError(413, 'too_large', 'A reference file may be at most 15 MB');
      }
      const report = checkFile(new Uint8Array(bytes), body.fileName, body.task.criteria);
      request.log.info(
        {
          fileName: body.fileName,
          score: report.autoScore,
          max: report.autoMax,
          ms: Math.round(report.ms),
        },
        'practice file checked',
      );
      return report;
    },
  );
  done();
};
