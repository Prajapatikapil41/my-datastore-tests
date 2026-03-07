// reporters/email-reporter.cjs
require('dotenv/config')
const fs = require('fs')
const path = require('path')
const nodemailer = require('nodemailer')

// Gmail has a 25MB limit, but we'll use 20MB to be safe
const MAX_EMAIL_SIZE_BYTES = 20 * 1024 * 1024

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

function formatBytes(bytes) {
  if (bytes === 0) return '0 Bytes'
  const k = 1024
  const sizes = ['Bytes', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
}

function collectAttachments(result = {}) {
  const atts = []
  try {
    if (!Array.isArray(result.attachments)) return atts
    for (const a of result.attachments) {
      if (!a || !a.path) continue
      const ext = path.extname(a.path).toLowerCase()
      // Only include images, skip videos for email (too large)
      if (['.png', '.jpg', '.jpeg', '.webp', '.gif'].includes(ext)) {
        try { 
          if (fs.existsSync(a.path)) {
            const stats = fs.statSync(a.path)
            atts.push({ 
              filename: path.basename(a.path), 
              path: a.path,
              size: stats.size
            }) 
          }
        } catch (e) {}
      }
    }
  } catch (e) {}
  return atts
}

function filterAttachmentsBySize(attachments, maxSizeBytes = MAX_EMAIL_SIZE_BYTES) {
  const validAttachments = []
  const skippedAttachments = []
  let totalSize = 0

  for (const att of attachments) {
    const size = att.size || 0
    if (totalSize + size <= maxSizeBytes) {
      validAttachments.push(att)
      totalSize += size
    } else {
      skippedAttachments.push(att)
    }
  }

  return { validAttachments, skippedAttachments, totalSize }
}

class EmailReporter {
  constructor() {
    this.issues = [] 
    this.stats = { passed: 0, failed: 0, skipped: 0, warnings: 0 }
  }

  onTestEnd(test, result) {
    if (result.status === 'passed') this.stats.passed++
    else if (result.status === 'failed' || result.status === 'timedOut') this.stats.failed++
    else this.stats.skipped++

    const hasWarning = (result.annotations || []).some(a => a.type === 'warning')
    if (hasWarning) this.stats.warnings++

    if (result.status === 'failed' || result.status === 'timedOut' || hasWarning) {
      const base = {
        title: test.title,
        file: test.location?.file || 'unknown',
        line: test.location?.line || '',
        time: new Date().toLocaleString()
      }
      
      const attachments = collectAttachments(result)

      if (result.status === 'failed' || result.status === 'timedOut') {
        this.issues.push(Object.assign({}, base, {
          type: 'failed',
          message: result.error?.message || 'Test failed',
          stack: result.error?.stack || '',
          files: attachments
        }))
      } else if (hasWarning) {
         this.issues.push(Object.assign({}, base, {
          type: 'warning',
          message: (result.annotations.find(a => a.type === 'warning')?.description) || 'Warning',
          stack: '',
          files: attachments
        }))
      }
    }
  }

  async onEnd() {
    const totalTests = this.stats.passed + this.stats.failed + this.stats.skipped

    // ---------------------------------------------------------
    // EMAIL 1: Daily Summary (NO ATTACHMENTS)
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
    // EMAIL 2: Failure Details (WITH ATTACHMENTS - filtered by size)
    // ---------------------------------------------------------
    if (this.issues.length > 0 && process.env.FAILURE_ALERT_EMAILS) {
      const subject = `❌ Alert: ${this.stats.failed} Failures / ${this.stats.warnings} Warnings`
      
      // Collect all attachments and filter by size
      const allAttachments = []
      const seen = new Set()
      for (const it of this.issues) {
        for (const file of it.files || []) {
          if (!seen.has(file.path)) { allAttachments.push(file); seen.add(file.path) }
        }
      }

      const { validAttachments, skippedAttachments, totalSize } = filterAttachmentsBySize(allAttachments)

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
          </div>
        `)
        textLines.push(`${it.type.toUpperCase()} — ${it.title}\nFile: ${it.file}:${it.line}\nMessage: ${it.message}`)
      }

      // Add info about attachments
      if (validAttachments.length > 0 || skippedAttachments.length > 0) {
        htmlParts.push(`
          <div style="margin-top:15px;padding:10px;background:#f5f5f5;border-radius:4px;font-size:12px;">
            <strong>Attachments:</strong><br/>
            ${validAttachments.map(a => `📷 ${escapeHtml(a.filename)} (${formatBytes(a.size)})`).join('<br/>')}
            ${skippedAttachments.length > 0 ? `<br/><br/><em style="color:#888;">⚠️ ${skippedAttachments.length} attachment(s) skipped due to size limit (videos/large files). Check CI artifacts for full details.</em>` : ''}
          </div>
        `)
      }

      try {
        // Only pass valid (size-filtered) attachments
        await this._sendMail(
          process.env.FAILURE_ALERT_EMAILS, 
          subject, 
          textLines.join('\n\n'), 
          `<!doctype html><body>${htmlParts.join('')}</body>`, 
          validAttachments
        )
        console.log(`📧 Failure alert sent to: ${process.env.FAILURE_ALERT_EMAILS}`)
        if (skippedAttachments.length > 0) {
          console.log(`⚠️ ${skippedAttachments.length} attachment(s) skipped due to size limit`)
        }
      } catch (err) {
        console.error('❌ Failed to send failure alert:', err)
        // Fallback: try sending without any attachments
        try {
          console.log('📧 Retrying email without attachments...')
          await this._sendMail(
            process.env.FAILURE_ALERT_EMAILS, 
            subject + ' (No Attachments)', 
            textLines.join('\n\n'), 
            `<!doctype html><body>${htmlParts.join('')}<p style="color:#888;font-size:12px;">Attachments were removed due to email size limits. Check CI artifacts for screenshots/videos.</p></body>`, 
            []
          )
          console.log('📧 Failure alert sent without attachments')
        } catch (retryErr) {
          console.error('❌ Failed to send failure alert even without attachments:', retryErr)
        }
      }
    } else if (!this.issues.length) {
      console.log('✅ No failures/warnings — skipping failure alert email.')
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
      attachments: attachments.map(a => ({ filename: a.filename, path: a.path }))
    }
    return transporter.sendMail(mailOptions)
  }
}

module.exports = EmailReporter
