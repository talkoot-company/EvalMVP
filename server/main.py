"""
FastAPI server for the EvalMVP criteria database.

Serves criteria data from db/evals.db over HTTP.
Automatically creates the database if it doesn't exist by running seed.py.

Run:
    uvicorn server.main:app --reload --port 8000
or via npm run dev (started automatically alongside Vite).
"""

import json
import re
import sqlite3
import subprocess
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, field_validator

ROOT = Path(__file__).parent.parent
DB_PATH = ROOT / "db" / "evals.db"
SEED_SCRIPT = ROOT / "db" / "seed.py"

app = FastAPI(title="EvalMVP API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:8080", "http://localhost:5173", "http://localhost:3000"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# DB helpers
# ---------------------------------------------------------------------------

def get_conn() -> sqlite3.Connection:
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    return conn


def _db_has_table(table: str) -> bool:
    try:
        with get_conn() as conn:
            row = conn.execute(
                "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (table,)
            ).fetchone()
            return row is not None
    except Exception:
        return False


def _run_seed() -> None:
    print("Running seed.py …", file=sys.stderr)
    result = subprocess.run(
        [sys.executable, str(SEED_SCRIPT)],
        capture_output=True, text=True,
        cwd=str(ROOT),
    )
    if result.returncode != 0:
        print(result.stderr, file=sys.stderr)
        raise RuntimeError("seed.py failed — check the output above")
    print(result.stdout, file=sys.stderr)


def ensure_db() -> None:
    if not DB_PATH.exists():
        print("Database not found — seeding …", file=sys.stderr)
        _run_seed()
        return

    # eval_results is created by seed but we handle it gracefully if missing
    if not _db_has_table("eval_results"):
        try:
            with get_conn() as conn:
                conn.execute("""
                    CREATE TABLE IF NOT EXISTS eval_results (
                        id TEXT PRIMARY KEY, generation_id TEXT NOT NULL,
                        criterion_id TEXT NOT NULL, criterion_name TEXT,
                        desired_score TEXT, score TEXT, rationale TEXT,
                        evidence TEXT, product_name TEXT, run_at TEXT NOT NULL
                    )
                """)
        except Exception as e:
            print(f"Warning: could not create eval_results table: {e}", file=sys.stderr)

    missing = [t for t in ("criteria", "generations", "type_mapping") if not _db_has_table(t)]
    if missing:
        print(f"Missing tables {missing} — re-seeding …", file=sys.stderr)
        _run_seed()

    # Add notes column if it doesn't exist yet (safe to run every startup)
    try:
        with get_conn() as conn:
            conn.execute("ALTER TABLE criteria ADD COLUMN notes TEXT")
    except Exception:
        pass  # column already exists

    # Ensure indexes for common query patterns (idempotent)
    with get_conn() as conn:
        conn.execute("CREATE INDEX IF NOT EXISTS idx_generations_created_at ON generations (created_at DESC)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_generations_model ON generations (model)")


def row_to_criterion(row: sqlite3.Row) -> dict:
    d = dict(row)
    d["eval_definition"] = json.loads(d["eval_definition"])
    d["custom_tags"] = json.loads(d.get("custom_tags") or "{}")
    d["active"] = bool(d["active"])
    return d


# ---------------------------------------------------------------------------
# Pydantic models
# ---------------------------------------------------------------------------

class CriterionIn(BaseModel):
    id: str | None = None
    context: str
    content_type: str
    criteria_category: str | None = None
    criteria_name: str
    criteria_definition: str | None = ""
    criteria_type: str
    eval_definition: dict[str, Any]
    weight: float = 1.0
    active: bool = True
    marketplace_tag: str | None = None
    brand_tag: str | None = None
    industry_tag: str | None = None
    customer: str | None = None
    brand: str | None = None
    custom_tags: dict[str, list[str]] | None = None
    notes: str | None = None


# ---------------------------------------------------------------------------
# Startup
# ---------------------------------------------------------------------------

@app.on_event("startup")
def startup() -> None:
    ensure_db()


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@app.get("/api/criteria")
def list_criteria() -> list[dict]:
    with get_conn() as conn:
        rows = conn.execute("SELECT * FROM criteria ORDER BY context, content_type, criteria_category, criteria_name").fetchall()
    return [row_to_criterion(r) for r in rows]


@app.get("/api/criteria/{criterion_id}")
def get_criterion(criterion_id: str) -> dict:
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM criteria WHERE id = ?", (criterion_id,)).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Criterion not found")
    return row_to_criterion(row)


def _slugify(text: str) -> str:
    text = text.lower().strip()
    text = re.sub(r"[^\w\s-]", "", text)
    text = re.sub(r"[\s_]+", "-", text)
    text = re.sub(r"-+", "-", text)
    return text.strip("-")[:80]


@app.post("/api/criteria", status_code=201)
def create_criterion(body: CriterionIn) -> dict:
    now = datetime.now(timezone.utc).isoformat()
    cid = body.id or f"{_slugify(body.criteria_name)}-{_slugify(body.content_type)}"
    with get_conn() as conn:
        existing = conn.execute("SELECT id FROM criteria WHERE id = ?", (cid,)).fetchone()
        if existing:
            raise HTTPException(status_code=409, detail=f"Criterion '{cid}' already exists")
        conn.execute(
            """INSERT INTO criteria
               (id, context, content_type, criteria_category, criteria_name,
                criteria_definition, criteria_type, eval_definition,
                weight, active, marketplace_tag, brand_tag, industry_tag,
                customer, brand, custom_tags, created_at, updated_at)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (cid, body.context, body.content_type, body.criteria_category,
             body.criteria_name, body.criteria_definition or "", body.criteria_type,
             json.dumps(body.eval_definition), body.weight, 1 if body.active else 0,
             body.marketplace_tag, body.brand_tag, body.industry_tag,
             body.customer, body.brand,
             json.dumps(body.custom_tags or {}), now, now),
        )
        row = conn.execute("SELECT * FROM criteria WHERE id = ?", (cid,)).fetchone()
    return row_to_criterion(row)


@app.put("/api/criteria/{criterion_id}")
def update_criterion(criterion_id: str, body: CriterionIn) -> dict:
    now = datetime.now(timezone.utc).isoformat()
    with get_conn() as conn:
        existing = conn.execute("SELECT created_at FROM criteria WHERE id = ?", (criterion_id,)).fetchone()
        if not existing:
            raise HTTPException(status_code=404, detail="Criterion not found")
        conn.execute(
            """UPDATE criteria SET
               context=?, content_type=?, criteria_category=?, criteria_name=?,
               criteria_definition=?, criteria_type=?, eval_definition=?,
               weight=?, active=?, marketplace_tag=?, brand_tag=?, industry_tag=?,
               customer=?, brand=?, custom_tags=?, notes=?, updated_at=?
               WHERE id=?""",
            (body.context, body.content_type, body.criteria_category, body.criteria_name,
             body.criteria_definition or "", body.criteria_type,
             json.dumps(body.eval_definition), body.weight, 1 if body.active else 0,
             body.marketplace_tag, body.brand_tag, body.industry_tag,
             body.customer, body.brand,
             json.dumps(body.custom_tags or {}), body.notes, now, criterion_id),
        )
        row = conn.execute("SELECT * FROM criteria WHERE id = ?", (criterion_id,)).fetchone()
    return row_to_criterion(row)


@app.delete("/api/criteria/{criterion_id}", status_code=204)
def delete_criterion(criterion_id: str) -> None:
    with get_conn() as conn:
        existing = conn.execute("SELECT id FROM criteria WHERE id = ?", (criterion_id,)).fetchone()
        if not existing:
            raise HTTPException(status_code=404, detail="Criterion not found")
        conn.execute("DELETE FROM criteria WHERE id = ?", (criterion_id,))


@app.put("/api/criteria/{criterion_id}/toggle-active")
def toggle_active(criterion_id: str) -> dict:
    now = datetime.now(timezone.utc).isoformat()
    with get_conn() as conn:
        row = conn.execute("SELECT active FROM criteria WHERE id = ?", (criterion_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Criterion not found")
        new_active = 0 if row["active"] else 1
        conn.execute("UPDATE criteria SET active=?, updated_at=? WHERE id=?", (new_active, now, criterion_id))
        updated = conn.execute("SELECT * FROM criteria WHERE id = ?", (criterion_id,)).fetchone()
    return row_to_criterion(updated)


# ---------------------------------------------------------------------------
# Generations routes
# ---------------------------------------------------------------------------

def row_to_generation(row: sqlite3.Row, include_raw: bool = False) -> dict:
    d = dict(row)
    for field in ("req_json", "resp_json"):
        raw = d.pop(field, None)  # always remove from dict first
        if include_raw and raw:
            try:
                d[field] = json.loads(raw)
            except json.JSONDecodeError:
                d[field] = raw
    d["is_valid"] = bool(d["is_valid"]) if d.get("is_valid") is not None else None
    return d


@app.get("/api/generations")
def list_generations(
    search: str = "",
    model: str = "",
    limit: int = 100,
    offset: int = 0,
) -> dict:
    conditions = []
    params: list = []

    if search:
        conditions.append(
            "(last_user_message LIKE ? OR response_content LIKE ? OR system_prompt LIKE ?)"
        )
        like = f"%{search}%"
        params += [like, like, like]

    if model:
        conditions.append("model = ?")
        params.append(model)

    where = ("WHERE " + " AND ".join(conditions)) if conditions else ""

    with get_conn() as conn:
        total = conn.execute(
            f"SELECT COUNT(*) FROM generations {where}", params
        ).fetchone()[0]
        rows = conn.execute(
            f"""SELECT generation_id, model, created_at, system_prompt,
                       last_user_message, few_shot_count, temperature, max_tokens,
                       response_content, prompt_tokens, completion_tokens, total_tokens,
                       finish_reason, is_valid
                FROM generations {where}
                ORDER BY created_at DESC NULLS LAST
                LIMIT ? OFFSET ?""",
            params + [limit, offset],
        ).fetchall()

    return {
        "total": total,
        "limit": limit,
        "offset": offset,
        "items": [row_to_generation(r) for r in rows],
    }


@app.get("/api/generations/counts-by-type")
def generation_counts_by_type() -> dict[str, int]:
    """Returns count of generations per inferred type, using SQL CASE for speed."""
    with get_conn() as conn:
        rows = conn.execute("""
            SELECT
              CASE
                WHEN instr(lower(system_prompt), 'bullet') > 0 THEN 'Bullets'
                WHEN instr(lower(system_prompt), 'sustainab') > 0 THEN 'Sustainability'
                WHEN instr(lower(system_prompt), 'extract') > 0
                  OR instr(lower(system_prompt), 'lookup') > 0
                  OR instr(lower(system_prompt), 'identify') > 0 THEN 'Extraction'
                WHEN instr(lower(system_prompt), 'title') > 0
                  OR instr(lower(system_prompt), 'subhead') > 0
                  OR instr(lower(system_prompt), 'naming') > 0 THEN 'Title'
                WHEN instr(lower(system_prompt), 'description') > 0
                  OR instr(lower(system_prompt), 'copywriter') > 0
                  OR instr(lower(system_prompt), 'copy') > 0 THEN 'Description'
                ELSE 'Other'
              END AS type,
              COUNT(*) AS cnt
            FROM generations
            WHERE system_prompt IS NOT NULL
            GROUP BY type
        """).fetchall()
    return {r["type"]: r["cnt"] for r in rows}


@app.get("/api/generations/models")
def list_generation_models() -> list[str]:
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT DISTINCT model FROM generations WHERE model IS NOT NULL ORDER BY model"
        ).fetchall()
    return [r["model"] for r in rows]


@app.get("/api/generations/{generation_id}")
def get_generation(generation_id: str) -> dict:
    with get_conn() as conn:
        row = conn.execute(
            "SELECT * FROM generations WHERE generation_id = ?", (generation_id,)
        ).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Generation not found")
    return row_to_generation(row, include_raw=True)


# ---------------------------------------------------------------------------
# Type-mapping routes
# ---------------------------------------------------------------------------

GENERATION_TYPES = ["Title", "Description", "Bullets", "Sustainability", "Extraction", "Other"]
CRITERIA_CONTENT_TYPES = ["Title", "Description", "Bullets/Specs", "Meta Description"]


def _ensure_type_mapping_table() -> None:
    with get_conn() as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS type_mapping (
                criteria_content_type TEXT NOT NULL,
                generation_type       TEXT NOT NULL,
                PRIMARY KEY (criteria_content_type, generation_type)
            )
        """)
        # Seed defaults if empty
        count = conn.execute("SELECT COUNT(*) FROM type_mapping").fetchone()[0]
        if count == 0:
            defaults = [
                ("Title",           "Title"),
                ("Description",     "Description"),
                ("Bullets/Specs",   "Bullets"),
                ("Meta Description","Description"),
            ]
            conn.executemany(
                "INSERT OR IGNORE INTO type_mapping VALUES (?,?)", defaults
            )


@app.get("/api/mapping")
def get_mapping() -> dict[str, list[str]]:
    """Returns { criteria_content_type: [generation_type, ...] }"""
    _ensure_type_mapping_table()
    result: dict[str, list[str]] = {ct: [] for ct in CRITERIA_CONTENT_TYPES}
    with get_conn() as conn:
        rows = conn.execute("SELECT criteria_content_type, generation_type FROM type_mapping").fetchall()
    for r in rows:
        ct = r["criteria_content_type"]
        if ct in result:
            result[ct].append(r["generation_type"])
    return result


@app.put("/api/mapping")
def update_mapping(body: dict[str, list[str]]) -> dict[str, list[str]]:
    """Replace the full mapping. Body: { criteria_content_type: [generation_type, ...] }"""
    _ensure_type_mapping_table()
    with get_conn() as conn:
        conn.execute("DELETE FROM type_mapping")
        for ct, gen_types in body.items():
            for gt in gen_types:
                conn.execute(
                    "INSERT OR IGNORE INTO type_mapping VALUES (?,?)", (ct, gt)
                )
    return get_mapping()


@app.get("/api/mapping/generation-types")
def get_generation_types() -> list[str]:
    return GENERATION_TYPES


# ---------------------------------------------------------------------------
# Eval routes
# ---------------------------------------------------------------------------

RESULTS_DIR = ROOT / "server" / "results"


@app.get("/api/eval/criteria")
def get_eval_criteria() -> list[dict]:
    """Return all active criteria from SQLite for use in eval dropdowns."""
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT id, criteria_name, criteria_definition, criteria_type, criteria_category "
            "FROM criteria WHERE active = 1 ORDER BY context, content_type, criteria_name"
        ).fetchall()
    return [
        {
            "criteriaId": r["id"],
            "criteriaCode": r["id"],
            "criteriaName": r["criteria_name"],
            "criteriaDefinition": r["criteria_definition"] or "",
        }
        for r in rows
    ]


def _save_html_result(result: dict) -> Path:
    import html as html_mod
    RESULTS_DIR.mkdir(parents=True, exist_ok=True)
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    safe_gen_id = result["generation_id"][:8]
    out_path = RESULTS_DIR / f"eval_{safe_gen_id}_{timestamp}.html"

    e = html_mod.escape
    row = result
    evidence_html = " &nbsp;|&nbsp; ".join(
        f'&ldquo;{e(q)}&rdquo;' for q in (row.get("evidence") or []) if q
    )
    score_label = f"{e(str(row['score']))} / {e(str(row['desired_score']))}" if row.get("desired_score") else e(str(row.get("score", "")))
    pass_fail = ""
    if row.get("desired_score"):
        pass_fail = "pass" if str(row["score"]) == str(row["desired_score"]) else "fail"

    html_doc = f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Eval — {e(row.get('product_name', ''))} — {e(row.get('criterion_name', ''))}</title>
  <style>
    body {{ font-family: system-ui, sans-serif; max-width: 800px; margin: 40px auto; padding: 0 16px; color: #1a1a2e; }}
    h1 {{ font-size: 1.4rem; margin-bottom: 4px; }}
    .meta {{ color: #666; font-size: 0.8rem; margin-bottom: 24px; }}
    .label {{ font-size: 0.7rem; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; color: #888; margin-bottom: 6px; }}
    .box {{ background: #f8f9fb; border-left: 3px solid #6c63ff; border-radius: 4px; padding: 14px 16px; font-size: 0.9rem; line-height: 1.6; white-space: pre-wrap; margin-bottom: 20px; }}
    .score {{ display: inline-block; font-weight: 700; padding: 4px 12px; border-radius: 4px; font-size: 1.1rem; margin-bottom: 20px; }}
    .pass {{ background: #d4edda; color: #155724; }}
    .fail {{ background: #f8d7da; color: #721c24; }}
    .neutral {{ background: #e2e3e5; color: #383d41; }}
    .evidence {{ color: #555; font-style: italic; font-size: 0.85rem; }}
  </style>
</head>
<body>
  <h1>{e(row.get('product_name', 'Unknown product'))}</h1>
  <div class="meta">
    Generation {e(result['generation_id'])} &nbsp;|&nbsp;
    Criterion: {e(row.get('criterion_name', ''))} &nbsp;|&nbsp;
    Run at {e(result.get('run_at', ''))}
  </div>
  <div class="label">Score</div>
  <div class="score {pass_fail or 'neutral'}">{score_label}</div>
  <div class="label">Rationale</div>
  <div class="box">{e(row.get('rationale', ''))}</div>
  <div class="label">Evidence</div>
  <p class="evidence">{evidence_html or '—'}</p>
</body>
</html>"""

    out_path.write_text(html_doc, encoding="utf-8")
    return out_path


class RunEvalRequest(BaseModel):
    generation_id: str
    criterion_id: str | None = None
    criterion_name: str | None = None

    @field_validator("criterion_id", mode="before")
    @classmethod
    def coerce_criterion_id(cls, v: object) -> str | None:
        return str(v) if v is not None else None


@app.post("/api/eval/run")
def run_eval(body: RunEvalRequest) -> dict:
    if not body.criterion_id and not body.criterion_name:
        raise HTTPException(status_code=422, detail="Either criterion_id or criterion_name is required")

    # 1. Load generation from DB
    with get_conn() as conn:
        gen_row = conn.execute(
            "SELECT * FROM generations WHERE generation_id = ?", (body.generation_id,)
        ).fetchone()
    if not gen_row:
        raise HTTPException(status_code=404, detail="Generation not found")

    copy_text = gen_row["response_content"] or ""
    req_json_raw = gen_row["req_json"]
    try:
        req_data = json.loads(req_json_raw) if isinstance(req_json_raw, str) else (req_json_raw or {})
    except (json.JSONDecodeError, TypeError):
        req_data = {}
    request_messages = req_data.get("messages", [])

    # 2. Load criterion from SQLite
    with get_conn() as conn:
        if body.criterion_id:
            crit_row = conn.execute(
                "SELECT * FROM criteria WHERE id = ?", (body.criterion_id,)
            ).fetchone()
        elif body.criterion_name:
            crit_row = conn.execute(
                "SELECT * FROM criteria WHERE LOWER(criteria_name) = LOWER(?)", (body.criterion_name,)
            ).fetchone()
        else:
            crit_row = None

    if crit_row is None:
        raise HTTPException(
            status_code=404,
            detail=f"Criterion not found: id={body.criterion_id!r}, name={body.criterion_name!r}",
        )

    criterion = row_to_criterion(crit_row)

    # 3. Run the eval
    sys.path.insert(0, str(ROOT / "server"))
    from eval_runner import run_single_eval
    try:
        result = run_single_eval(copy_text, request_messages, criterion)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Eval failed: {e}")

    # 4. Persist to DB
    now = datetime.now(timezone.utc).isoformat()
    result_id = str(uuid.uuid4())
    with get_conn() as conn:
        conn.execute(
            """INSERT OR REPLACE INTO eval_results
               (id, generation_id, criterion_id, criterion_name, desired_score,
                score, rationale, evidence, product_name, run_at)
               VALUES (?,?,?,?,?,?,?,?,?,?)""",
            (
                result_id,
                body.generation_id,
                result["criterion_id"],
                result["criterion_name"],
                result.get("desired_score", ""),
                result["score"],
                result["rationale"],
                json.dumps(result["evidence"]),
                result.get("product_name", ""),
                now,
            ),
        )

    # 5. Save HTML report locally
    result_with_meta = {**result, "generation_id": body.generation_id, "run_at": now}
    try:
        html_path = _save_html_result(result_with_meta)
    except Exception as e:
        html_path = None
        print(f"Warning: could not save HTML report: {e}", file=sys.stderr)

    return {
        "result_id": result_id,
        "generation_id": body.generation_id,
        "criterion_id": result["criterion_id"],
        "criterion_name": result["criterion_name"],
        "desired_score": result.get("desired_score", ""),
        "score": result["score"],
        "rationale": result["rationale"],
        "evidence": result["evidence"],
        "product_name": result.get("product_name", ""),
        "run_at": now,
        "html_report": str(html_path) if html_path else None,
    }


@app.get("/api/eval/results/{generation_id}")
def get_eval_results_for_generation(generation_id: str) -> list[dict]:
    with get_conn() as conn:
        rows = conn.execute(
            """SELECT * FROM eval_results WHERE generation_id = ?
               ORDER BY run_at DESC""",
            (generation_id,),
        ).fetchall()
    results = []
    for r in rows:
        d = dict(r)
        try:
            d["evidence"] = json.loads(d["evidence"] or "[]")
        except (json.JSONDecodeError, TypeError):
            d["evidence"] = []
        results.append(d)
    return results


# ---------------------------------------------------------------------------
# Post-edit route
# ---------------------------------------------------------------------------

class PostEditRequest(BaseModel):
    generation_id: str
    criterion_name: str
    score: str
    desired_score: str
    rationale: str
    evidence: list[str] = []


@app.post("/api/post-edit")
def post_edit(body: PostEditRequest) -> dict:
    # 1. Load generation
    with get_conn() as conn:
        gen_row = conn.execute(
            "SELECT system_prompt, last_user_message, response_content, req_json FROM generations WHERE generation_id = ?",
            (body.generation_id,)
        ).fetchone()
    if not gen_row:
        raise HTTPException(status_code=404, detail="Generation not found")

    system_prompt = gen_row["system_prompt"] or ""
    user_message = gen_row["last_user_message"] or ""
    original_content = gen_row["response_content"] or ""

    # 2. Build post-edit prompt
    evidence_block = ""
    if body.evidence:
        evidence_block = "\nSpecific passages flagged:\n" + "\n".join(f'  - "{e}"' for e in body.evidence if e)

    post_edit_prompt = f"""You are an expert product copy editor. Your task is to improve a piece of product copy based on evaluation feedback.

--- ORIGINAL TASK ---
{system_prompt}

--- PRODUCT DATA ---
{user_message}

--- ORIGINAL COPY ---
{original_content}

--- EVALUATION FEEDBACK ---
Criterion: {body.criterion_name}
Score: {body.score} (target: {body.desired_score})
Feedback: {body.rationale}{evidence_block}

--- INSTRUCTIONS ---
Rewrite the copy to address the evaluation feedback and achieve the target score.
- Keep the same format and approximate length as the original.
- Only change what is needed to address the specific feedback.
- Do not add commentary or explanations — output only the improved copy.
"""

    # 3. Call LLM
    sys.path.insert(0, str(ROOT / "server"))
    from eval_runner import ai_client, llm_model
    try:
        response = ai_client().chat.completions.create(
            model=llm_model(),
            messages=[{"role": "user", "content": post_edit_prompt}],
        )
        improved = response.choices[0].message.content or ""
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Post-edit failed: {e}")

    return {"improved_content": improved.strip()}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("server.main:app", host="0.0.0.0", port=8000, reload=True)
