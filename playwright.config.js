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
    headless: process.env.CI ? true : false,
    
    // ✅ ENABLE SCREENSHOTS ON FAILURE
    screenshot: 'only-on-failure', 
    
    // ✅ ENABLE VIDEO ON FAILURE
    // 'retain-on-failure' is best for your case: 
    // it records every test, but deletes the video if the test passes.
    video: 'retain-on-failure', 
    
    trace: 'on-first-retry',
    viewport: null // Added based on your project config
  },

  projects: [
    {
      name: 'chromium',
      use: {
        // viewport: null is moved to global use above, or keep here if preferred
      }
    }
  ],

  timeout: 1100000
})
