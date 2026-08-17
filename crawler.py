#!/usr/bin/env python3
"""Synchronize the Lingnan Pass virtual card-art catalog anonymously.

The request signature was reconstructed from the Android client. The catalog
endpoints currently accept signed client requests without an account token,
user ID, username, or device identifier.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from io import BytesIO
from pathlib import Path
from typing import Any

import requests
from PIL import Image, ImageOps, features
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry


_SIGN_KEY = "417b5137-2dbb-4ff9-ac68-30024d787a18"
_BASE_URL = "https://alipd.lingnanpass.com"
_IMAGE_BASE = "http://wuqa.lingnanpass.com:7574"
_USER_AGENT = "ling nan tong/7.4 (iPhone; iOS 26.3.1; Scale/3.00)"

_LIST_ENDPOINT = "APPMall/cardart/cardart!getAllCardArtSeriesList.action"
_DETAIL_ENDPOINT = "APPMall/cardart/cardart!getCardArtSeriesDetail.action"

PAGE_SIZE = 50
API_TIMEOUT = 20
IMAGE_TIMEOUT = 40
MAX_IMAGE_BYTES = 25 * 1024 * 1024
MIN_ACTIVE_SERIES_RATIO = 0.8
FULL_IMAGE_WIDTH = 1600
THUMBNAIL_WIDTH = 640
FULL_IMAGE_QUALITY = 86
THUMBNAIL_QUALITY = 78


class SyncError(RuntimeError):
    """Raised when a sync cannot safely produce a complete data set."""


@dataclass
class SyncStats:
    downloaded: int = 0
    existing: int = 0
    removed: int = 0


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _build_header(sign: str) -> dict[str, Any]:
    """Build the anonymous client header required by the catalog endpoints."""
    return {
        "apptype": 5,
        "phonebrand": "iPhone18,4",
        "phonemodel": "26.3.1",
        "type": "iOS",
        "versionCode": "7.4",
        "suitChannel": "4",
        "locale": "zh-Hans",
        "ctp": "05",
        "sign": sign,
    }


def _sign(body: dict[str, Any]) -> tuple[str, str]:
    body_json = json.dumps(body, separators=(",", ":"), ensure_ascii=False)
    raw = f"body={body_json}&key={_SIGN_KEY}"
    sign = hashlib.md5(raw.encode("utf-8")).hexdigest().upper()
    return sign, body_json


def _create_session() -> requests.Session:
    retry = Retry(
        total=3,
        connect=3,
        read=3,
        status=3,
        backoff_factor=1,
        status_forcelist=(429, 500, 502, 503, 504),
        allowed_methods=frozenset(("GET", "POST")),
        respect_retry_after_header=True,
    )
    adapter = HTTPAdapter(max_retries=retry, pool_connections=4, pool_maxsize=4)
    session = requests.Session()
    session.mount("https://", adapter)
    session.mount("http://", adapter)
    return session


class LingnanPassClient:
    def __init__(self, request_delay: float = 0.5) -> None:
        self.request_delay = max(0.0, request_delay)
        self.session = _create_session()

    def close(self) -> None:
        self.session.close()

    def api_post(self, endpoint: str, body: dict[str, Any]) -> dict[str, Any]:
        sign, body_json = _sign(body)
        headers = {
            "Content-Type": "application/x-www-form-urlencoded",
            "Accept": "application/json",
            "Accept-Language": "zh-Hans-CN;q=1",
            "User-Agent": _USER_AGENT,
            "header": json.dumps(_build_header(sign), separators=(",", ":")),
        }

        try:
            response = self.session.post(
                f"{_BASE_URL}/{endpoint}",
                headers=headers,
                data={"body": body_json},
                timeout=API_TIMEOUT,
            )
            response.raise_for_status()
            payload = response.json()
        except (requests.RequestException, ValueError) as exc:
            raise SyncError(f"API request failed for {endpoint}: {exc}") from exc

        if payload.get("code") != 0:
            message = payload.get("message") or payload.get("msg") or "unknown error"
            raise SyncError(f"API returned code {payload.get('code')} for {endpoint}: {message}")
        return payload

    def fetch_all_series(self) -> list[dict[str, Any]]:
        all_series: list[dict[str, Any]] = []
        seen_ids: set[str] = set()

        for page_no in range(1, 101):
            body = {
                "cityCode": "01",
                "ctp": "05",
                "locale": "zh-Hans",
                "mobileVendor": "0",
                "pageNo": str(page_no),
                "pageSize": str(PAGE_SIZE),
                "suitChannel": "4",
            }
            payload = self.api_post(_LIST_ENDPOINT, body)
            page_data = payload.get("data", {}).get("seriesInfoList", [])
            if not isinstance(page_data, list):
                raise SyncError(f"Series list page {page_no} has an unexpected shape")
            if not page_data:
                break

            for series in page_data:
                series_id = _series_id(series)
                if not series_id:
                    raise SyncError(f"Series list page {page_no} contains an item without an ID")
                if series_id in seen_ids:
                    raise SyncError(f"Duplicate series ID returned by the API: {series_id}")
                seen_ids.add(series_id)
                all_series.append(series)

            print(f"  page {page_no}: {len(all_series)} series", flush=True)
            if len(page_data) < PAGE_SIZE:
                break
            time.sleep(self.request_delay)
        else:
            raise SyncError("Series pagination exceeded the 100-page safety limit")

        if not all_series:
            raise SyncError("The API returned no card-art series")
        return all_series

    def fetch_series_cards(self, series_id: str) -> list[dict[str, Any]]:
        payload = self.api_post(
            _DETAIL_ENDPOINT,
            {"seriesId": series_id, "suitChannel": "4"},
        )
        cards = payload.get("data", {}).get("seriesInfo", {}).get("cardArtItemList", [])
        if not isinstance(cards, list):
            raise SyncError(f"Series {series_id} has an unexpected card list shape")
        return cards

    def download_image(self, remote_path: str) -> bytes:
        url = f"{_IMAGE_BASE}{remote_path}" if remote_path.startswith("/") else remote_path
        try:
            with self.session.get(
                url,
                headers={"User-Agent": _USER_AGENT},
                stream=True,
                timeout=IMAGE_TIMEOUT,
            ) as response:
                response.raise_for_status()
                content_type = response.headers.get("Content-Type", "").lower()
                if content_type and not content_type.startswith("image/"):
                    raise SyncError(f"Image URL returned Content-Type {content_type}: {url}")

                chunks: list[bytes] = []
                total = 0
                for chunk in response.iter_content(chunk_size=64 * 1024):
                    if not chunk:
                        continue
                    total += len(chunk)
                    if total > MAX_IMAGE_BYTES:
                        raise SyncError(f"Image exceeds {MAX_IMAGE_BYTES} bytes: {url}")
                    chunks.append(chunk)
        except requests.RequestException as exc:
            raise SyncError(f"Image download failed: {url}: {exc}") from exc

        if not chunks:
            raise SyncError(f"Image download returned an empty body: {url}")
        return b"".join(chunks)


def _series_id(series: dict[str, Any]) -> str:
    return str(series.get("cardArtSeriesID") or series.get("seriesId") or "")


def _series_name(series: dict[str, Any]) -> str:
    return str(series.get("cardArtSeriesName") or series.get("seriesName") or "").strip()


def _card_id(card: dict[str, Any]) -> str:
    return str(card.get("cardArtId") or card.get("cardId") or "")


def _expected_card_count(series: dict[str, Any]) -> int | None:
    value = series.get("iPCardArtItemNum")
    try:
        return int(value) if value is not None else None
    except (TypeError, ValueError):
        return None


def _remote_image_path(card: dict[str, Any]) -> str:
    return str(
        card.get("cardArtRawUrl")
        or card.get("cardArtThumbnailUrl")
        or card.get("cardArtUrl")
        or ""
    )


def _load_existing_data(data_path: Path) -> dict[str, Any] | None:
    if not data_path.exists():
        return None
    try:
        payload = json.loads(data_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise SyncError(f"Cannot read existing data file {data_path}: {exc}") from exc
    if not isinstance(payload, dict) or not isinstance(payload.get("series"), list):
        raise SyncError(f"Existing data file has an unexpected shape: {data_path}")
    return payload


def _previous_ids(existing: dict[str, Any] | None) -> tuple[set[str], set[str]]:
    series_ids: set[str] = set()
    card_ids: set[str] = set()
    if not existing:
        return series_ids, card_ids

    for series in existing.get("series", []):
        series_id = str(series.get("seriesId", ""))
        if series_id:
            series_ids.add(series_id)
        for card in series.get("cards", []):
            card_id = str(card.get("cardId", ""))
            if card_id:
                card_ids.add(card_id)
    return series_ids, card_ids


def _asset_paths(output_dir: Path, series_id: str, card_id: str) -> tuple[Path, Path]:
    return (
        output_dir / "cards" / series_id / f"{card_id}.webp",
        output_dir / "thumbs" / series_id / f"{card_id}.webp",
    )


def _save_webp(image: Image.Image, path: Path, width: int, quality: int) -> None:
    converted = image.copy()
    if converted.width > width:
        height = max(1, round(converted.height * width / converted.width))
        converted = converted.resize((width, height), Image.Resampling.LANCZOS)

    has_alpha = "A" in converted.getbands() or "transparency" in converted.info
    target_mode = "RGBA" if has_alpha else "RGB"
    if converted.mode != target_mode:
        converted = converted.convert(target_mode)

    path.parent.mkdir(parents=True, exist_ok=True)
    temp_path = path.with_name(f".{path.name}.tmp")
    try:
        converted.save(
            temp_path,
            format="WEBP",
            quality=quality,
            method=6,
            exact=has_alpha,
        )
        temp_path.replace(path)
    finally:
        if temp_path.exists():
            temp_path.unlink()


def _ensure_card_assets(
    client: LingnanPassClient,
    output_dir: Path,
    series_id: str,
    card_id: str,
    remote_path: str,
    force: bool,
    stats: SyncStats,
) -> tuple[str, str]:
    full_path, thumb_path = _asset_paths(output_dir, series_id, card_id)
    if (
        not force
        and full_path.exists()
        and full_path.stat().st_size > 0
        and thumb_path.exists()
        and thumb_path.stat().st_size > 0
    ):
        stats.existing += 1
        return (
            full_path.relative_to(output_dir).as_posix(),
            thumb_path.relative_to(output_dir).as_posix(),
        )

    image_bytes = client.download_image(remote_path)
    stats.downloaded += 1

    try:
        with Image.open(BytesIO(image_bytes)) as source:
            source.load()
            normalized = ImageOps.exif_transpose(source)
            _save_webp(normalized, full_path, FULL_IMAGE_WIDTH, FULL_IMAGE_QUALITY)
            _save_webp(normalized, thumb_path, THUMBNAIL_WIDTH, THUMBNAIL_QUALITY)
    except (OSError, ValueError) as exc:
        raise SyncError(f"Cannot convert image for card {card_id}: {exc}") from exc

    return (
        full_path.relative_to(output_dir).as_posix(),
        thumb_path.relative_to(output_dir).as_posix(),
    )


def _resolve_public_asset(output_dir: Path, relative_path: str) -> Path:
    root = output_dir.resolve()
    candidate = (output_dir / relative_path).resolve()
    if candidate != root and root not in candidate.parents:
        raise SyncError(f"Asset path escapes the public directory: {relative_path}")
    return candidate


def validate_gallery(data: dict[str, Any], output_dir: Path) -> None:
    series_list = data.get("series")
    if not isinstance(series_list, list) or not series_list:
        raise SyncError("Generated data contains no series")

    series_ids: set[str] = set()
    card_ids: set[str] = set()
    for series in series_list:
        series_id = str(series.get("seriesId", ""))
        if not series_id or series_id in series_ids:
            raise SyncError(f"Missing or duplicate series ID: {series_id!r}")
        series_ids.add(series_id)

        cards = series.get("cards")
        if not isinstance(cards, list) or int(series.get("cardCount", -1)) != len(cards):
            raise SyncError(f"Card count mismatch in series {series_id}")
        for card in cards:
            card_id = str(card.get("cardId", ""))
            if not card_id or card_id in card_ids:
                raise SyncError(f"Missing or duplicate card ID: {card_id!r}")
            card_ids.add(card_id)
            for field in ("imageFile", "thumbnailFile"):
                relative_path = str(card.get(field, ""))
                asset_path = _resolve_public_asset(output_dir, relative_path)
                if not relative_path or not asset_path.is_file() or asset_path.stat().st_size <= 0:
                    raise SyncError(f"Missing {field} for card {card_id}: {relative_path}")

    checks = {
        "totalSeries": len(series_list),
        "totalCards": len(card_ids),
    }
    for field, expected in checks.items():
        if int(data.get(field, -1)) != expected:
            raise SyncError(f"Summary field {field} should be {expected}, got {data.get(field)}")


def _prune_unreferenced_assets(
    data: dict[str, Any], output_dir: Path, stats: SyncStats
) -> None:
    referenced = {
        _resolve_public_asset(output_dir, str(card[field])).resolve()
        for series in data["series"]
        for card in series["cards"]
        for field in ("imageFile", "thumbnailFile")
    }

    for folder_name in ("cards", "thumbs"):
        folder = output_dir / folder_name
        if not folder.exists():
            continue
        folder_root = folder.resolve()
        for asset in folder.rglob("*.webp"):
            resolved = asset.resolve()
            if resolved != folder_root and folder_root not in resolved.parents:
                raise SyncError(f"Asset path escapes {folder}: {asset}")
            if resolved not in referenced:
                asset.unlink()
                stats.removed += 1

        directories = sorted(
            (path for path in folder.rglob("*") if path.is_dir() and not path.is_symlink()),
            key=lambda path: len(path.parts),
            reverse=True,
        )
        for directory in directories:
            try:
                directory.rmdir()
            except OSError:
                pass


def _write_json_atomic(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temp_path = path.with_name(f".{path.name}.tmp")
    try:
        temp_path.write_text(
            json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        temp_path.replace(path)
    finally:
        if temp_path.exists():
            temp_path.unlink()


def _catalog_fingerprint(data: dict[str, Any]) -> str:
    """Return a stable representation that excludes sync-only timestamps."""
    comparable = {
        key: value
        for key, value in data.items()
        if key not in {"generatedAt", "sync"}
    }
    return json.dumps(comparable, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def sync_gallery(args: argparse.Namespace) -> dict[str, Any]:
    output_dir: Path = args.output_dir
    data_path = output_dir / "data.json"
    existing = _load_existing_data(data_path)
    previous_series_ids, previous_card_ids = _previous_ids(existing)

    if not features.check("webp"):
        raise SyncError("The installed Pillow build does not support WebP")

    client = LingnanPassClient(args.request_delay)
    stats = SyncStats()
    now = _utc_now()
    output_data: dict[str, Any] | None = None
    try:
        print("Fetching the current series catalog...", flush=True)
        live_metadata = client.fetch_all_series()
        live_ids = {_series_id(series) for series in live_metadata}

        if (
            previous_series_ids
            and len(live_ids) < len(previous_series_ids) * MIN_ACTIVE_SERIES_RATIO
            and not args.allow_large_shrink
        ):
            raise SyncError(
                "The active series count dropped from "
                f"{len(previous_series_ids)} to {len(live_ids)}. "
                "Use --allow-large-shrink after verifying the API response."
            )

        output_series: list[dict[str, Any]] = []
        seen_card_ids: set[str] = set()

        for index, metadata in enumerate(live_metadata, 1):
            series_id = _series_id(metadata)
            name = _series_name(metadata)
            if not name:
                raise SyncError(f"Series {series_id} has no name")

            cards_raw = client.fetch_series_cards(series_id)
            expected = _expected_card_count(metadata)
            if expected is not None and expected != len(cards_raw):
                raise SyncError(
                    f"Series {series_id} expected {expected} cards but returned {len(cards_raw)}"
                )

            cards: list[dict[str, Any]] = []
            for raw_card in cards_raw:
                card_id = _card_id(raw_card)
                if not card_id or card_id in seen_card_ids:
                    raise SyncError(f"Missing or duplicate card ID in live data: {card_id!r}")
                seen_card_ids.add(card_id)

                remote_path = _remote_image_path(raw_card)
                if not remote_path:
                    raise SyncError(f"Card {card_id} has no image URL")
                image_file, thumbnail_file = _ensure_card_assets(
                    client=client,
                    output_dir=output_dir,
                    series_id=series_id,
                    card_id=card_id,
                    remote_path=remote_path,
                    force=args.force_images,
                    stats=stats,
                )
                cards.append(
                    {
                        "cardId": card_id,
                        "cardName": str(raw_card.get("cardArtName") or "Unnamed card"),
                        "imageFile": image_file,
                        "thumbnailFile": thumbnail_file,
                    }
                )

            record: dict[str, Any] = {
                "seriesId": series_id,
                "seriesName": name,
                "brand": str(
                    metadata.get("cardArtSeriesBrand")
                    or metadata.get("seriesBrand")
                    or ""
                ),
                "cardCount": len(cards),
                "cards": cards,
            }
            output_series.append(record)
            print(f"[{index}/{len(live_metadata)}] {name}: {len(cards)} cards", flush=True)
            time.sleep(client.request_delay)

        active_cards = sum(len(series["cards"]) for series in output_series)
        current_card_ids = {
            str(card["cardId"])
            for series in output_series
            for card in series["cards"]
        }

        output_data = {
            "schemaVersion": 2,
            "generatedAt": now,
            "source": {
                "scope": "current anonymous catalog response",
                "cityCode": "01",
                "ctp": "05",
                "suitChannel": "4",
            },
            "totalSeries": len(output_series),
            "totalCards": active_cards,
            "sync": {
                "newSeries": len(live_ids - previous_series_ids),
                "newCards": len(current_card_ids - previous_card_ids),
                "removedSeries": len(previous_series_ids - live_ids),
                "removedCards": len(previous_card_ids - current_card_ids),
            },
            "series": output_series,
        }
        validate_gallery(output_data, output_dir)
        if (
            existing
            and existing.get("schemaVersion") == output_data["schemaVersion"]
            and _catalog_fingerprint(existing) == _catalog_fingerprint(output_data)
        ):
            output_data = existing
            print("No catalog changes detected; data.json was left unchanged", flush=True)
        else:
            _write_json_atomic(data_path, output_data)
        _prune_unreferenced_assets(output_data, output_dir, stats)
    finally:
        client.close()

    if output_data is None:
        raise SyncError("Sync ended before output data was generated")
    print("\nSync complete", flush=True)
    print(f"  series:              {output_data['totalSeries']}")
    print(f"  cards:               {output_data['totalCards']}")
    print(f"  downloaded images:   {stats.downloaded}")
    print(f"  existing WebP pairs: {stats.existing}")
    print(f"  removed stale WebP:  {stats.removed}")
    print(f"  data file:           {data_path}")
    return output_data


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=Path("public"),
        help="Public output directory (default: public)",
    )
    parser.add_argument(
        "--request-delay",
        type=float,
        default=0.5,
        help="Delay between catalog requests in seconds (default: 0.5)",
    )
    parser.add_argument(
        "--force-images",
        action="store_true",
        help="Regenerate all WebP images even when outputs already exist",
    )
    parser.add_argument(
        "--allow-large-shrink",
        action="store_true",
        help="Accept an active catalog more than 20%% smaller than the previous one",
    )
    parser.add_argument(
        "--check",
        action="store_true",
        help="Validate existing data and image assets without using the network",
    )
    return parser.parse_args()


def main() -> int:
    args = _parse_args()
    try:
        if args.check:
            data = _load_existing_data(args.output_dir / "data.json")
            if data is None:
                raise SyncError("No existing data.json was found")
            validate_gallery(data, args.output_dir)
            print("Existing gallery data and assets are valid")
        else:
            sync_gallery(args)
    except SyncError as exc:
        print(f"Sync failed: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
