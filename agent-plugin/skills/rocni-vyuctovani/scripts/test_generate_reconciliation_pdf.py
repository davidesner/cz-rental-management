"""Testy loaderu a rozlišení výstupní cesty. Spusť: python3 -m unittest -v"""
import json
import tempfile
import unittest
from decimal import Decimal
from pathlib import Path

from generate_reconciliation_pdf import load_reconciliation, resolve_output_path


def _write(tmpdir, payload):
    p = Path(tmpdir) / "data.json"
    p.write_text(json.dumps(payload), encoding="utf-8")
    return p


class LoadReconciliationTest(unittest.TestCase):
    def test_desetinna_cisla_jsou_decimal(self):
        with tempfile.TemporaryDirectory() as td:
            path = _write(td, {"result": {"amount_kc": 1234.50}})
            data = load_reconciliation(path)
            self.assertEqual(data["result"]["amount_kc"], Decimal("1234.50"))
            self.assertIsInstance(data["result"]["amount_kc"], Decimal)

    def test_cela_cisla_zustavaji_int(self):
        with tempfile.TemporaryDirectory() as td:
            path = _write(td, {"sheets": [{"type": "services", "columns": 3}]})
            data = load_reconciliation(path)
            self.assertIsInstance(data["sheets"][0]["columns"], int)

    def test_decimal_prezije_i_vnoreny_v_seznamu(self):
        with tempfile.TemporaryDirectory() as td:
            path = _write(td, {"rows": [["Voda", 100.00], ["Teplo", 250.25]]})
            data = load_reconciliation(path)
            self.assertEqual(data["rows"][1][1], Decimal("250.25"))

    def test_chybejici_soubor_hlasi_srozumitelnou_chybu(self):
        with self.assertRaises(FileNotFoundError):
            load_reconciliation(Path("/nope/chybi.json"))


class ResolveOutputPathTest(unittest.TestCase):
    def test_out_dir_prebije_adresar_ale_zachova_jmeno(self):
        data = {"output_path": "puvodni/misto/Vyuctovani_2025.pdf"}
        got = resolve_output_path(data, Path("/cil/vyuctovani/2025"))
        self.assertEqual(got, Path("/cil/vyuctovani/2025/Vyuctovani_2025.pdf"))

    def test_bez_out_dir_zustava_output_path(self):
        data = {"output_path": "Vyuctovani_2025.pdf"}
        got = resolve_output_path(data, None)
        self.assertEqual(got, Path("Vyuctovani_2025.pdf"))


if __name__ == "__main__":
    unittest.main()
