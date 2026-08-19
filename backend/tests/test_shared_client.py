"""
Regression cover for the shared HTTP client proxy.

The bug: the connection-pooling refactor replaced httpx.AsyncClient with
_SharedClientProxy at call sites that cache their client behind

    if _client is None or _client.is_closed:

The proxy had no is_closed. The first call short-circuits on `is None` and
succeeds, so nothing failed at startup — but every call after it evaluated
.is_closed and raised AttributeError. In the OpenRouter model cascade that
meant only the first model was ever reachable; the moment that model stopped
being available, every AI feature reported "all models unavailable" with an
AttributeError against each remaining model.
"""

import httpx

from app.utils.http import shared_client, get_http


class TestProxyIsDropInForAsyncClient:
    def test_exposes_is_closed(self):
        proxy = shared_client(timeout=httpx.Timeout(5.0))
        assert proxy.is_closed is False

    def test_cache_guard_survives_repeated_calls(self):
        """The exact shape of the guard that broke, exercised more than once."""
        cached = None

        def get_client():
            nonlocal cached
            if cached is None or cached.is_closed:
                cached = shared_client(timeout=httpx.Timeout(5.0))
            return cached

        first = get_client()
        # Second call is where AttributeError used to be raised.
        second = get_client()
        third = get_client()

        assert first is second is third

    def test_delegates_unknown_attributes_to_the_shared_client(self):
        proxy = shared_client()
        # `headers` is not overridden by the proxy; it must still resolve.
        assert proxy.headers is not None
        assert proxy.headers == get_http().headers

    def test_private_names_still_raise(self):
        """A real internal typo must fail loudly rather than being forwarded."""
        proxy = shared_client()
        try:
            proxy._not_a_real_attribute
        except AttributeError:
            pass
        else:
            raise AssertionError("private attribute access should raise")

    def test_per_site_defaults_are_still_applied(self):
        """The proxy's actual job — defaults must survive the added delegation."""
        proxy = shared_client(timeout=httpx.Timeout(42.0))
        merged = proxy._merge({})
        assert merged["timeout"].read == 42.0

    def test_explicit_request_options_still_win_over_defaults(self):
        proxy = shared_client(timeout=httpx.Timeout(42.0))
        merged = proxy._merge({"timeout": httpx.Timeout(1.0)})
        assert merged["timeout"].read == 1.0
