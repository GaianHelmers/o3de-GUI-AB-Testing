"""
Run: python tests/test_read_reports.py   (standard library only)

Reads the sample reports in tests/fixtures, which tests/markers.test.js keeps equal to what the
viewer exports, so this also proves the viewer's writer and this reader agree on the format.
Measuring runs on a small screen captured twice, written with import_captures.widget_map, so the
widget maps it reads are the importer's own.
"""

import json
import os
import shutil
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "tools"))
import import_captures  # noqa: E402
import read_reports as R  # noqa: E402

GALLERY = {
    "id": "test-gallery",
    "title": "Test",
    "pairs": {
        "Editor/01_main_window": {"app": "Editor", "title": "01 main window", "a": {"image": "a.png"}, "b": {"image": "b.png"}},
        "Gallery/02_buttons": {"app": "Gallery", "title": "02 buttons", "a": {"image": "ga.png"}, "b": {"image": "gb.png"}},
    },
}


def sample(name):
    with open(os.path.join(HERE, "fixtures", name), encoding="utf-8") as handle:
        report = R.parse_report(handle.read())
    report["source"] = name
    return report


# ==================================================================================
# Reading, merging, digest
# ==================================================================================

class ReadReports(unittest.TestCase):

    def setUp(self):
        self.reports = [sample("report-alice.md"), sample("report-bob.md")]
        self.markers = {marker["id"]: marker for marker in R.merge(self.reports)}

    def test_reports_parse(self):
        self.assertEqual([r["reporter"] for r in self.reports], ["alice", "bob"])
        self.assertEqual([r["gallery"]["version"] for r in self.reports], [1, 2])
        self.assertEqual(self.markers["m-b1"]["note"], "fence ``` inside a note\nsecond line")

    def test_the_same_marker_counts_once_newest_copy_wins(self):
        self.assertEqual(sorted(self.markers), ["m-a1", "m-a2", "m-b1", "m-shared"])
        self.assertEqual(self.markers["m-shared"]["note"], "newer note")
        self.assertEqual(self.markers["m-shared"]["reporter"], "bob")

    def test_states_follow_the_current_version(self):
        states = {marker_id: R.state(marker, 2) for marker_id, marker in self.markers.items()}
        self.assertEqual(states, {"m-a1": "needs-verification", "m-a2": "fixed", "m-shared": "open", "m-b1": "open"})

    def test_digest(self):
        text = R.digest(list(self.markers.values()), self.reports, GALLERY, 2, {"m-shared": ["`QLabel#title`: no difference"]})
        self.assertIn("- Reports: 2, from alice, bob", text)
        self.assertIn("- Markers: 4 (open 2, needs verification 1, fixed 1)", text)
        self.assertIn("| `AzQtComponents::TabBar` | 2 | 1 | 2 |", text)        # m-a1 (alice) and m-shared (bob), fixed m-a2 left out
        self.assertIn("| 1 | open | 40, 18 | `QMainWindow#main > AzQtComponents::TabBar (A: QMainWindow#main > QLabel#title)` | bob | newer note |", text)
        self.assertIn("- **1**: `QLabel#title`: no difference.", text)
        self.assertIn("- **2**: not measured.", text)
        self.assertIn("tab text clipped \\| right edge", text)
        self.assertIn("fence \\`\\`\\` inside a note second line", text)
        self.assertLess(text.index("### Editor / 01 main window"), text.index("### Gallery / 02 buttons"))

    def test_files_without_report_data_are_refused(self):
        with self.assertRaises(ValueError):
            R.parse_report("# just notes")


# ==================================================================================
# Measuring
# ==================================================================================

def widget(number, parent, class_name, name, geometry, px=12, family="Open Sans", drawn=None, background="#ff444444"):
    """One widget as the capture harness dumps it."""
    return {"id": number, "parent": parent, "classes": [class_name, "QWidget"], "name": name, "geometry": geometry,
            "flags": {"window": parent < 0}, "palette": {"Window": background, "WindowText": "#ffcccccc"},
            "font": {"family": family, "resolvedFamily": drawn or family, "px": px, "weight": 400, "italic": False}}


class Measuring(unittest.TestCase):
    """A window with two labels, captured twice. In Flattened the title label moved, shrank, lost its
    18px font and its dark background; everything else only went through the window-wide palette
    swap (transparent -> #444444 backgrounds)."""

    def setUp(self):
        self.root = tempfile.mkdtemp()
        native = [widget(0, -1, "QWidget", "win", [0, 0, 400, 300], background="#00000000"),
                  widget(1, 0, "QLabel", "title", [10, 10, 200, 30], px=18, family="Amazon Ember Light", drawn="Tahoma", background="#ff1b1b1b"),
                  widget(2, 0, "QLabel", "other", [10, 50, 100, 20], background="#00000000")]
        flattened = [widget(0, -1, "QWidget", "win", [0, 0, 400, 300]),
                     widget(1, 0, "QLabel", "title", [12, 10, 150, 24]),
                     widget(2, 0, "QLabel", "other", [10, 50, 100, 20])]
        pair = {"app": "App", "title": "s", "a": self.capture("A", "qss", native), "b": self.capture("B", "flat", flattened)}
        self.manifest = {"pairs": {"App/s": pair}}

    def tearDown(self):
        shutil.rmtree(self.root)

    def capture(self, side, folder, widgets):
        """The harness dump under <root>/dumps/set1/App/<folder>/, and the gallery widget map made from it."""
        dump = os.path.join(self.root, "dumps", "set1", "App", folder, "s.widgets.json")
        os.makedirs(os.path.dirname(dump))
        with open(dump, "w", encoding="utf-8") as handle:
            json.dump({"devicePixelRatio": 1, "widgets": widgets}, handle)
        widget_map = "gallery/apps/App/%s/s.widgets.js" % side
        os.makedirs(os.path.join(self.root, os.path.dirname(widget_map)))
        with open(os.path.join(self.root, widget_map), "w", encoding="utf-8") as handle:
            handle.write(import_captures.widget_map(dump, "App/s/" + side))
        return {"image": "s.png", "w": 400, "h": 300, "source": "set1", "widgets": widget_map}

    def measured(self, x, y, dumps=True):
        marker = {"id": "m", "pair": "App/s", "x": x, "y": y}
        return R.measure_all([marker], self.manifest, self.root, os.path.join(self.root, "dumps") if dumps else None)["m"]

    def test_the_widget_under_the_point_is_compared_across_both_captures(self):
        self.assertEqual(self.measured(20, 15), ["`QLabel#title`: at 10,10 -> 12,10; size 200x30 -> 150x24; "
                                                 "font Amazon Ember Light (drawn as Tahoma) 18px -> Open Sans 12px; background #1b1b1b -> #444444"])

    def test_the_window_wide_palette_swap_is_not_news(self):
        self.assertEqual(self.measured(20, 55), ["`QLabel#other`: no difference"])

    def test_a_point_on_different_widgets_reports_both_flattened_first(self):
        self.assertEqual(self.measured(11, 12), [
            "`QWidget#win`: no difference",
            "`QLabel#title` (Native's widget here): at 10,10 -> 12,10; size 200x30 -> 150x24; "
            "font Amazon Ember Light (drawn as Tahoma) 18px -> Open Sans 12px; background #1b1b1b -> #444444"])

    def test_without_the_dumps_only_position_and_size(self):
        self.assertEqual(self.measured(20, 15, dumps=False), ["`QLabel#title`: at 10,10 -> 12,10; size 200x30 -> 150x24"])

    def test_siblings_sharing_class_and_name_are_numbered(self):
        nodes = [{"class": "QWidget", "name": "", "parent": -1}, {"class": "QLabel", "name": "", "parent": 0}, {"class": "QLabel", "name": "", "parent": 0}]
        self.assertEqual(R.widget_keys(nodes), ["/QWidget#[0]", "/QWidget#[0]/QLabel#[0]", "/QWidget#[0]/QLabel#[1]"])


if __name__ == "__main__":
    unittest.main(verbosity=2)
