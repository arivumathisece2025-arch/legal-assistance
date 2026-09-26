import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  use: {
    baseURL: 'http://localhost:4173', // Frontend URL
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: [
    {
      // 1. Start the API server. APP_ENCRYPTION_KEY is required by the upload
      //    path, which refuses to store a document without it.
      command: 'PORT=3000 APP_ENCRYPTION_KEY=6bd79b85fcddaa9d498f6b83871ad71229730ecf40ce76f0f93f8e85a63c2912 pnpm --filter @workspace/api-server run dev',
      port: 3000,
      reuseExistingServer: !process.env.CI,
      timeout: 60000,
    },
    {
      // 2. Build and preview the frontend. API_PORT lets the Vite proxy
      //    forward the SPA's relative `/api/*` calls to the server above.
      command: 'PORT=4173 BASE_PATH=/ API_PORT=3000 pnpm --filter @workspace/clause-compass run build && PORT=4173 BASE_PATH=/ API_PORT=3000 pnpm --filter @workspace/clause-compass run serve',
      port: 4173,
      reuseExistingServer: !process.env.CI,
      timeout: 180000,
    }
  ],
});





