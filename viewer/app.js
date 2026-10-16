/*
 * app.js -- the A/B viewer: one page, every view behind a hash route.
 *
 *   #/                      home: application and family groups
 *   #/group/<id>            the screens of one group
 *   #/pair/<id>?g=<group>   one screen, A and B, with its markers
 *   #/markers               every marker
 *
 * Data comes from gallery/gallery.js (pairs, groups) and gallery/version.js (the gallery version);
 * widget maps load on demand. Markers live in the browser (viewer/markers.js).
 */
(function () {
    "use strict";

    // ==================================================================================
    // Setup
    // ==================================================================================

    const gallery = window.AB_GALLERY;
    const VERSION = Number(window.AB_GALLERY_VERSION || 1);
    const M = window.ABMarkers;
    const view = document.getElementById("view");
    const storage = probeStorage();
    const store = new M.Store(storage, gallery.id);
    const settings = store.settings();
    const ui = {
        mode: settings.mode || "side",       // side | flip | actual
        wide: Boolean(settings.wide),         // full width: images span the window, marker list below
        stretch: settings.stretch !== false,  // fit views fill the width, small captures grow; off: own pixels at most, centered
        flipSide: "B",                        // side shown in flip mode (the A / B buttons)
        flipHeld: false,                      // Space or F held: flip mode shows the other side
        focus: null,                          // marker id highlighted in list and image
        pending: null,                        // marker being placed
        confirmDelete: null,
    };
    const groupsById = new Map(gallery.groups.map((group) => [group.id, group]));

    function probeStorage() {
        try {
            const probe = "__o3de_ab_probe";
            window.localStorage.setItem(probe, "1");
            window.localStorage.removeItem(probe);
            return window.localStorage;
        } catch (error) {
            document.getElementById("storage-banner").hidden = false;
            const memory = {};
            return { getItem: (key) => (key in memory ? memory[key] : null), setItem: (key, value) => { memory[key] = String(value); } };
        }
    }

    // ==================================================================================
    // Helpers
    // ==================================================================================

    function esc(text) {
        return String(text == null ? "" : text).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
    }

    function stateOf(marker) {
        return M.state(marker, VERSION);
    }

    const STATE_LABEL = { open: "Open", "needs-verification": "Needs verification", fixed: "Fixed" };

    function pairUrl(pairId, groupId) {
        return "#/pair/" + encodeURIComponent(pairId) + (groupId ? "?g=" + encodeURIComponent(groupId) : "");
    }

    function groupUrl(groupId) {
        return "#/group/" + encodeURIComponent(groupId);
    }

    function tallyHtml(markers) {
        const tally = M.counts(markers, VERSION);
        const parts = [];
        for (const key of ["open", "needs-verification", "fixed"]) {
            if (tally[key]) {
                parts.push('<span title="' + STATE_LABEL[key] + '"><span class="dot ' + key + '"></span>' + tally[key] + "</span>");
            }
        }
        return parts.join("");
    }

    function widgetLabel(widgets) {
        return M.widgetSummary(widgets, true) || "no widget recorded";
    }

    // A and B can differ in size (a shorter menu, a wider window): a point past one capture's edge
    // is not drawn on that side.
    function outsideOf(pair, marker) {
        return ["A", "B"].filter((side) => marker.x >= pair[side.toLowerCase()].w || marker.y >= pair[side.toLowerCase()].h);
    }

    function toast(message) {
        const node = document.createElement("div");
        node.className = "toast";
        node.textContent = message;
        document.body.appendChild(node);
        setTimeout(() => node.remove(), 3200);
    }

    // Widget maps are plain scripts (file:// pages cannot fetch); each loads once.
    const scriptLoads = new Map();
    function loadScript(src) {
        if (!scriptLoads.has(src)) {
            scriptLoads.set(src, new Promise((resolve) => {
                const script = document.createElement("script");
                script.src = src;
                script.onload = () => resolve(true);
                script.onerror = () => resolve(false);
                document.head.appendChild(script);
            }));
        }
        return scriptLoads.get(src);
    }

    // The widget under a point in each capture.
    async function widgetsAt(pair, x, y) {
        const widgets = { A: null, B: null };
        for (const side of ["A", "B"]) {
            const info = pair[side.toLowerCase()];
            if (info.widgets && (await loadScript(info.widgets))) {
                widgets[side] = M.widgetAt((window.AB_WIDGETS || {})[pair.id + "/" + side], x, y);
            }
        }
        return widgets;
    }

    // ==================================================================================
    // Top bar
    // ==================================================================================

    function renderTop(crumbs) {
        document.getElementById("version-label").textContent = "gallery version " + VERSION;
        document.getElementById("crumbs").innerHTML = crumbs.map((crumb) => crumb.href
            ? '<a href="' + crumb.href + '">' + esc(crumb.text) + "</a>"
            : "<span>" + esc(crumb.text) + "</span>").join("<span>/</span>");
        const all = store.all();
        document.getElementById("totals").innerHTML = all.length ? tallyHtml(all) : '<span class="muted">No markers yet</span>';
        const reporter = store.settings().reporter;
        document.getElementById("reporter-button").textContent = reporter ? "Reporter: " + reporter : "Set your name";
    }

    // ==================================================================================
    // Routes
    // ==================================================================================

    function route() {
        closePopover();
        const hash = location.hash.replace(/^#\/?/, "");
        const [path, query] = hash.split("?");
        const params = new URLSearchParams(query || "");
        if (path.startsWith("group/")) {
            renderGroup(decodeURIComponent(path.slice(6)));
        } else if (path.startsWith("pair/")) {
            renderPair(decodeURIComponent(path.slice(5)), params.get("g"));
        } else if (path === "markers") {
            renderMarkers();
        } else {
            renderHome();
        }
        window.scrollTo(0, 0);
    }

    // ---- home ---------------------------------------------------------------------

    function renderHome() {
        renderTop([]);
        const markers = store.all();
        const kinds = [];
        for (const group of gallery.groups) {
            if (!kinds.includes(group.kind)) {
                kinds.push(group.kind);
            }
        }
        let html = '<div class="page"><section><h1>' + esc(gallery.title) + "</h1>";
        html += '<p class="lede">Every pair shows the same screen twice. <b>A</b>: ' + esc(gallery.sides.A) + ". <b>B</b>: " + esc(gallery.sides.B) + ". "
            + "Open a screen and click wherever B differs from A (or wherever either is wrong) to drop a crosshair; it shows on both images. Add a description if it helps. "
            + "Markers stay in this browser. When you are done, <b>Export report</b> and attach the file to a GitHub issue.</p>";
        html += '<p class="lede">Gallery version ' + VERSION + ". Markers placed under an older version show as <b>needs verification</b> until you check them against the new captures.</p></section>";
        for (const kind of kinds) {
            html += "<section><h2>" + esc(kind === "Application" ? "Applications" : kind === "Family" ? "Families (the same screens, grouped by what they show)" : kind) + '</h2><div class="cards">';
            for (const group of gallery.groups.filter((g) => g.kind === kind)) {
                const groupMarkers = markers.filter((marker) => group.pairs.includes(marker.pair));
                html += '<a class="card" href="' + groupUrl(group.id) + '"><span class="title">' + esc(group.title) + "</span>"
                    + '<span class="meta"><span>' + group.pairs.length + " screens</span>" + tallyHtml(groupMarkers) + "</span></a>";
            }
            html += "</div></section>";
        }
        html += "</div>";
        view.innerHTML = html;
    }

    // ---- group --------------------------------------------------------------------

    function renderGroup(groupId) {
        const group = groupsById.get(groupId);
        if (!group) {
            return renderMissing("No group " + groupId);
        }
        renderTop([{ text: group.title }]);
        const markers = store.all();
        let html = '<div class="page"><section><h1>' + esc(group.title) + '</h1><p class="lede">' + group.pairs.length
            + " screens. Each tile shows B; hover it to see A.</p></section><section class=\"shots\">";
        for (const pairId of group.pairs) {
            const pair = gallery.pairs[pairId];
            const pairMarkers = markers.filter((marker) => marker.pair === pairId);
            html += '<a class="shot" href="' + pairUrl(pairId, group.id) + '"><span class="frame">'
                + '<img loading="lazy" src="' + esc(pair.b.image) + '" alt="">'
                + '<img class="legacy" loading="lazy" src="' + esc(pair.a.image) + '" alt="">'
                + '<span class="tag">' + (group.kind === "Application" ? "" : esc(pair.app) + " &middot; ") + "B, hover for A</span></span>"
                + '<span class="caption">' + esc(pair.title) + '</span><span class="badges">' + tallyHtml(pairMarkers) + "</span></a>";
        }
        html += "</section></div>";
        view.innerHTML = html;
    }

    // ---- all markers --------------------------------------------------------------

    function renderMarkers() {
        renderTop([{ text: "All markers" }]);
        const order = { "needs-verification": 0, open: 1, fixed: 2 };
        const markers = store.all().sort((a, b) => order[stateOf(a)] - order[stateOf(b)]);
        let html = '<div class="page"><section><h1>All markers</h1><p class="lede">' + markers.length + " markers in this browser. "
            + "Export them as one report file from the top bar.</p></section>";
        if (!markers.length) {
            html += '<p class="empty">No markers yet. Open a screen from the home page and click on an image to mark a fault.</p>';
        } else {
            html += '<div class="table-wrap"><table><thead><tr><th>State</th><th>Screen</th><th>Point</th><th>Widget</th><th>Description</th><th>Version</th></tr></thead><tbody>';
            for (const marker of markers) {
                const pair = gallery.pairs[marker.pair];
                const state = stateOf(marker);
                html += "<tr><td><span class=\"chip " + state + '">' + STATE_LABEL[state] + "</span></td>"
                    + "<td>" + (pair ? '<a href="' + pairUrl(marker.pair) + '">' + esc(pair.app + " / " + pair.title) + "</a>" : esc(marker.pair) + ' <span class="muted">(not in this gallery)</span>') + "</td>"
                    + '<td class="mono">' + marker.x + ", " + marker.y + '</td><td class="mono">' + esc(widgetLabel(marker.widgets)) + "</td>"
                    + "<td>" + esc(marker.note) + "</td><td>" + marker.createdVersion + (marker.verifiedVersion !== marker.createdVersion ? " &rarr; " + marker.verifiedVersion : "") + "</td></tr>";
            }
            html += "</tbody></table></div>";
        }
        view.innerHTML = html + "</div>";
    }

    function renderMissing(message) {
        renderTop([{ text: "Not found" }]);
        view.innerHTML = '<div class="page"><p class="empty">' + esc(message) + '. <a href="#/">Back to all groups</a></p></div>';
    }

    // ==================================================================================
    // Pair view
    // ==================================================================================

    function renderPair(pairId, groupId) {
        const pair = gallery.pairs[pairId];
        if (!pair) {
            return renderMissing("No screen " + pairId);
        }
        const group = groupsById.get(groupId) || groupsById.get("app/" + pair.app);
        const index = group ? group.pairs.indexOf(pairId) : -1;
        const prev = index > 0 ? group.pairs[index - 1] : null;
        const next = group && index < group.pairs.length - 1 ? group.pairs[index + 1] : null;
        renderTop(group ? [{ text: group.title, href: groupUrl(group.id) }, { text: pair.title }] : [{ text: pair.title }]);

        const modes = [["side", "Side by side"], ["flip", "Flip"], ["actual", "Actual size"]];
        view.innerHTML = '<div class="page' + (ui.wide ? " wide" : "") + '" id="pair-page">'
            + '<div class="pairbar">'
            + (prev ? '<a class="button" href="' + pairUrl(prev, group.id) + '" title="Previous screen (Left arrow)">&larr;</a>' : '<span class="button" aria-disabled="true">&larr;</span>')
            + (next ? '<a class="button" href="' + pairUrl(next, group.id) + '" title="Next screen (Right arrow)">&rarr;</a>' : '<span class="button" aria-disabled="true">&rarr;</span>')
            + '<span class="title">' + esc(pair.app) + " / " + esc(pair.title) + "</span>"
            + (group ? '<span class="count">' + (index + 1) + " of " + group.pairs.length + "</span>" : "")
            + '<span class="grow"></span>'
            + '<span class="segmented" role="group" aria-label="View">' + modes.map(([key, label]) =>
                '<button type="button" data-mode="' + key + '" aria-pressed="' + (ui.mode === key) + '">' + label + "</button>").join("") + "</span>"
            + '<button class="button" type="button" id="stretch-button" aria-pressed="' + ui.stretch + '"' + (ui.mode === "actual" ? " disabled" : "")
            + ' title="Fill the width, enlarging small captures; off: never past their own pixels, centered (S)">Stretch</button>'
            + '<button class="button" type="button" id="wide-button" aria-pressed="' + ui.wide + '" title="Images span the whole window, marker list below (W)">Full width</button>'
            + "</div>"
            + '<p class="hint">Click an image to mark a fault. Left and Right arrows move between screens; S toggles stretch, W full width. '
            + "In Flip, hold Space or F to see the other side, or click A / B to switch.</p>"
            + '<div class="pair"><div class="stage" id="stage"></div><aside class="panel" id="panel"></aside></div></div>';

        view.querySelectorAll("[data-mode]").forEach((button) => button.addEventListener("click", () => {
            ui.mode = button.dataset.mode;
            store.setSettings({ mode: ui.mode });
            view.querySelectorAll("[data-mode]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.mode === ui.mode)));
            document.getElementById("stretch-button").disabled = ui.mode === "actual";    // actual size is always 1:1
            renderStage(pair);
        }));
        document.getElementById("stretch-button").addEventListener("click", toggleStretch);
        document.getElementById("wide-button").addEventListener("click", toggleWide);
        ui.current = { pair: pair, prev: prev, next: next, group: group };
        renderStage(pair);
        renderPanel(pair);
    }

    // Stretch: side by side and flip fill the width (small captures grow); off, nothing passes its own pixels.
    function toggleStretch() {
        ui.stretch = !ui.stretch;
        store.setSettings({ stretch: ui.stretch });
        document.getElementById("stretch-button").setAttribute("aria-pressed", String(ui.stretch));
        renderStage(ui.current.pair);
    }

    // Full width is a layout choice on top of any view mode: no page width cap, marker list below.
    function toggleWide() {
        ui.wide = !ui.wide;
        store.setSettings({ wide: ui.wide });
        document.getElementById("pair-page").classList.toggle("wide", ui.wide);
        document.getElementById("wide-button").setAttribute("aria-pressed", String(ui.wide));
    }

    function renderStage(pair) {
        const stage = document.getElementById("stage");
        if (!stage) {
            return;
        }
        const flip = ui.mode === "flip";
        stage.className = "stage" + (flip ? " single" : "") + (ui.mode === "actual" ? " actual" : "");
        // Both sides are always in the page; flip mode hides one, so a flip swaps instantly.
        stage.innerHTML = ["A", "B"].map((side) => {
            const info = pair[side.toLowerCase()];
            return '<figure class="side" data-side="' + side + '"><figcaption class="side-label"><span><b>' + side + "</b> " + esc(gallery.sides[side]) + "</span>"
                + (flip ? flipButtons(side) : "")
                + '<span class="mono">' + esc(info.source) + " &middot; " + info.w + "&times;" + info.h + "</span></figcaption>"
                + '<div class="viewport"><div class="frame"><div class="canvas" data-side="' + side + '">'
                + '<img src="' + esc(info.image) + '" alt="Side ' + side + " of " + esc(pair.title) + '" draggable="false"></div></div></div></figure>';
        }).join("");

        // One scale and one top-left corner for A and B: the centered frame is as wide as the wider capture
        // (its own pixels, or the whole viewport when stretched), each canvas takes its capture's share of it.
        const widest = Math.max(pair.a.w, pair.b.w);
        const fill = ui.stretch && ui.mode !== "actual";
        stage.querySelectorAll(".canvas").forEach((canvas) => {
            const side = canvas.dataset.side;
            const image = canvas.querySelector("img");
            canvas.parentElement.style.width = fill ? "100%" : widest + "px";
            canvas.style.width = (pair[side.toLowerCase()].w / widest * 100) + "%";
            canvas.addEventListener("click", (event) => {
                if (event.target.closest(".ring")) {
                    return;
                }
                const rect = image.getBoundingClientRect();
                const info = pair[side.toLowerCase()];
                const x = (event.clientX - rect.left) * info.w / rect.width;
                const y = (event.clientY - rect.top) * info.h / rect.height;
                if (x >= 0 && y >= 0 && x < info.w && y < info.h) {
                    openPopover(pair, x, y, event.clientX, event.clientY);
                }
            });
        });
        stage.querySelectorAll("[data-flip]").forEach((button) => button.addEventListener("click", () => {
            ui.flipSide = button.dataset.flip;
            showFlipSide();
        }));
        if (ui.mode === "actual") {
            const viewports = Array.from(stage.querySelectorAll(".viewport"));
            viewports.forEach((viewport) => viewport.addEventListener("scroll", () => {
                for (const other of viewports) {
                    if (other !== viewport) {
                        other.scrollLeft = viewport.scrollLeft;
                        other.scrollTop = viewport.scrollTop;
                    }
                }
            }));
        }
        showFlipSide();
        drawMarkers(pair);
    }

    function flipButtons(side) {
        return '<span class="segmented small" role="group" aria-label="Show side">' + ["A", "B"].map((key) =>
            '<button type="button" data-flip="' + key + '" aria-pressed="' + (key === side) + '">' + key + "</button>").join("") + "</span>";
    }

    // Flip mode shows the latched side (A / B buttons), or the other one while Space or F is held.
    function showFlipSide() {
        const shown = ui.flipHeld ? (ui.flipSide === "A" ? "B" : "A") : ui.flipSide;
        document.querySelectorAll("#stage .side").forEach((figure) => {
            figure.hidden = ui.mode === "flip" && figure.dataset.side !== shown;
        });
    }

    // Every marker of the screen on both images, at the same image pixel.
    function drawMarkers(pair) {
        const markers = store.forPair(pair.id);
        document.querySelectorAll("#stage .canvas").forEach((canvas) => {
            canvas.querySelectorAll(".marker").forEach((node) => node.remove());
            const side = canvas.dataset.side;
            const info = pair[side.toLowerCase()];
            markers.forEach((marker, index) => {
                if (outsideOf(pair, marker).includes(side)) {
                    return;
                }
                const node = document.createElement("span");
                node.className = "marker " + stateOf(marker) + (ui.focus === marker.id ? " focus" : "");
                node.style.left = (marker.x / info.w * 100) + "%";
                node.style.top = (marker.y / info.h * 100) + "%";
                node.innerHTML = '<span class="ring" title="' + esc("Marker " + (index + 1) + (marker.note ? ": " + marker.note : "")) + '"></span>'
                    + '<span class="label"><span>' + (index + 1) + "</span></span>";
                node.querySelector(".ring").addEventListener("click", (event) => {
                    event.stopPropagation();
                    focusMarker(marker.id, true);
                });
                canvas.appendChild(node);
            });
        });
    }

    function focusMarker(id, scrollList) {
        ui.focus = id;
        drawMarkers(ui.current.pair);
        document.querySelectorAll(".mitem").forEach((item) => item.classList.toggle("focus", item.dataset.id === id));
        if (scrollList && !ui.wide) {                      // full width: the list sits below, do not jump away from the image
            const item = document.querySelector('.mitem[data-id="' + CSS.escape(id) + '"]');
            if (item) {
                item.scrollIntoView({ block: "nearest" });
            }
        }
    }

    // ---- marker list --------------------------------------------------------------

    function renderPanel(pair) {
        const panel = document.getElementById("panel");
        if (!panel) {
            return;
        }
        const markers = store.forPair(pair.id);
        let html = "<h2>Markers on this screen (" + markers.length + ")</h2>";
        if (!markers.length) {
            html += '<p class="empty">None yet. Click on A or B where something is wrong; the marker shows on both.</p>';
        }
        html += '<ol class="mlist">';
        markers.forEach((marker, index) => {
            const state = stateOf(marker);
            const deleting = ui.confirmDelete === marker.id;
            const outside = outsideOf(pair, marker);
            html += '<li class="mitem' + (ui.focus === marker.id ? " focus" : "") + '" data-id="' + esc(marker.id) + '">'
                + '<div class="head"><span class="num">' + (index + 1) + "</span>"
                + '<span class="chip ' + state + '">' + STATE_LABEL[state] + "</span>"
                + '<span class="muted mono">' + marker.x + ", " + marker.y + "</span>"
                + (outside.length ? '<span class="muted">beyond ' + outside.join(" and ") + "'s edge</span>" : "") + "</div>"
                + '<div class="widget">' + esc(widgetLabel(marker.widgets)) + "</div>"
                + (marker.note ? '<div class="note">' + esc(marker.note) + "</div>" : "")
                + '<div class="actions">'
                + (state === "needs-verification" ? '<button class="button small" data-act="confirm" title="Still wrong in the current captures">Still wrong</button>' : "")
                + (state !== "fixed" ? '<button class="button small" data-act="fixed">Fixed</button>' : '<button class="button small" data-act="confirm">Reopen</button>')
                + '<button class="button small" data-act="edit">Edit</button>'
                + '<button class="button small danger" data-act="delete">' + (deleting ? "Delete for good?" : "Delete") + "</button>"
                + "</div></li>";
        });
        html += "</ol>";
        panel.innerHTML = html;

        panel.querySelectorAll(".mitem").forEach((item) => {
            item.addEventListener("mouseenter", () => focusMarker(item.dataset.id, false));
            item.querySelectorAll("[data-act]").forEach((button) => button.addEventListener("click", () => act(item.dataset.id, button.dataset.act, item)));
        });
    }

    function act(id, action, item) {
        const marker = store.markers.get(id);
        if (!marker) {
            return;
        }
        if (action === "confirm") {
            store.put(M.confirm(marker, VERSION));
        } else if (action === "fixed") {
            store.put(M.markFixed(marker, VERSION));
        } else if (action === "delete") {
            if (ui.confirmDelete !== id) {
                ui.confirmDelete = id;
                setTimeout(() => {
                    if (ui.confirmDelete === id) {
                        ui.confirmDelete = null;
                        renderPanel(ui.current.pair);
                    }
                }, 3000);
                return renderPanel(ui.current.pair);
            }
            ui.confirmDelete = null;
            store.remove(id);
        } else if (action === "edit") {
            const note = item.querySelector(".note");
            const editor = document.createElement("div");
            editor.innerHTML = '<textarea aria-label="Description">' + esc(marker.note) + '</textarea><div class="actions"><button class="button primary small" type="button">Save</button><button class="button small" type="button">Cancel</button></div>';
            (note || item.querySelector(".actions")).replaceWith(editor);
            const area = editor.querySelector("textarea");
            area.focus();
            const [save, cancel] = editor.querySelectorAll("button");
            save.addEventListener("click", () => {
                store.put(M.setNote(marker, area.value.trim()));
                refreshPair();
            });
            cancel.addEventListener("click", refreshPair);
            return;
        }
        refreshPair();
    }

    function refreshPair() {
        renderTop(document.getElementById("crumbs") ? currentCrumbs() : []);
        drawMarkers(ui.current.pair);
        renderPanel(ui.current.pair);
    }

    function currentCrumbs() {
        const group = ui.current.group;
        return group ? [{ text: group.title, href: groupUrl(group.id) }, { text: ui.current.pair.title }] : [{ text: ui.current.pair.title }];
    }

    // ---- placing a marker ---------------------------------------------------------

    const popover = document.getElementById("popover");
    const popoverNote = document.getElementById("popover-note");
    const popoverWhere = document.getElementById("popover-where");

    function openPopover(pair, x, y, clientX, clientY) {
        const where = "At " + Math.round(x) + ", " + Math.round(y);
        const pending = { pair: pair.id, x: x, y: y, lookup: widgetsAt(pair, x, y) };
        ui.pending = pending;
        popoverNote.value = "";
        popoverWhere.textContent = where + " (looking up the widget...)";
        popover.hidden = false;
        const width = 300;
        const height = popover.offsetHeight || 170;
        popover.style.left = Math.min(Math.max(8, clientX + 14), window.innerWidth - width - 8) + "px";
        popover.style.top = Math.min(Math.max(8, clientY + 14), window.innerHeight - height - 8) + "px";
        popoverNote.focus();
        pending.lookup.then((widgets) => {
            if (ui.pending === pending) {
                popoverWhere.textContent = where + " - " + widgetLabel(widgets);
            }
        });
    }

    function closePopover() {
        ui.pending = null;
        popover.hidden = true;
    }

    async function savePending() {
        const pending = ui.pending;
        if (!pending) {
            return;
        }
        const note = popoverNote.value.trim();
        closePopover();
        const widgets = await pending.lookup;               // usually done already: the maps are local scripts
        const marker = M.create({ pair: pending.pair, x: pending.x, y: pending.y, note: note, widgets: widgets }, VERSION);
        if (!store.put(marker)) {
            toast("Could not save the marker: browser storage is full or blocked. Export a report to keep your work.");
        }
        closePopover();
        ui.focus = marker.id;
        refreshPair();
    }

    document.getElementById("popover-save").addEventListener("click", savePending);
    document.getElementById("popover-cancel").addEventListener("click", closePopover);
    popoverNote.addEventListener("keydown", (event) => {
        if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
            savePending();
        }
    });

    // ==================================================================================
    // Report export, import, reporter name
    // ==================================================================================

    document.getElementById("export-button").addEventListener("click", () => {
        const markers = store.all();
        if (!markers.length) {
            return toast("There are no markers to export yet.");
        }
        const reporter = store.settings().reporter || "";
        const text = M.buildReport(gallery, VERSION, markers, reporter);
        const date = new Date().toISOString().slice(0, 10);
        const name = ("o3de-ab-report_v" + VERSION + "_" + (reporter || "anonymous") + "_" + date + ".md").replace(/[^A-Za-z0-9._-]+/g, "-");
        const link = document.createElement("a");
        link.href = URL.createObjectURL(new Blob([text], { type: "text/markdown" }));
        link.download = name;
        document.body.appendChild(link);
        link.click();
        setTimeout(() => {
            URL.revokeObjectURL(link.href);
            link.remove();
        }, 1000);
        toast("Report saved as " + name + " (" + markers.length + " markers). Attach it to a GitHub issue.");
    });

    const importFile = document.getElementById("import-file");
    document.getElementById("import-button").addEventListener("click", () => importFile.click());
    importFile.addEventListener("change", () => {
        const file = importFile.files[0];
        importFile.value = "";
        if (!file) {
            return;
        }
        const reader = new FileReader();
        reader.onload = () => {
            try {
                const report = M.parseReport(String(reader.result));
                const result = store.merge(report.markers);
                const other = report.gallery.id !== gallery.id ? " (from another gallery: " + report.gallery.id + ")" : "";
                toast("Imported " + result.added + " new and " + result.updated + " updated markers" + other + ".");
                route();
            } catch (error) {
                toast("Could not import " + file.name + ": " + error.message);
            }
        };
        reader.readAsText(file);
    });

    const reporterDialog = document.getElementById("reporter-dialog");
    const reporterName = document.getElementById("reporter-name");
    document.getElementById("reporter-button").addEventListener("click", () => {
        reporterName.value = store.settings().reporter || "";
        reporterDialog.showModal();
    });
    reporterDialog.addEventListener("close", () => {
        if (reporterDialog.returnValue === "save") {
            store.setSettings({ reporter: reporterName.value.trim() });
            renderTop(ui.current && location.hash.startsWith("#/pair/") ? currentCrumbs() : []);
            route();
        }
    });

    // ==================================================================================
    // Keyboard
    // ==================================================================================

    const FLIP_KEYS = [" ", "f", "F"];

    function typing(event) {
        const tag = event.target.tagName;
        return tag === "INPUT" || tag === "TEXTAREA" || event.target.isContentEditable;
    }

    function releaseFlip() {
        if (ui.flipHeld) {
            ui.flipHeld = false;
            showFlipSide();
        }
    }

    document.addEventListener("keydown", (event) => {
        if (event.key === "Escape") {
            closePopover();
            return;
        }
        if (typing(event) || !location.hash.startsWith("#/pair/") || !ui.current || event.ctrlKey || event.metaKey || event.altKey) {
            return;
        }
        if (event.key === "ArrowLeft" && ui.current.prev) {
            location.hash = pairUrl(ui.current.prev, ui.current.group && ui.current.group.id);
        } else if (event.key === "ArrowRight" && ui.current.next) {
            location.hash = pairUrl(ui.current.next, ui.current.group && ui.current.group.id);
        } else if (event.key === "w" || event.key === "W") {
            event.preventDefault();
            toggleWide();
        } else if ((event.key === "s" || event.key === "S") && ui.mode !== "actual") {
            event.preventDefault();
            toggleStretch();
        } else if (FLIP_KEYS.includes(event.key) && ui.mode === "flip") {
            event.preventDefault();             // on every repeat too: a held Space scrolls the page otherwise
            if (!ui.flipHeld) {
                ui.flipHeld = true;
                showFlipSide();
            }
        }
    });
    document.addEventListener("keyup", (event) => {
        if (FLIP_KEYS.includes(event.key) && ui.flipHeld) {
            event.preventDefault();             // a focused button would otherwise take the Space as a click
            releaseFlip();
        }
    });
    window.addEventListener("blur", releaseFlip);

    window.addEventListener("hashchange", route);
    route();
})();
