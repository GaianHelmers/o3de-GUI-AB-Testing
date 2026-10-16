/*
 * markers.js -- fault markers: storage, version states and the report format.
 *
 * Pure logic, no DOM: the viewer (app.js) uses it in the browser, tests/markers.test.js runs it
 * under Node. A marker is one crosshair a reviewer placed on a screen. It shows on both A and B
 * at the same image pixel, wherever it was placed (the two captures share their top-left corner):
 *
 *   { id, pair, x, y,                           image pixels, the same on A and B
 *     note, widgets: { A, B },                  widget under the point in each capture (or null)
 *     status: "open" | "fixed",
 *     createdVersion, verifiedVersion,          gallery versions (window.AB_GALLERY_VERSION)
 *     fixedVersion, created, updated }          ISO timestamps
 *
 * State shown to the reviewer:
 *   open                -- placed or confirmed under the current gallery version
 *   needs-verification  -- open, but last confirmed under an older version (captures changed)
 *   fixed               -- the reviewer marked it fixed
 */
(function (root, factory) {
    const api = factory();
    if (typeof module === "object" && module.exports) {
        module.exports = api;
    } else {
        root.ABMarkers = api;
    }
})(typeof self !== "undefined" ? self : this, function () {
    "use strict";

    const REPORT_FORMAT = "o3de-ab-report/2";
    const DATA_START = "<!-- o3de-ab-report:data -->";

    // ------------------------------------------------------------------------------
    // State and version
    // ------------------------------------------------------------------------------

    function state(marker, galleryVersion) {
        if (marker.status === "fixed") {
            return "fixed";
        }
        return marker.verifiedVersion < galleryVersion ? "needs-verification" : "open";
    }

    function create(fields, galleryVersion, now) {
        const time = now || new Date().toISOString();
        return {
            id: fields.id || newId(),
            pair: fields.pair,
            x: Math.round(fields.x),
            y: Math.round(fields.y),
            note: fields.note || "",
            widgets: fields.widgets || { A: null, B: null },
            status: "open",
            createdVersion: galleryVersion,
            verifiedVersion: galleryVersion,
            fixedVersion: null,
            created: time,
            updated: time,
        };
    }

    // Still a fault under the current version: confirmed, open again.
    function confirm(marker, galleryVersion, now) {
        return Object.assign({}, marker, { status: "open", verifiedVersion: galleryVersion, fixedVersion: null, updated: now || new Date().toISOString() });
    }

    function markFixed(marker, galleryVersion, now) {
        return Object.assign({}, marker, { status: "fixed", fixedVersion: galleryVersion, updated: now || new Date().toISOString() });
    }

    function setNote(marker, note, now) {
        return Object.assign({}, marker, { note: note, updated: now || new Date().toISOString() });
    }

    function newId() {
        if (typeof crypto !== "undefined" && crypto.randomUUID) {
            return crypto.randomUUID();
        }
        return "m-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
    }

    function counts(markers, galleryVersion) {
        const result = { open: 0, "needs-verification": 0, fixed: 0, total: 0 };
        for (const marker of markers) {
            result[state(marker, galleryVersion)] += 1;
            result.total += 1;
        }
        return result;
    }

    // ------------------------------------------------------------------------------
    // Storage (one store per gallery; any object with getItem / setItem works)
    // ------------------------------------------------------------------------------

    class Store {
        constructor(storage, galleryId) {
            this.storage = storage;
            this.key = "o3de-ab:" + galleryId + ":markers";
            this.settingsKey = "o3de-ab:" + galleryId + ":settings";
            this.markers = new Map();
            this.load();
        }

        load() {
            this.markers.clear();
            try {
                const text = this.storage.getItem(this.key);
                for (const marker of text ? JSON.parse(text) : []) {
                    this.markers.set(marker.id, marker);
                }
            } catch (error) {
                // unreadable storage: start empty; an exported report restores markers
            }
        }

        save() {
            try {
                this.storage.setItem(this.key, JSON.stringify(Array.from(this.markers.values())));
                return true;
            } catch (error) {
                return false;
            }
        }

        all() {
            return Array.from(this.markers.values()).sort((a, b) => a.created < b.created ? -1 : 1);
        }

        forPair(pairId) {
            return this.all().filter((marker) => marker.pair === pairId);
        }

        put(marker) {
            this.markers.set(marker.id, marker);
            return this.save();
        }

        remove(id) {
            this.markers.delete(id);
            return this.save();
        }

        // Merge markers from a report: a marker already here keeps whichever copy changed last.
        merge(markers) {
            let added = 0;
            let updated = 0;
            for (const marker of markers) {
                const existing = this.markers.get(marker.id);
                if (!existing) {
                    this.markers.set(marker.id, marker);
                    added += 1;
                } else if (marker.updated > existing.updated) {
                    this.markers.set(marker.id, marker);
                    updated += 1;
                }
            }
            this.save();
            return { added: added, updated: updated };
        }

        settings() {
            try {
                return JSON.parse(this.storage.getItem(this.settingsKey) || "{}");
            } catch (error) {
                return {};
            }
        }

        setSettings(values) {
            try {
                this.storage.setItem(this.settingsKey, JSON.stringify(Object.assign(this.settings(), values)));
            } catch (error) {
                // settings are a convenience only
            }
        }
    }

    // ------------------------------------------------------------------------------
    // Report: readable Markdown + a JSON block that read_reports.py and Claude parse
    // ------------------------------------------------------------------------------

    // The widget under a marker as text: B's (the side under review), and A's when it differs.
    // full: the widget's path from its window, else class#name.
    function widgetSummary(widgets, full) {
        const text = (widget) => (widget ? (full && widget.path) || widget.className + (widget.name ? "#" + widget.name : "") : "");
        const a = text(widgets && widgets.A);
        const b = text(widgets && widgets.B);
        if (!a || a === b) {
            return b;
        }
        return b ? b + " (A: " + a + ")" : "A: " + a;
    }

    // A table cell: one line, pipes escaped, backticks escaped so a note cannot open a code span.
    function escapeCell(text) {
        return String(text || "").replace(/\|/g, "\\|").replace(/\r?\n/g, " ").replace(/`/g, "\\`");
    }

    function widgetCell(widgets) {
        const text = widgetSummary(widgets, false);
        return text ? "`" + text.replace(/\|/g, "\\|") + "`" : "-";
    }

    function buildReport(gallery, galleryVersion, markers, reporter, now) {
        const time = now || new Date().toISOString();
        const tally = counts(markers, galleryVersion);
        const lines = [];
        lines.push("# O3DE GUI A/B report");
        lines.push("");
        lines.push("- Gallery: " + gallery.title + " (`" + gallery.id + "`), version " + galleryVersion);
        lines.push("- Captures: A = " + gallery.sides.A + " (" + gallery.sources.A + "), B = " + gallery.sides.B + " (" + [].concat(gallery.sources.B).join(", ") + ")");
        lines.push("- Reporter: " + (reporter || "anonymous"));
        lines.push("- Exported: " + time);
        lines.push("- Markers: " + tally.total + " (open " + tally.open + ", needs verification " + tally["needs-verification"] + ", fixed " + tally.fixed + ")");
        lines.push("");

        const byPair = new Map();
        for (const marker of markers) {
            if (!byPair.has(marker.pair)) {
                byPair.set(marker.pair, []);
            }
            byPair.get(marker.pair).push(marker);
        }
        for (const [pairId, pairMarkers] of byPair) {
            const pair = gallery.pairs[pairId];
            lines.push("## " + (pair ? pair.app + " / " + pair.title : pairId));
            lines.push("");
            lines.push("`" + pairId + "`");
            lines.push("");
            lines.push("| # | Point (px) | Widget | State | Description |");
            lines.push("|---|---|---|---|---|");
            pairMarkers.forEach((marker, index) => {
                lines.push("| " + [index + 1, marker.x + ", " + marker.y, widgetCell(marker.widgets), state(marker, galleryVersion),
                    escapeCell(marker.note)].join(" | ") + " |");
            });
            lines.push("");
        }

        const data = {
            format: REPORT_FORMAT,
            gallery: { id: gallery.id, title: gallery.title, version: galleryVersion, sources: gallery.sources },
            reporter: reporter || "",
            exported: time,
            markers: markers.map((marker) => {
                const pair = gallery.pairs[marker.pair];
                return Object.assign({}, marker, {
                    state: state(marker, galleryVersion),
                    images: pair ? { A: pair.a.image, B: pair.b.image } : null,
                });
            }),
        };
        lines.push("<details><summary>Report data (for tools: tools/read_reports.py)</summary>");
        lines.push("");
        lines.push(DATA_START);
        lines.push("```json");
        lines.push(JSON.stringify(data, null, 1).replace(/`/g, "\\u0060"));     // a note holding ``` cannot end the fence early
        lines.push("```");
        lines.push("</details>");
        lines.push("");
        return lines.join("\n");
    }

    function parseReport(text) {
        const start = text.indexOf(DATA_START);
        if (start < 0) {
            throw new Error("This file has no report data block.");
        }
        const open = text.indexOf("```json", start);
        const close = text.indexOf("```", open + 7);
        if (open < 0 || close < 0) {
            throw new Error("The report data block is incomplete.");
        }
        const data = JSON.parse(text.slice(open + 7, close));
        if (data.format !== REPORT_FORMAT) {
            throw new Error("Unknown report format: " + data.format);
        }
        const markers = data.markers.map((marker) => {
            const copy = Object.assign({}, marker);
            delete copy.state;                              // derived when the report was written
            delete copy.images;
            return copy;
        });
        return { gallery: data.gallery, reporter: data.reporter, exported: data.exported, markers: markers };
    }

    // ------------------------------------------------------------------------------
    // Widget under a point (compact widget maps from tools/import_captures.py)
    // ------------------------------------------------------------------------------

    // map = { dpr, classes: [chain], widgets: [[x, y, w, h, parent, classIndex, name]] }
    function widgetAt(map, imageX, imageY) {
        if (!map) {
            return null;
        }
        const x = imageX / (map.dpr || 1);
        const y = imageY / (map.dpr || 1);
        let best = -1;
        let bestDepth = -1;
        const depthOf = (index) => {
            let depth = 0;
            for (let row = map.widgets[index]; row && row[4] >= 0; row = map.widgets[row[4]]) {
                depth += 1;
            }
            return depth;
        };
        map.widgets.forEach((row, index) => {
            if (x >= row[0] && y >= row[1] && x < row[0] + row[2] && y < row[1] + row[3]) {
                const depth = depthOf(index);
                if (depth >= bestDepth) {
                    best = index;
                    bestDepth = depth;
                }
            }
        });
        if (best < 0) {
            return null;
        }
        const row = map.widgets[best];
        const path = [];
        for (let index = best, guard = 0; index >= 0 && guard < 6; index = map.widgets[index][4], guard += 1) {
            const item = map.widgets[index];
            path.push(map.classes[item[5]].split(" < ")[0] + (item[6] ? "#" + item[6] : ""));
        }
        return {
            className: map.classes[row[5]].split(" < ")[0],
            classChain: map.classes[row[5]],
            name: row[6],
            rect: [row[0], row[1], row[2], row[3]],
            path: path.reverse().join(" > "),
        };
    }

    return { REPORT_FORMAT, state, create, confirm, markFixed, setNote, counts, Store, buildReport, parseReport, widgetAt, widgetSummary };
});
