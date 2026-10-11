import { z } from 'zod';
import { AgentId, Os } from './ids.js';

export const DoctorCheck = z.object({
  id: z.string(),
  title: z.string(),
  status: z.enum(['pass', 'warn', 'fail']),
  /** What to do when not passing, in the product's voice */
  fix: z.string().optional(),
  agent: AgentId.optional(),
});
export type DoctorCheck = z.infer<typeof DoctorCheck>;

export const DoctorReport = z.object({
  os: Os,
  orchVersion: z.string(),
  engineVersion: z.string(),
  checks: z.array(DoctorCheck),
});
export type DoctorReport = z.infer<typeof DoctorReport>;
