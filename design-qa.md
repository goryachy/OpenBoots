**Findings**

- [P1] The prior receive layout made the camera too tall after a scan, pushing the active-product card below the first mobile viewport.
  Location: `Receive` / `.receive-page--active`.
  Evidence: the user reported that the camera and card appeared on separate screens.
  Impact: the operator cannot confirm the scanned product while aiming the camera.
  Fix: while a receiving session is active, compact the header, remove the pre-session receiving explanation, reduce the live-camera frame to 168 px on narrow phones, and compact the product card controls.

**Open Questions**

- Source visual truth: user-provided receive-screen screenshot in this conversation.
- Implementation capture: blocked. The available native browser capture surface failed to start (`Sky Computer Use native pipe startup failed`), so no browser-rendered screenshot, console check, or pixel-normalized side-by-side comparison is available.

**Implementation Checklist**

- [x] Preserve the existing visual language and the product-card structure.
- [x] Keep the camera and active product card in the first mobile viewport after a scan.
- [x] Keep the larger camera treatment before a receiving session begins.
- [x] Keep manual barcode entry and receiving controls available.

**Follow-up Polish**

- Verify the active receive state on an iPhone Safari viewport with a physical device screenshot when browser capture becomes available.

final result: blocked
