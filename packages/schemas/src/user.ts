import { z } from 'zod';

export const UserRole = z.enum([
  'intake_officer', 'dispatch_officer', 'handling_staff',
  'reviewer', 'management', 'admin',
]);
export type UserRole = z.infer<typeof UserRole>;

export const User = z.object({
  id: z.string(),
  username: z.string(),
  full_name: z.string().nullable(),
  email: z.string().email().nullable(),
  role: UserRole,
  department_id: z.number().nullable(),
  is_field_staff: z.boolean(),
  shift_start: z.string().nullable(),
  shift_end: z.string().nullable(),
});
export type User = z.infer<typeof User>;
