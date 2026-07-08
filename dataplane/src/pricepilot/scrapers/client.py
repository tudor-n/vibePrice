"""The single network I/O point for all scrapers (ADR 0004).

Politeness is enforced here, in one place: a jittered delay between requests,
bounded retries with linear backoff on transient failures, and loud, never
retried failure on anything that looks like an anti-bot block (403/429 or a
challenge page). Scrapers themselves stay pure and fixture-testable; tests
drive this client through ``httpx.MockTransport`` — never the network.
"""

import random
import time
from collections.abc import Callable

import httpx

from pricepilot.config import Settings, get_settings

#: Lowercase substrings that mark an anti-bot challenge page in a 200 body.
BLOCKED_MARKERS = ("px-captcha", "are you a human", "unusual traffic")

#: Extra attempts after the first, for transient failures only.
MAX_TRANSIENT_RETRIES = 2

#: Jitter bounds applied to the politeness delay (uniform multiplier).
JITTER_RANGE = (0.5, 1.5)


class ScraperFetchError(RuntimeError):
    """A fetch failed for a non-block reason (timeouts exhausted, 4xx/5xx)."""


class ScraperBlockedError(ScraperFetchError):
    """The source is refusing us (403/429/challenge page). Never retried —
    hammering a blocking site is both impolite and counterproductive."""


class PoliteClient:
    """Rate-limited HTTP client shared by every scraper request.

    ``sleeper``/``transport``/``rng`` exist for tests (fake sleep recorder,
    ``httpx.MockTransport``, deterministic jitter); production callers use
    the defaults.
    """

    def __init__(
        self,
        settings: Settings | None = None,
        *,
        sleeper: Callable[[float], None] = time.sleep,
        transport: httpx.BaseTransport | None = None,
        rng: random.Random | None = None,
    ) -> None:
        settings = settings or get_settings()
        self._sleeper = sleeper
        self._rng: random.Random = rng or random.Random()
        self._delay = settings.scrape_delay_seconds
        self._made_request = False

        client_kwargs: dict[str, object] = {
            "headers": {
                "User-Agent": settings.scraper_user_agent,
                "Accept-Language": "en-US,en;q=0.9",
            },
            "timeout": settings.scrape_timeout_seconds,
            "follow_redirects": True,
        }
        if transport is not None:
            client_kwargs["transport"] = transport
        if settings.scraper_proxy_url:
            client_kwargs["proxy"] = settings.scraper_proxy_url
        self._client = httpx.Client(**client_kwargs)  # type: ignore[arg-type]

    def get(self, url: str) -> str:
        """Fetch one page politely; return its body text.

        Raises :class:`ScraperBlockedError` on 403/429/challenge markup (never
        retried) and :class:`ScraperFetchError` on other failures once the
        transient retries are exhausted.
        """
        if self._made_request and self._delay > 0:
            self._sleeper(self._delay * self._rng.uniform(*JITTER_RANGE))
        self._made_request = True

        last_error: Exception | None = None
        for attempt in range(1 + MAX_TRANSIENT_RETRIES):
            if attempt and self._delay > 0:
                self._sleeper(self._delay * attempt)  # linear backoff
            try:
                response = self._client.get(url)
            except httpx.TransportError as exc:  # timeouts, connection resets
                last_error = exc
                continue

            if response.status_code in (403, 429):
                raise ScraperBlockedError(
                    f"HTTP {response.status_code} at {url} — likely anti-bot block"
                )
            if response.is_success:
                lowered = response.text.lower()
                for marker in BLOCKED_MARKERS:
                    if marker in lowered:
                        raise ScraperBlockedError(
                            f"challenge page detected ({marker!r}) at {url}"
                        )
                return response.text
            if response.is_server_error:
                last_error = ScraperFetchError(f"HTTP {response.status_code} at {url}")
                continue
            raise ScraperFetchError(f"HTTP {response.status_code} at {url}")

        raise ScraperFetchError(
            f"giving up on {url} after {1 + MAX_TRANSIENT_RETRIES} attempts: {last_error}"
        )

    def close(self) -> None:
        self._client.close()

    def __enter__(self) -> "PoliteClient":
        return self

    def __exit__(self, *exc_info: object) -> None:
        self.close()
