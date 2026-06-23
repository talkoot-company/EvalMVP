"""
Import Coca-Cola AI generation files into evals.db.

- Clears existing generations (and eval_results that reference them)
- Pairs aiRequest / aiResponse JSON files by UUID
- Detects and skips non-English generations
- Deduplicates by GenerationID
- Prints a summary at the end
"""

import json
import os
import re
import sqlite3
import sys
from pathlib import Path

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

ROOT = Path(__file__).parent.parent
DB_PATH = ROOT / "db" / "evals.db"
DATA_DIR = ROOT / "data" / "cocacola_extracted"

# Phrases in system prompts / user messages that indicate non-English
NON_ENGLISH_MARKERS = [
    # French
    "en français", "in french", "french language", "en-fr", "fr-ca",
    "rédiger en", "rédigez en", "écrire en français",
    # Spanish
    "in spanish", "en español", "spanish language", "es-mx", "es-us",
    "mexican spanish", "español", "castellano",
    # Portuguese
    "in portuguese", "em português", "portuguese language", "pt-br",
    "português",
    # Italian
    "in italian", "in italiano",
    # Generic non-english
    "write in german", "auf deutsch",
]

# Common non-English words that reliably appear in the *response* text
# (short English words like "de", "le" also appear in English, so use longer patterns)
NON_ENGLISH_RESPONSE_PATTERNS = [
    r"\b(boisson|saveur|canette|bouteille|litre|sucre|zéro|agrumes)\b",  # French
    r"\b(sabor|lata|botella|bebida|azúcar|litro|agua|refresco)\b",       # Spanish
    r"\b(sabor|lata|garrafa|bebida|açúcar|litro|água)\b",                # Portuguese
]

# ---------------------------------------------------------------------------
# Language detection
# ---------------------------------------------------------------------------

def _is_english(system_prompt: str, last_user_msg: str, response_content: str) -> bool:
    """Return True if this generation is in English."""
    check_text = (system_prompt + " " + last_user_msg[:500]).lower()

    for marker in NON_ENGLISH_MARKERS:
        if marker in check_text:
            return False

    # Check response content for non-English word patterns
    for pattern in NON_ENGLISH_RESPONSE_PATTERNS:
        if re.search(pattern, response_content, re.IGNORECASE):
            return False

    # High density of non-ASCII characters in the response → likely non-English
    if response_content:
        non_ascii = sum(1 for c in response_content if ord(c) > 127)
        if non_ascii / len(response_content) > 0.08:  # >8% non-ASCII
            return False

    return True


# ---------------------------------------------------------------------------
# JSON parsing helpers
# ---------------------------------------------------------------------------

def _load_json(path: Path) -> dict | None:
    for enc in ("utf-8", "utf-8-sig", "latin-1"):
        try:
            return json.loads(path.read_text(encoding=enc))
        except (UnicodeDecodeError, json.JSONDecodeError):
            continue
    return None


def _extract_messages(req: dict) -> tuple[str, str, int]:
    """Return (system_prompt, last_user_message, few_shot_count)."""
    messages = req.get("messages", [])
    system_prompt = ""
    user_messages = []
    assistant_count = 0

    for m in messages:
        role = m.get("role", "")
        content = m.get("content", "")
        if role == "system" and not system_prompt:
            system_prompt = content
        elif role == "user":
            user_messages.append(content)
        elif role == "assistant":
            assistant_count += 1

    last_user = user_messages[-1] if user_messages else ""
    # few-shot = assistant messages before the final user turn
    few_shot = max(0, assistant_count)
    return system_prompt, last_user, few_shot


def _extract_response(resp: dict) -> dict | None:
    choices = resp.get("Choices") or resp.get("choices") or []
    if not choices:
        return None
    choice = choices[0]
    msg = choice.get("Message") or choice.get("message") or {}
    content = msg.get("content") or msg.get("Content") or ""
    finish = choice.get("finish_reason") or choice.get("FinishReason") or ""
    usage = resp.get("Usage") or resp.get("usage") or {}
    return {
        "generation_id":   str(resp.get("GenerationID") or resp.get("Id") or ""),
        "model":           resp.get("Model") or resp.get("model") or "",
        "created_at":      resp.get("Created") or resp.get("created"),
        "response_content": content,
        "finish_reason":   finish,
        "prompt_tokens":   usage.get("prompt_tokens") or usage.get("PromptTokens"),
        "completion_tokens": usage.get("completion_tokens") or usage.get("CompletionTokens"),
        "total_tokens":    usage.get("total_tokens") or usage.get("TotalTokens"),
        "is_valid":        resp.get("IsValid"),
    }


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    if not DATA_DIR.exists():
        print(f"ERROR: {DATA_DIR} does not exist", file=sys.stderr)
        sys.exit(1)

    # Collect all UUIDs that have a response file
    resp_files = {
        p.stem.replace("_aiResponse", ""): p
        for p in DATA_DIR.glob("*_aiResponse.json")
    }
    req_files = {
        p.stem.replace("_aiRequest", ""): p
        for p in DATA_DIR.glob("*_aiRequest.json")
    }

    print(f"Found {len(resp_files):,} response files, {len(req_files):,} request files")

    uuids = sorted(resp_files.keys())

    # ---------------------------------------------------------------------------
    # Clear existing generations + dependent eval_results
    # ---------------------------------------------------------------------------
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    conn.execute("DELETE FROM eval_results")
    conn.execute("DELETE FROM generations")
    conn.commit()
    print("Cleared existing generations and eval_results.")

    # ---------------------------------------------------------------------------
    # Process files
    # ---------------------------------------------------------------------------
    inserted = 0
    skipped_no_req = 0
    skipped_non_english = 0
    skipped_duplicate = 0
    skipped_parse_error = 0
    seen_ids: set[str] = set()

    for uuid in uuids:
        resp_path = resp_files[uuid]
        req_path  = req_files.get(uuid)

        # Parse response
        resp = _load_json(resp_path)
        if not resp:
            skipped_parse_error += 1
            continue

        info = _extract_response(resp)
        if not info or not info["generation_id"]:
            skipped_parse_error += 1
            continue

        gen_id = info["generation_id"]

        # Deduplicate
        if gen_id in seen_ids:
            skipped_duplicate += 1
            continue
        seen_ids.add(gen_id)

        # Parse request
        system_prompt, last_user_msg, few_shot_count = "", "", 0
        req_json_str = None
        if req_path:
            req = _load_json(req_path)
            if req:
                system_prompt, last_user_msg, few_shot_count = _extract_messages(req)
                temperature    = req.get("temperature")
                max_tokens     = req.get("max_tokens")
                top_p          = req.get("top_p")
                freq_penalty   = req.get("frequency_penalty")
                pres_penalty   = req.get("presence_penalty")
                req_json_str   = json.dumps(req)
            else:
                temperature = max_tokens = top_p = freq_penalty = pres_penalty = None
        else:
            skipped_no_req += 1
            temperature = max_tokens = top_p = freq_penalty = pres_penalty = None

        # Language filter
        if not _is_english(system_prompt, last_user_msg, info["response_content"]):
            skipped_non_english += 1
            continue

        resp_json_str = json.dumps(resp)

        conn.execute(
            """INSERT OR IGNORE INTO generations
               (generation_id, model, created_at, system_prompt, last_user_message,
                few_shot_count, temperature, max_tokens,
                response_content, prompt_tokens, completion_tokens, total_tokens,
                finish_reason, is_valid, req_json, resp_json)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (
                gen_id,
                info["model"],
                info["created_at"],
                system_prompt,
                last_user_msg,
                few_shot_count,
                temperature,
                max_tokens,
                info["response_content"],
                info["prompt_tokens"],
                info["completion_tokens"],
                info["total_tokens"],
                info["finish_reason"],
                1 if info["is_valid"] else 0,
                req_json_str,
                resp_json_str,
            ),
        )
        inserted += 1

        if inserted % 500 == 0:
            conn.commit()
            print(f"  {inserted:,} inserted so far…")

    conn.commit()
    conn.close()

    print(f"\n{'='*50}")
    print(f"Done.")
    print(f"  Inserted:           {inserted:,}")
    print(f"  Skipped (no req):   {skipped_no_req:,}")
    print(f"  Skipped (non-EN):   {skipped_non_english:,}")
    print(f"  Skipped (dupe):     {skipped_duplicate:,}")
    print(f"  Skipped (parse err):{skipped_parse_error:,}")
    print(f"  Total processed:    {len(uuids):,}")


if __name__ == "__main__":
    main()
