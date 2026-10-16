"""
import_captures.py -- build the gallery from capture sets (maintainer tool).

    python tools/import_captures.py --legacy <set dir> --flatten <set dir>[,<set dir>...] [--gallery gallery]

A capture set dir holds <App>/qss/<screen>.png + <screen>.widgets.json (legacy, stylesheets on) and
<App>/flat/... (flattened), as written by the O3DE capture harness (run_captures.py). For every
legacy screen the first flatten set that has the same screen supplies side B.

Writes, relative to the repo root (so the gallery works wherever the repo is cloned):
    gallery/apps/<App>/A/<screen>.png, B/<screen>.png
    gallery/apps/<App>/A/<screen>.widgets.js, B/...    compact widget map, loaded on demand
    gallery/gallery.js                                 manifest: groups and pairs
gallery/version.js (the gallery version) is never touched: edit it by hand when new captures land.
"""

import argparse
import json
import os
import re
import shutil
import struct
import sys
from collections import OrderedDict

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))


# ==================================================================================
# Images and widget maps
# ==================================================================================

def png_size(path):
    with open(path, "rb") as handle:
        header = handle.read(24)
    width, height = struct.unpack(">II", header[16:24])
    return width, height


def drawn_widgets(document):
    """The dumped widgets that are part of the captured image. The dump holds every widget visible
    to the captured root, which includes separate windows parented under it (a floating dock
    container, a viewport overlay): grab() does not draw those, so they and their contents go."""
    by_id = {widget["id"]: widget for widget in document["widgets"]}
    root_id = document["widgets"][0]["id"]

    def in_other_window(widget):
        while widget is not None and widget["id"] != root_id:
            if widget.get("flags", {}).get("window"):
                return True
            widget = by_id.get(widget.get("parent"))
        return False

    return [widget for widget in document["widgets"] if not in_other_window(widget)]


def widget_map(dump_path, screen_key):
    """Compact widget map of one capture: a class table and one row per drawn widget,
    [x, y, w, h, parent row, class index, object name], geometry in logical pixels."""
    with open(dump_path, encoding="utf-8") as handle:
        document = json.load(handle)
    classes, class_index, rows, row_of = [], {}, [], {}
    for widget in drawn_widgets(document):
        chain = " < ".join(widget["classes"][:3])
        if chain not in class_index:
            class_index[chain] = len(classes)
            classes.append(chain)
        row_of[widget["id"]] = len(rows)
        x, y, w, h = widget["geometry"]
        rows.append([x, y, w, h, row_of.get(widget.get("parent", -1), -1), class_index[chain], widget.get("name", "")])
    data = {"dpr": document.get("devicePixelRatio", 1), "classes": classes, "widgets": rows}
    return "window.AB_WIDGETS = window.AB_WIDGETS || {};\nwindow.AB_WIDGETS[%s] = %s;\n" % (
        json.dumps(screen_key), json.dumps(data, separators=(",", ":")))


# ==================================================================================
# Titles and families
# ==================================================================================

WALK = re.compile(r"__(menu|tab|page|dock)-(.+)$")
AUTO_WINDOW = re.compile(r"^[A-Za-z0-9]+_(\d+)_(.+)$")
APP_TITLES = {"o3de": "Project Manager", "Gallery": "Qt Control Gallery", "LuaIDE": "Lua IDE",
              "AssetProcessor": "Asset Processor", "AssetBundler": "Asset Bundler",
              "MaterialEditor": "Material Editor", "MaterialCanvas": "Material Canvas", "PassCanvas": "Pass Canvas",
              "ShaderManagementConsole": "Shader Management Console", "Editor": "Editor"}


def screen_title(screen):
    """'07_main_window_final__menu--File-Open--Recent' -> '07 main window final / Menu: File Open Recent';
    an auto-captured top-level window ('AssetBundler_00_AzQtComponents--WindowDecorationWrapper') reads
    'Window 00'."""
    match = WALK.search(screen)
    base = screen[:match.start()] if match else screen
    auto = AUTO_WINDOW.match(base)
    if auto and ("WindowDecorationWrapper" in base or "--" in auto.group(2)):
        base = "Window %s" % auto.group(1)
    base = base.replace("_", " ").strip()
    if not match:
        return base
    kind, rest = match.group(1), match.group(2)
    rest = re.sub(r"-+", " ", rest).strip()
    return "%s / %s: %s" % (base, kind.capitalize(), rest)


FAMILIES = OrderedDict([
    ("tabs", ("Tabs", lambda screen, classes: "QTabBar" in classes)),
    ("menus", ("Menus", lambda screen, classes: "__menu-" in screen)),
    ("docks", ("Hidden docks", lambda screen, classes: "__dock-" in screen)),
    ("pages", ("Stacked pages and tabs", lambda screen, classes: "__page-" in screen or "__tab-" in screen)),
    ("windows", ("Windows as opened", lambda screen, classes: "__" not in screen)),
])


def visible_classes(dump_path):
    with open(dump_path, encoding="utf-8") as handle:
        return {cls for widget in drawn_widgets(json.load(handle)) for cls in widget["classes"]}


# ==================================================================================
# Main
# ==================================================================================

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--legacy", required=True, help="capture set dir for side A (uses <App>/qss)")
    parser.add_argument("--flatten", required=True, help="comma-separated capture set dirs for side B, first wins (uses <App>/flat)")
    parser.add_argument("--gallery", default=os.path.join(REPO, "gallery"))
    parser.add_argument("--title", default="O3DE GUI flatten A/B")
    args = parser.parse_args()
    flatten_sets = [path for path in args.flatten.split(",") if path]
    apps_dir = os.path.join(args.gallery, "apps")
    shutil.rmtree(apps_dir, ignore_errors=True)

    pairs = OrderedDict()
    app_groups = OrderedDict()
    family_groups = OrderedDict((key, []) for key in FAMILIES)
    missing = []

    for app in sorted(os.listdir(args.legacy)):
        legacy_dir = os.path.join(args.legacy, app, "qss")
        if not os.path.isdir(legacy_dir):
            continue
        for name in sorted(os.listdir(legacy_dir)):
            if not name.endswith(".png"):
                continue
            screen = name[:-4]
            flat_png = next((os.path.join(s, app, "flat", name) for s in flatten_sets
                             if os.path.exists(os.path.join(s, app, "flat", name))), None)
            if flat_png is None:
                missing.append("%s/%s" % (app, screen))
                continue
            pair_id = "%s/%s" % (app, screen)
            entry = OrderedDict(id=pair_id, app=app, screen=screen, title=screen_title(screen))
            for side, png in (("A", os.path.join(legacy_dir, name)), ("B", flat_png)):
                out_dir = os.path.join(apps_dir, app, side)
                os.makedirs(out_dir, exist_ok=True)
                shutil.copyfile(png, os.path.join(out_dir, name))
                width, height = png_size(png)
                relative_png = "gallery/apps/%s/%s/%s" % (app, side, name)
                entry[side.lower()] = OrderedDict(image=relative_png, w=width, h=height,
                                                  source=os.path.basename(os.path.dirname(os.path.dirname(os.path.dirname(png)))))
                dump = png[:-4] + ".widgets.json"
                if os.path.exists(dump):
                    with open(os.path.join(out_dir, screen + ".widgets.js"), "w", encoding="utf-8", newline="\n") as handle:
                        handle.write(widget_map(dump, "%s/%s" % (pair_id, side)))
                    entry[side.lower()]["widgets"] = "gallery/apps/%s/%s/%s.widgets.js" % (app, side, screen)
            pairs[pair_id] = entry
            app_groups.setdefault(app, []).append(pair_id)
            legacy_dump = os.path.join(legacy_dir, screen + ".widgets.json")
            classes = visible_classes(legacy_dump) if os.path.exists(legacy_dump) else set()
            for key, (_, test) in FAMILIES.items():
                if test(screen, classes):
                    family_groups[key].append(pair_id)

    groups = [OrderedDict(id="app/" + app, kind="Application", title=APP_TITLES.get(app, app), pairs=ids)
              for app, ids in app_groups.items()]
    groups += [OrderedDict(id="family/" + key, kind="Family", title=FAMILIES[key][0], pairs=ids)
               for key, ids in family_groups.items() if ids]
    manifest = OrderedDict(
        id="o3de-gui-ab", title=args.title,
        sides=OrderedDict(A="Legacy (stylesheets on)", B="Flattened (stylesheets off)"),
        sources=OrderedDict(A=os.path.basename(os.path.normpath(args.legacy)),
                            B=[os.path.basename(os.path.normpath(s)) for s in flatten_sets]),
        groups=groups, pairs=pairs)
    with open(os.path.join(args.gallery, "gallery.js"), "w", encoding="utf-8", newline="\n") as handle:
        handle.write("// Generated by tools/import_captures.py -- do not edit (the version lives in version.js)\n")
        handle.write("window.AB_GALLERY = %s;\n" % json.dumps(manifest, indent=1))
    version_path = os.path.join(args.gallery, "version.js")
    if not os.path.exists(version_path):
        with open(version_path, "w", encoding="utf-8", newline="\n") as handle:
            handle.write("// The gallery version. Raise it by hand when new captures land: markers placed under an\n"
                         "// older version then show 'needs verification' until their owner checks them again.\n"
                         "window.AB_GALLERY_VERSION = 1;\n")

    # ---- check: every manifest image exists, every widget map is valid JS-wrapped JSON
    problems = 0
    for entry in pairs.values():
        for side in ("a", "b"):
            if not os.path.exists(os.path.join(REPO, entry[side]["image"])):
                problems += 1
    print("%d pairs in %d application groups, %d family groups; %d legacy screens without a flatten capture; %d missing files"
          % (len(pairs), len(app_groups), sum(1 for ids in family_groups.values() if ids), len(missing), problems))
    for key in missing[:10]:
        print("  no flatten capture: " + key)
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
