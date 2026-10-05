import { z } from 'zod';

/** HTTP 200 can still be a business error: check `code` separately (spec 5.1). */
export const RedfoxEnvelope = z.object({
  code: z.number().int(),
  msg: z.string().optional(),
  message: z.string().optional(),
  data: z.unknown(),
});
export const REDFOX_SUCCESS = 2000;

/** RF13 — from user-provided provider doc (2026-10-05). */
export const Rf13Data = z.object({ taskId: z.string().min(1).max(128) });

/** RF14 — status values outside the documented set fail validation (contract violation). */
export const Rf14Data = z.object({
  taskId: z.string().min(1),
  status: z.enum(['succeeded', 'processing', 'failed']),
  failReason: z.string().nullable().optional(),
  text: z.string().nullable().optional(),
  stampSents: z
    .array(z.object({ textSeg: z.string(), start: z.number().int().nonnegative(), end: z.number().int().nonnegative() }))
    .nullable()
    .optional(),
});
