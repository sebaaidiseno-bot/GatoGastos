// Copia los archivos estáticos a public/ y escribe config.js con las variables de entorno de Vercel.
// La "anon key" de Supabase es pública por diseño: los datos los protege la seguridad por filas (RLS).
import { mkdirSync, copyFileSync, writeFileSync } from 'node:fs';

const out = 'public';
mkdirSync(out, { recursive: true });
for (const f of ['index.html', 'manifest.webmanifest', 'apple-touch-icon.png', 'icon-192.png', 'icon-512.png']) {
  copyFileSync(f, `${out}/${f}`);
}
const env = process.env;
const config = {
  url: env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL || '',
  anonKey: env.SUPABASE_ANON_KEY || env.NEXT_PUBLIC_SUPABASE_ANON_KEY || env.SUPABASE_PUBLISHABLE_KEY || env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || '',
};
writeFileSync(`${out}/config.js`, `window.GG_CONFIG=${JSON.stringify(config)};\n`);
console.log(config.url ? `Supabase configurado: ${config.url}` : 'Aviso: faltan SUPABASE_URL y SUPABASE_ANON_KEY; la app abrirá en modo ejemplo.');
