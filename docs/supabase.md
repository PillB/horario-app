# Supabase environment variables

This project uses Supabase for backend services. Configure the following public environment variables before running the Expo app locally or in CI builds:

- `EXPO_PUBLIC_SUPABASE_URL`
- `EXPO_PUBLIC_SUPABASE_ANON_KEY`

These keys are exposed to the client runtime. Treat them as credentials that should not be stored in version control or shared outside trusted build systems.

## Local development (Expo)

1. Create a `.env` file in the project root based on `.env.example` and fill in your Supabase values:

   ```bash
   cp .env.example .env
   ```

2. Ensure your Expo config loads environment variables. If you use `app.config.ts`, import `dotenv/config` and read from `process.env`:

   ```ts
   // app.config.ts
   import 'dotenv/config';
   import { ExpoConfig } from 'expo/config';

   const config: ExpoConfig = {
     name: 'horario-app',
     slug: 'horario-app',
     extra: {
       supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL,
       supabaseAnonKey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
     },
   };

   export default config;
   ```

   If you rely on `app.json`, point to the `.env` file when starting Expo so the values are injected:

   ```bash
   EXPO_PUBLIC_SUPABASE_URL=... EXPO_PUBLIC_SUPABASE_ANON_KEY=... npx expo start
   ```

   or use `dotenv` at startup:

   ```bash
   export $(cat .env | xargs) && npx expo start
   ```

3. Run the app with `npx expo start`. Expo will read the environment variables and make them available as `process.env.EXPO_PUBLIC_SUPABASE_URL` and `process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY`.

## CI builds

- Configure your CI/CD pipeline (e.g., GitHub Actions, EAS Build) to set `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY` as environment variables or secrets.
- Avoid committing `.env` files. Instead, provide the values via the CI provider's secret management and expose them as environment variables at build time.
- For EAS, add the variables under **Build > Environment variables** or include them in your `eas.json` profile using the `env` block.

## Safe handling practices

- **Never commit secrets**: Add `.env` to `.gitignore` (already included by Expo) and keep actual keys out of version control.
- **Limit scope**: Use environment-specific keys (development vs. production) and avoid reusing keys across projects.
- **Rotation**: If a key is exposed or compromised, rotate it in Supabase, update the value in your CI secrets, and refresh the `.env` file locally.
- **Least privilege**: Use the anonymous public key for client-side calls and keep service role keys exclusively on trusted backends.

## Key rotation checklist

1. Generate a new anonymous key in the Supabase dashboard.
2. Update CI secrets and any deployment environments to the new values.
3. Replace the local `.env` entries and restart Expo (`npx expo start -c` to clear the cache if needed).
4. Invalidate old builds that might still embed the previous key.
