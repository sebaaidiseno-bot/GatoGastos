# Gato Gastos

App web para llevar las finanzas de la casa entre dos personas ("el gato" y "la gata"):
gastos comunes 50/50 con balance automático, cuentas mensuales o en cuotas, el pie del crédito
hipotecario, deseos, y una sección privada para cada uno.

- Frontend: un solo `index.html` (sin frameworks), servido como sitio estático en Vercel.
- Backend: Supabase (cuentas con correo y clave, base de datos con seguridad por filas, cambios en vivo).

## Puesta en marcha

### 1. Supabase
1. En **SQL Editor**, pega y ejecuta `supabase/schema.sql`.
2. Agrega los dos correos que pueden usar la app (el dueño es `gato`, su pareja `gata`):
   ```sql
   insert into public.permitidos (email, rol) values
     ('correo-del-gato@ejemplo.com', 'gato'),
     ('correo-de-la-gata@ejemplo.com', 'gata');
   ```
3. En **Authentication → URL Configuration**:
   - Site URL: `https://gatogastos.vercel.app`
   - Redirect URLs: `https://gatogastos.vercel.app/**`
4. En **Project Settings → API** copia la *Project URL* y la *anon / publishable key*.

### 2. Vercel
En **Settings → Environment Variables** del proyecto agrega:

| Nombre | Valor |
| --- | --- |
| `SUPABASE_URL` | Project URL de Supabase |
| `SUPABASE_ANON_KEY` | anon / publishable key |

Luego vuelve a desplegar (**Deployments → Redeploy**). Sin estas variables la app abre en modo ejemplo.

La anon key es pública por diseño: lo que protege los datos son las políticas de `schema.sql`
(solo los correos de `permitidos` pueden leer y escribir, y lo privado solo lo ve su dueño).

## Uso
- El gato entra a la app, toca **Crear cuenta** con su correo y una clave, y confirma desde el correo.
- En su perfil (foto arriba a la derecha) toca **Invitar a la gata**: le llega un enlace por correo,
  entra con él y la app le pide crear su clave.
- **¿Olvidaste tu clave?** en la pantalla de entrada envía un enlace para crear una nueva.
- Solo los correos de `permitidos` pueden crear cuenta.

## Desarrollo local
```bash
SUPABASE_URL=... SUPABASE_ANON_KEY=... node build.mjs
cd public && python3 -m http.server 8000
```
