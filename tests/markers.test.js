// Run: node tests/markers.test.js   (no dependencies)
// UPDATE_FIXTURES=1 node tests/markers.test.js rewrites tests/fixtures after a report format change.
"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const M = require("../viewer/markers.js");

const gallery = {
    id: "test-gallery",
    title: "Test",
    sides: { A: "Legacy", B: "Flattened" },
    sources: { A: "i1", B: ["t3"] },
    pairs: {
        "Editor/01_main_window": { app: "Editor", title: "01 main window", a: { image: "a.png" }, b: { image: "b.png" } },
        "Gallery/02_buttons": { app: "Gallery", title: "02 buttons", a: { image: "ga.png" }, b: { image: "gb.png" } },
    },
};

const tabBar = { className: "AzQtComponents::TabBar", name: "", classChain: "AzQtComponents::TabBar < QTabBar < QWidget",
    rect: [10, 10, 200, 30], path: "QMainWindow#main > AzQtComponents::TabBar" };
const title = { className: "QLabel", name: "title", classChain: "QLabel < QFrame < QWidget",
    rect: [10, 8, 120, 20], path: "QMainWindow#main > QLabel#title" };

function memoryStorage() {
    const data = {};
    return { getItem: (k) => (k in data ? data[k] : null), setItem: (k, v) => { data[k] = String(v); } };
}

let passed = 0;
function test(name, body) {
    body();
    passed += 1;
    console.log("ok   " + name);
}

// ---- versions
test("a new marker is open under its own version", () => {
    const marker = M.create({ pair: "Editor/01_main_window", x: 10.4, y: 20.6, note: "tab cut" }, 1, "2026-10-16T00:00:00Z");
    assert.strictEqual(M.state(marker, 1), "open");
    assert.strictEqual(marker.x, 10);
    assert.strictEqual(marker.y, 21);
    assert.deepStrictEqual(marker.widgets, { A: null, B: null });
});

test("a version bump flags older open markers, confirming clears it", () => {
    const marker = M.create({ pair: "Editor/01_main_window", x: 1, y: 1 }, 1);
    assert.strictEqual(M.state(marker, 2), "needs-verification");
    const confirmed = M.confirm(marker, 2);
    assert.strictEqual(M.state(confirmed, 2), "open");
    assert.strictEqual(confirmed.createdVersion, 1);
    assert.strictEqual(confirmed.verifiedVersion, 2);
});

test("fixed markers stay fixed across versions", () => {
    const fixed = M.markFixed(M.create({ pair: "p", x: 0, y: 0 }, 1), 1);
    assert.strictEqual(M.state(fixed, 3), "fixed");
    assert.deepStrictEqual(M.counts([fixed], 3), { open: 0, "needs-verification": 0, fixed: 1, total: 1 });
});

// ---- storage
test("markers persist through the store", () => {
    const storage = memoryStorage();
    const store = new M.Store(storage, "test-gallery");
    store.put(M.create({ id: "m1", pair: "Editor/01_main_window", x: 5, y: 6 }, 1));
    const reloaded = new M.Store(storage, "test-gallery");
    assert.strictEqual(reloaded.all().length, 1);
    assert.strictEqual(reloaded.forPair("Editor/01_main_window")[0].id, "m1");
    reloaded.remove("m1");
    assert.strictEqual(new M.Store(storage, "test-gallery").all().length, 0);
});

// ---- report round trip
test("an exported report imports back to the same markers", () => {
    const markers = [
        M.create({ id: "m1", pair: "Editor/01_main_window", x: 5, y: 6, note: "pipe | in note\nand a newline", widgets: { A: title, B: tabBar } }, 1, "2026-10-16T01:00:00Z"),
        M.markFixed(M.create({ id: "m2", pair: "Editor/01_main_window", x: 7, y: 8 }, 1, "2026-10-16T02:00:00Z"), 1, "2026-10-16T03:00:00Z"),
    ];
    const text = M.buildReport(gallery, 2, markers, "tester", "2026-10-16T04:00:00Z");
    assert.ok(text.includes("needs-verification"));
    assert.ok(text.includes("\\|"), "pipes are escaped in the table");
    assert.ok(text.includes("`AzQtComponents::TabBar (A: QLabel#title)`"), "a widget that differs between A and B shows both");
    const parsed = M.parseReport(text);
    assert.strictEqual(parsed.reporter, "tester");
    assert.strictEqual(parsed.gallery.version, 2);
    assert.deepStrictEqual(parsed.markers, markers);
});

test("merge keeps the copy that changed last", () => {
    const storage = memoryStorage();
    const store = new M.Store(storage, "g");
    const older = M.create({ id: "m1", pair: "p", x: 1, y: 1, note: "old" }, 1, "2026-10-16T00:00:00Z");
    store.put(older);
    const newer = M.setNote(older, "new", "2026-10-16T05:00:00Z");
    const extra = M.create({ id: "m2", pair: "p", x: 2, y: 2 }, 1);
    assert.deepStrictEqual(store.merge([newer, extra]), { added: 1, updated: 1 });
    assert.strictEqual(store.markers.get("m1").note, "new");
    assert.deepStrictEqual(store.merge([older]), { added: 0, updated: 0 });
});

test("parseReport rejects files without report data", () => {
    assert.throws(() => M.parseReport("# just notes"), /no report data/);
});

test("a note holding a code fence survives the report", () => {
    const marker = M.create({ id: "m1", pair: "Editor/01_main_window", x: 1, y: 1, note: "see ```json here```" }, 1, "2026-10-16T00:00:00Z");
    assert.deepStrictEqual(M.parseReport(M.buildReport(gallery, 1, [marker], "t", "2026-10-16T00:00:00Z")).markers, [marker]);
});

// ---- sample reports: what tests/test_read_reports.py reads, kept equal to what the viewer exports
function sampleReports() {
    const shared = M.create({ id: "m-shared", pair: "Editor/01_main_window", x: 40, y: 18, note: "old note", widgets: { A: title, B: tabBar } }, 1, "2026-10-16T01:00:00Z");
    const alice = [
        M.create({ id: "m-a1", pair: "Editor/01_main_window", x: 30, y: 20, note: "tab text clipped | right edge", widgets: { A: tabBar, B: tabBar } }, 1, "2026-10-16T01:10:00Z"),
        M.markFixed(M.create({ id: "m-a2", pair: "Gallery/02_buttons", x: 5, y: 6, note: "fixed already" }, 1, "2026-10-16T01:20:00Z"), 1, "2026-10-16T01:30:00Z"),
        shared,
    ];
    const bob = [                                                       // bob imported alice's report, confirmed m-shared under version 2
        M.setNote(M.confirm(shared, 2, "2026-10-17T09:00:00Z"), "newer note", "2026-10-17T09:00:00Z"),
        M.create({ id: "m-b1", pair: "Gallery/02_buttons", x: 7, y: 8, note: "fence ``` inside a note\nsecond line" }, 2, "2026-10-17T09:05:00Z"),
    ];
    return {
        "report-alice.md": M.buildReport(gallery, 1, alice, "alice", "2026-10-16T02:00:00Z"),
        "report-bob.md": M.buildReport(gallery, 2, bob, "bob", "2026-10-17T10:00:00Z"),
    };
}

test("the sample reports match what the viewer exports", () => {
    for (const [name, text] of Object.entries(sampleReports())) {
        const file = path.join(__dirname, "fixtures", name);
        if (process.env.UPDATE_FIXTURES) {
            fs.mkdirSync(path.dirname(file), { recursive: true });
            fs.writeFileSync(file, text);
        }
        const saved = fs.existsSync(file) ? fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n") : "";
        assert.strictEqual(saved, text, name + " is out of date: UPDATE_FIXTURES=1 node tests/markers.test.js");
    }
});

// ---- widget under a point
test("widgetAt finds the deepest widget and scales by the device pixel ratio", () => {
    const map = {
        dpr: 1.5,
        classes: ["QMainWindow < QWidget", "AzQtComponents::TabBar < QTabBar < QWidget"],
        widgets: [[0, 0, 800, 600, -1, 0, "main"], [10, 10, 200, 30, 0, 1, ""]],
    };
    const hit = M.widgetAt(map, 30, 30);           // 20, 20 logical
    assert.strictEqual(hit.className, "AzQtComponents::TabBar");
    assert.strictEqual(hit.path, "QMainWindow#main > AzQtComponents::TabBar");
    assert.strictEqual(M.widgetAt(map, 1100, 300).className, "QMainWindow");   // 733, 200 logical
    assert.strictEqual(M.widgetAt(map, 5000, 5000), null);
});

test("widgetSummary names B's widget, and A's only when it differs", () => {
    assert.strictEqual(M.widgetSummary({ A: tabBar, B: tabBar }), "AzQtComponents::TabBar");
    assert.strictEqual(M.widgetSummary({ A: title, B: tabBar }, true), "QMainWindow#main > AzQtComponents::TabBar (A: QMainWindow#main > QLabel#title)");
    assert.strictEqual(M.widgetSummary({ A: title, B: null }), "A: QLabel#title");
    assert.strictEqual(M.widgetSummary({ A: null, B: null }), "");
});

console.log("\n" + passed + " passed");
