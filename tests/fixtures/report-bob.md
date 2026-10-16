# O3DE GUI A/B report

- Gallery: Test (`test-gallery`), version 2
- Captures: A = Legacy (i1), B = Flattened (t3)
- Reporter: bob
- Exported: 2026-10-17T10:00:00Z
- Markers: 2 (open 2, needs verification 0, fixed 0)

## Editor / 01 main window

`Editor/01_main_window`

| # | Point (px) | Widget | State | Description |
|---|---|---|---|---|
| 1 | 40, 18 | `AzQtComponents::TabBar (A: QLabel#title)` | open | newer note |

## Gallery / 02 buttons

`Gallery/02_buttons`

| # | Point (px) | Widget | State | Description |
|---|---|---|---|---|
| 1 | 7, 8 | - | open | fence \`\`\` inside a note second line |

<details><summary>Report data (for tools: tools/read_reports.py)</summary>

<!-- o3de-ab-report:data -->
```json
{
 "format": "o3de-ab-report/2",
 "gallery": {
  "id": "test-gallery",
  "title": "Test",
  "version": 2,
  "sources": {
   "A": "i1",
   "B": [
    "t3"
   ]
  }
 },
 "reporter": "bob",
 "exported": "2026-10-17T10:00:00Z",
 "markers": [
  {
   "id": "m-shared",
   "pair": "Editor/01_main_window",
   "x": 40,
   "y": 18,
   "note": "newer note",
   "widgets": {
    "A": {
     "className": "QLabel",
     "name": "title",
     "classChain": "QLabel < QFrame < QWidget",
     "rect": [
      10,
      8,
      120,
      20
     ],
     "path": "QMainWindow#main > QLabel#title"
    },
    "B": {
     "className": "AzQtComponents::TabBar",
     "name": "",
     "classChain": "AzQtComponents::TabBar < QTabBar < QWidget",
     "rect": [
      10,
      10,
      200,
      30
     ],
     "path": "QMainWindow#main > AzQtComponents::TabBar"
    }
   },
   "status": "open",
   "createdVersion": 1,
   "verifiedVersion": 2,
   "fixedVersion": null,
   "created": "2026-10-16T01:00:00Z",
   "updated": "2026-10-17T09:00:00Z",
   "state": "open",
   "images": {
    "A": "a.png",
    "B": "b.png"
   }
  },
  {
   "id": "m-b1",
   "pair": "Gallery/02_buttons",
   "x": 7,
   "y": 8,
   "note": "fence \u0060\u0060\u0060 inside a note\nsecond line",
   "widgets": {
    "A": null,
    "B": null
   },
   "status": "open",
   "createdVersion": 2,
   "verifiedVersion": 2,
   "fixedVersion": null,
   "created": "2026-10-17T09:05:00Z",
   "updated": "2026-10-17T09:05:00Z",
   "state": "open",
   "images": {
    "A": "ga.png",
    "B": "gb.png"
   }
  }
 ]
}
```
</details>
