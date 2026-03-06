// reporters/email-reporter.cjs
require('dotenv/config')
const fs = require('fs')
const path = require('path')
const nodemailer = require('nodemailer')

function escapeHtml(s = '') { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;') }
function getTopFrameFromStack(stack = '') {
  try {
    const lines = String(stack || '').split('\n').map(l => l.trim()).filter(Boolean)
    for (const l of lines) {
      const m = l.match(/\(?(.+):(\d+):(\d+)\)?$/)
      if (m) return { raw: l, file: m[1], line: Number(m[2]), col: Number(m[3]) }
    }
  } catch (e) {}
  return null
}

// UPDATED: Renamed and added video extensions (.webm, .mp4)
function collectAttachments(result = {}) {
  const atts = []
  try {
    if (!Array.isArray(result.attachments)) return atts
    for (const a of result.attachments) {
      if (!a || !a.path) continue
      const ext = path.extname(a.path).toLowerCase()
      // Includes images AND videos
      if (['.png', '.jpg', '.jpeg', '.webp', '.gif', '.webm', '.mp4'].includes(ext)) {
        try { 
          if (fs.existsSync(a.path)) atts.push({ filename: path.basename(a.path), path: a.path }) 
        } catch (e) {}
      }
    }
  } catch (e) {}
  return atts
}

class EmailReporter {
  constructor() {
    this.issues = [] 
    this.stats = { passed: 0, failed: 0, skipped: 0, warnings: 0 }
  }

  onTestEnd(test, result) {
    // 1. Collect Stats
    if (result.status === 'passed') this.stats.passed++
    else if (result.status === 'failed' || result.status === 'timedOut') this.stats.failed++
    else this.stats.skipped++

    // Check for warnings
    const hasWarning = (result.annotations || []).some(a => a.type === 'warning')
    if (hasWarning) this.stats.warnings++

    // 2. Collect Details (Only if issue exists)
    if (result.status === 'failed' || result.status === 'timedOut' || hasWarning) {
      const base = {
        title: test.title,
        file: test.location?.file || 'unknown',
        line: test.location?.line || '',
        time: new Date().toLocaleString()
      }
      
      // UPDATED: Collect both images and videos
      const attachments = collectAttachments(result)

      if (result.status === 'failed' || result.status === 'timedOut') {
        this.issues.push(Object.assign({}, base, {
          type: 'failed',
          message: result.error?.message || 'Test failed',
          stack: result.error?.stack || '',
          files: attachments // Changed property name to 'files'
        }))
      } else if (hasWarning) {
         this.issues.push(Object.assign({}, base, {
          type: 'warning',
          message: (result.annotations.find(a => a.type === 'warning')?.description) || 'Warning',
          stack: '',
          files: attachments // Changed property name to 'files'
        }))
      }
    }
  }

  async onEnd() {
    const totalTests = this.stats.passed + this.stats.failed + this.stats.skipped

    // ---------------------------------------------------------
    // EMAIL 1: Daily Summary (To Shaily & Utkal) - ALWAYS SEND
    // ---------------------------------------------------------
    if (process.env.DAILY_REPORT_EMAILS) {
      const subject = this.stats.failed > 0 
        ? `⚠️ Daily Report: ${this.stats.failed} Issues Found` 
        : `✅ Daily Report: Website Working Fine`
      
      const text = `Hello Team,\n\nWebsite testing for https://datastore.geowgs84.com has completed.\n\n` +
                   `Status: ${this.stats.failed > 0 ? 'Issues Detected' : 'All Systems Operational'}\n\n` +
                   `Total Tests: ${totalTests}\n` +
                   `Passed: ${this.stats.passed}\n` +
                   `Failed: ${this.stats.failed}\n` +
                   `Warnings: ${this.stats.warnings}\n\n` +
                   `Regards,\nAutomation Team`

      const html = `
        <div style="font-family: Arial, sans-serif; padding: 20px; border: 1px solid #eee;">
          <h3>Datastore Website Testing Completed</h3>
          <p><strong>Website:</strong> <a href="https://datastore.geowgs84.com">https://datastore.geowgs84.com</a></p>
          <p><strong>Time:</strong> ${new Date().toLocaleString()}</p>
          <hr>
          <p><strong>Total Tests:</strong> ${totalTests}</p>
          <p><strong>Passed:</strong> <span style="color:green">${this.stats.passed}</span></p>
          <p><strong>Failed:</strong> <span style="color:red">${this.stats.failed}</span></p>
          <p><strong>Warnings:</strong> <span style="color:orange">${this.stats.warnings}</span></p>
        </div>
      `

      try {
        await this._sendMail(process.env.DAILY_REPORT_EMAILS, subject, text, html, [])
        console.log(`📧 Daily summary sent to: ${process.env.DAILY_REPORT_EMAILS}`)
      } catch (err) {
        console.error('❌ Failed to send daily summary:', err)
      }
    }

    // ---------------------------------------------------------
    // EMAIL 2: Failure Details (To Kapil) - ONLY IF ISSUES
    // ---------------------------------------------------------
    if (this.issues.length > 0 && process.env.FAILURE_ALERT_EMAILS) {
      const subject = `❌ Alert: ${this.stats.failed} Failures / ${this.stats.warnings} Warnings`
      
      // Flatten unique attachments (images + videos)
      const flattened = []
      const seen = new Set()
      for (const it of this.issues) {
        for (const file of it.files || []) {
          if (!seen.has(file.path)) { flattened.push(file); seen.add(file.path) }
        }
      }

      const htmlParts = []
      const textLines = []
      
      for (const it of this.issues) {
        const top = getTopFrameFromStack(it.stack)
        htmlParts.push(`
          <div style="padding:10px;margin:8px 0;border-radius:6px;border:1px solid #e6e6e6;">
            <strong>${it.type === 'failed' ? '❌ FAILURE' : '⚠️ WARNING'}</strong> &nbsp; <em>${escapeHtml(it.title)}</em><br/>
            <small>File: ${escapeHtml(it.file)}:${escapeHtml(it.line)} &nbsp; | &nbsp; Time: ${escapeHtml(it.time)}</small>
            <p style="margin:8px 0;padding:8px;background:#fafafa;border-radius:4px;white-space:pre-wrap;">${escapeHtml(it.message || '')}</p>
            ${ top ? `<div style="font-size:12px;color:#666">Top: ${escapeHtml(top.raw)}</div>` : '' }
            ${ (it.files && it.files.length) ? `<div style="margin-top:8px;font-size:13px;"><strong>Attachments:</strong> ${it.files.map(a => escapeHtml(a.filename)).join(', ')}</div>` : ''}
          </div>
        `)
        textLines.push(`${it.type.toUpperCase()} — ${it.title}\nFile: ${it.file}:${it.line}\nMessage: ${it.message}`)
      }

      try {
        await this._sendMail(process.env.FAILURE_ALERT_EMAILS, subject, textLines.join('\n\n'), `<!doctype html><body>${htmlParts.join('')}</body>`, flattened)
        console.log(`📧 Failure alert sent to: ${process.env.FAILURE_ALERT_EMAILS}`)
      } catch (err) {
        console.error('❌ Failed to send failure alert:', err)
      }
    } else if (!this.issues.length) {
      console.log('✅ No failures/warnings — skipping Kapil email.')
    }
  }

  async _sendMail(to, subject, text, html, attachments = []) {
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      secure: process.env.SMTP_SECURE === 'true' || false,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
    })

    const mailOptions = {
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      to, 
      subject,
      text,
      html,
      attachments
    }
    return transporter.sendMail(mailOptions)
  }
}

module.exports = EmailReporter
