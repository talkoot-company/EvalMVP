"""
Eval runner: downloads accuracy criteria, evaluates each generation, saves HTML report.

Usage:
    python run_evals.py
"""
from __future__ import annotations

import html
import json
import re
import sys
from datetime import datetime
from pathlib import Path

from talkoot_evals_client import TakootEvalsSeanClient
from utils import gpt5, gpt5_messages

# ---------------------------------------------------------------------------
# Configuration — edit these to control what runs
# ---------------------------------------------------------------------------

# Criteria codes to evaluate. Set to None to run all.
ACTIVE_CRITERIA_CODES: set[str] | None = {
    "AVOIDSHALL",   # Avoids hallucinations
    "INCLUDESRE",   # Includes relevant product details such as materials and ingredients
    "FEATURESAR",   # Features are linked to the correct benefit
    "BULLETSAND",   # Bullets and/or specs provide information that supports the product copy
}

# When True, a rewrite is generated using the original chat chain + eval feedback.
ENABLE_POST_EDIT = True

GENERATIONS_DIR = Path("generations")
RESULTS_DIR = Path("results")
PRODUCT_CACHE_DIR = Path("product_cache")


# ---------------------------------------------------------------------------
# Product data extraction and caching
# ---------------------------------------------------------------------------

def _extract_last_user_message(request: dict) -> str:
    for msg in reversed(request.get("messages", [])):
        if msg.get("role") == "user":
            return msg.get("content", "")
    return ""


def _parse_product_json(text: str) -> dict:
    match = re.search(r'\{[^{}]+\}', text)
    if not match:
        return {}
    try:
        return json.loads(match.group(0))
    except json.JSONDecodeError:
        return {}


def extract_product_data(request: dict) -> dict:
    raw = _parse_product_json(_extract_last_user_message(request))

    def split_semi(value: str) -> list[str]:
        return [v.strip() for v in value.split(";") if v.strip()]

    return {
        "product_name": raw.get("Model Name") or raw.get("Title") or "Unknown Product",
        "keywords": split_semi(raw.get("Keywords", "")),
        "lcm_claims": split_semi(raw.get("LCM Claims", "")),
        "optiva_claims": split_semi(raw.get("Optiva Claims", "")),
    }


def load_or_extract_product_data(gen_id: str, request: dict) -> dict:
    PRODUCT_CACHE_DIR.mkdir(exist_ok=True)
    cache_path = PRODUCT_CACHE_DIR / f"{gen_id}.json"

    if cache_path.exists():
        print(f"  [cache hit] {gen_id}")
        return json.loads(cache_path.read_text(encoding="utf-8"))

    data = extract_product_data(request)
    cache_path.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"  [cached]    {gen_id} → {data['product_name']}")
    return data


# ---------------------------------------------------------------------------
# Loading generations
# ---------------------------------------------------------------------------

def load_generations() -> list[dict]:
    pairs: dict[str, dict] = {}
    for f in GENERATIONS_DIR.glob("*_aiRequest.json"):
        gen_id = f.stem.replace("_aiRequest", "")
        pairs.setdefault(gen_id, {})["request"] = json.loads(f.read_text(encoding="utf-8"))
    for f in GENERATIONS_DIR.glob("*_aiResponse.json"):
        gen_id = f.stem.replace("_aiResponse", "")
        pairs.setdefault(gen_id, {})["response"] = json.loads(f.read_text(encoding="utf-8"))

    generations = []
    for gen_id, data in pairs.items():
        if "request" not in data or "response" not in data:
            print(f"  Skipping incomplete pair: {gen_id}", file=sys.stderr)
            continue
        product_data = load_or_extract_product_data(gen_id, data["request"])
        generations.append({
            "generation_id": gen_id,
            "product_name": product_data["product_name"],
            "product_data": product_data,
            "copy_text": _extract_copy(data["response"]),
            "request_messages": data["request"].get("messages", []),
        })
    return generations


def _extract_copy(response: dict) -> str:
    try:
        return response["Choices"][0]["Message"]["content"]
    except (KeyError, IndexError, TypeError):
        return ""


# ---------------------------------------------------------------------------
# Fetching criteria from the API
# ---------------------------------------------------------------------------

def fetch_full_criteria(client: TakootEvalsSeanClient) -> list[dict]:
    criteria_list = client.criterias_for_accuracy()
    if not isinstance(criteria_list, list):
        criteria_list = [criteria_list]

    enriched = []
    for criterion in criteria_list:
        cid = str(criterion.get("criteriaId", criterion.get("id", criterion.get("Id", ""))))
        if not cid:
            continue

        code = criterion.get("criteriaCode", "")
        if ACTIVE_CRITERIA_CODES is not None and code not in ACTIVE_CRITERIA_CODES:
            continue

        try:
            scores = client.fetch_criteria_scores(cid)
        except Exception as e:
            print(f"  Warning: could not fetch scores for criterion {cid}: {e}", file=sys.stderr)
            scores = []

        try:
            examples = client.fetch_criteria_score_examples(cid)
        except Exception as e:
            print(f"  Warning: could not fetch examples for criterion {cid}: {e}", file=sys.stderr)
            examples = []

        enriched.append({**criterion, "_scores": scores, "_examples": examples})
    return enriched


# ---------------------------------------------------------------------------
# Building the eval prompt
# ---------------------------------------------------------------------------

def _build_rubric_text(scores: list, examples: list) -> str:
    if not scores:
        return ""

    example_map: dict[str, list[str]] = {}
    for ex in (examples or []):
        sid = str(ex.get("criteriaScoreId", ""))
        text = ex.get("example", ex.get("Example", ""))
        if text:
            example_map.setdefault(sid, []).append(text)

    lines = ["Scoring rubric:"]
    for s in sorted(scores, key=lambda x: x.get("rankOrder", 0)):
        score_val = s.get("scoreAmount", "")
        label = s.get("criteriaScoreTitle", "")
        definition = s.get("criteriaScoreDefinition", "")
        sid = str(s.get("criteriaScoreId", ""))
        lines.append(f"  Score {score_val} — {label}: {definition}")
        for ex_text in example_map.get(sid, []):
            lines.append(f'    Example: "{ex_text}"')

    return "\n".join(lines)


def _get_desired_score(criterion: dict) -> str:
    scores = criterion.get("_scores", [])
    if not scores:
        return ""
    values = [s.get("scoreAmount", "") for s in scores]
    values = [v for v in values if v != ""]
    if not values:
        return ""
    try:
        return str(max(int(v) for v in values))
    except (ValueError, TypeError):
        return str(values[-1])


def _format_product_data_section(product_data: dict) -> str:
    lines = [f"PRODUCT NAME: {product_data.get('product_name', '')}"]
    if product_data.get("keywords"):
        lines.append("KEYWORDS: " + ", ".join(product_data["keywords"]))
    if product_data.get("lcm_claims"):
        lines.append("APPROVED LCM CLAIMS (legally permitted on-pack claims):")
        for c in product_data["lcm_claims"]:
            lines.append(f"  - {c}")
    if product_data.get("optiva_claims"):
        lines.append("APPROVED OPTIVA CLAIMS (attribute badges/icons):")
        for c in product_data["optiva_claims"]:
            lines.append(f"  - {c}")
    return "\n".join(lines)


def build_eval_prompt(criterion: dict, copy_text: str, product_data: dict) -> str:
    name = criterion.get("criteriaName", criterion.get("name", criterion.get("Name", "Unknown criterion")))
    description = criterion.get("criteriaDefinition", criterion.get("description", criterion.get("Description", "")))
    rubric = _build_rubric_text(criterion.get("_scores", []), criterion.get("_examples", []))
    product_section = _format_product_data_section(product_data)

    return f"""You are an expert evaluator of ecommerce product copy. Evaluate the copy below against the provided criterion and return a JSON object.

CRITERION: {name}
DESCRIPTION: {description}

{rubric}

PRODUCT DATA:
{product_section}

COPY TO EVALUATE:
{copy_text}

Return ONLY a JSON object with these exact fields:
- "score": the numeric score (or "Yes"/"No" for pass/fail criteria)
- "rationale": 1-3 sentences explaining the score with reference to the rubric
- "evidence": a list of 1-3 short quoted phrases from the copy that support your score

Example: {{"score": 3, "rationale": "The copy speaks directly to the reader with warm phrasing.", "evidence": ["Fuel your moments", "you can feel good about your choice"]}}"""


# ---------------------------------------------------------------------------
# Running evaluations
# ---------------------------------------------------------------------------

def run_evals(generations: list[dict], criteria: list[dict]) -> list[dict]:
    """Return one result dict per generation, each containing its eval rows."""
    total = len(generations) * len(criteria)
    done = 0
    results = []

    for gen in generations:
        eval_rows = []
        for criterion in criteria:
            cid = str(criterion.get("criteriaId", criterion.get("id", criterion.get("Id", ""))))
            cname = criterion.get("criteriaName", criterion.get("name", criterion.get("Name", "")))
            desired = _get_desired_score(criterion)
            prompt = build_eval_prompt(criterion, gen["copy_text"], gen["product_data"])

            print(f"  [{done + 1}/{total}] {gen['product_name'][:40]!r} | {cname[:40]!r}")
            try:
                result = gpt5(prompt)
                if isinstance(result, dict):
                    score = result.get("score", "")
                    rationale = result.get("rationale", "")
                    evidence = result.get("evidence", [])
                else:
                    score, rationale, evidence = "", str(result), []
            except Exception as e:
                print(f"    Error: {e}", file=sys.stderr)
                score, rationale, evidence = "ERROR", str(e), []

            eval_rows.append({
                "criterion_id": cid,
                "criterion_name": cname,
                "desired_score": desired,
                "score": score,
                "rationale": rationale,
                "evidence": evidence if isinstance(evidence, list) else [str(evidence)],
            })
            done += 1

        results.append({**gen, "eval_rows": eval_rows})

    return results


# ---------------------------------------------------------------------------
# Post-editing
# ---------------------------------------------------------------------------

def build_feedback_message(eval_rows: list[dict]) -> str:
    failing = [
        r for r in eval_rows
        if r["desired_score"] and str(r["score"]) != str(r["desired_score"])
    ]
    if not failing:
        return (
            "The product description passed all evaluation criteria. "
            "Please produce a final polished version with no changes to substance."
        )

    lines = [
        "The product description above was evaluated against quality criteria and found the following issues. "
        "Please rewrite the product description to address each issue while preserving the original tone, "
        "structure, brand voice, and all legally approved claims.\n",
        "Issues to address:",
    ]
    for r in failing:
        lines.append(
            f"- {r['criterion_name']} "
            f"(scored {r['score']}/{r['desired_score']}): {r['rationale']}"
        )
    lines.append(
        "\nReturn only the rewritten product description with no commentary or explanation."
    )
    return "\n".join(lines)


def run_post_edit(generation: dict, eval_rows: list[dict]) -> tuple[str, str]:
    feedback = build_feedback_message(eval_rows)
    messages = list(generation["request_messages"]) + [
        {"role": "user", "content": feedback}
    ]
    print(f"  Running post-edit rewrite for {generation['product_name']!r}...")
    try:
        rewritten = gpt5_messages(messages)
    except Exception as e:
        rewritten = f"[Post-edit failed: {e}]"
    return feedback, rewritten


# ---------------------------------------------------------------------------
# HTML report
# ---------------------------------------------------------------------------

_CSS = """
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
       background: #f5f6f8; color: #1a1a2e; padding: 32px 16px; }
h1 { font-size: 1.6rem; margin-bottom: 4px; }
.meta { color: #666; font-size: 0.85rem; margin-bottom: 32px; }
.generation { background: #fff; border-radius: 10px; padding: 28px 32px;
              margin-bottom: 32px; box-shadow: 0 1px 4px rgba(0,0,0,.08); }
.generation h2 { font-size: 1.2rem; margin-bottom: 4px; }
.gen-id { font-size: 0.75rem; color: #999; margin-bottom: 20px; font-family: monospace; }
.section-label { font-size: 0.7rem; font-weight: 700; letter-spacing: .08em;
                 text-transform: uppercase; color: #888; margin-bottom: 8px; }
.copy-box { background: #f8f9fb; border-left: 3px solid #6c63ff; border-radius: 4px;
            padding: 14px 16px; font-size: 0.9rem; line-height: 1.6;
            white-space: pre-wrap; margin-bottom: 24px; }
table { width: 100%; border-collapse: collapse; font-size: 0.85rem; margin-bottom: 24px; }
th { text-align: left; padding: 8px 10px; background: #f0f1f5;
     font-weight: 600; border-bottom: 2px solid #dde; }
td { padding: 8px 10px; border-bottom: 1px solid #eee; vertical-align: top; }
.score-cell { text-align: center; font-weight: 700; border-radius: 4px; }
.pass { background: #d4edda; color: #155724; }
.fail { background: #f8d7da; color: #721c24; }
.evidence { color: #555; font-style: italic; font-size: 0.8rem; }
.feedback-box { background: #fff8e1; border-left: 3px solid #f0a500; border-radius: 4px;
                padding: 14px 16px; font-size: 0.85rem; line-height: 1.6;
                white-space: pre-wrap; margin-bottom: 24px; }
.rewrite-box { background: #f0fff4; border-left: 3px solid #28a745; border-radius: 4px;
               padding: 14px 16px; font-size: 0.9rem; line-height: 1.6;
               white-space: pre-wrap; margin-bottom: 8px; }
.divider { border: none; border-top: 1px solid #eee; margin: 24px 0; }
"""


def _score_cell(score: str, desired: str) -> str:
    if not desired:
        return f'<td class="score-cell">{html.escape(str(score))}</td>'
    css = "pass" if str(score) == str(desired) else "fail"
    return f'<td class="score-cell {css}">{html.escape(str(score))} / {html.escape(str(desired))}</td>'


def _render_generation(gen_result: dict) -> str:
    e = html.escape
    parts = []

    parts.append(f'<div class="generation">')
    parts.append(f'  <h2>{e(gen_result["product_name"])}</h2>')
    parts.append(f'  <div class="gen-id">{e(gen_result["generation_id"])}</div>')

    # Original copy
    parts.append('  <div class="section-label">Original copy</div>')
    parts.append(f'  <div class="copy-box">{e(gen_result["copy_text"])}</div>')

    # Eval results table
    parts.append('  <div class="section-label">Evaluation results</div>')
    parts.append('  <table>')
    parts.append('    <tr><th>Criterion</th><th>Score / Desired</th><th>Rationale</th><th>Evidence</th></tr>')
    for row in gen_result["eval_rows"]:
        evidence_html = " &nbsp;|&nbsp; ".join(
            f'&ldquo;{e(q)}&rdquo;' for q in row["evidence"] if q
        )
        parts.append(
            f'    <tr>'
            f'      <td>{e(row["criterion_name"])}</td>'
            f'      {_score_cell(row["score"], row["desired_score"])}'
            f'      <td>{e(row["rationale"])}</td>'
            f'      <td class="evidence">{evidence_html}</td>'
            f'    </tr>'
        )
    parts.append('  </table>')

    # Post-edit section
    if "feedback_message" in gen_result:
        parts.append('  <hr class="divider">')
        parts.append('  <div class="section-label">Rewrite prompt sent to model</div>')
        parts.append(f'  <div class="feedback-box">{e(gen_result["feedback_message"])}</div>')
        parts.append('  <div class="section-label">Rewritten copy</div>')
        parts.append(f'  <div class="rewrite-box">{e(gen_result["rewritten_copy"])}</div>')

    parts.append('</div>')
    return "\n".join(parts)


def save_html(gen_results: list[dict]) -> Path:
    RESULTS_DIR.mkdir(exist_ok=True)
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    out_path = RESULTS_DIR / f"eval_results_{timestamp}.html"

    active_label = ", ".join(sorted(ACTIVE_CRITERIA_CODES)) if ACTIVE_CRITERIA_CODES else "all"
    body_parts = []
    for gr in gen_results:
        body_parts.append(_render_generation(gr))

    html_doc = f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Eval Results — {html.escape(timestamp)}</title>
  <style>{_CSS}</style>
</head>
<body>
  <h1>Eval Results</h1>
  <div class="meta">
    Generated {html.escape(datetime.now().strftime("%Y-%m-%d %H:%M:%S"))} &nbsp;|&nbsp;
    Criteria: {html.escape(active_label)} &nbsp;|&nbsp;
    Post-edit: {"on" if ENABLE_POST_EDIT else "off"}
  </div>
  {"".join(body_parts)}
</body>
</html>"""

    out_path.write_text(html_doc, encoding="utf-8")
    return out_path


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def main() -> int:
    print("Authenticating...")
    client = TakootEvalsSeanClient()
    client.token()

    print("Fetching accuracy criteria...")
    criteria = fetch_full_criteria(client)
    print(f"  Found {len(criteria)} active criterion/criteria")

    print("Loading generations...")
    generations = load_generations()
    print(f"  Found {len(generations)} generation(s)")

    if not generations:
        print("No generations found in the generations/ folder.", file=sys.stderr)
        return 1
    if not criteria:
        print("No criteria matched. Check ACTIVE_CRITERIA_CODES.", file=sys.stderr)
        return 1

    print(f"Running {len(generations) * len(criteria)} evaluations...")
    gen_results = run_evals(generations, criteria)

    if ENABLE_POST_EDIT:
        print("Running post-edit rewrites...")
        for gr in gen_results:
            feedback, rewritten = run_post_edit(gr, gr["eval_rows"])
            gr["feedback_message"] = feedback
            gr["rewritten_copy"] = rewritten

    out_path = save_html(gen_results)
    print(f"\nDone. Report saved to: {out_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
