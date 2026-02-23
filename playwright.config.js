// @ts-check
import { defineConfig } from '@playwright/test'
import 'dotenv/config'

export default defineConfig({
  testDir: './tests',

  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,

  reporter: [
    ['list'],
    ['html'],
    ['./reporters/email-reporter.cjs']
  ],

  use: {
    headless: process.env.CI ? true : false,   // ✅ Headless in GitHub
    trace: 'on-first-retry'
  },

  projects: [
    {
      name: 'chromium',
      use: {
        viewport: null
      }
    }
  ],

  timeout: 600000
})
