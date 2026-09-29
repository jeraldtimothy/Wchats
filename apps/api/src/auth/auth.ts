import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { eq } from 'drizzle-orm';
import { provisionUser } from '../accounts/provision.js';
import { db } from '../db/client.js';
import * as schema from '../db/schema.js';
import { env } from '../env.js';

export const googleAuthEnabled = Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);

export const auth = betterAuth({
  appName: 'LiteChat',
  baseURL: env.BETTER_AUTH_URL,
  basePath: '/api/auth',
  secret: env.BETTER_AUTH_SECRET,
  trustedOrigins: [env.WEB_ORIGIN],
  database: drizzleAdapter(db, {
    provider: 'pg',
    schema: {
      user: schema.user,
      session: schema.session,
      account: schema.account,
      verification: schema.verification,
    },
  }),
  emailAndPassword: { enabled: true, minPasswordLength: 8 },
  socialProviders: googleAuthEnabled
    ? { google: { clientId: env.GOOGLE_CLIENT_ID!, clientSecret: env.GOOGLE_CLIENT_SECRET! } }
    : {},
  session: {
    expiresIn: 60 * 60 * 24 * 30,
    updateAge: 60 * 60 * 24,
  },
  advanced: {
    cookiePrefix: 'litechat',
    useSecureCookies: env.BETTER_AUTH_URL.startsWith('https://'),
  },
  databaseHooks: {
    user: {
      create: {
        after: async (user) => {
          await provisionUser(db, user);
        },
      },
    },
    session: {
      create: {
        // Disabled users cannot sign in.
        before: async (session) => {
          const profile = await db.query.profiles.findFirst({
            where: eq(schema.profiles.userId, session.userId),
          });
          if (profile?.isDisabled) return false;
        },
      },
    },
  },
});
