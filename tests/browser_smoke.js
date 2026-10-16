// Browser smoke test: drives a real Chromium browser (Edge or Chrome) over the DevTools protocol,
// with no dependencies (Node 22+ has a built-in WebSocket).
//
//   node tests/browser_smoke.js [path to msedge.exe / chrome]
//
// Opens index.html from disk (file://), places a marker by clicking side B of a pair, checks the
// marker, its widget and its note survive a reload and a browser restart (same profile), checks the
// view controls (actual size, full width, flip keys), then exports a report and imports it into a
// cleared store.
"use strict";
const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const assert = require("assert");

const BROWSER = process.argv[2] || [
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
].find((candidate) => fs.existsSync(candidate));
const PAGE = "file:///" + path.resolve(__dirname, "..", "index.html").replace(/\\/g, "/");
const PROFILE = fs.mkdtempSync(path.join(os.tmpdir(), "o3de-ab-smoke-"));
const PORT = 9300 + Math.floor(Math.random() * 500);
const PAIR = "Editor/02_main_entity_selected";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function launch(url) {
    const browser = spawn(BROWSER, ["--headless=new", "--disable-gpu", "--no-first-run", "--window-size=1600,700",
        "--remote-debugging-port=" + PORT, "--user-data-dir=" + PROFILE, url], { stdio: "ignore" });
    for (let attempt = 0; attempt < 50; attempt += 1) {
        await sleep(200);
        try {
            const targets = await (await fetch("http://127.0.0.1:" + PORT + "/json")).json();
            const page = targets.find((target) => target.type === "page");
            if (page) {
                return { browser, socket: await connect(page.webSocketDebuggerUrl) };
            }
        } catch (error) {
            // not up yet
        }
    }
    throw new Error("browser did not start");
}

function connect(url) {
    return new Promise((resolve) => {
        const socket = new WebSocket(url);
        let id = 0;
        const waiting = new Map();
        socket.onmessage = (event) => {
            const message = JSON.parse(event.data);
            if (waiting.has(message.id)) {
                waiting.get(message.id)(message);
                waiting.delete(message.id);
            }
        };
        socket.send2 = (method, params) => new Promise((done) => {
            id += 1;
            waiting.set(id, done);
            socket.send(JSON.stringify({ id, method, params: params || {} }));
        });
        socket.onopen = () => resolve(socket);
    });
}

async function evaluate(socket, expression) {
    const reply = await socket.send2("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (reply.result.exceptionDetails) {
        throw new Error("page error: " + JSON.stringify(reply.result.exceptionDetails));
    }
    return reply.result.result.value;
}

async function click(socket, x, y) {
    for (const type of ["mousePressed", "mouseReleased"]) {
        await socket.send2("Input.dispatchMouseEvent", { type, x, y, button: "left", clickCount: 1 });
    }
}

// name is the event key (" ", "f", "w"); a keyDown with text also fires the keypress, as a real key does
const KEYS = { " ": ["Space", 32], f: ["KeyF", 70], s: ["KeyS", 83], w: ["KeyW", 87] };
async function key(socket, type, name, autoRepeat) {
    const [code, keyCode] = KEYS[name];
    await socket.send2("Input.dispatchKeyEvent", { type, key: name, code, windowsVirtualKeyCode: keyCode,
        text: type === "keyDown" ? name : undefined, autoRepeat: Boolean(autoRepeat) });
    await sleep(50);
}

(async () => {
    assert.ok(BROWSER, "no Edge or Chrome found");
    let { browser, socket } = await launch(PAGE + "#/pair/" + encodeURIComponent(PAIR));
    await sleep(1500);

    // ---- Report opens the project's GitHub issues in a new tab
    const reportLink = await evaluate(socket, "(() => { const link = document.getElementById('report-link'); return [link.href, link.target, link.rel].join('|'); })()");
    assert.strictEqual(reportLink, "https://github.com/GaianHelmers/o3de-GUI-AB-Testing/issues|_blank|noopener");
    console.log("ok   Report opens the GitHub issues in a new tab");

    // ---- place a marker: click 40% / 30% into side B, type a note, save
    const point = await evaluate(socket, `(() => {
        const image = document.querySelector('.canvas[data-side="B"] img');
        const rect = image.getBoundingClientRect();
        return { x: rect.left + rect.width * 0.4, y: rect.top + rect.height * 0.3 };
    })()`);
    await click(socket, point.x, point.y);
    await sleep(800);                                   // widget map loads
    const where = await evaluate(socket, "document.getElementById('popover-where').textContent");
    assert.ok(!where.includes("looking up"), "widget lookup finished: " + where);
    await evaluate(socket, "document.getElementById('popover-note').value = 'smoke test note'; document.getElementById('popover-save').click(); true");
    await sleep(300);
    const first = await evaluate(socket, "document.querySelectorAll('#panel .mitem').length + '|' + document.querySelectorAll('#stage .canvas[data-side=\"A\"] .marker').length"
        + " + '|' + document.querySelectorAll('#stage .canvas[data-side=\"B\"] .marker').length");
    assert.strictEqual(first, "1|1|1", "one marker in the list, its crosshair on both A and B");
    console.log("ok   marker placed: " + where);

    // ---- reload: the marker is still there
    await socket.send2("Page.reload");
    await sleep(1500);
    const afterReload = await evaluate(socket, "document.querySelector('#panel .mitem .note') && document.querySelector('#panel .mitem .note').textContent");
    assert.strictEqual(afterReload, "smoke test note");
    console.log("ok   marker survives a reload");

    // ---- actual size: on both images the crosshair sits on the clicked image pixel
    const offset = await evaluate(socket, `(async () => {
        document.querySelector('[data-mode="actual"]').click();
        await new Promise((done) => setTimeout(done, 400));
        const marker = new ABMarkers.Store(localStorage, AB_GALLERY.id).all()[0];
        const pair = AB_GALLERY.pairs[marker.pair];
        return Math.max(...["A", "B"].map((side) => {
            const info = pair[side.toLowerCase()];
            const image = document.querySelector('.canvas[data-side="' + side + '"] img').getBoundingClientRect();
            const cross = document.querySelector('.canvas[data-side="' + side + '"] .marker').getBoundingClientRect();
            return Math.max(Math.abs(image.left + marker.x * image.width / info.w - cross.left),
                Math.abs(image.top + marker.y * image.height / info.h - cross.top));
        }));
    })()`);
    assert.ok(offset < 1.5, "a crosshair is " + offset + "px off its point");
    console.log("ok   crosshair sits on its pixel on A and B in actual size");

    // ---- full width (W): no page cap, remembered
    await key(socket, "keyDown", "w");
    await key(socket, "keyUp", "w");
    const wide = await evaluate(socket, `document.getElementById("pair-page").classList.contains("wide") + "|"
        + JSON.parse(localStorage.getItem("o3de-ab:" + AB_GALLERY.id + ":settings")).wide + "|"
        + Math.round(document.getElementById("stage").getBoundingClientRect().width)`);
    assert.ok(/^true\|true\|1[5-9]\d\d$/.test(wide), "full width, remembered, stage spans the window: " + wide);
    console.log("ok   full width toggles with W and is remembered");

    // ---- flip: Space or F held shows the other side, A / B latch, a held Space never scrolls
    const shown = () => evaluate(socket, "Array.from(document.querySelectorAll('#stage .side')).filter((f) => !f.hidden).map((f) => f.dataset.side).join('')");
    await evaluate(socket, "document.querySelector('[data-mode=\"flip\"]').click(); true");
    await sleep(300);
    assert.strictEqual(await shown(), "B");
    await key(socket, "keyDown", "f");
    assert.strictEqual(await shown(), "A", "F held shows A");
    await key(socket, "keyUp", "f");
    assert.strictEqual(await shown(), "B", "F released shows B");
    assert.ok(await evaluate(socket, "document.documentElement.scrollHeight > innerHeight + 100"), "the page is long enough to scroll");
    await key(socket, "keyDown", " ");
    for (let repeat = 0; repeat < 6; repeat += 1) {
        await key(socket, "keyDown", " ", true);
    }
    assert.strictEqual(await shown(), "A", "Space held shows A");
    assert.strictEqual(await evaluate(socket, "scrollY"), 0, "a held Space does not scroll the page");
    await key(socket, "keyUp", " ");
    assert.strictEqual(await shown(), "B", "Space released shows B");
    await evaluate(socket, "document.querySelector('#stage .side:not([hidden]) [data-flip=\"A\"]').click(); true");
    assert.strictEqual(await shown(), "A", "the A button latches A");
    await key(socket, "keyDown", "f");
    assert.strictEqual(await shown(), "B", "F held from A shows B");
    await key(socket, "keyUp", "f");
    assert.strictEqual(await shown(), "A");
    await evaluate(socket, "document.querySelector('#stage .side:not([hidden]) [data-flip=\"B\"]').click(); true");
    console.log("ok   flip: F or Space held, A / B buttons latch, a held Space does not scroll");

    // control: outside flip mode the page keeps the browser's own Space (scroll), so the check above is real
    await evaluate(socket, "document.querySelector('[data-mode=\"side\"]').click(); scrollTo(0, 0); true");
    await key(socket, "keyDown", " ");
    await key(socket, "keyUp", " ");
    await sleep(300);
    assert.ok(await evaluate(socket, "scrollY > 0"), "control: Space scrolls when the page does not take it");

    // ---- the smallest capture at full width flip: Stretch (the default) fills the width; S turns it
    //      off, then the capture shows at its own pixel size, centered
    await evaluate(socket, "document.querySelector('[data-mode=\"flip\"]').click(); true");
    const smallest = await evaluate(socket, `(() => {
        const pair = Object.values(AB_GALLERY.pairs).sort((a, b) => a.b.w - b.b.w)[0];
        location.hash = "#/pair/" + encodeURIComponent(pair.id);
        return pair.id;
    })()`);
    await sleep(1000);
    const measure = () => evaluate(socket, `(() => {
        const pair = AB_GALLERY.pairs[${JSON.stringify(smallest)}];
        const viewport = document.querySelector('#stage .side:not([hidden]) .viewport');
        const image = viewport.querySelector("img").getBoundingClientRect();
        return { width: image.width, left: image.left - viewport.getBoundingClientRect().left - viewport.clientLeft,
            inner: viewport.clientWidth, widest: Math.max(pair.a.w, pair.b.w), own: pair.b.w };
    })()`);
    let size = await measure();
    assert.ok(Math.abs(size.width - size.own / size.widest * size.inner) < 1, "stretched to the width: " + JSON.stringify(size));
    await key(socket, "keyDown", "s");
    await key(socket, "keyUp", "s");
    size = await measure();
    assert.ok(Math.abs(size.width - size.own) < 0.5, "its own pixel size with Stretch off: " + JSON.stringify(size));
    assert.ok(Math.abs(size.left - (size.inner - size.widest) / 2) < 1, "centered: " + JSON.stringify(size));
    console.log("ok   " + smallest + ": stretched to the width by default; S shows its own " + size.own + "px, centered");

    // ---- A and B of different widths are drawn at one scale, Stretch on or off, so the same image
    //      pixel lines up: the pair with the biggest width gap (large) and the smallest capture
    await evaluate(socket, "document.querySelector('[data-mode=\"side\"]').click(); true");
    const uneven = await evaluate(socket, "Object.values(AB_GALLERY.pairs).sort((p, q) => Math.abs(q.a.w - q.b.w) - Math.abs(p.a.w - p.b.w))[0].id");
    for (const pairId of [uneven, smallest]) {
        await evaluate(socket, "location.hash = " + JSON.stringify("#/pair/" + encodeURIComponent(pairId)) + "; true");
        await sleep(1000);
        for (let round = 0; round < 2; round += 1) {
            const [stretched, scaleA, scaleB] = await evaluate(socket, `(() => {
                const pair = AB_GALLERY.pairs[${JSON.stringify(pairId)}];
                const scale = (side) => document.querySelector('.canvas[data-side="' + side + '"]').getBoundingClientRect().width / pair[side.toLowerCase()].w;
                return [document.getElementById("stretch-button").getAttribute("aria-pressed"), scale("A"), scale("B")];
            })()`);
            assert.ok(Math.abs(scaleA - scaleB) < 0.002, pairId + ": A and B scales differ, stretch " + stretched + ": " + scaleA + ", " + scaleB);
            console.log("ok   " + pairId + ": A and B at one scale, stretch " + stretched + " (" + scaleA.toFixed(3) + ")");
            await key(socket, "keyDown", "s");
            await key(socket, "keyUp", "s");
        }
    }

    // ---- restart the browser on the same profile
    socket.close();
    browser.kill();
    await sleep(1500);
    ({ browser, socket } = await launch(PAGE + "#/markers"));
    await sleep(1500);
    const rows = await evaluate(socket, "document.querySelectorAll('tbody tr').length");
    assert.strictEqual(rows, 1, "the all-markers view lists it after a restart");
    console.log("ok   marker survives a browser restart");

    // ---- export, clear, import
    const report = await evaluate(socket, `(() => {
        const store = new ABMarkers.Store(localStorage, AB_GALLERY.id);
        return ABMarkers.buildReport(AB_GALLERY, AB_GALLERY_VERSION, store.all(), "smoke");
    })()`);
    assert.ok(report.includes("smoke test note") && report.includes(require("../viewer/markers.js").REPORT_FORMAT));
    const restored = await evaluate(socket, `(() => {
        localStorage.removeItem("o3de-ab:" + AB_GALLERY.id + ":markers");
        const store = new ABMarkers.Store(localStorage, AB_GALLERY.id);
        const result = store.merge(ABMarkers.parseReport(${JSON.stringify(report)}).markers);
        return result.added + "|" + new ABMarkers.Store(localStorage, AB_GALLERY.id).all().length;
    })()`);
    assert.strictEqual(restored, "1|1");
    console.log("ok   report exports and imports back");

    socket.close();
    browser.kill();
    await sleep(500);
    fs.rmSync(PROFILE, { recursive: true, force: true });
    console.log("\nbrowser smoke test passed (" + path.basename(BROWSER) + ")");
})().catch((error) => {
    console.error(error);
    process.exit(1);
});
