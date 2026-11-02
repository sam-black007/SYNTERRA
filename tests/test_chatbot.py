"""
Unit and Integration Tests for SYNTERRA AI Agronomist Chatbot
"""

import sys
import unittest
from pathlib import Path

# Add project root to sys.path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app import create_app
from app.services.chatbot_service import chatbot_service


class TestChatbotService(unittest.TestCase):
    def setUp(self):
        self.app = create_app()
        self.app.config['TESTING'] = True
        self.client = self.app.test_client()

    def test_calculate_vpd(self):
        """Test calculation of Vapor Pressure Deficit (VPD)."""
        vpd = chatbot_service.calculate_vpd(25.0, 60.0)
        self.assertIsNotNone(vpd)
        self.assertAlmostEqual(vpd, 1.27, places=1)

        # None values check
        self.assertIsNone(chatbot_service.calculate_vpd(None, 60.0))
        self.assertIsNone(chatbot_service.calculate_vpd(25.0, None))

    def test_get_context_snapshot(self):
        """Test retrieval of live agronomic context."""
        with self.app.app_context():
            ctx = chatbot_service.get_context_snapshot()
            self.assertIn('telemetry', ctx)
            self.assertIn('weather', ctx)
            self.assertIn('diagnosis', ctx)
            self.assertIn('irrigation', ctx)

    def test_smart_suggestions(self):
        """Test dynamic generation of suggestion chips."""
        with self.app.app_context():
            sugs = chatbot_service.get_smart_suggestions()
            self.assertIsInstance(sugs, list)
            self.assertGreaterEqual(len(sugs), 2)
            for s in sugs:
                self.assertIsInstance(s, str)

    def test_ask_botanical_intents(self):
        """Test botanical inference engine for key agricultural intents."""
        with self.app.app_context():
            # Intent: Early Blight
            res_eb = chatbot_service.ask("What is the treatment for Early Blight?")
            self.assertTrue(res_eb['success'])
            self.assertTrue("blight" in res_eb['reply'].lower() or "fungicide" in res_eb['reply'].lower())

            # Intent: Irrigation
            res_irrig = chatbot_service.ask("Should I irrigate today?")
            self.assertTrue(res_irrig['success'])
            self.assertTrue("irrigation" in res_irrig['reply'].lower() or "irrigate" in res_irrig['reply'].lower())

            # Intent: VPD & Microclimate
            res_vpd = chatbot_service.ask("Analyze canopy VPD and humidity")
            self.assertTrue(res_vpd['success'])
            self.assertTrue("vpd" in res_vpd['reply'].lower() or "humidity" in res_vpd['reply'].lower())

            # Intent: Weather & Spore Risk
            res_w = chatbot_service.ask("Why is the fungal disease risk high?")
            self.assertTrue(res_w['success'])
            self.assertTrue("pathogen" in res_w['reply'].lower() or "risk" in res_w['reply'].lower())

    def test_api_chat_endpoint(self):
        """Test /api/chat POST route."""
        # Empty message validation
        res_empty = self.client.post('/api/chat', json={'message': ''})
        self.assertEqual(res_empty.status_code, 400)

        # Valid question
        res = self.client.post('/api/chat', json={'message': 'Give me a canopy health overview'})
        self.assertEqual(res.status_code, 200)
        data = res.get_json()
        self.assertTrue(data['success'])
        self.assertIn('reply', data)
        self.assertIn('timestamp', data)

    def test_api_chat_suggestions_endpoint(self):
        """Test /api/chat/suggestions GET route."""
        res = self.client.get('/api/chat/suggestions')
        self.assertEqual(res.status_code, 200)
        data = res.get_json()
        self.assertTrue(data['success'])
        self.assertIn('suggestions', data)
        self.assertIn('context', data)


if __name__ == '__main__':
    unittest.main()
