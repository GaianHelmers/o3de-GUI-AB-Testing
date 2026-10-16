# O3DE GUI A/B report

- Gallery: Test (`test-gallery`), version 1
- Captures: A = Legacy (i1), B = Flattened (t3)
- Reporter: alice
- Exported: 2026-10-16T02:00:00Z
- Markers: 3 (open 2, needs verification 0, fixed 1)

## Editor / 01 main window

`Editor/01_main_window`

| # | Point (px) | Widget | State | Description |
|---|---|---|---|---|
| 1 | 30, 20 | `AzQtComponents::TabBar` | open | tab text clipped \| right edge |
| 2 | 40, 18 | `AzQtComponents::TabBar (A: QLabel#title)` | open | old note |

## Gallery / 02 buttons

`Gallery/02_buttons`

| # | Point (px) | Widget | State | Description |
|---|---|---|---|---|
| 1 | 5, 6 | - | fixed | fixed already |

<details><summary>Report data (for tools: tools/read_reports.py)</summary>

<!-- o3de-ab-report:data -->
```json
{
 "format": "o3de-ab-report/2",
 "gallery": {
  "id": "test-gallery",
  "title": "Test",
  "version": 1,
  "sources": {
   "A": "i1",
   "B": [
    "t3"
   ]
  }
 },
 "reporter": "alice",
 "exported": "2026-10-16T02:00:00Z",
 "markers": [
  {
   "id": "m-a1",
   "pair": "Editor/01_main_window",
   "x": 30,
   "y": 20,
   "note": "tab text clipped | right edge",
   "widgets": {
    "A": {
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
   "verifiedVersion": 1,
   "fixedVersion": null,
   "created": "2026-10-16T01:10:00Z",
   "updated": "2026-10-16T01:10:00Z",
   "state": "open",
   "images": {
    "A": "a.png",
    "B": "b.png"
   }
  },
  {
   "id": "m-a2",
   "pair": "Gallery/02_buttons",
   "x": 5,
   "y": 6,
   "note": "fixed already",
   "widgets": {
    "A": null,
    "B": null
   },
   "status": "fixed",
   "createdVersion": 1,
   "verifiedVersion": 1,
   "fixedVersion": 1,
   "created": "2026-10-16T01:20:00Z",
   "updated": "2026-10-16T01:30:00Z",
   "state": "fixed",
   "images": {
    "A": "ga.png",
    "B": "gb.png"
   }
  },
  {
   "id": "m-shared",
   "pair": "Editor/01_main_window",
   "x": 40,
   "y": 18,
   "note": "old note",
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
   "verifiedVersion": 1,
   "fixedVersion": null,
   "created": "2026-10-16T01:00:00Z",
   "updated": "2026-10-16T01:00:00Z",
   "state": "open",
   "images": {
    "A": "a.png",
    "B": "b.png"
   }
  }
 ]
}
```
</details>
