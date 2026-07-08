"""Capture one live Google Places response as a fixture (human-in-the-loop).

Mirrors ``pricepilot.scrapers.capture``: a person runs this manually against
the live Google Places API (real key, real billing) when a fixture needs
refreshing, then trims/reviews the saved JSON before committing it under
``tests/fixtures/places/``. Never run in CI and never imported by tests.

Usage (needs GOOGLE_PLACES_API_KEY; PLACES_PROVIDER is irrelevant here — this
CLI always calls Google directly, independent of the configured provider):

    python -m pricepilot.places.capture text "Hotel Continental Forum" --city sibiu
    python -m pricepilot.places.capture nearby --lat 45.79 --lng 24.15 --city sibiu
"""

import argparse
import json
import re
import sys
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import urlopen

from pricepilot.config import get_settings
from pricepilot.places.google import _DETAILS, _NEARBY, _TEXT

_OUT_DIR = Path(__file__).resolve().parents[3] / "tests" / "fixtures" / "places"


def _slug(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", text.lower()).strip("_")


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="python -m pricepilot.places.capture",
        description="Fetch one live Google Places response and save it as a fixture.",
    )
    sub = parser.add_subparsers(dest="command", required=True)

    text_cmd = sub.add_parser("text", help="Text Search request")
    text_cmd.add_argument("query", help='e.g. "Hotel Continental Forum"')
    text_cmd.add_argument("--city", required=True, help="city slug, e.g. sibiu")
    text_cmd.add_argument("--out", default=None, help="output path override")

    nearby_cmd = sub.add_parser("nearby", help="Nearby Search request")
    nearby_cmd.add_argument("--lat", required=True, type=str)
    nearby_cmd.add_argument("--lng", required=True, type=str)
    nearby_cmd.add_argument("--city", required=True, help="city slug, used only in the filename")
    nearby_cmd.add_argument("--radius", type=int, default=1500, help="meters")
    nearby_cmd.add_argument("--kind", default="lodging")
    nearby_cmd.add_argument("--out", default=None, help="output path override")

    details_cmd = sub.add_parser("details", help="Place Details request")
    details_cmd.add_argument("place_id")
    details_cmd.add_argument("--out", default=None, help="output path override")

    return parser


def main(argv: list[str] | None = None) -> int:
    args = _build_parser().parse_args(argv)
    settings = get_settings()
    if not settings.google_places_api_key:
        print("error: GOOGLE_PLACES_API_KEY is required to capture a live fixture", file=sys.stderr)
        return 2

    key = settings.google_places_api_key
    if args.command == "text":
        params = {"query": f"{args.query}, {args.city}", "key": key}
        url = f"{_TEXT}?{urlencode(params)}"
        out_path = Path(args.out or _OUT_DIR / f"text_search_{_slug(args.query)}.json")
    elif args.command == "nearby":
        params = {
            "location": f"{args.lat},{args.lng}",
            "radius": args.radius,
            "type": args.kind,
            "key": key,
        }
        url = f"{_NEARBY}?{urlencode(params)}"
        out_path = Path(args.out or _OUT_DIR / f"nearby_{args.kind}_{_slug(args.city)}.json")
    else:  # details
        params = {"place_id": args.place_id, "key": key}
        url = f"{_DETAILS}?{urlencode(params)}"
        out_path = Path(args.out or _OUT_DIR / f"details_{_slug(args.place_id)}.json")

    print(f"Fetching {url}")
    with urlopen(url, timeout=20.0) as resp:  # noqa: S310 - human-in-the-loop CLI, real key
        raw = resp.read().decode("utf-8")

    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(raw, encoding="utf-8")

    body = json.loads(raw)
    status = body.get("status", "?")
    results = body.get("results", [body["result"]] if "result" in body else [])
    print(f"Saved to {out_path}; status={status}, {len(results)} result(s).")
    if status != "OK":
        print(
            f"warning: Google returned status={status!r} — inspect before committing.",
            file=sys.stderr,
        )
    return 0


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
