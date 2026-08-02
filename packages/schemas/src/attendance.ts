import { z } from 'zod';

export const AttendanceStatus = z.enum([
  'present', 'late', 'early_leave', 'absent',
]);
export type AttendanceStatus = z.infer<typeof AttendanceStatus>;

export const ShiftAttendance = z.object({
  id: z.number(),
  user_id: z.string(),
  clock_in: z.string().nullable(),
  clock_in_lat: z.number().nullable(),
  clock_in_lng: z.number().nullable(),
  clock_out: z.string().nullable(),
  clock_out_lat: z.number().nullable(),
  clock_out_lng: z.number().nullable(),
  date: z.string(),
  status: AttendanceStatus.nullable(),
});
export type ShiftAttendance = z.infer<typeof ShiftAttendance>;

export const ClockInInput = z.object({
  lat: z.number(),
  lng: z.number(),
  ticket_id: z.number().optional(),
});
export type ClockInInput = z.infer<typeof ClockInInput>;

export const ClockOutInput = z.object({
  lat: z.number(),
  lng: z.number(),
});
export type ClockOutInput = z.infer<typeof ClockOutInput>;

export const TodayAttendance = z.object({
  id: z.number().optional(),
  status: z.union([AttendanceStatus, z.literal('not_clocked_in')]),
  clock_in: z.string().nullable(),
  clock_out: z.string().nullable(),
  clock_in_lat: z.number().nullable(),
  clock_in_lng: z.number().nullable(),
  clock_out_lat: z.number().nullable(),
  clock_out_lng: z.number().nullable(),
});
export type TodayAttendance = z.infer<typeof TodayAttendance>;

export const TicketAttendanceLog = z.object({
  id: z.number(),
  ticket_id: z.number(),
  user_id: z.string(),
  action: z.string(),
  lat: z.number().nullable(),
  lng: z.number().nullable(),
  distance_from_site_meters: z.number().nullable(),
  is_manual_override: z.boolean(),
  created_at: z.string(),
});
export type TicketAttendanceLog = z.infer<typeof TicketAttendanceLog>;
