import { serve } from 'https://deno.land/std@0.208.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';

function jsonRes(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

async function authenticate(): Promise<{ sb: ReturnType<typeof createClient>; userId: string } | Response> {
  const email = Deno.env.get('ZAPIA_EMAIL');
  const password = Deno.env.get('ZAPIA_PASSWORD');
  if (!email || !password) return jsonRes({ error: 'Credenciales IA no configuradas en el servidor' }, 500);

  const anonUrl = Deno.env.get('SUPABASE_URL')!;
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

  const sb = createClient(anonUrl, anonKey);
  const { data: auth, error: authErr } = await sb.auth.signInWithPassword({ email, password });
  if (authErr || !auth?.user) return jsonRes({ error: 'Credenciales IA inválidas' }, 401);

  const { data: userDoc } = await sb
    .from('usuarios')
    .select('data')
    .eq('id', auth.user.id)
    .single();

  if (userDoc?.data?.rol !== 'ia') return jsonRes({ error: 'Rol no autorizado' }, 403);

  const adminSb = createClient(anonUrl, serviceKey);
  return { sb: adminSb, userId: auth.user.id };
}

async function handleAttendance(sb: ReturnType<typeof createClient>, payload: Record<string, unknown>) {
  const { month, week, data } = payload as { month: string; week: string; data: Record<string, unknown> };
  if (!month || !week || !data) return jsonRes({ error: 'Faltan campos: month, week, data' }, 400);

  const id = `activity:${month}`;
  const { data: existing } = await sb.from('informes').select('data').eq('id', id).single();

  const report = existing?.data || { id, people: {} };
  if (!report.people) report.people = {};

  report.people[week] = {
    actividad: true,
    publicadores: Number(data.publishers) || 0,
    auxiliares: Number(data.auxiliary) || 0,
    horas: Number(data.hours) || 0,
    visitantes: Number(data.visitors) || 0,
    notas: data.notes || '',
    updatedAt: new Date().toISOString(),
  };

  const { error } = await sb
    .from('informes')
    .upsert({ id, data: report, updated_at: new Date().toISOString() }, { onConflict: 'id' });

  if (error) return jsonRes({ error: error.message }, 500);
  return jsonRes({ ok: true, id, week });
}

async function handlePerson(sb: ReturnType<typeof createClient>, payload: Record<string, unknown>) {
  const { data } = payload as { data: Record<string, unknown> };
  const name = String(data?.name || '').trim();
  if (!name) return jsonRes({ error: 'Falta campo: data.name' }, 400);

  const person: Record<string, unknown> = {
    name,
    genero: data.genero || '',
    calificacion: data.calificacion || '',
    labores: Array.isArray(data.labores) ? data.labores : [],
    grupoId: data.grupoId || '',
    nacimiento: data.nacimiento || '',
    bautismo: data.bautismo || '',
    email: data.email || '',
    telefono: data.telefono || '',
    notas: data.notas || '',
    activo: true,
  };

  const { data: existing } = await sb
    .from('participantes')
    .select('id, data')
    .ilike('data->>name', name)
    .limit(1)
    .single();

  if (existing) {
    const merged = { ...existing.data, ...person };
    const { error } = await sb
      .from('participantes')
      .update({ data: merged, updated_at: new Date().toISOString() })
      .eq('id', existing.id);
    if (error) return jsonRes({ error: error.message }, 500);
    return jsonRes({ ok: true, id: existing.id, updated: true });
  }

  const id = crypto.randomUUID();
  const { error } = await sb
    .from('participantes')
    .insert({ id, data: person, updated_at: new Date().toISOString() });
  if (error) return jsonRes({ error: error.message }, 500);
  return jsonRes({ ok: true, id, created: true });
}

async function handleAssignment(sb: ReturnType<typeof createClient>, payload: Record<string, unknown>) {
  const { month, week, assignments } = payload as {
    month: string;
    week: string;
    assignments: Record<string, string>;
  };
  if (!month || !week || !assignments) return jsonRes({ error: 'Faltan campos: month, week, assignments' }, 400);

  const { data: existing } = await sb.from('programas').select('data').eq('id', month).single();
  const program = existing?.data || { midweeks: [] };

  let mw = program.midweeks?.find((w: Record<string, unknown>) => w.id === week);
  if (!mw) {
    if (!program.midweeks) program.midweeks = [];
    mw = { id: week, presidente: '', sections: [] };
    program.midweeks.push(mw);
  }

  for (const [field, personId] of Object.entries(assignments)) {
    if (field === 'presidente') {
      mw.presidente = personId;
    } else {
      for (const sec of mw.sections || []) {
        for (const part of sec.parts || []) {
          if (!part.assignments) part.assignments = {};
          if (field in part.assignments && !part.assignments[field]) {
            part.assignments[field] = personId;
          }
        }
      }
    }
  }

  const { error } = await sb
    .from('programas')
    .upsert({ id: month, data: program, updated_at: new Date().toISOString() }, { onConflict: 'id' });
  if (error) return jsonRes({ error: error.message }, 500);
  return jsonRes({ ok: true, month, week });
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return jsonRes({ error: 'Method not allowed' }, 405);

  const authResult = await authenticate();
  if (authResult instanceof Response) return authResult;

  const { sb } = authResult;
  let payload: Record<string, unknown>;
  try {
    payload = await req.json();
  } catch {
    return jsonRes({ error: 'JSON inválido' }, 400);
  }

  try {
    switch (payload.action) {
      case 'attendance': return await handleAttendance(sb, payload);
      case 'person': return await handlePerson(sb, payload);
      case 'assignment': return await handleAssignment(sb, payload);
      default: return jsonRes({ error: `Acción desconocida: ${payload.action}` }, 400);
    }
  } catch (err) {
    return jsonRes({ error: err.message || 'Error interno' }, 500);
  }
});
