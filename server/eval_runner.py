"""
Self-contained eval runner using local SQLite criterion definitions.

Azure OpenAI credentials are read from environment variables (loaded from
.env.local / .env.docker / .env if present) — never hardcoded:
  AZURE_OPENAI_ENDPOINT      (required)
  AZURE_OPENAI_API_KEY       (required)
  AZURE_OPENAI_API_VERSION   (default 2024-12-01-preview)
  AZURE_OPENAI_DEPLOYMENT    (model/deployment name, default gpt-5)
"""
from __future__ import annotations

import json
import os
import re
from pathlib import Path

from openai import AzureOpenAI

# Load credentials from local env files if python-dotenv is available. Existing
# environment variables are not overridden (override=False), so values injected
# by Docker/CI win. Safe if the package or files are absent.
try:
    from dotenv import load_dotenv

    _ROOT = Path(__file__).resolve().parent.parent
    for _env_name in (".env", ".env.local", ".env.docker"):
        load_dotenv(_ROOT / _env_name, override=False)
except ImportError:
    pass


def llm_model() -> str:
    return os.environ.get("AZURE_OPENAI_DEPLOYMENT", "gpt-5")


_ai_client: AzureOpenAI | None = None


def ai_client() -> AzureOpenAI:
    """Lazily build the Azure OpenAI client so importing this module never
    requires credentials (and a missing key fails clearly at call time)."""
    global _ai_client
    if _ai_client is None:
        endpoint = os.environ.get("AZURE_OPENAI_ENDPOINT")
        api_key = os.environ.get("AZURE_OPENAI_API_KEY")
        if not endpoint or not api_key:
            raise RuntimeError(
                "Azure OpenAI credentials are not configured. Set AZURE_OPENAI_ENDPOINT "
                "and AZURE_OPENAI_API_KEY (e.g. in .env.local)."
            )
        _ai_client = AzureOpenAI(
            azure_endpoint=endpoint,
            api_key=api_key,
            api_version=os.environ.get("AZURE_OPENAI_API_VERSION", "2024-12-01-preview"),
        )
    return _ai_client


def _call_llm(messages: list[dict]) -> dict | str:
    response = ai_client().chat.completions.create(
        model=llm_model(),
        messages=messages,
    )
    raw = response.choices[0].message.content or ""
    cleaned = raw.replace("```json", "").replace("```", "").strip()
    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        return raw


# ---------------------------------------------------------------------------
# Product data extraction
# ---------------------------------------------------------------------------

def _extract_last_user_message(request_messages: list[dict]) -> str:
    for msg in reversed(request_messages):
        if msg.get("role") == "user":
            return msg.get("content", "")
    return ""


def _parse_product_json(text: str) -> dict:
    match = re.search(r"\{[^{}]+\}", text)
    if not match:
        return {}
    try:
        return json.loads(match.group(0))
    except json.JSONDecodeError:
        return {}


def extract_product_data(request_messages: list[dict]) -> dict:
    raw = _parse_product_json(_extract_last_user_message(request_messages))

    def split_semi(value: str) -> list[str]:
        return [v.strip() for v in value.split(";") if v.strip()]

    return {
        "product_name": raw.get("Model Name") or raw.get("Title") or "Unknown Product",
        "keywords": split_semi(raw.get("Keywords", "")),
        "lcm_claims": split_semi(raw.get("LCM Claims", "")),
        "optiva_claims": split_semi(raw.get("Optiva Claims", "")),
    }


# ---------------------------------------------------------------------------
# Rubric building from local eval_definition
# ---------------------------------------------------------------------------

def _build_rubric_text(criteria_type: str, eval_definition: dict) -> str:
    lines = ["Scoring rubric:"]

    if criteria_type == "yes-no":
        yes_def = eval_definition.get("definition_yes", "")
        no_def = eval_definition.get("definition_no", "")
        yes_ex = [e for e in (eval_definition.get("yes_examples") or []) if e]
        no_ex = [e for e in (eval_definition.get("no_examples") or []) if e]
        if yes_def:
            lines.append(f"  Yes: {yes_def}")
            for ex in yes_ex:
                lines.append(f'    Example: "{ex}"')
        if no_def:
            lines.append(f"  No: {no_def}")
            for ex in no_ex:
                lines.append(f'    Example: "{ex}"')

    elif criteria_type == "numerical-scale":
        for n in [1, 2, 3, 4]:
            row = eval_definition.get(f"score_{n}", {})
            title = row.get("title", "")
            definition = row.get("definition", "")
            ex1 = row.get("example_1", "")
            ex2 = row.get("example_2", "")
            label = f"Score {n}"
            if title:
                label += f" — {title}"
            if definition:
                label += f": {definition}"
            lines.append(f"  {label}")
            for ex in [ex1, ex2]:
                if ex:
                    lines.append(f'    Example: "{ex}"')

    else:  # count
        buckets = eval_definition.get("buckets") or ["0", "1", "2", "3+"]
        titles = eval_definition.get("bucket_titles") or {}
        definitions = eval_definition.get("bucket_definitions") or {}
        examples = eval_definition.get("bucket_examples") or {}
        for b in buckets:
            label = f"  Count {b}"
            if titles.get(b):
                label += f" — {titles[b]}"
            if definitions.get(b):
                label += f": {definitions[b]}"
            lines.append(label)
            for ex in (examples.get(b) or []):
                if ex:
                    lines.append(f'    Example: "{ex}"')

    return "\n".join(lines)


def _desired_score(criteria_type: str, eval_definition: dict) -> str:
    if criteria_type == "yes-no":
        return "Yes"
    if criteria_type == "numerical-scale":
        return "4"
    # count — last bucket
    buckets = eval_definition.get("buckets") or ["0", "1", "2", "3+"]
    return str(buckets[-1]) if buckets else ""


# ---------------------------------------------------------------------------
# Prompt construction
# ---------------------------------------------------------------------------

def _format_product_section(product_data: dict) -> str:
    lines = [f"PRODUCT NAME: {product_data.get('product_name', '')}"]
    if product_data.get("keywords"):
        lines.append("KEYWORDS: " + ", ".join(product_data["keywords"]))
    if product_data.get("lcm_claims"):
        lines.append("APPROVED LCM CLAIMS:")
        for c in product_data["lcm_claims"]:
            lines.append(f"  - {c}")
    if product_data.get("optiva_claims"):
        lines.append("APPROVED OPTIVA CLAIMS:")
        for c in product_data["optiva_claims"]:
            lines.append(f"  - {c}")
    return "\n".join(lines)


def build_eval_prompt(criterion: dict, copy_text: str, product_data: dict) -> str:
    name = criterion.get("criteria_name", "Unknown")
    description = criterion.get("criteria_definition", "")
    criteria_type = criterion.get("criteria_type", "numerical-scale")
    eval_definition = criterion.get("eval_definition") or {}

    rubric = _build_rubric_text(criteria_type, eval_definition)
    product_section = _format_product_section(product_data)

    if criteria_type == "yes-no":
        score_instruction = 'score: "Yes" or "No"'
    elif criteria_type == "numerical-scale":
        score_instruction = "score: a number from 1 to 4"
    else:
        score_instruction = "score: the count bucket (e.g. 0, 1, 2, 3+)"

    return f"""You are an expert evaluator of ecommerce product copy. Evaluate the copy below against the provided criterion and return a JSON object.

CRITERION: {name}
DESCRIPTION: {description}

{rubric}

PRODUCT DATA:
{product_section}

COPY TO EVALUATE:
{copy_text}

Return ONLY a JSON object with these exact fields:
- "score": {score_instruction}
- "rationale": 1-3 sentences explaining the score with reference to the rubric
- "evidence": a list of 1-3 short quoted phrases from the copy that support your score

Example: {{"score": 3, "rationale": "The copy speaks directly to the reader.", "evidence": ["Fuel your moments", "feel good about your choice"]}}"""


# ---------------------------------------------------------------------------
# Main eval entry point
# ---------------------------------------------------------------------------

def run_single_eval(
    copy_text: str,
    request_messages: list[dict],
    criterion: dict,
) -> dict:
    """
    Run a single criterion eval against one piece of copy.
    criterion is a local SQLite row dict (with eval_definition already parsed).
    Returns a dict with: score, rationale, evidence, criterion_id, criterion_name, desired_score.
    """
    product_data = extract_product_data(request_messages)
    criteria_type = criterion.get("criteria_type", "numerical-scale")
    eval_definition = criterion.get("eval_definition") or {}

    prompt = build_eval_prompt(criterion, copy_text, product_data)
    result = _call_llm([{"role": "user", "content": prompt}])

    if isinstance(result, dict):
        score = result.get("score", "")
        rationale = result.get("rationale", "")
        evidence = result.get("evidence", [])
    else:
        score, rationale, evidence = "", str(result), []

    return {
        "criterion_id": criterion.get("id", ""),
        "criterion_name": criterion.get("criteria_name", ""),
        "desired_score": _desired_score(criteria_type, eval_definition),
        "score": str(score),
        "rationale": rationale,
        "evidence": evidence if isinstance(evidence, list) else [str(evidence)],
        "product_name": product_data["product_name"],
    }
