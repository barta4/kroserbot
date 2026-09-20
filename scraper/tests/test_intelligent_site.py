"""Tests unitarios para el motor de navegación inteligente anti-bloqueo."""

from __future__ import annotations

import unittest
from unittest.mock import MagicMock, patch

import requests

from scraper.site import (
    BROWSER_PROFILES,
    BlockedError,
    IntelligentPacer,
    SiteClient,
    robots_allows,
)


class TestIntelligentPacer(unittest.TestCase):
    def test_pacer_no_sleep(self):
        pacer = IntelligentPacer(no_sleep=True)
        self.assertEqual(pacer.calculate_delay(), 0.0)
        self.assertIsNone(pacer.tick_and_pause_if_needed())

    def test_pacer_gaussian_bounds(self):
        pacer = IntelligentPacer(min_delay=2.0, max_delay=4.0)
        delays = [pacer.calculate_delay() for _ in range(50)]
        # Todos deben estar dentro del rango acotado
        for d in delays:
            self.assertGreaterEqual(d, 1.4)
            self.assertLessEqual(d, 5.2)

    def test_pacer_latency_adaptation(self):
        pacer = IntelligentPacer(min_delay=2.0, max_delay=4.0)
        initial_mult = pacer.latency_multiplier
        # Servidor lento -> aumenta multiplicador
        pacer.report_latency(2.5)
        self.assertGreater(pacer.latency_multiplier, initial_mult)

        # Servidor rápido -> reduce multiplicador
        pacer.report_latency(0.2)
        self.assertLess(pacer.latency_multiplier, 2.5)

    def test_pacer_natural_reading_pause(self):
        pacer = IntelligentPacer()
        pacer.next_reading_pause = 3
        self.assertIsNone(pacer.tick_and_pause_if_needed())
        self.assertIsNone(pacer.tick_and_pause_if_needed())
        pause = pacer.tick_and_pause_if_needed()
        self.assertIsNotNone(pause)
        self.assertGreaterEqual(pause, 10.0)


class TestSiteClientIntelligence(unittest.TestCase):
    def test_browser_profiles_have_required_fields(self):
        for prof in BROWSER_PROFILES:
            self.assertIn("ua", prof)
            self.assertIn("platform", prof)
            self.assertTrue(prof["ua"].startswith("Mozilla/5.0"))

    def test_session_headers_complete(self):
        client = SiteClient(no_sleep=True)
        headers = client.session.headers
        self.assertIn("User-Agent", headers)
        self.assertIn("Accept", headers)
        self.assertIn("Accept-Language", headers)
        self.assertIn("Sec-Fetch-Dest", headers)
        self.assertIn("Sec-Fetch-Mode", headers)
        self.assertEqual(headers["Sec-Fetch-Mode"], "navigate")

    @patch("requests.Session.get")
    def test_dynamic_referer_chaining(self, mock_get):
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.text = "<html>Ficha 1</html>"
        mock_get.return_value = mock_response

        client = SiteClient(no_sleep=True)
        # 1er request -> Referer inicial por defecto /catalogo
        client.get_html("/catalogo/producto-1")
        first_call_headers = mock_get.call_args[1]["headers"]
        self.assertEqual(first_call_headers["Referer"], "https://www.kroser.com.uy/catalogo")

        # 2do request -> Referer debe encadenar producto-1
        client.get_html("/catalogo/producto-2")
        second_call_headers = mock_get.call_args[1]["headers"]
        self.assertEqual(second_call_headers["Referer"], "https://www.kroser.com.uy/catalogo/producto-1")

    @patch("requests.Session.get")
    def test_auto_recovery_on_remote_disconnected(self, mock_get):
        # Simula caída de TCP (RemoteDisconnected / ConnectionError) en intento 1, y éxito en intento 2
        mock_success = MagicMock()
        mock_success.status_code = 200
        mock_success.text = "<html>Recuperado</html>"

        mock_get.side_effect = [
            requests.exceptions.ConnectionError("Remote end closed connection without response"),
            mock_success,
        ]

        client = SiteClient(no_sleep=True)
        html = client.get_html("/catalogo/producto-test")
        self.assertEqual(html, "<html>Recuperado</html>")
        self.assertEqual(mock_get.call_count, 2)

    @patch("requests.Session.get")
    def test_robots_allows_graceful_on_error(self, mock_get):
        mock_get.side_effect = requests.exceptions.RequestException("DNS failure")
        self.assertTrue(robots_allows("https://www.kroser.com.uy"))


if __name__ == "__main__":
    unittest.main()
