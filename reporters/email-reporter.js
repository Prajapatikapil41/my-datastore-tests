// reporters/email-reporter.js (ESM) - simple email: where/what + screenshot attachments
import 'dotenv/config'
import fs from 'fs'
import path from 'path'
import os from 'os'
import nodemailer from 'nodemailer'

function readIfExists(p) { try { return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null } catch { return null } }
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

function collectImageAttachments(result = {}) {
  const atts = []

  if (!result || !Array.isArray(result.attachments)) {
    return atts
  }

  for (const a of result.attachments) {
    if (!a || !a.path) continue

    try {
      if (!fs.existsSync(a.path)) continue

      const ext = path.extname(a.path).toLowerCase()
      if (['.png', '.jpg', '.jpeg', '.webp', '.gif'].includes(ext)) {
        atts.push({
          filename: path.basename(a.path),
          path: a.path
        })
      }
    } catch {}
  }

  return atts
}


export default class EmailReporter {
  constructor() { this.issues = [] }

  onTestEnd(test, result) {
    const base = { title: test.title, file: test.location?.file || 'unknown', line: test.location?.line || '', time: new Date().toLocaleString() }
    const images = collectImageAttachments(result)

    if (result.status === 'failed' || result.status === 'timedOut') {
      this.issues.push(Object.assign({}, base, { type: 'failed', message: result.error?.message || 'Test failed', stack: result.error?.stack || '', images }))
    }

    for (const ann of result.annotations || []) {
      if (ann.type === 'warning') {
        this.issues.push(Object.assign({}, base, { type: 'warning', message: ann.description || 'Warning', stack: '', images }))
      }
    }
  }

  async onEnd() {
    if (!this.issues.length) { console.log('✅ No failures/warnings — skipping email.'); return }
    const failuresCount = this.issues.filter(i => i.type === 'failed').length
    const warningsCount = this.issues.filter(i => i.type === 'warning').length
    const subject = failuresCount ? `❌ Tests: ${failuresCount} failures, ${warningsCount} warnings` : `⚠️ Tests: ${warningsCount} warnings`

    const flattened = []
    const seen = new Set()
    for (const it of this.issues) for (const img of it.images || []) if (!seen.has(img.path)) { flattened.push(img); seen.add(img.path) }

    const htmlParts = []
    const textLines = []
    textLines.push(`Playwright quick report — ${new Date().toLocaleString()}`)
    textLines.push(`Failures: ${failuresCount}  Warnings: ${warningsCount}`)
    textLines.push('')

    for (const it of this.issues) {
      const top = getTopFrameFromStack(it.stack)
      htmlParts.push(`
        <div style="padding:10px;margin:8px 0;border-radius:6px;border:1px solid #e6e6e6;">
          <strong>${it.type === 'failed' ? '❌ FAILURE' : '⚠️ WARNING'}</strong> &nbsp; <em>${escapeHtml(it.title)}</em><br/>
          <small>File: ${escapeHtml(it.file)}:${escapeHtml(it.line)} &nbsp; | &nbsp; Time: ${escapeHtml(it.time)}</small>
          <p style="margin:8px 0;padding:8px;background:#fafafa;border-radius:4px;white-space:pre-wrap;">${escapeHtml(it.message || '')}</p>
          ${ top ? `<div style="font-size:12px;color:#666">Top: ${escapeHtml(top.raw)}</div>` : '' }
          ${ (it.images && it.images.length) ? `<div style="margin-top:8px;font-size:13px;"><strong>Attached screenshots:</strong> ${it.images.map(a => escapeHtml(a.filename)).join(', ')}</div>` : '<div style="margin-top:8px;font-size:13px;color:#888">No screenshots attached</div>'}
        </div>
      `)

      textLines.push(`${it.type === 'failed' ? 'FAIL' : 'WARN'} — ${it.title}`)
      textLines.push(`File: ${it.file}:${it.line}  Time: ${it.time}`)
      textLines.push(`Message: ${it.message}`)
      if (it.stack) textLines.push(`Stack top: ${getTopFrameFromStack(it.stack)?.raw || ''}`)
      if (it.images && it.images.length) textLines.push(`Screenshots: ${it.images.map(a => a.path).join(', ')}`)
      textLines.push('')
    }

    try {
      await this._sendMail(subject, textLines.join('\n'), `<!doctype html><body>${htmlParts.join('')}</body>`, flattened)
      console.log('📧 Simple report sent')
    } catch (err) {
      console.error('❌ Failed to send simple report:', err)
    }
  }

  async _sendMail(subject, text, html, attachments = []) {
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      secure: process.env.SMTP_SECURE === 'true' || false,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
    })

    const mailOptions = {
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      to: process.env.TO_EMAILS,
      cc: process.env.CC_EMAILS,
      bcc: process.env.BCC_EMAILS,
      subject,
      text,
      html,
      attachments
    }

    return transporter.sendMail(mailOptions)
  }
}
