# O3DE GUI A/B

Screenshots of every O3DE application's windows, menus, tabs and docks, each captured twice:

- **A**: legacy, the Qt stylesheets on (how O3DE looks today)
- **B**: flattened, the stylesheets off and the same look produced by the C++ style

B is meant to be indistinguishable from A. This repo lets anyone go through the pairs, mark every
place where B differs from A (or where either looks wrong), and send the marks back as one report.

Nothing to install, build or serve: clone the repo (or download the ZIP) and open `index.html`.

## Reviewing

1. Open `index.html` in your browser (double-click it). Firefox, Chrome and Edge all work.
2. Optional: **Set your name** in the top bar, so your reports carry it.
3. On the home page, pick an application, or a family (all tabs, all menus, ...), then a screen.
4. Click wherever something is wrong. A numbered crosshair appears on **both** A and B at the
   same pixel, whichever side you clicked. Add a description if it helps (Ctrl+Enter saves).
   The widget under the point is recorded for you.
5. Your markers save in this browser as you go, and survive reloads and restarts.

Viewing a screen:

| Control | What it does |
|---|---|
| Side by side | A and B next to each other, at one scale |
| Flip | One image at a time in the same place: hold **Space** or **F** to see the other side, or click A / B. The quickest way to spot a shift of a pixel or two. |
| Actual size | A and B at 1:1 pixels, scrolling together |
| Stretch (**S**) | On (the default): side by side and flip fill the width, enlarging small captures such as menus. Off: nothing grows past its own pixels, centered. |
| Full width (**W**) | Any of the views above across the whole window, with the marker list below |
| **Left** / **Right** arrows | Previous / next screen |

Each marker in the list has **Fixed** (it no longer applies), **Edit**, **Delete**, and, after a
gallery update, **Still wrong** (see versions below).

A and B are not always the same size: a menu can be a few pixels shorter in B, a window wider. The
two images always share one scale and one top-left corner (the pair is centered as a whole), so a
pixel in A sits exactly where the same pixel of B does, side by side and in a flip. A marker past
the edge of the smaller image shows on the other one only.

## Sending a report

1. Click **Export report**. Your browser downloads one file,
   `o3de-ab-report_v<version>_<name>_<date>.md`, holding every marker you have made.
2. Click **Report**: the project's GitHub issues open in a new tab. Start a new issue with the
   **A/B report** template and drag the file into it.

Each export holds all your markers, so send a fresh one whenever you have done more; repeats
count once. **Import** loads a report back into a browser: to carry your markers to another
machine, or to pick up where someone else left off.

## Gallery versions

The top bar shows the gallery version. It goes up when new captures land. Markers you placed under
an older version then show **needs verification**: open the screen and press **Still wrong** if the
fault is still there, or **Fixed** if it is gone. Markers placed after the update are plain open
markers.

## Where markers are kept

In your browser's storage for this page: one set per browser profile. Clearing the browser's site
data deletes them, so export a report to keep a copy. If the browser refuses to store data for a
page opened from disk, a banner says so; then serve the folder instead, with
`python -m http.server 8000` in the repo, and open `http://localhost:8000`. (A page opened from disk
and the same page served from localhost keep separate markers; move them with Export and Import.)

## Maintainers

```
index.html                     the viewer, one page
viewer/app.js                  views, controls, marker placement
viewer/markers.js              markers, versions, the report format (no DOM; tests run it in Node)
viewer/style.css
gallery/version.js             the gallery version: edit by hand
gallery/gallery.js             the manifest (generated)
gallery/apps/<App>/A|B/        <screen>.png and <screen>.widgets.js (generated)
tools/import_captures.py       builds gallery/ from O3DE capture sets
tools/read_reports.py          merges submitted reports into one digest
tests/
```

**New captures.** Rebuild the gallery from the capture sets the O3DE capture harness writes, then
raise `window.AB_GALLERY_VERSION` in `gallery/version.js` by one, so reviewers re-check their
markers against the new images:

```
python tools/import_captures.py --legacy <capture set> --flatten <capture set>[,<capture set>...]
```

**Reading reports.** Reports pasted into an issue and reports attached to one both count:

```
python tools/read_reports.py --github <owner>/<repo>     # the repo's open issues (read only, uses gh)
python tools/read_reports.py <file or folder> ...        # report files saved on disk
```

It prints one Markdown digest: totals, the widget classes that still have markers, then every
screen with its images and markers (point, widget path in B and in A when they differ, reporter,
description). `--json` prints the merged markers instead, `--out FILE` writes to a file. A marker
sent more than once counts once (the newest copy wins), and states are recomputed against the
current gallery version.

Each marker is also measured: the widget under its point is compared between Native (A) and
Flattened (B). Position and size come from the gallery's widget maps; add `--dumps <capture root>`
(the capture sets the gallery was imported from) for font, background and text colour too:

```
- **4**: `QLabel#activeProjectLabel`: at 11,103 -> 13,103; size 239x28 -> 166x24; font Amazon Ember Light (drawn as Tahoma) 18px -> Open Sans 12px.
```

**Tests:**

```
node tests/markers.test.js          marker logic and the report format
python tests/test_read_reports.py   the report reader, on the same sample reports
node tests/browser_smoke.js         the viewer in headless Edge or Chrome: placing, reload, restart, views, export, import
```

**Report format** (`o3de-ab-report/2`): a Markdown file whose data block, after the line
`<!-- o3de-ab-report:data -->`, is a ```` ```json ```` fence holding
`{format, gallery {id, title, version, sources}, reporter, exported, markers [...]}`. A marker is
`{id, pair, x, y, note, widgets {A, B}, status, createdVersion, verifiedVersion, fixedVersion,
created, updated}`, with `x, y` in image pixels, the same on A and B.

## License

CC0 1.0, see [LICENSE](LICENSE).
