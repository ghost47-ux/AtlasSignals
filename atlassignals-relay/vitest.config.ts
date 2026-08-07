import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    // Generous timeouts — the webhook tests build the full Fastify app, and
    // CI/dev machines can be slow on cold starts.
    testTimeout: 15_000,
    hookTimeout: 15_000,
  },
});
