import { getSupabaseClient } from './supabaseClient';

export type AvailabilitySlot = {
  id?: string;
  workerId: string;
  day: string;
  from: string;
  to: string;
};

export type Worker = {
  id: string;
  name: string;
  role: string;
  skills: string[];
  availability: AvailabilitySlot[];
};

export type Shift = {
  id: string;
  date: string;
  workerId: string;
  templateId: string;
  location?: string;
  status?: 'Draft' | 'Published';
};

type OperationResult = { success: boolean; message?: string };

type SchedulerData = {
  workers: Worker[];
  shifts: Shift[];
};

const parseSkills = (value: unknown): string[] => {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string');
  if (typeof value === 'string') {
    return value
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [];
};

const mapWorkerRow = (row: any): Worker => ({
  id: row.id ?? row.worker_id ?? '',
  name: row.name ?? row.full_name ?? 'Unnamed worker',
  role: row.role ?? row.title ?? 'Unknown',
  skills: parseSkills(row.skills),
  availability: [],
});

const mapAvailabilityRow = (row: any): AvailabilitySlot => ({
  id:
    row.id?.toString?.() ??
    `${row.worker_id ?? row.workerId ?? 'worker'}-${row.day ?? row.weekday ?? 'day'}-${row.from_time ?? row.from ?? ''}-${
      row.to_time ?? row.to ?? ''
    }`,
  workerId: row.worker_id ?? row.workerId ?? '',
  day: row.day ?? row.weekday ?? '',
  from: row.from_time ?? row.from ?? '',
  to: row.to_time ?? row.to ?? '',
});

const mapShiftRow = (row: any): Shift => ({
  id:
    row.id?.toString?.() ?? `${row.worker_id ?? row.workerId ?? 'worker'}-${row.date ?? 'date'}-${row.template_id ?? 'template'}`,
  date: row.date ?? '',
  workerId: row.worker_id ?? row.workerId ?? '',
  templateId: row.template_id ?? row.templateId ?? '',
  location: row.location ?? undefined,
  status: (row.status as 'Draft' | 'Published' | undefined) ?? 'Draft',
});

export const loadSchedulerData = async (): Promise<SchedulerData> => {
  const client = getSupabaseClient();
  if (!client) return { workers: [], shifts: [] };

  const [workersResponse, availabilityResponse, shiftsResponse] = await Promise.all([
    client.from('workers').select('id, name, role, skills'),
    client.from('worker_availability').select('id, worker_id, day, from_time, to_time'),
    client.from('shifts').select('id, date, worker_id, template_id, location, status'),
  ]);

  if (workersResponse.error) {
    console.warn('Unable to load workers', workersResponse.error.message);
  }
  if (availabilityResponse.error) {
    console.warn('Unable to load worker availability', availabilityResponse.error.message);
  }
  if (shiftsResponse.error) {
    console.warn('Unable to load shifts', shiftsResponse.error.message);
  }

  const workers = (workersResponse.data ?? []).map(mapWorkerRow);
  const availabilityLookup = new Map<string, AvailabilitySlot[]>();
  (availabilityResponse.data ?? []).forEach((row) => {
    const slot = mapAvailabilityRow(row);
    if (!slot.workerId || !slot.day || !slot.from || !slot.to) return;
    const existing = availabilityLookup.get(slot.workerId) ?? [];
    availabilityLookup.set(slot.workerId, [...existing, slot]);
  });

  const workerLookup = new Map<string, Worker>();
  workers.forEach((worker) => {
    workerLookup.set(worker.id, { ...worker, availability: availabilityLookup.get(worker.id) ?? [] });
  });

  const shifts = (shiftsResponse.data ?? [])
    .map(mapShiftRow)
    .filter((shift) => shift.workerId && shift.date && shift.templateId);

  return { workers: Array.from(workerLookup.values()), shifts };
};

export const upsertWorker = async (worker: Worker): Promise<OperationResult> => {
  const client = getSupabaseClient();
  if (!client) return { success: true, message: 'Supabase not configured; saved locally only.' };

  const payload = {
    id: worker.id,
    name: worker.name,
    role: worker.role,
    skills: worker.skills,
  };

  const { error } = await client.from('workers').upsert(payload, { onConflict: 'id' });
  if (error) {
    console.warn('Unable to upsert worker', error.message);
    return { success: false, message: error.message };
  }

  return { success: true, message: 'Worker saved' };
};

export const upsertAvailabilitySlot = async (slot: AvailabilitySlot): Promise<OperationResult> => {
  const client = getSupabaseClient();
  if (!client) return { success: true, message: 'Supabase not configured; saved locally only.' };

  const payload = {
    worker_id: slot.workerId,
    day: slot.day,
    from_time: slot.from,
    to_time: slot.to,
  };

  const { error } = await client
    .from('worker_availability')
    .upsert(payload, { onConflict: 'worker_id,day,from_time,to_time' });
  if (error) {
    console.warn('Unable to upsert availability', error.message);
    return { success: false, message: error.message };
  }

  return { success: true, message: 'Availability saved' };
};

export const upsertShift = async (shift: Shift): Promise<OperationResult> => {
  const client = getSupabaseClient();
  if (!client) return { success: true, message: 'Supabase not configured; saved locally only.' };

  const payload = {
    id: shift.id,
    date: shift.date,
    worker_id: shift.workerId,
    template_id: shift.templateId,
    location: shift.location,
    status: shift.status ?? 'Draft',
  };

  const { error } = await client
    .from('shifts')
    .upsert(payload, { onConflict: 'worker_id,date,template_id' });
  if (error) {
    console.warn('Unable to upsert shift', error.message);
    return { success: false, message: error.message };
  }

  return { success: true, message: 'Shift saved' };
};
