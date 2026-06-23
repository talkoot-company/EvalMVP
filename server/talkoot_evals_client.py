#!/usr/bin/env python3
"""
Runnable Python implementation generated from the Postman collection:
Takoot-Evals-Sean

Install dependency:
    pip install requests

Notes:
- Token credentials from the Postman Token request are embedded directly below.
- Some Postman variables were not available in the active environment/collection details inspected.
  Fill the TODO constants before running against the target API:
    URL_GC, UNIVERSAL_TAG_ID, ACCURACY_TAG_ID, CRITERIA_TYPE_ID, CRITERIA_ID
- DESCRIPTION_TAG_ID was inferred from the known/open response for Tags Description: tagId 21.
"""

from __future__ import annotations

import json
import sys
from typing import Any, Dict, Optional
from urllib.parse import urljoin

import requests


# -----------------------------------------------------------------------------
# Embedded credentials / variables from the Postman collection
# -----------------------------------------------------------------------------

TOKEN_URL = "https://app-test-cerberus.azurewebsites.net/connect/token"
CLIENT_ID = "golfcarts"
CLIENT_SECRET = "461b6067-dc45-4932-a852-0e17729404d2"
SCOPE = "golfcarts"
GRANT_TYPE = "password"
USERNAME = "admin@talkoot.com"
PASSWORD = "DutchBr0s!"

# Postman collection/environment variables that could not be retrieved from the
# active workspace data. Replace these TODO values with the actual values.
URL_GC = "https://app-test-golfcarts.azurewebsites.net"
UNIVERSAL_TAG_ID = "1"
DESCRIPTION_TAG_ID = "21"
ACCURACY_TAG_ID = "26"
CRITERIA_TYPE_ID = "1"
CRITERIA_ID = "26"

REQUEST_TIMEOUT_SECONDS = 30


class TakootEvalsSeanClient:
    """Client for requests in the Takoot-Evals-Sean Postman collection."""

    def __init__(self) -> None:
        self.session = requests.Session()
        self.access_token_gc: Optional[str] = None

    @staticmethod
    def _print_response(name: str, response: requests.Response) -> None:
        print(f"\n=== {name} ===")
        print(f"{response.request.method} {response.url}")
        print(f"Status: {response.status_code}")
        try:
            parsed = response.json()
            print(json.dumps(parsed, indent=2, ensure_ascii=False))
        except ValueError:
            print(response.text)

    @staticmethod
    def _require_filled(name: str, value: str) -> None:
        if value.startswith("TODO-FILL") or "TODO-FILL" in value:
            raise ValueError(
                f"Missing required variable {name}. "
                f"Fill the {name} constant at the top of this script."
            )

    @staticmethod
    def _build_url(path: str) -> str:
        TakootEvalsSeanClient._require_filled("URL_GC", URL_GC)
        base = URL_GC.rstrip("/") + "/"
        return urljoin(base, path.lstrip("/"))

    def _auth_headers(self) -> Dict[str, str]:
        if not self.access_token_gc:
            raise RuntimeError(
                "No access token available. Call token() before authenticated requests."
            )

        return {
            "Authorization": f"Bearer {self.access_token_gc}",
            "Accept": "application/json",
        }

    # 1. Token
    # POST https://app-test-cerberus.azurewebsites.net/connect/token
    def token(self) -> Dict[str, Any]:
        data = {
            "client_id": CLIENT_ID,
            "client_secret": CLIENT_SECRET,
            "scope": SCOPE,
            "grant_type": GRANT_TYPE,
            "username": USERNAME,
            "password": PASSWORD,
        }

        response = self.session.post(
            TOKEN_URL,
            data=data,
            headers={
                "Content-Type": "application/x-www-form-urlencoded",
                "Accept": "application/json",
            },
            timeout=REQUEST_TIMEOUT_SECONDS,
        )

        self._print_response("Token", response)
        response.raise_for_status()

        payload = response.json()
        self.access_token_gc = payload.get("access_token")

        if not self.access_token_gc:
            raise RuntimeError("Token response did not include an access_token field.")

        return payload

    # 2. TagTypes
    # GET {{URL_gc}}/tagtypes
    def tag_types(self) -> Any:
        url = self._build_url("/tagtypes")

        response = self.session.get(
            url,
            headers=self._auth_headers(),
            timeout=REQUEST_TIMEOUT_SECONDS,
        )

        self._print_response("TagTypes", response)
        response.raise_for_status()
        return response.json()

    # 3. Tags Universal
    # GET {{URL_gc}}/tags/{{universal_TagId}}
    def tags_universal(self) -> Any:
        self._require_filled("UNIVERSAL_TAG_ID", UNIVERSAL_TAG_ID)

        url = self._build_url(f"/tags/{UNIVERSAL_TAG_ID}")

        response = self.session.get(
            url,
            headers=self._auth_headers(),
            timeout=REQUEST_TIMEOUT_SECONDS,
        )

        self._print_response("Tags Universal", response)
        response.raise_for_status()
        return response.json()

    # 4. Tags Description
    # GET {{URL_gc}}/tags/{{description_TagId}}
    def tags_description(self) -> Any:
        url = self._build_url(f"/tags/{DESCRIPTION_TAG_ID}")

        response = self.session.get(
            url,
            headers=self._auth_headers(),
            timeout=REQUEST_TIMEOUT_SECONDS,
        )

        self._print_response("Tags Description", response)
        response.raise_for_status()
        return response.json()

    # 5. Tags Accuracy
    # GET {{URL_gc}}/tags/{{accuracy_TagId}}
    def tags_accuracy(self) -> Any:
        self._require_filled("ACCURACY_TAG_ID", ACCURACY_TAG_ID)

        url = self._build_url(f"/tags/{ACCURACY_TAG_ID}")

        response = self.session.get(
            url,
            headers=self._auth_headers(),
            timeout=REQUEST_TIMEOUT_SECONDS,
        )

        self._print_response("Tags Accuracy", response)
        response.raise_for_status()
        return response.json()

    # 6. CriteriaTypes
    # GET {{URL_gc}}/criteriatypes/{{criteriaTypeId}}
    def criteria_types(self) -> Any:
        self._require_filled("CRITERIA_TYPE_ID", CRITERIA_TYPE_ID)

        url = self._build_url(f"/criteriatypes/{CRITERIA_TYPE_ID}")

        response = self.session.get(
            url,
            headers=self._auth_headers(),
            timeout=REQUEST_TIMEOUT_SECONDS,
        )

        self._print_response("CriteriaTypes", response)
        response.raise_for_status()
        return response.json()

    # 7. Criterias For Accuracy
    # GET {{URL_gc}}/criterias?tagid={{accuracy_TagId}}
    def criterias_for_accuracy(self) -> Any:
        self._require_filled("ACCURACY_TAG_ID", ACCURACY_TAG_ID)

        url = self._build_url("/criterias")

        response = self.session.get(
            url,
            params={"tagid": ACCURACY_TAG_ID},
            headers=self._auth_headers(),
            timeout=REQUEST_TIMEOUT_SECONDS,
        )

        self._print_response("Criterias For Accuracy", response)
        response.raise_for_status()
        return response.json()

    # 8. Criterias Includes a clear intended
    # GET {{URL_gc}}/criterias/{{criteriaId}}
    def criterias_includes_a_clear_intended(self) -> Any:
        self._require_filled("CRITERIA_ID", CRITERIA_ID)

        url = self._build_url(f"/criterias/{CRITERIA_ID}")

        response = self.session.get(
            url,
            headers=self._auth_headers(),
            timeout=REQUEST_TIMEOUT_SECONDS,
        )

        self._print_response("Criterias Includes a clear intended", response)
        response.raise_for_status()
        return response.json()

    # 9. CriteriaScores
    # GET {{URL_gc}}/criteriascores?criteriaId={{criteriaId}}
    def criteria_scores(self) -> Any:
        self._require_filled("CRITERIA_ID", CRITERIA_ID)

        url = self._build_url("/criteriascores")

        response = self.session.get(
            url,
            params={"criteriaId": CRITERIA_ID},
            headers=self._auth_headers(),
            timeout=REQUEST_TIMEOUT_SECONDS,
        )

        self._print_response("CriteriaScores", response)
        response.raise_for_status()
        return response.json()

    # 10. CriteriaScoreExamples
    # GET {{URL_gc}}/criteriascoreexamples?criteriaId={{criteriaId}}
    def criteria_score_examples(self) -> Any:
        self._require_filled("CRITERIA_ID", CRITERIA_ID)

        url = self._build_url("/criteriascoreexamples")

        response = self.session.get(
            url,
            params={"criteriaId": CRITERIA_ID},
            headers=self._auth_headers(),
            timeout=REQUEST_TIMEOUT_SECONDS,
        )

        self._print_response("CriteriaScoreExamples", response)
        response.raise_for_status()
        return response.json()

    def fetch_criteria_scores(self, criteria_id: str) -> Any:
        """Fetch score levels for any criterion by id."""
        url = self._build_url("/criteriascores")
        response = self.session.get(
            url,
            params={"criteriaId": criteria_id},
            headers=self._auth_headers(),
            timeout=REQUEST_TIMEOUT_SECONDS,
        )
        response.raise_for_status()
        return response.json()

    def fetch_criteria_score_examples(self, criteria_id: str) -> Any:
        """Fetch score examples for any criterion by id."""
        url = self._build_url("/criteriascoreexamples")
        response = self.session.get(
            url,
            params={"criteriaId": criteria_id},
            headers=self._auth_headers(),
            timeout=REQUEST_TIMEOUT_SECONDS,
        )
        response.raise_for_status()
        return response.json()

    def extract_accuracy_criteria_to_json(self, output_path: str = "accuracy_criteria.json") -> Any:
        """Fetch all criteria for the accuracy tag and save to a JSON file."""
        data = self.criterias_for_accuracy()

        with open(output_path, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2, ensure_ascii=False)

        print(f"\nSaved accuracy criteria to {output_path}")
        return data

    def run_collection_in_order(self) -> Dict[str, Any]:
        """Run every request in the Postman collection order."""
        results: Dict[str, Any] = {}

        results["Token"] = self.token()
        results["TagTypes"] = self.tag_types()
        results["Tags Universal"] = self.tags_universal()
        results["Tags Description"] = self.tags_description()
        results["Tags Accuracy"] = self.tags_accuracy()
        results["CriteriaTypes"] = self.criteria_types()
        results["Criterias For Accuracy"] = self.criterias_for_accuracy()
        results[
            "Criterias Includes a clear intended"
        ] = self.criterias_includes_a_clear_intended()
        results["CriteriaScores"] = self.criteria_scores()
        results["CriteriaScoreExamples"] = self.criteria_score_examples()

        return results


def main() -> int:
    client = TakootEvalsSeanClient()

    try:
        client.token()
        client.extract_accuracy_criteria_to_json("accuracy_criteria.json")
    except Exception as exc:
        print(f"\nERROR: {exc}", file=sys.stderr)
        return 1

    return 0


if __name__ == "__main__":
    sys.exit(main())
