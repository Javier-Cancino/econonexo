# EconoNexo

Plataforma para obtener datos económicos de México de INEGI, Banxico y SHCP mediante un chat con IA.

## Configuración

### 1. Variables de entorno

Crea un archivo `.env` con las siguientes variables:

```env
DATABASE_URL="postgresql://user:password@localhost:5432/econonexo?schema=public"
NEXTAUTH_SECRET="genera-un-secreto-aleatorio"
NEXTAUTH_URL="http://localhost:3000"
GOOGLE_CLIENT_ID="tu-google-client-id"
GOOGLE_CLIENT_SECRET="tu-google-client-secret"
```

### 2. Obtener credenciales de Google OAuth

1. Ve a [Google Cloud Console](https://console.cloud.google.com/)
2. Crea un proyecto o selecciona uno existente
3. Ve a "Credenciales" → "Crear credenciales" → "ID de cliente OAuth"
4. Configura las URLs autorizadas:
   - Origen: `http://localhost:3000`
   - URI de redireccionamiento: `http://localhost:3000/api/auth/callback/google`

### 3. Base de datos

```bash
# Crear la base de datos PostgreSQL
createdb econonexo

# Ejecutar migraciones
npx prisma migrate dev --name init
```

### 4. Instalar dependencias y ejecutar

```bash
npm install
npm run dev
```

## Uso

1. **Login**: Accede con tu cuenta de Google
2. **Configuración**: Ve a Configuración y añade tus API Keys:
   - **LLM**: OpenAI, Google AI o Groq (al menos una)
   - **INEGI**: Token de [INEGI API](https://www.inegi.org.mx/servicios/api_indicadores.html)
   - **Banxico**: Token de [SIE API](https://www.banxico.org.mx/SieAPIRest/service/v1/)
   - **SHCP**: No requiere token (datos públicos)
3. **Chat**: Escribe tu consulta en lenguaje natural

## Ejemplos de consultas

- "Dame el tipo de cambio FIX de Banxico"
- "PIB de México de INEGI"
- "Deuda pública del Gobierno Federal de SHCP"
- "Tasa de desocupación de INEGI"

## APIs soportadas

| Fuente | Descripción | Auth |
|--------|-------------|------|
| INEGI | Indicadores socioeconómicos | Token |
| Banxico | Series financieras | Token |
| SHCP | Finanzas públicas | Sin auth |

## Tecnologías

- Next.js 14 (App Router)
- TypeScript
- Tailwind CSS
- Prisma ORM
- PostgreSQL
- NextAuth.js
- OpenAI / Google AI / Groq APIs