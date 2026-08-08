import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    // Generous timeouts — the webhook tests build the full Fastify app, and
    // CI/dev machines can be slow on cold starts. 30s keeps the suite green
    // on slow Windows laptops where the 15s limit flaked under parallel load.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
