import importlib.util
import io
from pathlib import Path
from unittest.mock import patch
import unittest

spec = importlib.util.spec_from_file_location('convert', Path(__file__).resolve().parents[1] / 'convert_jp_filter.py')
convert = importlib.util.module_from_spec(spec)
spec.loader.exec_module(convert)

class ExceptionTests(unittest.TestCase):
    def convert(self, *sections):
        data = list(sections) + [''] * (len(convert.SECTIONS) - len(sections))
        with patch.object(convert.urllib.request, 'urlopen', side_effect=[io.BytesIO(s.encode()) for s in data]):
            return convert.convert('a' * 40)

    def test_cross_section_exception(self):
        domains, errors = self.convert('||shared.example^\n||safe.example^', '@@||shared.example^')
        self.assertEqual(domains, ['safe.example'])
        self.assertFalse(errors)

    def test_path_and_initiator_exception_protect_parent(self):
        domains, errors = self.convert('||socdm.com^\n||unrelatedsocdm.com^', '@@||d.socdm.com/adsv/v1?posall=$xmlhttprequest,domain=tver.jp')
        self.assertEqual(domains, ['unrelatedsocdm.com'])
        self.assertFalse(errors)

    def test_parent_exception_protects_child(self):
        self.assertEqual(self.convert('||ads.shared.example^\n@@||shared.example^')[0], [])

    def test_cosmetic_exception_does_not_unblock_network(self):
        self.assertEqual(self.convert('||shared.example^\n@@||shared.example^$generichide\n@@$generichide,domain=shared.example')[0], ['shared.example'])

    def test_unknown_exception_aborts_generation(self):
        _, errors = self.convert('||shared.example^\n@@/unknown-regex/')
        self.assertTrue(errors)

if __name__ == '__main__':
    unittest.main()
