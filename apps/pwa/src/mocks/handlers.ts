import { http, HttpResponse } from 'msw';
import type { TicketStatus } from '@city-os/schemas';

const tickets = [
  {
    id: 1,
    ticket_uid: 'MOB-001',
    title: 'Pothole on Jalan Skudai',
    description: 'Large pothole near the shopping mall causing traffic hazard.',
    status: 'OPEN' as TicketStatus,
    lat: 1.4920,
    lng: 103.7410,
    location_desc: 'Jalan Skudai, Johor Bahru',
    assigned_to: 'me',
    department_id: 1,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: 2,
    ticket_uid: 'MOB-002',
    title: 'Streetlight outage at Taman University',
    description: 'Streetlights not working along Jalan Universiti for 3 days.',
    status: 'IN_PROGRESS' as TicketStatus,
    lat: 1.4940,
    lng: 103.7420,
    location_desc: 'Taman Universiti, Johor Bahru',
    assigned_to: 'me',
    department_id: 2,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: 3,
    ticket_uid: 'MOB-003',
    title: 'Illegal dumping at Jalan Kebun Teh',
    description: 'Construction waste dumped on roadside.',
    status: 'ASSIGNED' as TicketStatus,
    lat: 1.4800,
    lng: 103.7350,
    location_desc: 'Jalan Kebun Teh, Johor Bahru',
    assigned_to: 'me',
    department_id: 3,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
];

let ticketStore = [...tickets];
let attendanceRecord: { status: string; clock_in: string | null; clock_out: string | null } = {
  status: 'not_clocked_in',
  clock_in: null,
  clock_out: null,
};

export const handlers = [
  http.get('*/api/v1/events', () => {
    return HttpResponse.json(ticketStore);
  }),

  http.get('*/api/v1/events/:id', ({ params }) => {
    const ticket = ticketStore.find((t) => t.id === Number(params.id));
    if (!ticket) return new HttpResponse(null, { status: 404 });
    return HttpResponse.json(ticket);
  }),

  http.patch('*/api/v1/events/:id/transition', async ({ params, request }) => {
    const ticket = ticketStore.find((t) => t.id === Number(params.id));
    if (!ticket) return new HttpResponse(null, { status: 404 });
    const body = (await request.json()) as any;
    ticket.status = body.status || ticket.status;
    return HttpResponse.json(ticket);
  }),

  http.get('*/api/v1/attendance/today', () => {
    return HttpResponse.json(attendanceRecord);
  }),

  http.post('*/api/v1/attendance/clock-in', () => {
    const now = new Date().toISOString();
    attendanceRecord = {
      status: 'present',
      clock_in: now,
      clock_out: null,
    };
    return HttpResponse.json({ id: 1, status: 'present', clock_in: now });
  }),

  http.post('*/api/v1/attendance/clock-out', () => {
    const now = new Date().toISOString();
    if (attendanceRecord.clock_in) {
      attendanceRecord.clock_out = now;
    }
    return HttpResponse.json({ id: 1, clock_out: now });
  }),
];