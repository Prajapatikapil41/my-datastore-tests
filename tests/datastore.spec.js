import { test, expect, chromium } from '@playwright/test'
import path from 'path'
import fs from 'fs'

/* ===============================
   GLOBAL TIMEOUT
================================ */
test.setTimeout(1100000)

const CONFIG = {
  BASE_URL: process.env.BASE_URL || 'https://datastore.geowgs84.com',
  HEADLESS: process.env.HEADLESS === 'true',
  PW_SLOWMO: Number(process.env.PW_SLOWMO || 0)
}
const PAUSE_MULTIPLIER = Number(process.env.PAUSE_MULTIPLIER || 0.55)
const VISUAL_MIN_PAUSE = 25

let browser, context, page
let CURRENT_TESTCASE = ''
let WARNINGS = []
let INFOS = []
let ERRORS = []

// Context for easier diagnostics
let CURRENT_FLOW = ''
let CURRENT_PRODUCT = ''
let CURRENT_SCENE = ''
let CURRENT_DETAILS = null
let LAST_ADDED_PRODUCT = ''

/* ===============================
   TIMEOUT CONFIG (env overrideable)
================================ */
const OUTLINE_WAIT_MS = Number(process.env.OUTLINE_WAIT_MS || 90000)
const PREVIEW_WAIT_MS = Number(process.env.PREVIEW_WAIT_MS || 90000)
const DETAILS_IMAGE_WAIT_MS = Number(process.env.DETAILS_IMAGE_WAIT_MS || 120000)

/* ===============================
   UTILS & LOGGING (kept/reused)
================================ */

function sanitizeFilename(s) {
  return s.replace(/[:\/\\<>?"|]/g, '-').replace(/[^\w\-\.]/g, '_').substring(0, 220)
}

function contextSnapshot() {
  return {
    test: CURRENT_TESTCASE || null,
    flow: CURRENT_FLOW || null,
    product: CURRENT_PRODUCT || null,
    scene: CURRENT_SCENE || null,
    details: CURRENT_DETAILS || null,
    time: new Date().toISOString()
  }
}

function logInfo(message, meta = {}) {
  const entry = Object.assign({}, contextSnapshot(), { level: 'info', message, meta })
  INFOS.push(entry)
  console.log(`[INFO] ${entry.time} ${entry.test ? `(${entry.test})` : ''} ${entry.flow ? `[${entry.flow}]` : ''} - ${message}`)
}

function addWarning(message, meta = {}) {
  const entry = Object.assign({}, contextSnapshot(), { level: 'warning', message, meta })
  WARNINGS.push(entry)
  console.warn(`[WARNING] ${entry.time} ${entry.test ? `(${entry.test})` : ''} ${entry.flow ? `[${entry.flow}]` : ''} - ${message}`)
}

function addError(message, meta = {}) {
  const entry = Object.assign({}, contextSnapshot(), { level: 'error', message, meta })
  ERRORS.push(entry)
  console.error(`[ERROR] ${entry.time} ${entry.test ? `(${entry.test})` : ''} ${entry.flow ? `[${entry.flow}]` : ''} - ${message}`)
}

function setContext({ flow = '', product = '', scene = '', details = null } = {}) {
  CURRENT_FLOW = flow || CURRENT_FLOW
  CURRENT_PRODUCT = product || CURRENT_PRODUCT
  CURRENT_SCENE = scene || CURRENT_SCENE
  CURRENT_DETAILS = details || CURRENT_DETAILS
}

function clearContext() {
  CURRENT_FLOW = ''
  CURRENT_PRODUCT = ''
  CURRENT_SCENE = ''
  CURRENT_DETAILS = null
}

/* ===============================
   VISUAL HELPERS (showStep, highlight, annotate)
   (unchanged but reused everywhere)
================================ */

// ... Show step, highlight, annotateElementLabel, removeAnnotationLabels
// (I included your unchanged implementations verbatim — for brevity I'll include only them once)
async function fastWait(pageArg, ms = 300) {
  const t = Math.max(VISUAL_MIN_PAUSE, Math.round(ms * PAUSE_MULTIPLIER))
  return pageArg.waitForTimeout(t)
}

async function focusPage(pageArg) {
  try { await pageArg.bringToFront() } catch {}
  await pageArg.waitForTimeout(300)
}

async function getInnerTextSafe(locatorOrHandle) {
  try {
    if (!locatorOrHandle) return ''
    if (typeof locatorOrHandle.innerText === 'function') {
      return (await locatorOrHandle.innerText()).trim()
    }
    if (locatorOrHandle.evaluate) {
      return (await locatorOrHandle.evaluate(el => el.innerText || '')).trim()
    }
    return ''
  } catch {
    return ''
  }
}

async function showStep(pageArg, text) {
  const stepText = text || ''
  console.log(stepText)
  try {
    await pageArg.evaluate(({ stepText, testCase }) => {
      let spacer = document.getElementById('pw-layout-spacer')
      if (!spacer) {
        spacer = document.createElement('div')
        spacer.id = 'pw-layout-spacer'
        spacer.style.width = '100%'
        spacer.style.pointerEvents = 'none'
        document.body.prepend(spacer)
      }

      let bar = document.getElementById('pw-banner-container')
      if (!bar) {
        bar = document.createElement('div')
        bar.id = 'pw-banner-container'
        Object.assign(bar.style, {
          position: 'fixed', top: '0', left: '0', width: '100%', zIndex: '999999',
          display: 'grid', gridTemplateColumns: 'max-content 1fr', columnGap: '8px',
          minHeight: '48px', padding: '4px 8px', alignItems: 'center', boxSizing: 'border-box',
          fontFamily: 'Segoe UI, sans-serif',
          background: 'linear-gradient(90deg, rgba(115,102,255,0.95), rgba(58,199,147,0.95))',
          borderBottom: '2px solid rgba(255,255,255,0.12)', pointerEvents: 'none'
        })

        const tc = document.createElement('div')
        tc.id = 'pw-testcase-header'
        Object.assign(tc.style, { padding: '8px 14px', minHeight: '36px', fontSize: '14px', fontWeight: '700', color: '#ffffff', display: 'flex', alignItems: 'center' })

        const step = document.createElement('div')
        step.id = 'pw-step-banner'
        Object.assign(step.style, { padding: '8px 14px', minHeight: '34px', fontSize: '13px', fontWeight: '600', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: 'rgba(10,10,30,0.95)', background: 'rgba(255,255,255,0.9)', borderRadius: '6px', margin: '6px 6px 6px 0', display: 'flex', alignItems: 'center' })

        bar.appendChild(tc)
        bar.appendChild(step)
        document.body.appendChild(bar)
      }

      const tcEl = document.getElementById('pw-testcase-header')
      const stepEl = document.getElementById('pw-step-banner')
      if (testCase) { tcEl.textContent = `TEST CASE : ${testCase}`; tcEl.style.display = 'block' } else { tcEl.style.display = 'none' }
      stepEl.textContent = stepText
      spacer.style.height = `${bar.offsetHeight}px`
    }, { stepText, testCase: CURRENT_TESTCASE })
  } catch (e) {
    // ignore if page context cannot run
  }
  await fastWait(pageArg, 300)
  return stepText
}

const HIGHLIGHT_COLORS = [
  'rgba(255, 99, 71, 0.18)',
  'rgba(135, 206, 235, 0.18)',
  'rgba(144, 238, 144, 0.18)',
  'rgba(255, 215, 0, 0.18)',
  'rgba(221, 160, 221, 0.18)',
  'rgba(255, 182, 193, 0.18)'
]
let lastColorIndex = -1

async function highlight(pageArg, locator, options = {}) {
  if (!locator) return
  const {
    color,
    borderColor,
    pause = 800,
    forceOutlineOnly = false,
    addShadow = true
  } = options

  try {
    const handle = await locator.elementHandle()
    if (!handle) return

    lastColorIndex = (lastColorIndex + 1) % HIGHLIGHT_COLORS.length
    const bgColor = color || HIGHLIGHT_COLORS[lastColorIndex]
    const outlineColor = borderColor || bgColor.replace(/rgba?\((.+)\)/, (m, inner) => {
      try { return `rgba(${inner.split(',').slice(0,3).join(',')},0.95)` } catch { return 'rgba(255,0,0,0.95)' }
    })

    await pageArg.evaluate(({ el, bg, outline, forceOutlineOnlyLocal, addShadowLocal }) => {
      try {
        if (!el.dataset.pwHighlightPrev) {
          el.dataset.pwHighlightPrev = JSON.stringify({
            outline: el.style.outline || '',
            outlineOffset: el.style.outlineOffset || '',
            backgroundColor: el.style.backgroundColor || '',
            boxShadow: el.style.boxShadow || '',
            transition: el.style.transition || ''
          })
        }
        const isModal = el.closest && (el.closest('.modal') || el.closest('.modal-content') || el.closest('.modal-dialog'))
        el.style.transition = 'box-shadow 220ms ease, outline 220ms ease, background-color 220ms ease'
        el.style.outline = `3px solid ${outline}`
        el.style.outlineOffset = '3px'
        if (!isModal && !forceOutlineOnlyLocal && bg) el.style.backgroundColor = bg
        if (addShadowLocal && !forceOutlineOnlyLocal) {
          let shadowColor = outline
          if (/^rgba?\(/i.test(outline)) {
            shadowColor = outline.replace(/\)$/, ',0.22)')
          } else {
            shadowColor = 'rgba(0,0,0,0.22)'
          }
          el.style.boxShadow = `0 8px 22px ${shadowColor}`
        } else {
          el.style.boxShadow = el.style.boxShadow || ''
        }
        try { el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'smooth' }) } catch {}
      } catch (e) {}
    }, { el: handle, bg: bgColor, outline: outlineColor, forceOutlineOnlyLocal: forceOutlineOnly, addShadowLocal: addShadow })

    await pageArg.waitForTimeout(Math.max(100, pause))
  } catch (e) {
    // ignore
  }
}

async function annotateElementLabel(pageArg, locator, labelText = '', opts = {}) {
  try {
    const handle = await locator.elementHandle()
    if (!handle) return null

    const id = `pw-annot-${Math.random().toString(36).slice(2,9)}`
    await pageArg.evaluate(({ el, id, labelText, opts }) => {
      try {
        const rect = el.getBoundingClientRect()
        const div = document.createElement('div')
        div.id = id
        div.dataset.pwAnnot = '1'
        div.textContent = labelText
        Object.assign(div.style, {
          position: 'absolute', left: `${Math.max(4, rect.left + window.scrollX)}px`,
          top: `${Math.max(4, rect.top + window.scrollY - 24)}px`,
          zIndex: 9999999, pointerEvents: 'none', fontSize: '12px',
          background: 'rgba(0,0,0,0.72)', color: '#fff', padding: '4px 8px', borderRadius: '4px',
          boxShadow: '0 6px 20px rgba(0,0,0,0.38)'
        })
        if (opts.border) div.style.border = opts.border
        document.body.appendChild(div)

        const dot = document.createElement('div')
        dot.id = `${id}-dot`
        dot.dataset.pwAnnot = '1'
        Object.assign(dot.style, {
          position: 'absolute', left: `${Math.round(rect.left + window.scrollX + rect.width/2)}px`,
          top: `${Math.round(rect.top + window.scrollY + rect.height/2)}px`, width: '8px', height: '8px',
          borderRadius: '50%', background: 'rgba(255,0,0,0.85)', transform: 'translate(-50%,-50%)', zIndex: 9999999, pointerEvents: 'none'
        })
        document.body.appendChild(dot)
      } catch (e) { /* ignore DOM issues */ }
    }, { el: handle, id, labelText, opts })

    await pageArg.waitForTimeout(300)
    return id
  } catch (e) {
    return null
  }
}

async function removeAnnotationLabels(pageArg) {
  try {
    await pageArg.evaluate(() => {
      document.querySelectorAll('[data-pw-annot]').forEach(el => el.remove())
    })
  } catch (e) {}
}

// NEW: helper to create a temporary annotation near an element and remove it after ms
async function annotateTemporary(pageArg, locator, labelText = '', ms = 1200, opts = {}) {
  try {
    if (!locator) return null
    const id = await annotateElementLabel(pageArg, locator, labelText, opts)
    if (!id) return null
    // leave it visible for the requested ms, then remove only that annotation (if still present)
    await pageArg.waitForTimeout(ms)
    try {
      await pageArg.evaluate((id) => { const el = document.getElementById(id); if (el) el.remove(); const dot = document.getElementById(id + '-dot'); if (dot) dot.remove() }, id)
    } catch (e) {}
    return id
  } catch (e) { return null }
}

/* ===============================
   CENTRALIZED LOCATORS
================================ */

const Locators = {
  // global
  rightNav: p => p.locator('nav.right-nav'),
  worldSearchButton: p => p.locator('#world_search'),
  pacInput: p => p.locator('#pac-input'),
  pacFirstOption: p => p.locator('.pac-container .pac-item').first(),
  mapContainer: p => p.locator('#map'),

  // AOI toolbar
  aoiToolbar: p => p.locator('[role="menubar"]').filter({
    has: p.locator('img[src*="drawing.png"], img[src*="mapfiles/drawing.png"], img[src*="mapfiles/drawing"]')
  }).first(),
  aoiRectButton: p => p.locator('button[aria-label="Draw a rectangle"], button[title="Draw a rectangle"], button[aria-label*="rect"], button[title*="rect"]').first(),

  // sidebar & nav
  sidebar: p => p.locator('nav.side-menu.sidebar'),
  satelliteSection: p => p.locator('#satellite'),
  tableSatellite: p => p.locator('#table_satellite'),
  firstSatelliteRow: p => p.locator('#table_satellite tr').nth(1),
  productCellsInSatelliteTable: p => p.locator('#table_satellite td div'),

  // cart & checkout
  cartPopup: p => p.locator('#popup'),
  addToCartPopup: p => p.locator('#popup'),
  cartCount: p => p.locator('#lblCartCount'),
  cartBadge: p => p.locator('#lblCartCount'),
  openCartBtn: p => p.locator('a[data-target="#cartModal"]'),
  cartTrigger: p => p.locator('a[data-target="#cartModal"]'),
  cartModal: p => p.locator('.modal.show, #cartModal'),
  shoppingCartTable: p => p.locator('#shopping_cart'),
  checkoutBtn: p => p.locator('#checkout_a'),
  firstName: p => p.locator('#first_name'),
  lastName: p => p.locator('#last_name'),
  email: p => p.locator('#email'),
  company: p => p.locator('#company'),
  phone: p => p.locator('#phone'),
  street: p => p.locator('textarea[name="street"]'),
  city: p => p.locator('#city'),
  state: p => p.locator('#state'),
  zip: p => p.locator('#zip'),
  country: p => p.locator('#country'),
  industry: p => p.locator('#industry'),
  description: p => p.locator('textarea[name="description"]'),
  submitBtn: p => p.locator('input[type="submit"]'),

  // scenes table
  scenesTable: p => p.locator('#tbl_satellite_scenes'),
  scenesRows: p => p.locator('#tbl_satellite_scenes tbody tr'),
  sceneRowAddButton: (p, row) => row.locator('td input[type="image"]').first(),
  sceneOutlineButton: (p, row) => row.locator('input[title="show scene outline"], input[title*="show scene outline"], button[title*="outline"], button[title*="Show outline"]'),
  scenePreviewButton: (p, row) => row.locator('input[title="Show scene preveiw"], input[title*="preview"], input[title*="preveiw"], button[title*="preview"], button[title*="Show preview"]'),
  sceneDetailsButton: (p, row) => row.locator('input[title="Show scene details"], input[value="Details"], button[title*="details"], button:has-text("Details")'),
  sceneDetailModal: p => p.locator('#SceneDetailModal, .modal.show'),
  sceneDetailImage: p => p.locator('#SceneDetailModal #img_scene, .modal.show #img_scene'),
  sceneDetailDataTable: p => p.locator('#SceneDetailModal #tbl_details, .modal.show #tbl_details'),

  // wizard
  modalContent: p => p.locator('.modal.show .modal-content'),
  modalHeading: p => p.locator('.modal.show #exampleModalLabel'),
  nextButton: p => p.locator('#smartwizard .sw-btn-next'),
  visiblePane: p => p.locator('#smartwizard .tab-pane[style*="display: block"]'),
  closeModalButton: p => p.locator('.modal.show button.close, .modal.show .close'),

  // upload, coords, locate, world/aoi view, hover
  uploadNav: p => p.locator('[data-target="#uploadFilesModal"]'),
  uploadModal: p => p.locator('.modal-content:has-text("Upload File")'),
  fileInput: p => p.locator('#kml_file_upload'),
  uploadBtn: p => p.locator('#kml-upload-btn'),
  sideNavToggle: p => p.locator('#expandNavbar'),
  infoWindow: p => p.locator('.gm-style-iw'),
  infoWindowContainer: p => p.locator('.gm-style-iw-chr'),
  infoWindowCloseButton: p => p.locator('.gm-style-iw-chr button.gm-ui-hover-effect'),
  deleteAllBtn: p => p.locator('#delete_all'),
  worldViewBtn: p => p.locator('#world_view'),
  aoiViewBtn: p => p.locator('#AOI_view'),
  coordsBtn: p => p.locator('a[data-target="#enterCoordinatesModal"], a[data-toggle="modal"][data-target="#enterCoordinatesModal"]'),
  coordsModalTitle: p => p.locator('.modal-content .modal-title, .modal .modal-title').filter({ hasText: 'Enter Coordinates' }),
  latInput: p => p.locator('#user_lat, input.lat_coord'),
  lonInput: p => p.locator('#user_lon, input.lon_coord'),
  takeMeBtn: p => p.locator('#submitCoordinates, button#submitCoordinates, button:has-text("Take Me")'),
  locateNav: p => p.locator('#locate'),
  hoverAnchor: p => p.locator('#hover_location'),
  hoverCheckbox: p => p.locator('#show_hoverLocation'),
  positionOnHover: p => p.locator('#position_on_hover')
}

/* ===============================
   REUSABLE UI ACTION HELPERS
================================ */

// Wait for locator to be visible then highlight it. Returns locator or null.
async function waitForAndHighlight(p, locatorFactoryOrLocator, timeout = 10000, options = {}) {
  try {
    const locator = typeof locatorFactoryOrLocator === 'function' ? locatorFactoryOrLocator(p) : locatorFactoryOrLocator
    await expect(locator).toBeVisible({ timeout })
    await highlight(p, locator, options)
    // If a label is requested, annotate temporarily
    if (options.label) {
      try { await annotateTemporary(p, locator, options.label, options.labelMs || 1200, { border: options.border }) } catch {}
    } else if (options.annotate) {
      // default annotate as 'Visible'
      try { await annotateTemporary(p, locator, 'Visible', options.labelMs || 900) } catch {}
    }
    return locator
  } catch (e) {
    return null
  }
}

// Click a visible element robustly
async function clickWhenVisible(p, locatorFactoryOrLocator, opts = {}) {
  const { timeout = 10000, force = false, annotate = true, label = null } = opts
  const locator = typeof locatorFactoryOrLocator === 'function' ? locatorFactoryOrLocator(p) : locatorFactoryOrLocator
  try {
    await expect(locator).toBeVisible({ timeout })
    await highlight(p, locator, { pause: 400 })
    // Annotate before clicking to indicate the action
    if (annotate) {
      const derivedLabel = label || 'Click'
      try { await annotateTemporary(p, locator, derivedLabel, 1000, { border: '2px solid rgba(0,200,120,0.95)' }) } catch {}
    }
    if (annotate && label) {
      // keep a tiny pause so the annotation is visible before the click
      await fastWait(p, 180)
    }
    try {
      await locator.click({ timeout: 8000 })
    } catch {
      if (force) await locator.click({ force: true })
      else throw new Error('Click failed and force not set')
    }
    // annotate result of click briefly (feedback)
    if (annotate) {
      try { await annotateTemporary(p, locator, 'Clicked', 700) } catch {}
    }
    await fastWait(p, 300)
    return true
  } catch (e) {
    addWarning(`clickWhenVisible failed: ${e?.message || e}`)
    return false
  }
}

async function openModalAndWait(p, triggerLocatorFactory, modalLocatorFactory, opts = {}) {
  const { triggerTimeout = 8000, modalTimeout = 20000, label } = opts
  const ok = await clickWhenVisible(p, triggerLocatorFactory, { timeout: triggerTimeout, force: true, annotate: true, label })
  if (!ok) return null
  const modal = await waitForAndHighlight(p, modalLocatorFactory, modalTimeout, { forceOutlineOnly: true, annotate: true, label: 'Modal Opened' })
  if (!modal) addWarning('Modal did not appear after triggering')
  return modal
}

async function ensureSideNavClosed(p) {
  try {
    const toggle = Locators.sideNavToggle(p)

    const visible = await toggle.isVisible().catch(() => false)
    if (!visible) return

    await highlight(p, toggle, { forceOutlineOnly: true })

    try {
      // annotate the toggle so user sees the click purpose
      try { await annotateTemporary(p, toggle, 'Toggle SideNav', 900) } catch {}
      await toggle.click()
      await fastWait(p, 500)
      logInfo('Side navigation toggle clicked once to ensure closure')
    } catch (clickErr) {
      addWarning('SideNav toggle click failed: ' + (clickErr?.message || clickErr))
    }

  } catch (e) {
    addWarning('ensureSideNavClosed failed: ' + (e?.message || e))
  }
}


// Wait for map readiness using multiple heuristics
async function waitForMapToLoad(p, timeout = 20000) {
  const map = Locators.mapContainer(p)
  try {
    await expect(map).toBeVisible({ timeout: Math.min(timeout, 10000) })
  } catch {
    // allow fallback; log but continue
    addWarning('Map container not visible')
  }

  const waitedForApi = await p.evaluate(() => {
    try {
      if (window.map && typeof window.map.once === 'function') return 'leaflet'
      if (window.map && typeof window.map.addListener === 'function') return 'google'
    } catch (e) {}
    return null
  })

  if (waitedForApi === 'leaflet') {
    await p.evaluate(() => new Promise(resolve => window.map.once('moveend', resolve))).catch(() => {})
    await fastWait(p, 600)
    return true
  }

  if (waitedForApi === 'google') {
    await p.evaluate(() => new Promise(resolve => window.map.addListener('idle', resolve))).catch(() => {})
    await fastWait(p, 600)
    return true
  }

  // fallback: wait for marker or canvas
  try {
    await p.locator('img[src*="marker"], .map-marker, .leaflet-marker-icon').first().waitFor({ state: 'visible', timeout: Math.min(8000, timeout) })
    await fastWait(p, 500)
    return true
  } catch (e) {
    // final fallback: wait for networkidle
    await p.waitForLoadState('networkidle').catch(() => {})
    await fastWait(p, 1000)
    return true
  }
}

// Reusable robust click for row buttons (outline/preview/details)
async function clickRowButtonRobust(p, row, buttonLocator) {
  try {
    await buttonLocator.first().scrollIntoViewIfNeeded()
    await buttonLocator.first().click()
    return true
  } catch (err) {
    try { await buttonLocator.first().click({ force: true }); return true } catch (err2) {
      const clicked = await row.evaluate((r) => {
        const btn = r.querySelector('input[title="show scene outline"], input[title*="preview"], input[title*="Show scene details"], input[value="Details"], button[title*="outline"], button[title*="preview"], button[title*="details"], button:has-text("Details")')
        if (!btn) return false
        try { btn.click(); return true } catch { return false }
      })
      return !!clicked
    }
  }
}

/* ===============================
   BBOX & OVERLAY DETECTION (kept)
================================ */

// getBoundingBoxForLocator, bboxIntersects, detectMapOverlayWithBBox, waitForMapOverlayForScene
// (reuse your implementations unchanged for reliability)

async function getBoundingBoxForLocator(page, locator) {
  try {
    if (!locator) return null
    const handle = await locator.elementHandle()
    if (!handle) return null
    const bb = await handle.boundingBox().catch(() => null)
    if (bb && typeof bb.x === 'number') return bb
    try {
      const bb2 = await page.evaluate(el => {
        try {
          if (el.getBBox) {
            const b = el.getBBox()
            return { x: b.x, y: b.y, width: b.width, height: b.height }
          }
          const r = el.getBoundingClientRect()
          return { x: r.x, y: r.y, width: r.width, height: r.height }
        } catch (e) { return null }
      }, handle)
      return bb2
    } catch (e) {
      return null
    }
  } catch (e) {
    return null
  }
}

function bboxIntersects(a, b, minOverlapRatio = 0.1) {
  if (!a || !b) return false
  const ax1 = a.x, ay1 = a.y, ax2 = a.x + a.width, ay2 = a.y + a.height
  const bx1 = b.x, by1 = b.y, bx2 = b.x + b.width, by2 = b.y + b.height
  const ix1 = Math.max(ax1, bx1), iy1 = Math.max(ay1, by1)
  const ix2 = Math.min(ax2, bx2), iy2 = Math.min(ay2, by2)
  const iw = Math.max(0, ix2 - ix1), ih = Math.max(0, iy2 - iy1)
  if (iw === 0 || ih === 0) return false
  const interArea = iw * ih
  const aArea = Math.max(1, a.width * a.height)
  const bArea = Math.max(1, b.width * b.height)
  const overlapRatio = interArea / Math.min(aArea, bArea)
  return overlapRatio >= minOverlapRatio
}

async function detectMapOverlayWithBBox(page, sceneId) {
  try {
    const mapLocator = Locators.mapContainer(page)
    const mapBB = await getBoundingBoxForLocator(page, mapLocator)

    if (sceneId) {
      const imgById = page.locator(`#map img[src*="${sceneId}"]`)
      if (await imgById.count() > 0) {
        const candidate = imgById.first()
        const src = await candidate.getAttribute('src') || ''
        if (!/marker|icon|static/i.test(src)) {
          const bb = await getBoundingBoxForLocator(page, candidate)
          if (bb && (!mapBB || bboxIntersects(bb, mapBB, 0.05))) {
            return { type: 'preview', locator: candidate, bbox: bb }
          }
        }
      }
    }

    const svgPath = page.locator('#map svg path, #map svg g path')
    if (await svgPath.count() > 0) {
      const candidate = svgPath.first()
      const bb = await getBoundingBoxForLocator(page, candidate)
      if (bb && (!mapBB || bboxIntersects(bb, mapBB, 0.03))) {
        return { type: 'outline', locator: candidate, bbox: bb }
      }
    }

    const canvas = page.locator('#map canvas')
    if (await canvas.count() > 0) {
      const candidate = canvas.first()
      const bb = await getBoundingBoxForLocator(page, candidate)
      if (bb && (!mapBB || bboxIntersects(bb, mapBB, 0.05))) {
        return { type: 'canvas', locator: candidate, bbox: bb }
      }
    }
  } catch (e) {
    // swallow detection errors safely
  }

  return null
}

async function waitForMapOverlayForScene(page, sceneId, timeout = 15000) {
  const start = Date.now()
  while (Date.now() - start < timeout) {
    const found = await detectMapOverlayWithBBox(page, sceneId)
    if (found) return found
    await page.waitForTimeout(500)
  }
  return null
}

/* ===============================
   AOI DETECTION
================================ */

async function detectAOIOnMap(page) {
  try {
    const candidates = [
      '#map svg rect',
      '#map svg path',
      '#map .leaflet-editing',
      '#map .leaflet-draw',
      '#map .drawn-rect',
      '#map .aoi',
      '#map .gm-rect',
      '#map .google-maps-aoi',
      '#map .gm-style'
    ]
    for (const sel of candidates) {
      const loc = page.locator(sel)
      if (await loc.count() > 0) {
        const first = loc.first()
        const bb = await getBoundingBoxForLocator(page, first)
        if (bb && bb.width > 6 && bb.height > 6) {
          return { type: 'aoi', locator: first, bbox: bb, selector: sel }
        }
      }
    }
  } catch (e) {}
  return null
}

async function waitForAOIOnMap(page, timeout = 12000) {
  const start = Date.now()
  while (Date.now() - start < timeout) {
    const found = await detectAOIOnMap(page)
    if (found) return found
    await page.waitForTimeout(400)
  }
  return null
}

/* ===============================
   UI ACTION HELPERS (screenshots, saving data)
================================ */

async function saveMapScreenshot(p, sceneId, suffix = 'overlay', markWarning = false) {
  try {
    const dir = path.join(process.cwd(), 'test-results')
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    const safe = sanitizeFilename(`scene_${sceneId || 'noid'}_${suffix}_${new Date().toISOString()}`)
    const filePath = path.join(dir, `${safe}.png`)
    await p.screenshot({ path: filePath, fullPage: true })
    if (markWarning) {
      addWarning(`screenshot saved: ${filePath}`, { sceneId, suffix })
    } else {
      logInfo(`screenshot saved: ${filePath}`, { sceneId, suffix })
    }
    return filePath
  } catch (e) {
    addWarning(`Failed to save screenshot for ${sceneId}: ${e?.message || e}`)
    return null
  }
}

async function saveOutlineData(pageArg, sceneId, outlineResult) {
  try {
    const dir = path.join(process.cwd(), 'test-results')
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })

    const data = {
      sceneId: sceneId || null,
      time: new Date().toISOString(),
      type: outlineResult?.type || null,
      bbox: outlineResult?.bbox || null
    }

    try {
      if (outlineResult && outlineResult.locator) {
        const handle = await outlineResult.locator.elementHandle()
        if (handle) {
          const outer = await handle.evaluate(el => {
            try {
              if (el.tagName && el.tagName.toLowerCase() === 'path') {
                return { tag: 'path', d: el.getAttribute('d') || null, outerHTML: el.outerHTML || null }
              }
              return { tag: el.tagName ? el.tagName.toLowerCase() : null, outerHTML: el.outerHTML || null }
            } catch (e) { return { error: String(e) } }
          })
          data.element = outer
        }
      }
    } catch (e) {
      data.elementCaptureError = String(e)
    }

    const safe = sanitizeFilename(`scene_${sceneId || 'noid'}_outline_${new Date().toISOString()}`)
    const filePath = path.join(dir, `${safe}.json`)
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8')

    logInfo(`outline data saved: ${filePath}`, { sceneId })
    return filePath
  } catch (e) {
    addWarning(`Failed to save outline data for ${sceneId}: ${e?.message || e}`)
    return null
  }
}

/* ===============================
   SCENE PROCESSING (outline, preview, details)
================================ */

async function getSceneIdFromRow(rowLocator) {
  try {
    // Try to get ID from input element's id attribute
    const idAttrHandle = await rowLocator.locator('td input[type="image"]').first().elementHandle()
    if (idAttrHandle) {
      const idAttr = await idAttrHandle.getAttribute('id')
      if (idAttr) {
        const firstDash = idAttr.indexOf('-')
        if (firstDash === -1) return idAttr
        const sceneId = idAttr.slice(firstDash + 1)
        if (sceneId && sceneId.trim()) return sceneId.trim()
      }
    }

    // Try to get from value attribute
    const valueAttr = await rowLocator.locator('td input[type="image"]').first().getAttribute('value')
    if (valueAttr) {
      // Try JSON parse
      try {
        const parsed = JSON.parse(valueAttr.replace(/'/g, '"'))
        if (parsed && parsed[0]) return String(parsed[0]).trim()
      } catch {
        // Try regex match
        const m = valueAttr.match(/^\s*\['?([^',\]]+)/)
        if (m && m[1]) return m[1].trim()
      }
    }

    // Try to extract from row text
    const txt = await getInnerTextSafe(rowLocator)
    if (txt) {
      // Look for common scene ID patterns
      const patterns = [
        /[A-Z0-9]{12,}/i,           // Standard catalog IDs
        /[A-Z]{2,3}\d_[A-Z0-9_]+/i, // 21AT style IDs like BJ3N3_PMS_...
        /Legion\d{2}-[A-Z0-9]+/i,   // Legion style IDs
        /\b[A-Z0-9]{10,}\b/i        // Generic long alphanumeric
      ]
      for (const pattern of patterns) {
        const m = txt.match(pattern)
        if (m && m[0]) return m[0].trim()
      }
    }

    // Last resort: generate a unique identifier for logging
    const rowNum = await rowLocator.evaluate(el => {
      const row = el.closest('tr')
      return row ? Array.from(row.parentElement.children).indexOf(row) : -1
    }).catch(() => -1)
    
    addWarning(`Could not parse sceneId from row, using fallback identifier`)
    return `unknown_scene_row_${rowNum}_${Date.now()}`
  } catch (e) {
    addWarning(`getSceneIdFromRow error: ${e?.message || e}`)
    return `error_scene_${Date.now()}`
  }
}

async function clickOutlineAndHandle(row, page, sceneId, sceneIndex = 0) {
  setContext({ flow: 'outline', scene: sceneId })
  const rowText = await getInnerTextSafe(row)
  const outlineBtn = Locators.sceneOutlineButton(page, row)

  if (await outlineBtn.count() === 0) {
    const msg = `Outline button missing for scene ${sceneId || rowText}`
    addWarning(msg)
    return { ok: false, outlineResult: null, message: msg }
  }

  await highlight(page, outlineBtn.first())
  const clicked = await clickRowButtonRobust(page, row, outlineBtn)
  if (!clicked) {
    const msg = `Failed to click outline button for ${sceneId || rowText}`
    addWarning(msg)
    return { ok: false, outlineResult: null, message: msg }
  }

  await showStep(page, `Waiting for outline overlay for ${sceneId || rowText}`)
  const result = await waitForMapOverlayForScene(page, sceneId, OUTLINE_WAIT_MS)
  if (!result) {
    const msg = `No map change detected after clicking outline for ${sceneId || rowText}`
    addWarning(msg)
    await saveMapScreenshot(page, sceneId || `row${sceneIndex+1}`, 'outline_missing', true)
    return { ok: false, outlineResult: null, message: msg }
  }

  try { (page, result.locator, { pause: 900 }) } catch {}
  await showStep(page, `Outline detected (${result.type}) for ${sceneId || rowText}`)
  try { await annotateElementLabel(page, result.locator, 'OUTLINE', { border: '2px solid rgba(0,120,255,0.95)' }) } catch {}

  await showStep(page, 'Waiting for outline to stabilize')
  try { await page.waitForTimeout(10000) } catch {}

  try {
    const outlineDataPath = await saveOutlineData(page, sceneId || `row${sceneIndex+1}`, result)
    await showStep(page, `Outline data saved: ${outlineDataPath || 'failed-to-save'}`)
  } catch (e) {
    addWarning(`Failed to persist outline data for ${sceneId || rowText}: ${e?.message || e}`)
  }

  try { await saveMapScreenshot(page, sceneId || `row${sceneIndex+1}`, 'outline_stabilized', false) } catch {}

  try { await page.waitForTimeout(1200); await removeAnnotationLabels(page) } catch {}

  return { ok: true, outlineResult: result, message: null }
}

// Modified: accept opts to allow a "simpleVerify" mode for specific products (2.7-2.11)
async function clickPreviewAndHandle(row, page, sceneId, outlineResult, sceneIndex = 0, opts = {}) {
  const { simpleVerify = false } = opts
  setContext({ flow: 'preview', scene: sceneId })
  const rowText = await getInnerTextSafe(row)
  const previewBtn = Locators.scenePreviewButton(page, row)

  if (await previewBtn.count() === 0) {
    const msg = `Preview button missing for scene ${sceneId || rowText}`
    addWarning(msg)
    return { ok: false, previewResult: null, previewImageSrc: '', message: msg }
  }

  await highlight(page, previewBtn.first())
  const clickedPreview = await clickRowButtonRobust(page, row, previewBtn)
  if (!clickedPreview) {
    const msg = `Failed to click preview button for ${sceneId || rowText}`
    addWarning(msg)
    return { ok: false, previewResult: null, previewImageSrc: '', message: msg }
  }

  await showStep(page, 'Waiting for preview image to load inside the outline')
  await page.waitForTimeout(10000)

  await showStep(page, `Waiting for preview overlay for ${sceneId || rowText}`)
  const previewShown = await waitForMapOverlayForScene(page, sceneId, PREVIEW_WAIT_MS)
  if (!previewShown) {
    const msg = `No preview overlay detected for ${sceneId || rowText} within ${Math.round(PREVIEW_WAIT_MS/1000)}s`
    addWarning(msg)
    await saveMapScreenshot(page, sceneId || `row${sceneIndex+1}`, 'preview_missing', true)
    return { ok: false, previewResult: null, previewImageSrc: '', message: msg }
  }

  let previewImageSrc = ''
  try {
    const el = previewShown.locator
    const tag = await el.evaluate(e => e.tagName && e.tagName.toLowerCase())
    if (tag === 'img') {
      previewImageSrc = await el.getAttribute('src') || ''
    } else {
      const nestedImg = previewShown.locator.locator('img').first()
      if (await nestedImg.count() > 0) previewImageSrc = await nestedImg.getAttribute('src') || ''
    }
  } catch (e) {
    previewImageSrc = ''
  }

  try {
    await highlight(page, previewShown.locator, { borderColor: 'rgba(0,200,120,0.95)', pause: 700 })
    await annotateElementLabel(page, previewShown.locator, 'PREVIEW', { border: '2px solid rgba(0,200,120,0.95)' })
  } catch (e) {}

  const savedPath = await saveMapScreenshot(page, sceneId || `row${sceneIndex+1}`, 'preview_success', false)
  await showStep(page, `Screenshot saved: ${savedPath || 'failed-to-save'}`)

  // If running in simpleVerify mode (2.7-2.11) only assert that an image is present and loaded
  if (simpleVerify) {
    try {
      const imgLocator = previewShown.locator
      // find the actual <img> to inspect
      let imgEl = null
      const tag = await imgLocator.evaluate(e => e.tagName && e.tagName.toLowerCase()).catch(() => null)
      if (tag === 'img') imgEl = imgLocator
      else {
        const nested = imgLocator.locator('img').first()
        if (await nested.count() > 0) imgEl = nested
      }

      if (imgEl) {
        await expect(imgEl).toBeVisible({ timeout: 10000 })
        const loaded = await imgEl.evaluate(i => !!(i.complete && i.naturalWidth && i.naturalWidth > 0)).catch(() => false)
        if (!loaded) {
          addWarning(`Preview image present but not fully loaded for ${sceneId || rowText}`)
          await saveMapScreenshot(page, sceneId || `row${sceneIndex+1}`, 'preview_not_loaded', true)
          return { ok: false, previewResult: previewShown, previewImageSrc: previewImageSrc || '', message: 'preview image not loaded' }
        }
        return { ok: true, previewResult: previewShown, previewImageSrc: previewImageSrc || '', message: null }
      }

      // fallback: if no img element could be found, still consider previewShown as present
      return { ok: true, previewResult: previewShown, previewImageSrc: previewImageSrc || '', message: null }
    } catch (e) {
      addWarning(`Error while simple-validating preview image for ${sceneId || rowText}: ${e?.message || e}`)
      return { ok: false, previewResult: previewShown, previewImageSrc: previewImageSrc || '', message: 'simple preview validation failed' }
    }
  }

  // Default (original) behavior: validate overlap and detailed checks
  if (outlineResult && outlineResult.bbox && previewShown.bbox) {
    const intersects = bboxIntersects(outlineResult.bbox, previewShown.bbox, 0.05)
    if (!intersects) {
      addWarning(`Preview overlay bbox does NOT overlap outline bbox for ${sceneId || rowText}`)
      await saveMapScreenshot(page, sceneId || `row${sceneIndex+1}`, 'preview_outside_outline', true)
    } else {
      await showStep(page, `Preview overlay is inside/overlapping the outline (good)`)
      try { await highlight(page, previewShown.locator, { borderColor: 'rgba(0,200,120,0.95)', pause: 700 }) } catch {}
    }
  } else {
    if (!outlineResult) addWarning(`Cannot validate preview vs outline because outline was not detected earlier for ${sceneId || rowText}`)
  }

  try { await page.waitForTimeout(900); await removeAnnotationLabels(page) } catch {}

  return { ok: true, previewResult: previewShown, previewImageSrc: previewImageSrc || '', message: null }
}

// Modified: accept opts to allow a "simpleVerify" mode for specific products (2.7-2.11)
async function clickDetailsAndHandle(row, page, sceneId, previewImageSrc = '', sceneIndex = 0, opts = {}) {
  const { simpleVerify = false } = opts
  setContext({ flow: 'details', scene: sceneId })
  const rowText = await getInnerTextSafe(row)
  const detailsBtn = Locators.sceneDetailsButton(page, row)

  if (await detailsBtn.count() === 0) {
    const msg = `Details button missing for scene ${sceneId || rowText}`
    addWarning(msg)
    return { ok: false, detailImageSrc: '', message: msg }
  }

  await highlight(page, detailsBtn.first())
  const clickedDetails = await clickRowButtonRobust(page, row, detailsBtn)
  if (!clickedDetails) {
    const msg = `Failed to click details button for ${sceneId || rowText}`
    addWarning(msg)
    return { ok: false, detailImageSrc: '', message: msg }
  }

  const modal = Locators.sceneDetailModal(page)
  try {
    await modal.waitFor({ state: 'visible', timeout: 25000 })
    await highlight(page, modal, { borderColor: 'rgba(0,120,255,0.95)', pause: 900 })

    await page.waitForTimeout(10000) // short wait for images to load

    const img = Locators.sceneDetailImage(page)
    try {
      await expect(img).toBeVisible({ timeout: DETAILS_IMAGE_WAIT_MS })
      const src = (await img.getAttribute('src')) || ''

      // In simpleVerify mode we only need to confirm the detail image is present and loaded
      if (simpleVerify) {
        const loaded = await img.evaluate(i => !!(i.complete && i.naturalWidth && i.naturalWidth > 0)).catch(() => false)
        if (!loaded) {
          addWarning(`Detail image present but not fully loaded for ${sceneId || rowText}. SRC="${src}"`)
          await saveMapScreenshot(page, sceneId || `row${sceneIndex+1}`, 'detail_not_loaded', true)
          try { await modal.locator('button:has-text("Close"), .btn-danger, button.close').first().click() } catch {}
          return { ok: false, detailImageSrc: src, message: 'detail image not loaded' }
        }
        try { await modal.locator('button:has-text("Close"), .btn-danger, button.close').first().click() } catch {}
        return { ok: true, detailImageSrc: src, message: null }
      }

      if (sceneId && src && src.includes(sceneId)) {
        await showStep(page, `Details image validated for ${sceneId}`)
        logInfo(`Details image validated`, { sceneId, src })
      } else {
        addWarning(`Modal image does not contain expected sceneId (${sceneId}). SRC="${src}"`)
        await saveMapScreenshot(page, sceneId || `row${sceneIndex+1}`, 'detail_image_mismatch', true)
      }

      try {
        await highlight(page, img, { borderColor: 'rgba(0,200,120,0.95)', pause: 800 })
        await annotateElementLabel(page, img, 'DETAILS', { border: '2px solid rgba(0,200,120,0.95)' })
      } catch (e) {}

      if (previewImageSrc) {
        const previewBase = previewImageSrc.split('/').pop()
        const detailBase = src.split('/').pop()
        if (previewBase && detailBase && previewBase === detailBase) {
          await showStep(page, 'Detail image matches preview image (filename match)')
          logInfo('Detail image matches preview (filename)', { previewBase, detailBase })
          try { await highlight(page, img, { borderColor: 'rgba(0,200,120,0.95)', pause: 800 }) } catch {}
        } else if (src && previewImageSrc && (src.includes(previewImageSrc) || previewImageSrc.includes(src))) {
          await showStep(page, 'Detail image and preview strongly match (src contains each other)')
          logInfo('Detail image and preview strongly match', { previewImageSrc, src })
          try { await highlight(page, img, { borderColor: 'rgba(0,200,120,0.95)', pause: 800 }) } catch {}
        } else {
          addWarning(`Details image does not match preview image for ${sceneId || rowText}. preview="${previewBase || previewImageSrc}", detail="${detailBase || src}"`)
          await saveMapScreenshot(page, sceneId || `row${sceneIndex+1}`, 'detail_not_matching_preview', true)
        }
      } else {
        if (!(sceneId && src && src.includes(sceneId))) {
          addWarning(`No preview image src available to compare and detail image doesn't include sceneId (${sceneId}). SRC="${src}"`)
          await saveMapScreenshot(page, sceneId || `row${sceneIndex+1}`, 'detail_no_preview_and_no_sceneid', true)
        }
      }

      const dataTable = Locators.sceneDetailDataTable(page)
      try {
        await expect(dataTable).toBeVisible({ timeout: 8000 })
        await highlight(page, dataTable, { borderColor: 'rgba(200,120,0,0.95)', pause: 700 })
        const dataText = await getInnerTextSafe(dataTable)
        if (!/id:|bbox:|properties|assets/i.test(dataText)) {
          addWarning(`Scene details data section seems unusual for ${sceneId || rowText}`)
          await saveMapScreenshot(page, sceneId || `row${sceneIndex+1}`, 'details_data_unusual', true)
        }
      } catch {
        addWarning(`Scene details data table not visible for ${sceneId || rowText}`)
        await saveMapScreenshot(page, sceneId || `row${sceneIndex+1}`, 'details_data_missing', true)
      }

      try { await page.waitForTimeout(1000); await removeAnnotationLabels(page) } catch {}

      try {
        await modal.locator('button:has-text("Close"), .btn-danger, button.close').first().click()
        await modal.waitFor({ state: 'hidden', timeout: 8000 })
      } catch {
        try { await page.locator('#SceneDetailModal button.close, .modal.show button.close').first().click() } catch {}
      }

      return { ok: true, detailImageSrc: src, message: null }

    } catch (e) {
      const msg = `Scene detail modal image not visible for ${sceneId || rowText}`
      addWarning(msg)
      await saveMapScreenshot(page, sceneId || `row${sceneIndex+1}`, 'detail_image_missing', true)
      try { await modal.locator('button:has-text("Close"), .btn-danger, button.close').first().click() } catch {}
      return { ok: false, detailImageSrc: '', message: msg }
    }
  } catch (e) {
    const msg = `SceneDetailModal did not appear for ${sceneId || rowText}`
    addWarning(msg)
    await saveMapScreenshot(page, sceneId || `row${sceneIndex+1}`, 'details_modal_missing', true)
    return { ok: false, detailImageSrc: '', message: msg }
  }
}

async function processScene(row, page, sceneIndex = 0, opts = {}) {
  const rowText = await getInnerTextSafe(row)
  await showStep(page, `Processing scene: ${rowText}`)
  await highlight(page, row)
  const sceneId = await getSceneIdFromRow(row)
  
  // Skip processing if scene ID is empty or malformed
  if (!sceneId || sceneId.startsWith('unknown_scene') || sceneId.startsWith('error_scene')) {
    addWarning(`Skipping scene processing - invalid or empty sceneId: "${sceneId}"`)
    return { skipped: true, reason: 'Invalid scene ID' }
  }

  setContext({ flow: 'sceneProcessing', scene: sceneId })

  try {
    const outlineRes = await clickOutlineAndHandle(row, page, sceneId, sceneIndex)
    await page.waitForTimeout(1000)

    const previewRes = await clickPreviewAndHandle(row, page, sceneId, outlineRes.outlineResult, sceneIndex, opts)

    await page.waitForTimeout(10000)

    const detailsRes = await clickDetailsAndHandle(row, page, sceneId, previewRes.previewImageSrc, sceneIndex, opts)

    // cleanup UI overlays if present
    try {
      const previewBtn = Locators.scenePreviewButton(page, row)
      const outlineBtn = Locators.sceneOutlineButton(page, row)
      if (await previewBtn.count() > 0) { await clickRowButtonRobust(page, row, previewBtn); await page.waitForTimeout(900) }
      if (await outlineBtn.count() > 0) { await clickRowButtonRobust(page, row, outlineBtn); await page.waitForTimeout(900) }
    } catch (e) {}
  } catch (e) {
    addWarning(`Error processing scene ${sceneId}: ${e?.message || e}`)
  }

  clearContext()
  await fastWait(page, 400)
  return { skipped: false }
}

/* ===============================
   COMMON FLOW BUILDERS (landing, close wizard, search/draw, satellite open, etc)
================================ */

async function openLanding(p) {
  setContext({ flow: 'landing' })
  try {
    await p.goto(CONFIG.BASE_URL, { waitUntil: 'domcontentloaded' })
    await expect(p).toHaveURL(/datastore\.geowgs84\.com/i)
    logInfo('Landing page opened')
    return true
  } catch (e) {
    addWarning('Failed to open landing: ' + (e?.message || e))
    return false
  }
}

async function S2closeWizardModal(p) {
  setContext({ flow: 'closeWizard' })
  const modal = await waitForAndHighlight(p, Locators.modalContent, 12000)
  if (!modal) return false
  const closeBtn = Locators.closeModalButton(p)
  try {
    await highlight(p, closeBtn, { borderColor: 'red' })
    // annotate close action so it's visible
    try { await annotateTemporary(p, closeBtn, 'Close wizard', 900, { border: '2px solid red' }) } catch {}
    await closeBtn.click()
    await expect(Locators.modalContent(p)).toBeHidden({ timeout: 8000 })
    await fastWait(p, 800)
    return true
  } catch (e) {
    addWarning('Failed to close wizard modal: ' + (e?.message || e))
    try { await Locators.closeModalButton(p).click({ force: true }) } catch {}
    return false
  }
}

async function searchPlace(p, placeName) {
  setContext({ flow: 'searchPlace', details: { place: placeName } })
  const nav = await waitForAndHighlight(p, Locators.rightNav, 10000, { forceOutlineOnly: true })
  if (!nav) { addWarning('right nav not visible'); return false }

  await showStep(p, 'Selecting search icon')
  const searchBtn = Locators.worldSearchButton(p)
  if (!await clickWhenVisible(p, searchBtn, { timeout: 8000, force: true, annotate: true, label: 'Search' })) return false

  await showStep(p, 'Waiting for search input')
  const input = await waitForAndHighlight(p, Locators.pacInput, 12000, { label: 'Search input' })
  if (!input) { addWarning('pac-input not visible'); return false }
  await showStep(p, `Typing location: ${placeName}`)
  await input.fill(placeName)

  const match = p.locator('.pac-container .pac-item', { hasText: placeName }).first()
  try {
    await expect(match).toBeVisible({ timeout: 12000 })
  } catch (e) {
    addWarning(`Search suggestion for "${placeName}" didn't appear`)
    return false
  }

  await highlight(p, match)
  // annotate the selection so user sees what is clicked
  try { await annotateTemporary(p, match, `Select: ${placeName}`, 1100) } catch {}
  await match.click()
  await waitForMapToLoad(p)
  try { await zoomUntilAOI(p) } catch (err) { const msg = 'AOI toolbar never appeared after zoom attempts'; addWarning(msg); return false }
  try { await openAndDrawRectangleAOI(p) } catch (err) { addWarning(`Unable to draw AOI rectangle: ${err?.message || err}`); return false }
  return true
}

async function zoomMapNTimes(page, times = 6) {
  await showStep(page, `Zooming map ${times} times using double-click`)
  const map = page.locator('#map')
  await expect(map).toBeVisible()
  const box = await map.boundingBox()
  if (!box) throw new Error('Map bounding box not found')
  for (let i = 0; i < times; i++) {
    const x = box.x + box.width * (0.45 + Math.random() * 0.1)
    const y = box.y + box.height * (0.45 + Math.random() * 0.1)
    await page.mouse.dblclick(x, y)
    await fastWait(page, 550)
  }
  await waitForMapToLoad(page)
}

async function zoomUntilAOI(page, maxAttempts = 12) {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try { await Locators.aoiToolbar(page).waitFor({ state: 'visible', timeout: 800 }); return } catch {}
    await zoomMapNTimes(page, 1)
    try { await Locators.aoiToolbar(page).waitFor({ state: 'visible', timeout: 1200 }); return } catch {}
  }
  throw new Error('AOI toolbar never appeared after zooming.')
}

async function clickDrawRectangleInToolbar(page, toolbarLocator) {
  await toolbarLocator.waitFor({ state: 'visible', timeout: 30000 })
  const rectBtn = toolbarLocator.locator('button[aria-label="Draw a rectangle"], button[title="Draw a rectangle"], button[aria-label*="rect"], button[title*="rect"]').first()
  if (await rectBtn.count() === 0) {
    const html = await toolbarLocator.evaluate(el => el.innerHTML)
    throw new Error('Draw-rectangle button not found inside toolbar. Toolbar HTML (truncated):\n' + html.substring(0, 3000))
  }
  try { await rectBtn.scrollIntoViewIfNeeded() } catch {}
  try {
    // annotate draw rectangle action
    try { await annotateTemporary(page, rectBtn, 'Draw rectangle', 1000) } catch {}
    await rectBtn.click({ timeout: 4000 })
  } catch (err) {
    try { await rectBtn.click({ force: true, timeout: 3000 }) } catch (err2) {
      const clicked = await toolbarLocator.evaluate((toolbarEl) => {
        const btn = toolbarEl.querySelector('button[aria-label="Draw a rectangle"], button[title="Draw a rectangle"], button[aria-label*="rect"], button[title*="rect"]')
        if (!btn) return false
        try { btn.click(); return true } catch { return false }
      })
      if (!clicked) throw new Error('Unable to click draw-rectangle button: ' + (err2 && err2.message ? err2.message : String(err2)))
    }
  }
}

async function openAndDrawRectangleAOI(p) {
  setContext({ flow: 'drawAOI' })
  await showStep(p, 'Waiting for AOI toolbar to appear')
  const toolbar = Locators.aoiToolbar(p)
  await toolbar.waitFor({ state: 'visible', timeout: 30000 })
  await highlight(p, toolbar, { forceOutlineOnly: true })
  await clickDrawRectangleInToolbar(p, toolbar)
  await fastWait(p, 400)
  await showStep(p, 'Drawing rectangle AOI on map')
  const map = Locators.mapContainer(p)
  await expect(map).toBeVisible()
  await highlight(p, map)
  const box = await map.boundingBox()
  if (!box) {
    addWarning('Map bounding box not found — cannot draw AOI')
    return
  }
  const startX = box.x + Math.round(box.width * 0.25)
  const startY = box.y + Math.round(box.height * 0.30)
  const endX   = box.x + Math.round(box.width * 0.65)
  const endY   = box.y + Math.round(box.height * 0.60)
  await p.mouse.move(startX, startY)
  await p.mouse.down()
  await p.mouse.move(endX, endY, { steps: 12 })
  await p.mouse.up()
  await fastWait(p, 1000)

  // Validate AOI appeared on map
  await showStep(p, 'Validating drawn AOI is present on the map')
  const aoi = await waitForAOIOnMap(p, 25000)
  if (!aoi) {
    const msg = 'Drawn AOI not detected on map after drawing.'
    addWarning(msg)
    await saveMapScreenshot(p, 'aoi', 'aoi_missing', true)
  } else {
    await showStep(p, `AOI detected (selector: ${aoi.selector || 'unknown'})`)
    logInfo(`AOI detected (selector: ${aoi.selector || 'unknown'})`, { selector: aoi.selector })
    try { await highlight(p, aoi.locator, { borderColor: 'rgba(0,200,120,0.95)', pause: 800 }) } catch {}
  }
}

/* ===============================
   SEARCH UI small helpers
================================ */

async function openSearchModal(p) {
  setContext({ flow: 'openSearch' })
  return await clickWhenVisible(p, Locators.worldSearchButton, { timeout: 8000, force: true, annotate: true, label: 'Search' })
}

async function waitForSearchInputAndHighlight(p, timeout = 8000) {
  const pac = await waitForAndHighlight(p, Locators.pacInput, timeout)
  if (!pac) {
    addWarning('Search input (pac-input) did not appear')
    await saveMapScreenshot(p, 'search', 'pac_input_missing', true)
    return null
  }
  return pac
}

async function verifySearchPlaceholder(p, expected = 'Search for Imagery, LiDAR & DEM Data') {
  try {
    const placeholder = (await p.locator('#pac-input').getAttribute('placeholder')) || ''
    if (placeholder !== expected) {
      addWarning(`Placeholder mismatch: expected "${expected}" but found "${placeholder}"`)
      return false
    }
    logInfo('Search placeholder matches expected', { placeholder })
    return true
  } catch (e) {
    addWarning(`Unable to read placeholder attribute: ${e?.message || e}`)
    return false
  }
}

/* ===============================
   SATELLITE / CART / CHECKOUT HELPERS
================================ */

async function highlightSidebarAndOpenSatellite(p) {
  const sidebar = Locators.sidebar(p)
  try { await expect(sidebar).toBeVisible({ timeout: 10000 }) } catch (e) { addWarning('Sidebar not visible'); return false }
  await highlight(p, sidebar, { forceOutlineOnly: true })
  const sat = Locators.satelliteSection(p)
  try { await expect(sat).toBeVisible({ timeout: 10000 }) } catch (e) { addWarning('#satellite section not visible'); return false }
  await highlight(p, sat)
  // annotate the click on Satellite section
  try { await annotateTemporary(p, sat, 'Open Satellite', 1000) } catch {}
  await sat.click()
  await fastWait(p, 500)
  return true
}

async function waitForSatelliteTableWithWarning(p, timeoutMs = 180000) {
  const table = Locators.tableSatellite(p)
  try { await table.waitFor({ state: 'visible', timeout: timeoutMs }); await highlight(p, table); return true } catch (err) { const msg = `table did not appear after ${Math.round(timeoutMs/1000)}s`; addWarning(msg); return false }
}

async function addItemToCartAndVerifyPopup(p) {
  const firstRow = Locators.firstSatelliteRow(p)
  try {
    await expect(firstRow).toBeVisible({ timeout: 10000 })
  } catch (e) {
    addWarning('First satellite row not visible in table')
    return false
  }

  let productName = ''
  try {
    const productDiv = firstRow.locator('td:nth-child(2) div')
    if (await productDiv.count() > 0) {
      productName = (await productDiv.first().innerText()).trim()
    }
  } catch (e) { productName = '' }

  if (!productName) {
    try {
      const inputEl = firstRow.locator('input[type="image"]').first()
      const raw = await inputEl.getAttribute('value')
      if (raw) {
        try {
          const parsed = JSON.parse(raw.replace(/'/g, '"'))
          if (parsed && parsed[0]) productName = String(parsed[0])
        } catch (err) {
          const m = raw.match(/^\s*\['?([^',\]]+)/)
          if (m) productName = (m[1] || '').trim()
        }
      }
    } catch (e) {}
  }

  if (!productName) {
    addWarning('Unable to parse product name from first satellite row')
    productName = ''
  }

  await highlight(p, firstRow, { forceOutlineOnly: true })
  const addBtn = firstRow.locator('input[type="image"]').first()
  try { await highlight(p, addBtn, { borderColor: 'rgba(0,200,120,0.95)', pause: 500 }) } catch {}

  try {
    // annotate add-to-cart action so it's visible
    try { await annotateTemporary(p, addBtn, 'Add to cart', 1000) } catch {}
    await addBtn.click()
  } catch (e) {
    try { await addBtn.click({ force: true }) } catch (err) { addWarning('Failed to click add-to-cart button on first row'); return false }
  }

  await fastWait(p, 600)

  LAST_ADDED_PRODUCT = (productName || '').trim()
  logInfo('Added to cart (captured product)', { product: LAST_ADDED_PRODUCT })

  const popup = Locators.addToCartPopup(p)
  try { await popup.waitFor({ state: 'visible', timeout: 15000 }) } catch (e) { const msg = 'popup did not appear within 15s after adding to cart'; addWarning(msg); return false }
  await highlight(p, popup)
  try { await expect(popup).toContainText('Item added to cart') } catch (e) { addWarning('Add-to-cart popup did not contain expected "Item added to cart" text'); }
  const popupDisplay = await popup.evaluate(el => window.getComputedStyle(el).display)
  if (popupDisplay !== 'block') { const msg = `popup display is "${popupDisplay}" (expected "block")`; addWarning(msg); return false }
  await expect(popup).toHaveCSS('display', 'block')
  return true
}

async function openCartAndVerifyItem(p) {
  const badge = Locators.cartBadge(p)
  let badgeText = ''
  try { badgeText = (await badge.innerText()).trim() } catch (e) { const msg = 'Unable to read cart badge'; addWarning(msg); return false }

  if (badgeText !== '1') { const msg = `Expected cart count "1" but found "${badgeText}"`; addWarning(msg); return false }
  await highlight(p, badge)

  const trigger = Locators.cartTrigger(p)
  await highlight(p, trigger)
  // annotate open cart action
  try { await annotateTemporary(p, trigger, 'Open Cart', 900) } catch {}
  await trigger.click()

  const cartTable = Locators.shoppingCartTable(p)
  try {
    await cartTable.waitFor({ state: 'visible', timeout: 15000 })
  } catch (e) {
    const msg = 'Shopping cart table did not appear in modal'
    addWarning(msg)
    return false
  }

  try {
    const modal = Locators.cartModal(p)
    if (await modal.count() > 0) await highlight(p, modal.first(), { borderColor: 'rgba(0,120,255,0.95)' })
  } catch (e) {}

  try {
    const firstRow = cartTable.locator('tr').nth(1)
    await firstRow.waitFor({ state: 'visible', timeout: 8000 })
    await highlight(p, firstRow, { borderColor: 'rgba(0,200,120,0.95)', pause: 700 })
    const productCell = firstRow.locator('td').nth(0)
    const actualProduct = (await getInnerTextSafe(productCell)).trim()

    logInfo('Cart first row product', { actualProduct, expected: LAST_ADDED_PRODUCT })

    if (LAST_ADDED_PRODUCT) {
      if (!actualProduct.includes(LAST_ADDED_PRODUCT)) {
        const msg = `${LAST_ADDED_PRODUCT} not found in first cart row. Found: ${actualProduct}`
        addWarning(msg)
        await saveMapScreenshot(p, LAST_ADDED_PRODUCT || 'cart_mismatch', 'cart_first_row_mismatch', true)
        return false
      }
    } else {
      if (!actualProduct.includes('WorldView03')) {
        const msg = `WorldView03 not found in first cart row (fallback). Found: ${actualProduct}`
        addWarning(msg)
        await saveMapScreenshot(p, 'cart', 'cart_first_row_missing_worldview03', true)
        return false
      }
    }

    return true
  } catch (e) {
    const msg = 'Failed to validate first cart row'
    addWarning(msg)
    await saveMapScreenshot(p, 'cart', 'cart_validation_error', true)
    return false
  }
}

async function checkoutAndFillForm(p) {
  const checkout = Locators.checkoutBtn(p)
  try { await expect(checkout).toBeVisible({ timeout: 10000 }) } catch (e) { const msg = 'Checkout button not visible'; addWarning(msg); return false }
  await highlight(p, checkout)
  try { await annotateTemporary(p, checkout, 'Checkout', 900) } catch {}
  await checkout.click()
  await fastWait(p, 600)
  try { await Locators.firstName(p).waitFor({ state: 'visible', timeout: 15000 }) } catch (e) { const msg = 'Checkout form did not appear'; addWarning(msg); return false }
  try {
    await highlight(p, Locators.firstName(p)); await p.fill('#first_name', 'Test')
    await highlight(p, Locators.lastName(p)); await p.fill('#last_name', 'testing')
    await highlight(p, Locators.email(p)); await p.fill('#email', 'kapil@test.com')
    await highlight(p, Locators.company(p)); await p.fill('#company', 'GeoWGS')
    await highlight(p, Locators.phone(p)); await p.fill('#phone', '9999999999')
    await highlight(p, Locators.street(p)); await p.fill('textarea[name="street"]', 'MG Road')
    await highlight(p, Locators.city(p)); await p.fill('#city', 'Bangalore')
    await highlight(p, Locators.state(p)); await p.fill('#state', 'Karnataka')
    await highlight(p, Locators.zip(p)); await p.fill('#zip', '560001')
    await highlight(p, Locators.country(p)); await p.fill('#country', 'India')
    await highlight(p, Locators.industry(p)); await p.selectOption('#industry', 'Technology')
    await highlight(p, Locators.description(p)); await p.fill('textarea[name="description"]', 'Automated test submission')
  } catch (e) { const msg = 'Unable to fill checkout form'; addWarning(msg); return false }

  const submitBtn = p.locator('input[type="submit"]')
  await highlight(p, submitBtn)
  let newPageOrNavigationResult = null
  try {
    const waitForEither = Promise.race([
      p.context().waitForEvent('page', { timeout: 30000 }).then(pg => ({ type: 'newPage', page: pg })),
      p.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 30000 }).then(() => ({ type: 'samePage' }))
    ])
    const [ , result ] = await Promise.all([ submitBtn.click(), waitForEither ])
    newPageOrNavigationResult = result
  } catch (e) { const msg = 'Submit failed or no navigation/new tab within timeout'; addWarning(msg); return false }

  if (newPageOrNavigationResult && newPageOrNavigationResult.type === 'newPage') {
    const thankYouPage = newPageOrNavigationResult.page
    try { await thankYouPage.waitForLoadState('domcontentloaded', { timeout: 30000 }); await expect(thankYouPage).toHaveURL(/thank_you/) } catch (e) { const msg = 'Thank-you page (new tab) did not load or URL mismatch'; addWarning(msg); return false }
  } else {
    try { await p.waitForLoadState('domcontentloaded', { timeout: 30000 }); const url = p.url(); if (!/thank_you/.test(url)) { const msg = `After submit current page URL is "${url}" (expected /thank_you/)`; addWarning(msg); return false } } catch (e) { const msg = 'Navigation after submit failed or timed out'; addWarning(msg); return false }
  }
  return true
}

async function waitForScenesTableStable(page, timeout = 120000) {
  try {
    setContext({ flow: 'waitScenesTable' })
    logInfo(`Waiting for scenes table (timeout: ${timeout}ms)`)

    const table = Locators.scenesTable(page)
    const rows = Locators.scenesRows(page)

    const start = Date.now()

    // Wait for table to appear
    await table.waitFor({ state: 'visible', timeout }).catch(() => null)

    // Poll until rows appear or timeout
    while (Date.now() - start < timeout) {
      const rowCount = await rows.count().catch(() => 0)

      if (rowCount > 0) {
        logInfo(`Scenes table loaded with ${rowCount} row(s)`)
        return true
      }

      await fastWait(page, 500)
    }

    addWarning('Scenes table visible but no rows found within timeout')
    return false

  } catch (e) {
    addError('waitForScenesTableStable failed: ' + (e?.message || e))
    try {
      await page.screenshot({ path: `error-scenes-table-${Date.now()}.png`, fullPage: true })
    } catch {}
    return false
  }
}

/* ===============================
   CLICK MAP UNTIL INFO WINDOW
================================ */

async function clickMapUntilInfoWindow(p) {
  await showStep(p, 'Attempting clicks on the map until info window appears')
  const infoWindowLocator = Locators.infoWindow(p)
  const mapLocator = Locators.mapContainer(p)

  try {
    await fastWait(p, 800)
    await expect(mapLocator).toBeVisible({ timeout: 15000 })
    await mapLocator.scrollIntoViewIfNeeded()
    try { await focusPage(p) } catch {}

    const box = await mapLocator.boundingBox()
    if (!box) {
      addWarning('Map container bounding box not found')
      return false
    }

    const maxAttempts = 15
    let found = false
    const baseOffsetX = 40
    const baseOffsetY = 80

    for (let i = 0; i < maxAttempts; i++) {
      const randomOffsetX = (Math.random() - 0.5) * 150
      const randomOffsetY = (Math.random() - 0.5) * 120
      let clickX = Math.round(box.x + box.width / 2 + baseOffsetX + randomOffsetX)
      let clickY = Math.round(box.y + box.height / 2 + baseOffsetY + randomOffsetY)
      clickX = Math.max(2, clickX)
      clickY = Math.max(2, clickY)

      try {
        await p.mouse.move(Math.max(0, clickX - 60), Math.max(0, clickY - 60), { steps: 12 })
        await p.mouse.move(clickX, clickY, { steps: 8 })
      } catch {}

      await p.evaluate(({ x, y }) => {
        const dot = document.createElement('div')
        dot.style.position = 'absolute'
        dot.style.left = `${x}px`
        dot.style.top = `${y}px`
        dot.style.width = '14px'
        dot.style.height = '14px'
        dot.style.background = 'red'
        dot.style.border = '2px solid white'
        dot.style.borderRadius = '50%'
        dot.style.zIndex = '999999'
        dot.style.pointerEvents = 'none'
        dot.style.boxShadow = '0 4px 12px rgba(0,0,0,0.35)'
        document.body.appendChild(dot)
        setTimeout(() => dot.remove(), 1400)
      }, { x: clickX, y: clickY })

      await fastWait(p, 300)

      try {
        await p.mouse.down()
        await fastWait(p, 80)
        await p.mouse.up()
      } catch {
        try { await p.mouse.click(clickX, clickY) } catch {}
      }

      await fastWait(p, 900)

      try {
        await Locators.sideNavToggle(p).isVisible().then(async visible => {
          if (visible) { await highlight(p, Locators.sideNavToggle(p)); await Locators.sideNavToggle(p).click().catch(() => {}); await fastWait(p, 600) }
        }).catch(() => {})
      } catch {}

      try {
        await infoWindowLocator.waitFor({ state: 'visible', timeout: 1500 })
        found = true
        await highlight(p, infoWindowLocator)
        break
      } catch {}
    }

    if (!found) {
      addWarning('Info window (.gm-style-iw) did not appear after multiple clicks')
      return false
    }
    return true
  } catch (e) {
    addWarning('Error while trying to trigger info window by clicking map: ' + (e?.message || e))
    return false
  }
}

/* ===============================
   SETUP / TEARDOWN
================================ */

let _consoleLogs = []
let _pageErrors = []

test.beforeEach(async ({}, testInfo) => {
  CURRENT_TESTCASE = testInfo.title || 'Unnamed test'
  WARNINGS = []
  INFOS = []
  ERRORS = []
  _consoleLogs = []
  _pageErrors = []
  clearContext()
  LAST_ADDED_PRODUCT = ''

  browser = await chromium.launch({
    headless: process.env.CI ? true : false,
    slowMo: CONFIG.PW_SLOWMO,
    args: ['--start-maximized']
  })

  const videoDir = path.join(process.cwd(), 'test-results')
  if (!fs.existsSync(videoDir)) fs.mkdirSync(videoDir, { recursive: true })

  context = await browser.newContext({ 
    viewport: null,
    recordVideo: { dir: videoDir } 
  })
  
  page = await context.newPage()

  await page.goto(CONFIG.BASE_URL, { waitUntil: 'domcontentloaded' })
})

test.afterEach(async ({}, testInfo) => {
  const needCapture =
    testInfo.status === 'failed' || testInfo.status === 'timedOut' || WARNINGS.length > 0

  // ---------------------------------------------------------
  // 1. TAKE SCREENSHOT (Must happen while Page is open)
  // ---------------------------------------------------------
  if (needCapture && page && !page.isClosed()) {
    try {
      // Remove UI overlays
      await page.evaluate(() => {
        document.getElementById('pw-banner-container')?.remove()
        document.getElementById('pw-layout-spacer')?.remove()
      }).catch(() => {})

      await page.bringToFront().catch(() => {})
      await page.waitForLoadState('networkidle').catch(() => {})
      
      // Create readable filename
      const status = testInfo.status || 'warning'
      const safeName = sanitizeFilename(`${testInfo.title}_${status}_retry${testInfo.retry}`)
      const resultsDir = path.join(process.cwd(), 'test-results')
      if (!fs.existsSync(resultsDir)) fs.mkdirSync(resultsDir, { recursive: true })

      const screenshotPath = path.join(resultsDir, `${safeName}.png`)
      await page.screenshot({ path: screenshotPath, fullPage: true })

      // Attach Screenshot
      testInfo.attachments = testInfo.attachments || []
      testInfo.attachments.push({
        name: `${safeName}.png`,
        path: screenshotPath,
        contentType: 'image/png'
      })
      console.log('📸 Screenshot attached:', screenshotPath)

      // Attach Logs
      if (WARNINGS.length > 0) {
        testInfo.annotations = testInfo.annotations || []
        testInfo.annotations.push({ type: 'warning', description: WARNINGS.map(w => `${w.time} - ${w.message}`).join('\n') })
      }
    } catch (err) {
      console.warn('⚠️ Screenshot capture failed:', err)
    }
  }

  // ---------------------------------------------------------
  // 2. SAVE VIDEO (Must happen after Context is closed)
  // ---------------------------------------------------------
  let videoPath = null
  try {
    if (context) {
      const video = page.video()
      await context.close() // Closing context flushes the video to disk
      if (video) videoPath = await video.path()
    }
  } catch (e) {
    // Ignore if already closed
  }

  if (needCapture && videoPath && fs.existsSync(videoPath)) {
    try {
      const status = testInfo.status || 'warning'
      const safeName = sanitizeFilename(`${testInfo.title}_${status}_retry${testInfo.retry}`)
      const resultsDir = path.join(process.cwd(), 'test-results')
      const finalVideoPath = path.join(resultsDir, `${safeName}.webm`)

      // Rename the video file to match the test case
      fs.renameSync(videoPath, finalVideoPath)

      // Attach Video
      testInfo.attachments = testInfo.attachments || []
      testInfo.attachments.push({
        name: `${safeName}.webm`,
        path: finalVideoPath,
        contentType: 'video/webm'
      })
      console.log('🎥 Video attached:', finalVideoPath)
    } catch (err) {
      console.warn('⚠️ Video rename/attach failed:', err)
    }
  } else if (!needCapture && videoPath && fs.existsSync(videoPath)) {
    // If test passed, delete the video to save space
    try { fs.unlinkSync(videoPath) } catch (e) {}
  }

  // ---------------------------------------------------------
  // 3. CLEANUP
  // ---------------------------------------------------------
  try {
    if (browser) await browser.close()
  } catch (e) {}
})

/* ===============================
   TESTS 
================================ */

test('[P0] 1: Shoping Cart and checkout page', async ({}, testInfo) => {
  CURRENT_TESTCASE = '[P0] 1: Submitting Selected AOI'

  await showStep(page, 'Step 1: Opening datastore landing page')
  const s1 = await openLanding(page)
  if (!s1) return

  await showStep(page, 'Step 2: Closing wizard modal')
  const s2 = await S2closeWizardModal(page)
  if (!s2) return

  await showStep(page, 'Step 3: Search for a place and Drawing AOI')
  const s3 = await searchPlace(page, 'Indore')
  if (!s3) return

  await showStep(page, 'Step 4: Open Satellite Imagery section')
  const s5 = await highlightSidebarAndOpenSatellite(page)
  if (!s5) return

  await showStep(page, 'Step 5: Waiting for table to load')
  const s6 = await waitForSatelliteTableWithWarning(page)
  if (!s6) return

  await showStep(page, 'Step 6: Click Add to cart for FIRST row in satellite table')
  const s7 = await addItemToCartAndVerifyPopup(page)
  if (!s7) return

  await showStep(page, 'Step 7: Waiting for "Item added to cart" popup / Verify cart (first-row match)')
  const s8 = await openCartAndVerifyItem(page)
  if (!s8) return

  await showStep(page, 'Step 8: Click Checkout / Fill form / Submit order')
  const s9 = await checkoutAndFillForm(page)
  if (!s9) return

  await showStep(page, 'Step 9: ✅ Redirected to thank_you page — TEST PASSED')

  if (WARNINGS.length > 0) {
    try {
      testInfo.attachments = testInfo.attachments || []
      testInfo.annotations = testInfo.annotations || []
      testInfo.annotations.push({
        type: 'warning',
        description: WARNINGS.map(w => `${w.time} — ${w.message}`).join('\n')
      })
    } catch (err) {
      console.warn('Failed to attach warnings to testInfo:', err)
    }
  }
})

const PRODUCT_TESTS = [
  { id: '2', titleSuffix: 'WorldView01', productName: 'WorldView01' },
  { id: '2.1', titleSuffix: 'WorldView02', productName: 'WorldView02' },
  { id: '2.2', titleSuffix: 'WorldView03', productName: 'WorldView03' },
  { id: '2.3', titleSuffix: 'WorldView04', productName: 'WorldView04' },
  { id: '2.4', titleSuffix: 'GeoEye1', productName: 'GeoEye1' },
  { id: '2.5', titleSuffix: 'QuickBird', productName: 'QuickBird' },
  { id: '2.6', titleSuffix: 'IKONOS', productName: 'IKONOS' },
  // New: simpler verification products — only check preview/details images are present & loaded
  { id: '2.7', titleSuffix: '21AT 30cm Archive', productName: '21AT 30cm Archive', simpleVerify: true },
  { id: '2.8', titleSuffix: '21AT 50cm Archive', productName: '21AT 50cm Archive', simpleVerify: true },
  { id: '2.9', titleSuffix: '21AT 80cm Archive', productName: '21AT 80cm Archive', simpleVerify: true },
  { id: '2.10', titleSuffix: 'WV-Legion01', productName: 'WV-Legion01', simpleVerify: true },
  { id: '2.11', titleSuffix: 'WV-Legion02', productName: 'WV-Legion02', simpleVerify: true }
]

PRODUCT_TESTS.forEach(({ id, titleSuffix, productName, simpleVerify = false }) => {
  test(`[P0] ${id}: Satellite scenes — ${titleSuffix} — outline, preview and details verification`, async ({}, testInfo) => {
    CURRENT_TESTCASE = `[P0] ${id}: Satellite scenes — ${titleSuffix} — outline, preview and details verification`

    const SCENES_TABLE_TIMEOUT = Number(process.env.SCENES_TABLE_TIMEOUT || 120000)

    await showStep(page, 'Step 1: Opening datastore landing page')
    await openLanding(page)

    await showStep(page, 'Step 2: Closing wizard modal')
    try {
      await S2closeWizardModal(page)
      await fastWait(page, 800)
    } catch {
      addWarning('Unable to close wizard modal')
    }

    await showStep(page, 'Step 3: Search for a place and Drawing AOI')
    setContext({ flow: 'searchAndDraw', details: { place: 'Indore' } })
    if (!await searchPlace(page, 'Indore')) {
      addWarning('searchPlace failed — stopping test')
      return
    }

    await showStep(page, 'Step 4: Open Satellite Imagery section')
    if (!await highlightSidebarAndOpenSatellite(page)) return

    await showStep(page, 'Step 5: Waiting for table to load')
    if (!await waitForSatelliteTableWithWarning(page)) return

    await showStep(page, `Step 6: Locate product "${productName}" in the satellite list`)
    setContext({ flow: 'productSelection', product: productName })

    // robust text-based product locator (handles spaces/special chars)
    const productCell = page.locator('#table_satellite td div', { hasText: productName }).first()
    if (await productCell.count() === 0) {
      addWarning(`Product "${productName}" not found in #table_satellite — skipping test`)
      return
    }

    await showStep(page, `Step 7: Clicking product "${productName}"`)
    try {
      await highlight(page, productCell)
      await productCell.click()
    } catch (e) {
      addWarning(`Unable to click product "${productName}": ${e?.message || e}`)
      return
    }

    await showStep(page, 'Step 8: Wait for scenes table to populate')
    const scenesOk = await waitForScenesTableStable(page, SCENES_TABLE_TIMEOUT)
    if (!scenesOk) {
      addWarning(`Scenes table not loaded for "${productName}"`)
      return
    }

    // preserve original behavior: process only the first scene per product
    const scenesRows = Locators.scenesRows(page)
    const scenesCountAll = await scenesRows.count()
    const scenesCount = Math.min(1, scenesCountAll)

    if (scenesCount === 0) {
      addWarning(`No scenes available for product "${productName}"`)
      return
    }

    for (let sIdx = 0; sIdx < scenesCount; sIdx++) {
      const row = scenesRows.nth(sIdx)
      const sceneId = await getSceneIdFromRow(row)
      setContext({ flow: 'sceneProcessing', product: productName, scene: sceneId })
      // pass the simpleVerify option so clickPreview/clickDetails run the lighter checks for 2.7-2.11
      await processScene(row, page, sIdx, { simpleVerify })
    }

    // small settle pause and clear product context
    await fastWait(page, 600)
    setContext({ product: '' })

    await showStep(page, `Step 9: ✅ Test for product "${productName}" completed`)
  })
})

test('[P1] 3: Search UI — search location (draw AOI)', async ({}, testInfo) => {
  CURRENT_TESTCASE = '[P1] 3: Search UI — search location (draw AOI)'

  await showStep(page, 'Step 1: Opening datastore landing page')
  const s1 = await openLanding(page)
  if (!s1) return

  await showStep(page, 'Step 2: Closing wizard modal')
  try {
    await S2closeWizardModal(page)
    await fastWait(page, 800)
  } catch {
    addWarning('Unable to close wizard modal')
  }

  await showStep(page, 'Step 3: Navigate to search module (click world_search)')
  const opened = await openSearchModal(page)
  if (!opened) {
    addWarning('Failed to open search module (world_search click)')
    return
  }

  await showStep(page, 'Step 4: Verify search input/modal opens')
  const pac = await waitForSearchInputAndHighlight(page)
  if (!pac) {
    addWarning('Search input (#pac-input) did not appear after opening search module')
    return
  }

  await showStep(page, 'Step 5: Verify placeholder text is "Search for Imagery, LiDAR & DEM Data"')
  const placeholderOk = await verifySearchPlaceholder(page, 'Search for Imagery, LiDAR & DEM Data')
  if (!placeholderOk) {
    addWarning('Search input placeholder mismatch')
  }

  await showStep(page, 'Step 6: Type "Indore" and select first suggestion')
  try {
    await pac.fill('Indore')
    const first = Locators.pacFirstOption(page)
    await expect(first).toBeVisible({ timeout: 12000 })
    await highlight(page, first)
    await first.click()
  } catch (e) {
    addWarning('Failed to type/select "Indore" from suggestions')
    return
  }

  await showStep(page, 'Step 7: Wait and verify marker/transparent image appears on map')
  let markerOk = false
  try {
    setContext({ flow: 'mapValidation', details: { type: 'searchMarker' } })
    await waitForMapToLoad(page)
    const marker = page
      .locator('#map img[src*="transparent.png"], #map img[src*="maps.gstatic.com"], #map img[src*="mapfiles/transparent.png"]')
      .first()
    await marker.waitFor({ state: 'visible', timeout: 15000 })
    // Dark strong highlight
    await highlight(page, marker, {
      borderColor: 'darkred',
      backgroundColor: 'rgba(0,0,0,0.35)',
      borderWidth: 4
    })

    logInfo('Map marker image detected and highlighted')
    // Pause so you can visually see it
    await fastWait(page, 2500)
    markerOk = true
  } catch (e) {
    addWarning('Expected map marker (transparent image) did not appear after selecting search suggestion')
    try {
      await page.screenshot({
        path: `search-marker-missing-${Date.now()}.png`,
        fullPage: true
      })
    } catch {}
  }
  if (!markerOk) return


  await showStep(page, 'Step 8: ✅ Search UI test completed (marker verified)')
  if (WARNINGS.length > 0) {
    try {
      testInfo.attachments = testInfo.attachments || []
      testInfo.annotations = testInfo.annotations || []
      testInfo.annotations.push({
        type: 'warning',
        description: WARNINGS.map(w => `${w.time} — ${w.message}`).join('\n')
      })
    } catch (err) {
      console.warn('Failed to attach warnings to testInfo:', err)
    }
  }
})

test('[P1] 4: Coordinates — enter lat/lon and zoom to place', async ({}, testInfo) => {
  CURRENT_TESTCASE = '[P1] 4: Coordinates — enter lat/lon and zoom to place'

  await showStep(page, 'Step 1: Opening datastore landing page')
  const s1 = await openLanding(page); if (!s1) return

  await showStep(page, 'Step 2: Closing wizard modal')
  try { await S2closeWizardModal(page); await fastWait(page, 800) } catch { addWarning('Unable to close wizard modal') }

  await showStep(page, 'Step 3: Open "Enter Coordinates" modal (click coords nav link)')
  if (!await clickWhenVisible(page, Locators.coordsBtn, { timeout: 10000, force: true, annotate: true, label: 'Coords' })) { addWarning('Coordinates nav button not found'); return }

  await showStep(page, 'Step 4: Verify coordinates modal opens and highlight it')
  if (!await waitForAndHighlight(page, Locators.coordsModalTitle, 12000)) { addWarning('Enter Coordinates modal did not appear'); return }

  await showStep(page, 'Step 5: Fill Latitude / Longitude and highlight inputs + Take Me button')
  try {
    await waitForAndHighlight(page, Locators.latInput, 8000); await Locators.latInput(page).fill('18.5246')
    await waitForAndHighlight(page, Locators.lonInput, 8000); await Locators.lonInput(page).fill('73.8786')
    await waitForAndHighlight(page, Locators.takeMeBtn, 8000)
  } catch (e) { addWarning('Unable to locate/fill coordinate inputs or highlight Take Me button'); return }

 await showStep(page, 'Step 6: Click "Take Me" and wait for map marker/transparent image to appear')

  if (!await clickWhenVisible(page, Locators.takeMeBtn, { timeout: 8000, force: true })) {
    addWarning('Failed to click Take Me button')
    return
  }

  let markerOk = false

  try {
    setContext({ flow: 'mapValidation', details: { type: 'coordinateMarker' } })

    await waitForMapToLoad(page)

    const marker = page
      .locator('#map img[src*="transparent.png"], #map img[src*="maps.gstatic.com"], #map img[src*="mapfiles/transparent.png"]')
      .first()

    await marker.waitFor({ state: 'visible', timeout: 15000 })

    // Dark visible highlight
    await highlight(page, marker, {
      borderColor: 'darkblue',
      backgroundColor: 'rgba(0,0,0,0.35)',
      borderWidth: 4
    })

    logInfo('Coordinate marker image detected and highlighted')

    // Pause so you can visually confirm it
    await fastWait(page, 2500)

    markerOk = true

  } catch (e) {
    addWarning('Expected map marker (transparent image) did not appear after submitting coordinates')

    try {
      await page.screenshot({
        path: `coordinates-marker-missing-${Date.now()}.png`,
        fullPage: true
      })
    } catch {}
  }

  if (!markerOk) return
  await showStep(page, 'Step 7: ✅ Coordinates test completed (marker verified)')
})

test('[P1] 5: Upload KMZ and verify map info window (zoom to place)', async ({}, testInfo) => {
  CURRENT_TESTCASE = '[P1] 5: Upload KMZ and verify map info window (zoom to place)'

  await showStep(page, 'Step 1: Opening datastore landing page')
  const s1 = await openLanding(page); if (!s1) return

  await showStep(page, 'Step 2: Closing wizard modal')
  try { await S2closeWizardModal(page); await fastWait(page, 800) } catch { addWarning('Unable to close wizard modal'); return }

  await showStep(page, 'Step 3: Click Upload KML/KMZ module')
  if (!await clickWhenVisible(page, Locators.uploadNav, { timeout: 8000, force: true, annotate: true, label: 'Upload' })) { addWarning('Unable to click Upload KML/KMZ module'); return }

  await showStep(page, 'Step 4: Verify Upload modal opens and highlight it')
  if (!await waitForAndHighlight(page, Locators.uploadModal, 10000)) { addWarning('Upload File modal did not appear'); return }

  await showStep(page, 'Step 5: Upload MadhyaPradesh.kmz and click Upload')
  try {
    await waitForAndHighlight(page, Locators.fileInput, 8000)
    await Locators.fileInput(page).setInputFiles('tests/test data/MadhyaPradesh.kmz')
    await waitForAndHighlight(page, Locators.uploadBtn, 8000)
    await Promise.all([
      Locators.uploadBtn(page).click(),
      Locators.uploadModal(page).waitFor({ state: 'hidden', timeout: 20000 }).catch(() => {})
    ])
    await fastWait(page, 1200)
  } catch (e) { addWarning('Failed to upload KMZ file or click Upload button'); return }

  await showStep(page, 'Step 5A: Ensure side nav is closed')
  await ensureSideNavClosed(page)

  await showStep(page, 'Step 6: Click around until info window appears')
  const infoOk = await clickMapUntilInfoWindow(page)
  if (!infoOk) { addWarning('Info window did not appear after upload'); return }

  await showStep(page, 'Step 7: ✅ KMZ upload and map verification completed')
})

test('[P1] 6: Locate (go to current location)', async ({}, testInfo) => {
  CURRENT_TESTCASE = '[P1] 6: Locate (go to current location)'

  await showStep(page, 'Step 1: Opening datastore landing page')
  const s1 = await openLanding(page); if (!s1) return

  await showStep(page, 'Step 2: Closing wizard modal')
  try { await S2closeWizardModal(page); await fastWait(page, 800) } catch { addWarning('Unable to close wizard modal'); return }

  await showStep(page, 'Step 3: Grant geolocation permission and set location')
  try {
    const geo = { latitude: 22.7196, longitude: 75.8577, accuracy: 50 }
    try {
      await context.grantPermissions(['geolocation'], { origin: CONFIG.BASE_URL })
    } catch {
      try { await context.grantPermissions(['geolocation']) } catch {}
    }
    try { await context.setGeolocation({ latitude: geo.latitude, longitude: geo.longitude, accuracy: geo.accuracy || 50 }) } catch (e) { addWarning('Could not set geolocation on context: ' + (e?.message || e)) }
  } catch (e) { addWarning('Failed to prepare geolocation permission: ' + (e?.message || e)); return }

  await showStep(page, 'Step 4: Click Locate button and verify current location marker')

  try {
    setContext({ flow: 'locateFlow', details: { type: 'currentLocation' } })

    const locateNav = Locators.locateNav(page)
    await expect(locateNav).toBeVisible({ timeout: 10000 })
    await highlight(page, locateNav)

    const locateLink = locateNav.locator('a').first()
    await expect(locateLink).toBeVisible({ timeout: 5000 })
    await highlight(page, locateLink)

    await Promise.all([
      locateLink.click(),
      fastWait(page, 600)
    ])

    await waitForMapToLoad(page)

    const marker = page
      .locator('#map img[src*="transparent.png"], #map img[src*="maps.gstatic.com"], #map img[src*="mapfiles/transparent.png"]')
      .first()

    await marker.waitFor({ state: 'visible', timeout: 15000 })

    // 🔥 Strong dark highlight
    await highlight(page, marker, {
      borderColor: 'green',
      backgroundColor: 'rgba(0, 0, 0, 0.91)',
      borderWidth: 4
    })

    logInfo('Locate marker detected', {
      selector: await marker.evaluate(e => e.getAttribute('src')) || 'unknown'
    })

    // 👀 Pause so you can clearly see it
    await fastWait(page, 5500)

  } catch (e) {
    addWarning('Current location marker did not appear on the map after clicking Locate')

    try {
      await saveMapScreenshot(page, 'locate', 'marker_missing', true)
    } catch {}

    return
  }

  await showStep(page, 'Step 5: ✅ Locate flow verified (marker visible)')
})

test('[P1] 7: Hover locationer — show coordinates on mouse hover', async ({}, testInfo) => {
  CURRENT_TESTCASE = '[P1] 7: Hover locationer — show coordinates on mouse hover'

  await showStep(page, 'Step 1: Opening datastore landing page')
  const s1 = await openLanding(page); if (!s1) return

  await showStep(page, 'Step 2: Closing wizard modal')
  try { await S2closeWizardModal(page); await fastWait(page, 600) } catch { addWarning('Unable to close wizard modal'); return }

  await showStep(page, 'Step 3: Enable hover location control')
  try {
    const hoverAnchor = Locators.hoverAnchor(page)
    const hoverCheckbox = Locators.hoverCheckbox(page)
    if (await hoverAnchor.count() > 0 && await hoverAnchor.isVisible().catch(() => false)) {
      await highlight(page, hoverAnchor); await hoverAnchor.click(); await fastWait(page, 300)
    } else if (await hoverCheckbox.count() > 0) {
      await highlight(page, hoverCheckbox); try { await hoverCheckbox.check() } catch { await hoverCheckbox.click() }; await fastWait(page, 300)
    } else {
      throw new Error('Neither hover anchor nor checkbox found')
    }
  } catch (e) {
    addWarning('Unable to enable hover location toggle: ' + (e?.message || e))
    return
  }

  await showStep(page, 'Step 4: Hover on map to get coordinates and verify #position_on_hover')
  const mapLocator = Locators.mapContainer(page)
  const posLocator = Locators.positionOnHover(page)
  try {
    await expect(mapLocator).toBeVisible({ timeout: 15000 })
    await mapLocator.scrollIntoViewIfNeeded()
    try { await focusPage(page) } catch {}
    const box = await mapLocator.boundingBox()
    if (!box) { addWarning('Map bounding box not found — cannot perform hover test'); return }

    const gridOffsets = [
      { dx: 0, dy: 0 },
      { dx: -100, dy: -60 },
      { dx: 100, dy: -60 },
      { dx: -100, dy: 60 },
      { dx: 100, dy: 60 },
      { dx: -40, dy: 0 },
      { dx: 40, dy: 0 },
      { dx: 0, dy: -120 },
      { dx: 0, dy: 120 }
    ]
    let found = false
    for (const off of gridOffsets) {
      const targetX = Math.round(box.x + box.width / 2 + off.dx)
      const targetY = Math.round(box.y + box.height / 2 + off.dy)
      try {
        await page.mouse.move(Math.max(0, targetX - 30), Math.max(0, targetY - 30), { steps: 10 })
        await page.mouse.move(targetX, targetY, { steps: 6 })
      } catch {}
      await fastWait(page, 600)
      if (await posLocator.count() > 0 && await posLocator.isVisible().catch(() => false)) {
        const txt = (await getInnerTextSafe(posLocator)) || ''
        if (/latitude[:\s]*\d+/i.test(txt) && /longitude[:\s]*\d+/i.test(txt)) {
          found = true
          await highlight(page, posLocator)
          logInfo('Hover position detected', { text: txt })
          break
        }
      }
    }
    for (let i = 0; i < 6 && !found; i++) {
      const rx = Math.round(box.x + box.width * (0.3 + Math.random() * 0.4))
      const ry = Math.round(box.y + box.height * (0.3 + Math.random() * 0.4))
      try { await page.mouse.move(rx, ry, { steps: 6 }) } catch {}
      await fastWait(page, 450)
      if (await posLocator.count() > 0 && await posLocator.isVisible().catch(() => false)) {
        const txt = (await getInnerTextSafe(posLocator)) || ''
        if (/latitude[:\s]*\d+/i.test(txt) && /longitude[:\s]*\d+/i.test(txt)) {
          found = true
          await highlight(page, posLocator)
          logInfo('Hover position detected (random fallback)', { text: txt })
          break
        }
      }
    }
    if (!found) {
      addWarning('Hover position element (#position_on_hover) did not appear or did not contain coordinates')
      await saveMapScreenshot(page, 'hover', 'position_missing', true)
      return
    }
  } catch (e) {
    addWarning('Error while attempting hover location detection: ' + (e?.message || e))
    return
  }
  await showStep(page, 'Step 5: ✅ Hover locationer verified (coordinates shown)')
})

test('[P1] 8: AOI_view (zoom back to AOI) and World View', async ({}, testInfo) => {
  CURRENT_TESTCASE = '[P1] 8: AOI_view (zoom back to AOI) and World View'

  await showStep(page, 'Step 1: Open landing page')
  if (!await openLanding(page)) return

  await showStep(page, 'Step 1A: Close wizard modal (if present)')
  try { await S2closeWizardModal(page); await fastWait(page, 600) } catch { addWarning('Unable to close wizard modal (non-blocking)') }

  await showStep(page, 'Waiting for map to fully load')
  try { await waitForMapToLoad(page) } catch (e) { addWarning('Map did not load as expected: ' + (e?.message || e)); return }

  await showStep(page, 'Step 2: Zoom until AOI tools appear and draw rectangle AOI')
  try { await zoomUntilAOI(page, 12) } catch (e) { addWarning('AOI toolbar did not appear after zoom attempts: ' + (e?.message || e)) }

  try { await openAndDrawRectangleAOI(page) } catch (e) { addWarning('Failed to draw rectangle AOI: ' + (e?.message || e)); return }

  await fastWait(page, 700)
  const aoiBefore = await waitForAOIOnMap(page, 9000)
  if (!aoiBefore) addWarning('AOI was not detectable immediately after drawing')

  if (aoiBefore && aoiBefore.locator) {
    try { await highlight(page, aoiBefore.locator, { borderColor: 'rgba(0,200,120,0.95)', pause: 900 }); await annotateElementLabel(page, aoiBefore.locator, 'AOI - BEFORE', { border: '2px solid rgba(0,200,120,0.95)' }); await fastWait(page, 400) } catch {}
  }

  await showStep(page, 'Step 3: Click side nav once')
  try { await ensureSideNavClosed(page) } catch (e) { addWarning('Unable to click side nav toggle: ' + (e?.message || e)) }

  await showStep(page, 'Step 3A: Take screenshot A (baseline with drawn AOI)')
  const screenshotA = await saveMapScreenshot(page, (aoiBefore && aoiBefore.selector) ? aoiBefore.selector.replace(/[^a-z0-9_-]/gi, '') : 'aoi', 'A', false)
  await showStep(page, `Screenshot A saved: ${screenshotA || 'failed-to-save'}`)

  await showStep(page, 'Step 4: Click #world_view (zoom out to world level)')
  try { await clickWhenVisible(page, Locators.worldViewBtn, { timeout: 8000, force: true, annotate: true, label: 'World View' }) } catch (e) { addWarning('World view button not clickable') }

  await fastWait(page, 1200)
  try { await waitForMapToLoad(page) } catch {}

  const aoiAfterWorld = await waitForAOIOnMap(page, 8000)
  if (aoiAfterWorld && aoiAfterWorld.locator) {
    try { await highlight(page, aoiAfterWorld.locator, { borderColor: 'rgba(255,165,0,0.95)', pause: 900 }); await annotateElementLabel(page, aoiAfterWorld.locator, 'AOI - WORLD', { border: '2px solid rgba(255,165,0,0.95)' }); await fastWait(page, 400) } catch {}
  }
  await showStep(page, 'Step 4A: Take screenshot B (after world view)')
  const screenshotB = await saveMapScreenshot(page, (aoiBefore && aoiBefore.selector) ? aoiBefore.selector.replace(/[^a-z0-9_-]/gi, '') : 'aoi', 'B', false)
  await showStep(page, `Screenshot B saved: ${screenshotB || 'failed-to-save'}`)

  await showStep(page, 'Step 5: Click #AOI_view (zoom back to AOI)')
  try { await clickWhenVisible(page, Locators.aoiViewBtn, { timeout: 8000, force: true, annotate: true, label: 'AOI View' }) } catch (e) { addWarning('AOI view button not clickable') }

  await fastWait(page, 1200)
  try { await waitForMapToLoad(page) } catch {}

  const aoiAfterAOIView = await waitForAOIOnMap(page, 10000)
  if (aoiAfterAOIView && aoiAfterAOIView.locator) {
    try { await highlight(page, aoiAfterAOIView.locator, { borderColor: 'rgba(0,120,255,0.95)', pause: 900 }); await annotateElementLabel(page, aoiAfterAOIView.locator, 'AOI - AOI_VIEW', { border: '2px solid rgba(0,120,255,0.95)' }); await fastWait(page, 400) } catch {}
  }
  await showStep(page, 'Step 5A: Take screenshot C (after AOI_view)')
  const screenshotC = await saveMapScreenshot(page, (aoiBefore && aoiBefore.selector) ? aoiBefore.selector.replace(/[^a-z0-9_-]/gi, '') : 'aoi', 'C', false)
  await showStep(page, `Screenshot C saved: ${screenshotC || 'failed-to-save'}`)

  if (!aoiBefore) addWarning('Baseline AOI bbox missing — visual comparison will rely solely on screenshots A/B/C')
  await showStep(page, 'Step 6: ✅ AOI_view & World View visual screenshots and highlights captured (A/B/C)')
})

test('[P1] 9: AOI info window validation with close + reset behavior', async ({}, testInfo) => {
  CURRENT_TESTCASE = '[P1] 9: AOI info window validation with close + reset behavior'

  await showStep(page, 'Step 1: Open landing page')
  if (!await openLanding(page)) return

  await showStep(page, 'Step 2: Close wizard modal (if present)')
  try { await S2closeWizardModal(page); await fastWait(page, 600) } catch {}

  await showStep(page, 'Step 3: Wait for map to fully load')
  try { await waitForMapToLoad(page) } catch (e) { addWarning('Map load failed'); return }

  await showStep(page, 'Step 4: Search and select "Vijay Nagar" (first result)')
  try {
    const opened = await openSearchModal(page)
    if (!opened) return
    const pac = await waitForSearchInputAndHighlight(page)
    if (!pac) return
    await pac.fill('Vijay Nagar')
    const first = Locators.pacFirstOption(page)
    await expect(first).toBeVisible({ timeout: 12000 })
    await highlight(page, first)
    await first.click()
    await waitForMapToLoad(page)
  } catch (e) { addWarning('Search failed'); return }

  await showStep(page, 'Step 5: Draw rectangle AOI')
  try { await zoomUntilAOI(page, 12) } catch {}
  try { await openAndDrawRectangleAOI(page) } catch (e) { addWarning('AOI draw failed'); return }
  await fastWait(page, 800)

  await showStep(page, 'Step 6: Click sidenav once')
  try { await ensureSideNavClosed(page) } catch {}

  await showStep(page, 'Step 7: Validate 1.0 info window presence')
  const infoWindowContainer = Locators.infoWindowContainer(page)
  const isInfoVisible = await infoWindowContainer.isVisible().catch(() => false)
  if (!isInfoVisible) { test.fail(true, '1.0 (info window container) not visible after drawing AOI'); return }
  await highlight(page, infoWindowContainer)

  await showStep(page, 'Step 8: Click 1.1 (close info window)')
  const closeBtn = Locators.infoWindowCloseButton(page)
  if (await closeBtn.isVisible().catch(() => false)) {
    await highlight(page, closeBtn)
    await closeBtn.click()
    await fastWait(page, 700)
  } else { test.fail(true, '1.1 (close button) not visible inside info window'); return }

  await showStep(page, 'Step 9: Click delete_all (1.2 reset button)')
  const deleteAllBtn = Locators.deleteAllBtn(page)
  if (await deleteAllBtn.isVisible().catch(() => false)) {
    await highlight(page, deleteAllBtn)
    await deleteAllBtn.click()
    await fastWait(page, 1200)
  } else { test.fail(true, 'delete_all (1.2) button not visible'); return }

  await showStep(page, 'Step 10: Click sidenav once after reset')
  try { await ensureSideNavClosedd(page) } catch {}

  await showStep(page, 'Step 11: Validate info window does NOT reappear')
  const closeBtnAfterReset = page.locator('.gm-ui-hover-effect')
  const isCloseVisibleAfterReset = await closeBtnAfterReset.isVisible().catch(() => false)
  if (isCloseVisibleAfterReset) {
    test.fail(true, 'Info window close button (1.1) appeared after reset — TEST FAILED')
  } else {
    logInfo('Info window not visible after reset — TEST PASSED')
  }
  await showStep(page, 'Testcase 9 completed')
})
