"""
read_reports.py -- merge submitted A/B reports into one digest for a style pass (maintainer tool).

    python tools/read_reports.py <report.md | folder> [...]            reports saved on disk
    python tools/read_reports.py --github OWNER/REPO [--label LABEL]    reports in open GitHub issues
    options: --dumps D  the capture root the gallery came from, for fonts and colours (see Measuring)
             --json     the merged markers as JSON instead of the Markdown digest
             --out F    write to F instead of printing

A report is the .md file the viewer's "Export report" writes: readable tables plus a JSON data
block. --github reads each open issue's body and every .md / .txt file attached to it, so a report
pasted into the issue and a report attached as a file both count. It only reads (gh issue list
and plain downloads); it never writes to GitHub.

A marker belongs to a screen: one point in image pixels, the same on A and B, and the widget
under it in each capture. Every marker has a stable id, so the same marker sent twice (a
re-export, or a reviewer who imported someone else's report) counts once: the copy changed last
wins, as in the viewer. States are recomputed against the current gallery version
(gallery/version.js), so a marker last confirmed under an older version shows as
needs-verification.

Each marker is also measured: the widget under its point is compared between Native (A) and
Flattened (B), so the digest says what differs and by how much, not only where.
"""

import argparse
import json
import os
import re
import subprocess
import sys
import urllib.request
from collections import Counter, OrderedDict

from import_captures import drawn_widgets

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
REPORT_FORMAT = "o3de-ab-report/2"
DATA_START = "<!-- o3de-ab-report:data -->"
ATTACHMENT = re.compile(r"https://github\.com/(?:user-attachments/files|[\w.-]+/[\w.-]+/files)/\d+/[^\s)\]>\"']+")
STATES = ["open", "needs-verification", "fixed"]


# ==================================================================================
# Gallery
# ==================================================================================

def load_gallery(root):
    """The manifest (gallery/gallery.js) and the gallery version (gallery/version.js)."""
    with open(os.path.join(root, "gallery", "gallery.js"), encoding="utf-8") as handle:
        text = handle.read()
    start = text.index("=", text.index("window.AB_GALLERY")) + 1
    manifest = json.loads(text[start:text.rindex(";")])
    with open(os.path.join(root, "gallery", "version.js"), encoding="utf-8") as handle:
        version = int(re.search(r"AB_GALLERY_VERSION\s*=\s*(\d+)", handle.read()).group(1))
    return manifest, version


# ==================================================================================
# Reading reports
# ==================================================================================

def parse_report(text):
    """The data block of an exported report: {gallery, reporter, exported, markers}. Raises ValueError."""
    start = text.find(DATA_START)
    if start < 0:
        raise ValueError("no report data block")
    open_fence = text.find("```json", start)
    close_fence = text.find("```", open_fence + 7)
    if open_fence < 0 or close_fence < 0:
        raise ValueError("the report data block is incomplete")
    data = json.loads(text[open_fence + 7:close_fence])
    if data.get("format") != REPORT_FORMAT:
        raise ValueError("unknown report format %r" % data.get("format"))
    markers = [{key: value for key, value in marker.items() if key not in ("state", "images")} for marker in data["markers"]]
    return {"gallery": data["gallery"], "reporter": data.get("reporter") or "anonymous",
            "exported": data.get("exported", ""), "markers": markers}


def read_paths(paths):
    """(source, text) for each report file named, and each .md / .txt file in a named folder."""
    files = []
    for path in paths:
        if os.path.isdir(path):
            files += [os.path.join(path, name) for name in sorted(os.listdir(path)) if name.lower().endswith((".md", ".txt"))]
        else:
            files.append(path)
    sources = []
    for path in files:
        with open(path, encoding="utf-8") as handle:
            sources.append((path, handle.read()))
    return sources


def read_github(repo, label):
    """(source, text) for each open issue body of the repo and each .md / .txt file attached to it."""
    command = ["gh", "issue", "list", "--repo", repo, "--state", "open", "--limit", "500", "--json", "number,body"]
    if label:
        command += ["--label", label]
    issues = json.loads(subprocess.run(command, check=True, capture_output=True, encoding="utf-8").stdout)
    sources = []
    for issue in issues:
        where = "%s#%d" % (repo, issue["number"])
        body = issue["body"] or ""
        sources.append((where, body))
        for url in ATTACHMENT.findall(body):
            if not url.lower().endswith((".md", ".txt")):
                continue
            try:
                with urllib.request.urlopen(url, timeout=30) as response:
                    sources.append((where + " " + url.rsplit("/", 1)[-1], response.read().decode("utf-8")))
            except OSError as error:
                print("skipped %s %s: %s" % (where, url, error), file=sys.stderr)
    return sources


# ==================================================================================
# Merging
# ==================================================================================

def state(marker, version):
    """The viewer's rule (viewer/markers.js state)."""
    if marker.get("status") == "fixed":
        return "fixed"
    return "needs-verification" if marker.get("verifiedVersion", 0) < version else "open"


def merge(reports):
    """One copy per marker id, the one changed last; each copy keeps the reporter of the report that carried it."""
    merged = OrderedDict()
    for report in reports:
        for marker in report["markers"]:
            current = merged.get(marker["id"])
            if current is None or marker.get("updated", "") > current.get("updated", ""):
                merged[marker["id"]] = dict(marker, reporter=report["reporter"])
    return list(merged.values())


# ==================================================================================
# Measuring: the widget under a marker, in Native (A) and in Flattened (B)
# ==================================================================================
#
# A marker says where, and what the reviewer saw; a style pass needs which property differs and by
# how much. The widget under the point (in each capture: two widgets when the point lands on
# different ones) is compared with the same widget on the other side. Position and size come from
# the gallery's widget maps, so they are always there; font and colours come from the capture
# harness dumps when --dumps names their root (<root>/<set>/<App>/qss|flat/<screen>.widgets.json).
# Colours are the widget's own background and text: on Native those are what the legacy
# stylesheet's background-color and color set. All values are logical pixels.

COLOUR_ROLES = (("Window", "background"), ("WindowText", "text colour"))


def load_map(path):
    """A gallery widget map as (nodes, dpr); node = {class, name, parent, rect}."""
    with open(path, encoding="utf-8") as handle:
        text = handle.read()
    data = json.loads(text[text.index("] = ") + 4:text.rindex(";")])
    nodes = [{"class": data["classes"][row[5]].split(" < ")[0], "name": row[6], "parent": row[4], "rect": row[:4]}
             for row in data["widgets"]]
    return nodes, data.get("dpr", 1)


def load_dump(path):
    """The widgets a capture drew, from its harness dump, as nodes with font and palette; None if missing."""
    if not os.path.isfile(path):
        return None
    with open(path, encoding="utf-8") as handle:
        widgets = drawn_widgets(json.load(handle))
    index_of = {widget["id"]: index for index, widget in enumerate(widgets)}
    return [{"class": widget["classes"][0], "name": widget.get("name", ""), "parent": index_of.get(widget.get("parent"), -1),
             "rect": widget["geometry"], "font": widget.get("font", {}), "palette": widget.get("palette", {})}
            for widget in widgets]


def widget_keys(nodes):
    """A key per node that names the same widget in both captures: its chain of class#name from the
    root, numbered where siblings share class and name. Parents come before their children."""
    keys, seen = [], {}
    for node in nodes:
        base = (keys[node["parent"]] if node["parent"] >= 0 else "") + "/" + node["class"] + "#" + node["name"]
        seen[base] = seen.get(base, 0) + 1
        keys.append("%s[%d]" % (base, seen[base] - 1))
    return keys


def node_at(nodes, dpr, x, y):
    """Index of the deepest node holding image point (x, y), ties to the later one (the viewer's rule)."""
    x, y = x / dpr, y / dpr
    best, best_depth, depth = None, -1, []
    for index, node in enumerate(nodes):
        depth.append(depth[node["parent"]] + 1 if node["parent"] >= 0 else 0)
        left, top, width, height = node["rect"]
        if left <= x < left + width and top <= y < top + height and depth[index] >= best_depth:
            best, best_depth = index, depth[index]
    return best


def load_screen(pair_id, pair, root, dumps_root):
    """Both sides of one screen: map nodes with their keys, and the dump nodes by key when found."""
    app, screen = pair_id.split("/", 1)
    sides = {}
    for side in "AB":
        info = pair[side.lower()]
        nodes, dpr = load_map(os.path.join(root, info["widgets"]))
        keys = widget_keys(nodes)
        dump = None
        if dumps_root:
            dump = load_dump(os.path.join(dumps_root, info["source"], app, "qss" if side == "A" else "flat", screen + ".widgets.json"))
        sides[side] = {"nodes": nodes, "dpr": dpr, "keys": keys, "index": {key: i for i, key in enumerate(keys)},
                       "dump": dict(zip(widget_keys(dump), dump)) if dump else {}}
    sides["typical"] = typical_changes(sides["A"]["dump"], sides["B"]["dump"])
    return sides


def typical_changes(dump_a, dump_b):
    """The commonest A -> B change of each colour role over the screen: the window-wide palette
    swap, which says nothing about one widget."""
    typical = {}
    for role, _ in COLOUR_ROLES:
        changes = Counter((node["palette"].get(role), dump_b[key]["palette"].get(role)) for key, node in dump_a.items() if key in dump_b)
        if changes:
            typical[role] = changes.most_common(1)[0][0]
    return typical


def side_node(side, key):
    """The widget with this key on one side: its map node, plus font and palette from the dump."""
    if key not in side["index"]:
        return None
    node = dict(side["nodes"][side["index"][key]])
    dumped = side["dump"].get(key)
    if dumped:
        node.update(font=dumped["font"], palette=dumped["palette"])
    return node


def colour(value):
    """'#ffrrggbb' -> '#rrggbb'; fully transparent -> 'transparent'."""
    if not value or len(value) != 9:
        return str(value)
    if value[1:3] == "ff":
        return "#" + value[3:]
    return "transparent" if value[1:3] == "00" else value


def font_text(font):
    """'Amazon Ember Light (drawn as Tahoma) 18px': the family asked for, the one Qt found, the size."""
    family = font.get("family", "?")
    drawn = font.get("resolvedFamily")
    text = family + (" (drawn as %s)" % drawn if drawn and drawn != family else "")
    text += " %spx" % font["px"] if font.get("px", -1) > 0 else " %spt" % font.get("pt")
    if font.get("weight", 400) != 400:
        text += " weight %s" % font["weight"]
    return text + (" italic" if font.get("italic") else "")


def differences(a, b, typical):
    """What differs between Native's and Flattened's copy of one widget, as short phrases."""
    found = []
    if list(a["rect"][:2]) != list(b["rect"][:2]):
        found.append("at %d,%d -> %d,%d" % (a["rect"][0], a["rect"][1], b["rect"][0], b["rect"][1]))
    if list(a["rect"][2:]) != list(b["rect"][2:]):
        found.append("size %dx%d -> %dx%d" % (a["rect"][2], a["rect"][3], b["rect"][2], b["rect"][3]))
    if "font" in a and "font" in b:
        if font_text(a["font"]) != font_text(b["font"]):
            found.append("font %s -> %s" % (font_text(a["font"]), font_text(b["font"])))
        for role, label in COLOUR_ROLES:
            change = (a["palette"].get(role), b["palette"].get(role))
            if change[0] != change[1] and change != typical.get(role):
                found.append("%s %s -> %s" % (label, colour(change[0]), colour(change[1])))
    return found


def measure(marker, screen):
    """For the widget under the marker in each capture (Flattened's first, the one being fixed; then
    Native's when the point lands on another widget there): what differs between its two copies."""
    found, seen = [], set()
    for side in "BA":
        index = node_at(screen[side]["nodes"], screen[side]["dpr"], marker["x"], marker["y"])
        if index is None or screen[side]["keys"][index] in seen:
            continue
        key = screen[side]["keys"][index]
        seen.add(key)
        node = screen[side]["nodes"][index]
        name = "`%s%s`" % (node["class"], "#" + node["name"] if node["name"] else "")
        if side == "A":
            name += " (Native's widget here)"
        a, b = side_node(screen["A"], key), side_node(screen["B"], key)
        if a is None or b is None:
            found.append("%s: only in %s" % (name, "Native" if b is None else "Flattened"))
        else:
            changes = differences(a, b, screen["typical"])
            found.append("%s: %s" % (name, "; ".join(changes) if changes else "no difference"))
    return found


def measure_all(markers, manifest, root, dumps_root):
    """{marker id: phrases} for every marker whose screen is in the gallery with both widget maps."""
    screens, measured = {}, {}
    for marker in markers:
        pair = manifest["pairs"].get(marker["pair"])
        if not pair or not pair["a"].get("widgets") or not pair["b"].get("widgets"):
            continue
        if marker["pair"] not in screens:
            screens[marker["pair"]] = load_screen(marker["pair"], pair, root, dumps_root)
        measured[marker["id"]] = measure(marker, screens[marker["pair"]])
    return measured


# ==================================================================================
# Digest
# ==================================================================================

def cell(text):
    """A Markdown table cell: one line, pipes and backticks escaped."""
    return str(text or "").replace("|", "\\|").replace("\r", "").replace("\n", " ").replace("`", "\\`")


def widget_class(marker):
    """The class of the widget under the marker in B (the side under review), else in A."""
    widgets = marker.get("widgets") or {}
    widget = widgets.get("B") or widgets.get("A")
    return widget.get("className", "?") if widget else "(no widget)"


def widget_cell(marker):
    """B's widget path, and A's when it differs (the same pixel on another widget: a layout shift)."""
    widgets = marker.get("widgets") or {}
    a, b = [(widget.get("path") or widget.get("className", "?")) if widget else "" for widget in (widgets.get("A"), widgets.get("B"))]
    text = b if not a or a == b else ("%s (A: %s)" % (b, a) if b else "A: " + a)
    return "`%s`" % text.replace("|", "\\|") if text else "-"


def digest(markers, reports, manifest, version, measured=None, dumps=False):
    """Markdown: totals, the widget classes that still have markers, then each screen with its markers
    and, when measured, what differs under each one."""
    pairs = manifest["pairs"]
    order = {pair_id: index for index, pair_id in enumerate(pairs)}
    tally = {name: sum(1 for marker in markers if state(marker, version) == name) for name in STATES}
    live = [marker for marker in markers if state(marker, version) != "fixed"]

    lines = ["# O3DE GUI A/B report digest", ""]
    lines.append("- Gallery: %s (`%s`), version %d" % (manifest["title"], manifest["id"], version))
    lines.append("- Reports: %d, from %s" % (len(reports), ", ".join(sorted({report["reporter"] for report in reports})) or "nobody"))
    lines.append("- Markers: %d (open %d, needs verification %d, fixed %d)"
                 % (len(markers), tally["open"], tally["needs-verification"], tally["fixed"]))
    if measured is not None:
        lines.append("- Measured: the widget under each crosshair, Native (A) -> Flattened (B), logical px. Position and size from "
                     "the gallery's widget maps; " + ("fonts and colours from the capture dumps" if dumps else "run with --dumps <capture root> for fonts and colours"))
    lines.append("")

    # ---- widget classes: where a style pass starts
    lines += ["## Widget classes with open markers", "",
              "Open and needs-verification markers, by the class of the widget under each crosshair in B.", ""]
    lines += ["| Widget class | Markers | Screens | Reporters |", "|---|---|---|---|"]
    by_class = OrderedDict()
    for marker in live:
        by_class.setdefault(widget_class(marker), []).append(marker)
    for name, group in sorted(by_class.items(), key=lambda item: (-len(item[1]), item[0])):
        lines.append("| `%s` | %d | %d | %d |" % (name.replace("|", "\\|"), len(group), len({m["pair"] for m in group}), len({m["reporter"] for m in group})))
    lines.append("")

    # ---- screens, in gallery order; screens no longer in the gallery last
    lines += ["## Screens", ""]
    by_pair = OrderedDict()
    for marker in sorted(markers, key=lambda m: (order.get(m["pair"], len(order)), m["pair"], STATES.index(state(m, version)), m.get("created", ""))):
        by_pair.setdefault(marker["pair"], []).append(marker)
    for pair_id, group in by_pair.items():
        pair = pairs.get(pair_id)
        lines.append("### " + ("%s / %s" % (pair["app"], pair["title"]) if pair else "%s (not in this gallery)" % pair_id))
        lines.append("")
        if pair:
            lines.append("A: `%s`  \nB: `%s`" % (pair["a"]["image"], pair["b"]["image"]))
            lines.append("")
        lines += ["| # | State | Point (px) | Widget | Reporter | Description |", "|---|---|---|---|---|---|"]
        for number, marker in enumerate(group, 1):
            lines.append("| %d | %s | %s, %s | %s | %s | %s |" % (number, state(marker, version), marker["x"], marker["y"],
                         widget_cell(marker), cell(marker["reporter"]), cell(marker.get("note"))))
        lines.append("")
        if measured:
            lines += ["Measured, Native -> Flattened:", ""]
            for number, marker in enumerate(group, 1):
                lines.append("- **%d**: %s" % (number, " ".join(phrase + "." for phrase in measured.get(marker["id"], ["not measured"]))))
            lines.append("")
    return "\n".join(lines)


def as_json(markers, reports, manifest, version, measured=None, dumps=False):
    """The merged markers with their current state, images and measurements, plus where they came from."""
    def images(marker):
        pair = manifest["pairs"].get(marker["pair"])
        return {"A": pair["a"]["image"], "B": pair["b"]["image"]} if pair else None
    return json.dumps({
        "gallery": {"id": manifest["id"], "version": version},
        "reports": [{"source": r["source"], "reporter": r["reporter"], "exported": r["exported"], "version": r["gallery"].get("version")} for r in reports],
        "markers": [dict(marker, state=state(marker, version), images=images(marker), measured=(measured or {}).get(marker["id"], []))
                    for marker in markers],
    }, indent=1, ensure_ascii=False)


# ==================================================================================
# Main
# ==================================================================================

def main():
    parser = argparse.ArgumentParser(description="Merge exported A/B reports into one digest.")
    parser.add_argument("paths", nargs="*", help="report files, or folders holding them")
    parser.add_argument("--github", metavar="OWNER/REPO", help="also read the open issues of this repo (needs gh, read only)")
    parser.add_argument("--label", help="with --github: only issues with this label")
    parser.add_argument("--dumps", metavar="DIR", help="capture root the gallery was imported from (<set>/<App>/qss|flat/...), "
                                                         "to measure fonts and colours too")
    parser.add_argument("--json", action="store_true", help="print the merged markers as JSON")
    parser.add_argument("--out", help="write to this file instead of printing")
    args = parser.parse_args()
    if not args.paths and not args.github:
        parser.error("name report files or folders, or --github OWNER/REPO")

    manifest, version = load_gallery(REPO)
    sources = read_paths(args.paths) + (read_github(args.github, args.label) if args.github else [])
    reports = []
    for source, text in sources:
        try:
            report = parse_report(text)
        except (ValueError, KeyError, TypeError) as error:
            print("skipped %s: %s" % (source, error), file=sys.stderr)
            continue
        if report["gallery"].get("id") != manifest["id"]:
            print("skipped %s: made for gallery %s, not %s" % (source, report["gallery"].get("id"), manifest["id"]), file=sys.stderr)
            continue
        report["source"] = source
        reports.append(report)

    markers = merge(reports)
    measured = measure_all(markers, manifest, REPO, args.dumps)
    output = (as_json if args.json else digest)(markers, reports, manifest, version, measured, bool(args.dumps))
    if args.out:
        with open(args.out, "w", encoding="utf-8", newline="\n") as handle:
            handle.write(output + "\n")
    else:
        sys.stdout.reconfigure(encoding="utf-8")        # notes can hold any character, the Windows console code page cannot
        print(output)
    print("%d markers from %d reports" % (len(markers), len(reports)), file=sys.stderr)


if __name__ == "__main__":
    main()
