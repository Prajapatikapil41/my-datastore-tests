# 📘 Datastore – End-to-End UI & Scene Validation Suite

---

# ✅ TC-1: Application Launch & Environment Setup

## 🎯 Objective

Verify that the application launches correctly and is ready for interaction.

## 🔁 Flow

```
Launch Browser
   ↓
Create Context
   ↓
Navigate to BASE_URL
   ↓
Wait for DOM Content Loaded
```

## 🔎 Validations

* Page loads successfully
* No blocking console errors
* Core layout visible
* Map component initialized

## ⚠ Failure Handling

* Capture full-page screenshot
* Log structured error
* Attach annotation to report

---

# ✅ TC-2: Satellite Scene Validation (Products 2.0 → 2.11)

## 🎯 Objective

Validate outline, preview, and detail behavior for each satellite product.

---

## 🔁 High-Level Flow

```
Search Location
   ↓
Draw AOI
   ↓
Open Satellite Section
   ↓
Select Product
   ↓
Wait for Scene Table
   ↓
Process First Scene
      ├─ Outline
      ├─ Preview
      └─ Details
```

---

## 🔵 TC-2.0 → 2.6 (Strict Validation Mode)

Products:
WorldView01, WorldView02, WorldView03, WorldView04, GeoEye1, QuickBird, IKONOS

### 🟢 Outline Validation

* Outline button clickable
* Overlay rendered (img/svg/canvas)
* Bounding box extracted
* Screenshot saved

### 🟢 Preview Validation (Strict)

* Preview overlay appears
* Image element exists
* Image fully loaded
* Bounding box overlap ≥ 5%
* Screenshot saved

### 🟢 Details Validation (Strict)

* Modal appears
* Image visible
* Image src contains sceneId
* Filename matches preview
* Metadata table present

  * id
  * bbox
  * properties
  * assets

---

## 🟡 TC-2.7 → 2.11 (Simple Verification Mode)

Products:
21AT Archive (30cm / 50cm / 80cm), WV-Legion01, WV-Legion02

### 🟢 Outline

Same validation as strict mode.

### 🟡 Preview (Simplified)

* Image exists
* Image visible
* Image fully loaded
* No overlap validation
* No filename comparison

### 🟡 Details (Simplified)

* Modal appears
* Image visible
* Image loaded
* No metadata validation
* No filename validation

---

# ✅ TC-3: Search UI — Search Location & Draw AOI

## 🎯 Objective

Verify search functionality and AOI drawing workflow.

## 🔁 Flow

```
Enter Location Name
   ↓
Select Suggestion
   ↓
Map Zooms to Location
   ↓
Activate AOI Tool
   ↓
Draw AOI
```

## 🔎 Validations

* Suggestions appear
* Map recenters
* Zoom adjusts
* AOI rectangle visible
* AOI overlay bounding box exists

---

# ✅ TC-4: Coordinates — Enter Latitude/Longitude

## 🎯 Objective

Validate manual coordinate entry.

## 🔁 Flow

```
Open Coordinate Panel
   ↓
Enter Lat/Lon
   ↓
Submit
   ↓
Map Zooms to Coordinates
```

## 🔎 Validations

* Inputs accept numeric values
* Submission triggers map move
* Map centers correctly
* Zoom updates

---

# ✅ TC-5: Upload KMZ & Verify Map Info Window

## 🎯 Objective

Validate KMZ upload and geometry rendering.

## 🔁 Flow

```
Upload KMZ File
   ↓
Wait for Processing
   ↓
Map Zooms to Geometry
   ↓
Click Geometry
   ↓
Verify Info Window
```

## 🔎 Validations

* Upload successful
* Geometry overlay visible
* Info window appears
* Metadata displayed correctly

---

# ✅ TC-6: Locate — Go to Current Location

## 🎯 Objective

Validate browser geolocation integration.

## 🔁 Flow

```
Click Locate Button
   ↓
Allow Permission
   ↓
Map Centers to Current Location
```

## 🔎 Validations

* Locate button clickable
* Permission handled
* Map repositioned
* Location marker visible

---

# ✅ TC-7: Hover Locationer — Live Coordinates Display

## 🎯 Objective

Validate dynamic coordinate display on mouse hover.

## 🔁 Flow

```
Move Mouse Over Map
   ↓
Observe Coordinate Panel
   ↓
Move Again
   ↓
Verify Update
```

## 🔎 Validations

* Coordinate display visible
* Latitude updates dynamically
* Longitude updates dynamically
* Values change with cursor movement

---

# ✅ TC-8: AOI View & World View

## 🎯 Objective

Validate view-switching controls.

## 🔁 Flow

```
Draw AOI
   ↓
Zoom Away
   ↓
Click AOI View
   ↓
Map Returns to AOI Bounds
   ↓
Click World View
   ↓
Map Zooms to Global View
```

## 🔎 Validations

* AOI View button works
* Map fits AOI bounding box
* World View resets zoom
* Map remains responsive

---

# ✅ TC-9: AOI Info Window — Close & Reset Behavior

## 🎯 Objective

Validate AOI info window functionality and reset behavior.

## 🔁 Flow

```
Draw AOI
   ↓
Click Inside AOI
   ↓
Info Window Appears
   ↓
Click Close
   ↓
Window Disappears
   ↓
Click Reset
   ↓
AOI Cleared
```

## 🔎 Validations

* Info window appears
* Correct metadata displayed
* Close button functional
* Reset removes AOI overlay
* Map returns to default state

---

# 🏗 Overall Execution Architecture (Updated 1–9)

```
Test Runner
   ↓
beforeEach
   ↓
TC-1 App Load
   ↓
TC-3–9 Map & UI Features
   ↓
TC-2 Satellite Scene Validation
   ↓
Warnings Collected
   ↓
afterEach
   ↓
Screenshot (if failure/warning)
   ↓
Teardown
```

---
