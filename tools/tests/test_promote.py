import importlib.util
from pathlib import Path
from unittest.mock import patch
import unittest

spec = importlib.util.spec_from_file_location('promote', Path(__file__).resolve().parents[1] / 'promote_batch.py')
promote = importlib.util.module_from_spec(spec)
spec.loader.exec_module(promote)
OK = (200, {'content-type': 'text/html; charset=utf-8'}, b'<html><head></head><body>ok</body></html>', None)

class PromoteTests(unittest.TestCase):
    def test_foreign_and_denied_redirects(self):
        for host, target in [('news.example.co.jp', 'https://bank.other.co.jp/'), ('example.com', 'https://unrelatedexample.com/'), ('news.example.com', 'https://checkout.example.com/'), ('example.com', '//foreign.example/'), ('example.com', 'http://example.com/'), ('example.com', 'https://user@example.com/'), ('example.com', 'https://example.com:444/')]:
            with self.subTest(target=target), patch.object(promote, 'fetch', return_value=(302, {'location': target}, b'', None)) as fetch:
                self.assertNotEqual(promote.judge(host)[1], 'PASS')
                self.assertEqual(fetch.call_count, 1)

    def test_relative_redirect_preserves_query(self):
        with patch.object(promote, 'fetch', side_effect=[(302, {'location': '/public?p=2'}, b'', None), OK]) as fetch:
            self.assertEqual(promote.judge('example.com')[1], 'PASS')
            self.assertEqual(fetch.call_args.args[0], 'https://example.com/public?p=2')

    def test_meta_csp_and_decoding(self):
        for body in [b'<meta http-equiv="Content&#45;Security&#45;Policy" content="script-src none">', b'<meta charset="shift_jis">', b'<html>\xff</html>']:
            with self.subTest(body=body), patch.object(promote, 'fetch', return_value=(200, {'content-type': 'text/html'}, body, None)):
                self.assertEqual(promote.judge('example.com')[1], 'FAIL')

    def test_header_csp_and_connection_close(self):
        for header in [{'connection': 'close'}, {'content-security-policy': "script-src 'none'"}]:
            with patch.object(promote, 'fetch', return_value=(200, dict(OK[1], **header), OK[2], None)):
                self.assertEqual(promote.judge('example.com')[1], 'FAIL')

    def test_valid_response_and_invalid_host(self):
        with patch.object(promote, 'fetch', return_value=OK) as fetch:
            self.assertEqual(promote.judge('example.com')[1], 'PASS')
            fetch.reset_mock()
            for host in ['example.com/path', 'example.com@evil.test', '*.example.com', 'example.com:443']:
                self.assertEqual(promote.judge(host)[1], 'FAIL')
            fetch.assert_not_called()

if __name__ == '__main__':
    unittest.main()
