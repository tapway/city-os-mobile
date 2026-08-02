import { z } from 'zod';

export const TicketStatus = z.enum([
  'OPEN', 'VERIFIED', 'ASSIGNED', 'IN_PROGRESS', 'RESOLVED', 'CLOSED',
]);
export type TicketStatus = z.infer<typeof TicketStatus>;

export const Ticket = z.object({
  id: z.number(),
  ticket_uid: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  status: TicketStatus,
  lat: z.number().nullable(),
  lng: z.number().nullable(),
  location_desc: z.string().nullable(),
  assigned_to: z.string().nullable(),
  department_id: z.number().nullable(),
  created_at: z.string().nullable(),
  updated_at: z.string().nullable(),
});
export type Ticket = z.infer<typeof Ticket>;

export const TicketList = z.array(Ticket);
export type TicketList = z.infer<typeof TicketList>;

export const CreateTicketInput = z.object({
  title: z.string().min(1).max(500),
  description: z.string().optional(),
  lat: z.number().optional(),
  lng: z.number().optional(),
  source: z.literal('mobile'),
  lane: z.literal('A'),
});
export type CreateTicketInput = z.infer<typeof CreateTicketInput>;

export const TransitionTicketInput = z.object({
  status: TicketStatus,
  note: z.string().optional(),
  lat: z.number().optional(),
  lng: z.number().optional(),
});
export type TransitionTicketInput = z.infer<typeof TransitionTicketInput>;
