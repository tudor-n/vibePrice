"""PoliteClient behavior — MockTransport only, never the network."""

import httpx
import pytest

from pricepilot.config import Settings
from pricepilot.scrapers.client import (
    BLOCKED_MARKERS,
    PoliteClient,
    ScraperBlockedError,
    ScraperFetchError,
)


class FixedRng:
    """rng.uniform(a, b) → always the midpoint multiplier we want to assert."""

    def __init__(self, value: float) -> None:
        self.value = value

    def uniform(self, low: float, high: float) -> float:
        assert (low, high) == (0.5, 1.5)  # jitter bounds are part of the contract
        return self.value


def make_settings(**overrides) -> Settings:
    defaults = {
        "scraper_user_agent": "TestAgent/1.0",
        "scrape_delay_seconds": 2.0,
        "scrape_timeout_seconds": 5.0,
        "scraper_proxy_url": "",
    }
    defaults.update(overrides)
    return Settings(**defaults)


def make_client(handler, *, settings=None, rng=None):
    sleeps: list[float] = []
    client = PoliteClient(
        settings or make_settings(),
        sleeper=sleeps.append,
        transport=httpx.MockTransport(handler),
        rng=rng or FixedRng(1.0),
    )
    return client, sleeps


def test_first_request_is_not_delayed() -> None:
    client, sleeps = make_client(lambda request: httpx.Response(200, text="ok"))
    assert client.get("https://example.test/a") == "ok"
    assert sleeps == []


def test_second_request_waits_with_jitter() -> None:
    client, sleeps = make_client(
        lambda request: httpx.Response(200, text="ok"), rng=FixedRng(1.25)
    )
    client.get("https://example.test/a")
    client.get("https://example.test/b")
    assert sleeps == [2.0 * 1.25]


@pytest.mark.parametrize("status", [403, 429])
def test_block_statuses_raise_blocked_and_never_retry(status: int) -> None:
    calls: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(str(request.url))
        return httpx.Response(status, text="blocked")

    client, _ = make_client(handler)
    with pytest.raises(ScraperBlockedError):
        client.get("https://example.test/a")
    assert len(calls) == 1


def test_challenge_markup_in_200_body_raises_blocked() -> None:
    marker = BLOCKED_MARKERS[0]
    client, _ = make_client(
        lambda request: httpx.Response(200, text=f"<html>{marker.upper()}</html>")
    )
    with pytest.raises(ScraperBlockedError):
        client.get("https://example.test/a")


def test_transient_5xx_retried_with_backoff_then_succeeds() -> None:
    responses = [httpx.Response(500), httpx.Response(502), httpx.Response(200, text="ok")]

    def handler(request: httpx.Request) -> httpx.Response:
        return responses.pop(0)

    client, sleeps = make_client(handler)
    assert client.get("https://example.test/a") == "ok"
    # No politeness delay on the first request; backoff = delay * attempt.
    assert sleeps == [2.0 * 1, 2.0 * 2]


def test_transient_retries_exhausted_raise_fetch_error() -> None:
    calls: list[int] = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(1)
        return httpx.Response(500)

    client, _ = make_client(handler)
    with pytest.raises(ScraperFetchError):
        client.get("https://example.test/a")
    assert len(calls) == 3  # initial + 2 retries


def test_timeouts_are_retried() -> None:
    state = {"raised": False}

    def handler(request: httpx.Request) -> httpx.Response:
        if not state["raised"]:
            state["raised"] = True
            raise httpx.ConnectTimeout("boom")
        return httpx.Response(200, text="ok")

    client, sleeps = make_client(handler)
    assert client.get("https://example.test/a") == "ok"
    assert sleeps == [2.0]  # one backoff sleep for the one retry


def test_other_4xx_fail_immediately_without_retry() -> None:
    calls: list[int] = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(1)
        return httpx.Response(404, text="nope")

    client, _ = make_client(handler)
    with pytest.raises(ScraperFetchError) as excinfo:
        client.get("https://example.test/a")
    assert not isinstance(excinfo.value, ScraperBlockedError)
    assert len(calls) == 1


def test_identifying_headers_are_sent() -> None:
    seen: dict[str, str] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["ua"] = request.headers["User-Agent"]
        seen["lang"] = request.headers["Accept-Language"]
        return httpx.Response(200, text="ok")

    client, _ = make_client(handler)
    client.get("https://example.test/a")
    assert seen["ua"] == "TestAgent/1.0"
    assert seen["lang"] == "en-US,en;q=0.9"


def test_zero_delay_never_sleeps() -> None:
    client, sleeps = make_client(
        lambda request: httpx.Response(200, text="ok"),
        settings=make_settings(scrape_delay_seconds=0.0),
    )
    client.get("https://example.test/a")
    client.get("https://example.test/b")
    assert sleeps == []


def test_scrape_source_list_parses_csv() -> None:
    assert make_settings(scrape_sources="booking, airbnb ,,").scrape_source_list() == [
        "booking",
        "airbnb",
    ]
    assert make_settings(scrape_sources="booking").scrape_source_list() == ["booking"]
