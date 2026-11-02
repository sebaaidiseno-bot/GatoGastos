// Entrada con usuario y creación de cuenta con código de invitación.
// Las claves de Supabase las entrega el propio entorno de la función: nunca van en el repositorio.
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';

const URL_SB = Deno.env.get('SUPABASE_URL')!;
const ANON = Deno.env.get('SUPABASE_ANON_KEY')!;
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const DOMINIO = 'sin-correo.gatogastos.vercel.app';
const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const resp = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
const falla = (status: number, error: string) => resp(status, { error });

async function huella(codigo: string) {
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(codigo));
  return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');
}

async function sesion(email: string, clave: string) {
  const { data, error } = await createClient(URL_SB, ANON, opts).auth.signInWithPassword({ email, password: clave });
  if (error || !data.session) return null;
  return { access_token: data.session.access_token, refresh_token: data.session.refresh_token };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return falla(405, 'Método no permitido.');
  const b = await req.json().catch(() => ({}));
  const usuario = String(b.usuario || '').trim().toLowerCase();
  const clave = String(b.clave || '');
  const admin = createClient(URL_SB, SERVICE, opts);

  if (b.accion === 'entrar') {
    const incorrecto = 'Usuario o clave incorrectos.';
    const { data: m } = await admin.from('miembros').select('user_id').eq('usuario', usuario).maybeSingle();
    if (!m) return falla(400, incorrecto);
    const { data: u } = await admin.auth.admin.getUserById(m.user_id);
    const s = u?.user?.email ? await sesion(u.user.email, clave) : null;
    return s ? resp(200, { session: s }) : falla(400, incorrecto);
  }

  if (b.accion === 'crear') {
    const codigo = String(b.codigo || '').trim().toUpperCase();
    if (!/^[a-z0-9._-]{3,24}$/.test(usuario)) return falla(400, 'El usuario debe tener de 3 a 24 letras o números, sin espacios.');
    if (clave.length < 6) return falla(400, 'La clave debe tener al menos 6 caracteres.');
    const { data: ocupado } = await admin.from('miembros').select('user_id').eq('usuario', usuario).maybeSingle();
    if (ocupado) return falla(400, 'Ese usuario ya existe. Elige otro.');

    // Reclama el código de una sola vez: si dos intentos llegan juntos, solo uno lo obtiene.
    const hash = await huella(codigo);
    const { data: cod } = await admin.from('codigos_invitacion').update({ usado_en: new Date().toISOString() })
      .eq('hash', hash).is('usado_en', null).gt('expira_en', new Date().toISOString()).select('rol').maybeSingle();
    if (!cod) return falla(400, 'El código no es válido o ya venció. Pide uno nuevo.');

    const email = `${crypto.randomUUID()}@${DOMINIO}`;
    let userId: string | undefined;
    try {
      // El trigger solo_permitidos exige que el correo esté en permitidos.
      const { error: e1 } = await admin.from('permitidos').insert({ email, rol: cod.rol });
      if (e1) throw e1;
      const { data: nuevo, error: e2 } = await admin.auth.admin.createUser({
        email, password: clave, email_confirm: true, user_metadata: { tiene_clave: true },
      });
      if (e2) throw e2;
      userId = nuevo.user.id;
      const { error: e3 } = await admin.from('miembros').insert({ user_id: userId, usuario, rol: cod.rol });
      if (e3) throw e3;
    } catch (e) {
      console.error('crear cuenta', e);
      if (userId) await admin.auth.admin.deleteUser(userId);
      await admin.from('permitidos').delete().eq('email', email);
      await admin.from('codigos_invitacion').update({ usado_en: null }).eq('hash', hash);
      return falla(500, 'No se pudo crear la cuenta. Intenta de nuevo.');
    }
    const s = await sesion(email, clave);
    return s ? resp(200, { session: s }) : falla(500, 'La cuenta se creó, pero no se pudo entrar. Prueba con la pestaña Entrar.');
  }

  if (b.accion === 'pedir_codigo') {
    // Misma respuesta exista o no el usuario, y como máximo un código cada 10 minutos.
    const listo = resp(200, { ok: true });
    const { data: m } = await admin.from('miembros').select('user_id').eq('usuario', usuario).maybeSingle();
    if (!m) return listo;
    const { data: previo } = await admin.from('codigos_recuperacion').select('creado_en').eq('user_id', m.user_id).maybeSingle();
    if (previo && Date.now() - new Date(previo.creado_en).getTime() < 10 * 60 * 1000) return listo;

    const { data: gato } = await admin.from('miembros').select('user_id').eq('rol', 'gato').maybeSingle();
    const { data: dueno } = gato ? await admin.auth.admin.getUserById(gato.user_id) : { data: null };
    const destino = dueno?.user?.email;
    const llave = Deno.env.get('RESEND_API_KEY');
    if (!destino || !llave) return falla(503, 'El envío de códigos aún no está configurado.');

    const codigo = crypto.randomUUID().replaceAll('-', '').slice(0, 10).toUpperCase();
    const { error: e1 } = await admin.from('codigos_recuperacion').upsert({
      user_id: m.user_id, hash: await huella(codigo), creado_en: new Date().toISOString(),
      expira_en: new Date(Date.now() + 30 * 60 * 1000).toISOString(), intentos: 0,
    });
    if (e1) { console.error('guardar código', e1); return falla(500, 'No se pudo crear el código. Intenta de nuevo.'); }
    const envio = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${llave}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'Gato Gastos <onboarding@resend.dev>', to: [destino],
        subject: `Código para recuperar la clave de ${usuario}`,
        text: `Código para recuperar la clave de "${usuario}": ${codigo}\n\nVence en 30 minutos y sirve una sola vez. Pásaselo solo a esa persona.`,
      }),
    });
    if (!envio.ok) {
      console.error('enviar código', envio.status, await envio.text());
      await admin.from('codigos_recuperacion').delete().eq('user_id', m.user_id);
      return falla(502, 'No se pudo enviar el código. Intenta de nuevo.');
    }
    return listo;
  }

  if (b.accion === 'restablecer') {
    const invalido = 'El código no es válido o ya venció. Pide uno nuevo.';
    if (clave.length < 6) return falla(400, 'La clave debe tener al menos 6 caracteres.');
    const { data: m } = await admin.from('miembros').select('user_id').eq('usuario', usuario).maybeSingle();
    if (!m) return falla(400, invalido);
    const { data: fila } = await admin.from('codigos_recuperacion').select('hash, expira_en, intentos').eq('user_id', m.user_id).maybeSingle();
    if (!fila || fila.intentos >= 5 || new Date(fila.expira_en).getTime() < Date.now()) return falla(400, invalido);
    const hash = await huella(String(b.codigo || '').trim().toUpperCase());
    if (hash !== fila.hash) {
      await admin.from('codigos_recuperacion').update({ intentos: fila.intentos + 1 }).eq('user_id', m.user_id);
      return falla(400, invalido);
    }
    // Consume el código de una sola vez: si dos intentos llegan juntos, solo uno sigue.
    const { data: usado } = await admin.from('codigos_recuperacion').delete().eq('user_id', m.user_id).eq('hash', hash).select('user_id');
    if (!usado?.length) return falla(400, invalido);
    const { data: u, error } = await admin.auth.admin.updateUserById(m.user_id, { password: clave });
    if (error || !u.user.email) { console.error('restablecer', error); return falla(500, 'No se pudo cambiar la clave. Pide un código nuevo.'); }
    const s = await sesion(u.user.email, clave);
    return s ? resp(200, { session: s }) : falla(500, 'La clave se cambió, pero no se pudo entrar. Prueba con la pestaña Entrar.');
  }

  return falla(400, 'Acción desconocida.');
});
