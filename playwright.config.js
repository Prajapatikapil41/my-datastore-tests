// @ts-check
import { defineConfig } from '@playwright/test'
import 'dotenv/config'

export default defineConfig({
  testDir: './tests',

  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,

  reporter: [
    ['list'],                              // Console reporter
    ['html'],                              // HTML report
    ['./reporters/email-reporter.cjs']     // Custom email reporter
  ],

  use: {
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
