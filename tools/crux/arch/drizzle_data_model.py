"""Project-local Crux arch extractor: `bionic/arch/data-model.md` from Drizzle.

Crux's data-model concern has no Drizzle reader, so `.bionic.yml` wires this
function through `arch_extractors` (runs only with CRUX_ARCH_ALLOW_OVERRIDES=1;
use `pnpm docs:arch`). It follows Crux's contract: `(root, docs_dir) ->
(markdown, sources)`, where `sources` maps repo-relative file -> sha256.

SOURCE is the newest `packages/database/drizzle/2*/snapshot.json`, the
committed drizzle-kit snapshot. It is the authoritative DDL (the invariant
"schema files and migrations agree" keeps it honest). Reading JSON beats
parsing the TypeScript schema: simpler, exact composite keys, schemas and
enums, and no parser dependency. Static read only: no drizzle-kit, database or
app code runs. Output is deterministic (sorted, no timestamps) and the entity
table uses Crux's `| table | column |` header so it counts as data-model entities.
Odd input never raises: it degrades to Crux's empty-but-valid stub.
"""

from __future__ import annotations

import hashlib
import json
import sys
from collections import defaultdict
from pathlib import Path

_DRIZZLE_DIR = "packages/database/drizzle"
_TITLE = "# Data model"
# Same sentence as crux.arch.core.NO_EXTRACTOR (the stub Crux itself renders).
_NO_EXTRACTOR = "> _no extractor for this stack — empty-but-valid spine file._"


def _stub() -> tuple[str, dict]:
    return f"{_TITLE}\n\n{_NO_EXTRACTOR}\n", {}


def _latest_snapshot(root: Path) -> Path | None:
    base = root / _DRIZZLE_DIR
    if not base.is_dir():
        return None
    folders = sorted(
        entry.name
        for entry in base.iterdir()
        if entry.is_dir()
        and entry.name.startswith("2")
        and (entry / "snapshot.json").is_file()
    )
    return base / folders[-1] / "snapshot.json" if folders else None


def _cell(text: object) -> str:
    return str(text).replace("|", "\\|").replace("\n", " ")


def _qualified(schema: str, name: str) -> str:
    return f"{schema}.{name}"


def _render(folder: str, ddl: list[dict]) -> str:
    by_type: dict[str, list[dict]] = defaultdict(list)
    for entity in ddl:
        by_type[entity.get("entityType", "")].append(entity)

    def per_table(kind: str) -> dict[str, list[dict]]:
        grouped: dict[str, list[dict]] = defaultdict(list)
        for entity in by_type[kind]:
            grouped[_qualified(entity["schema"], entity["table"])].append(entity)
        return grouped

    tables = sorted(by_type["tables"], key=lambda t: _qualified(t["schema"], t["name"]))
    columns = per_table("columns")
    pks, fks = per_table("pks"), per_table("fks")
    uniques, indexes = per_table("uniques"), per_table("indexes")
    policies = per_table("policies")
    enums = sorted(by_type["enums"], key=lambda e: _qualified(e["schema"], e["name"]))
    enum_names = {_qualified(e["schema"], e["name"]) for e in enums}

    out = [
        _TITLE,
        "",
        f"_Derived from `{_DRIZZLE_DIR}/{folder}/snapshot.json` "
        "(drizzle-kit snapshot; static read, no Drizzle executed)._",
        "",
        f"## Entities ({len(tables)} tables)",
        "",
        "| table | column | type | nullable | default | primary key | references |",
        "|---|---|---|---|---|---|---|",
    ]
    for table in tables:
        name = _qualified(table["schema"], table["name"])
        pk_columns = {c for pk in pks[name] for c in pk["columns"]}
        references: dict[str, list[str]] = defaultdict(list)
        for fk in fks[name]:
            target = _qualified(fk["schemaTo"], fk["tableTo"])
            for source_column, target_column in zip(fk["columns"], fk["columnsTo"]):
                references[source_column].append(f"{target}.{target_column}")
        for column in sorted(columns[name], key=lambda c: c["name"]):
            base = str(column["type"]).replace("[]", "")
            enum_key = next(
                (
                    _qualified(schema, base)
                    for schema in (column.get("typeSchema"), table["schema"])
                    if schema and _qualified(schema, base) in enum_names
                ),
                None,
            )
            kind = (enum_key or str(column["type"])) + (
                "[]" if column.get("dimensions", 0) and "[]" not in str(column["type"]) else ""
            )
            out.append(
                f"| {_cell(name)} | `{_cell(column['name'])}` | {_cell(kind)} "
                f"| {'no' if column.get('notNull') else 'yes'} "
                f"| {_cell(column['default']) if column.get('default') is not None else '—'} "
                f"| {'yes' if column['name'] in pk_columns else '—'} "
                f"| {_cell(', '.join(sorted(references[column['name']])) or '—')} |"
            )

    out += ["", "## Enums", ""]
    for entity in enums:
        values = ", ".join(f"`{v}`" for v in entity["values"])
        out.append(f"- `{_qualified(entity['schema'], entity['name'])}`: {values}")

    out += ["", "## Indexes", ""]
    for table in tables:
        name = _qualified(table["schema"], table["name"])
        parts = [f"primary key ({', '.join(c for pk in pks[name] for c in pk['columns'])})"] if pks[name] else []
        parts += [f"unique ({', '.join(u['columns'])})" for u in sorted(uniques[name], key=lambda u: u["name"])]
        for index in sorted(indexes[name], key=lambda i: i["name"]):
            cols = ", ".join(str(c["value"]) for c in index["columns"])
            tail = f" where {index['where']}" if index.get("where") else ""
            parts.append(f"{'unique ' if index.get('isUnique') else ''}index ({cols}){tail}")
        if parts:
            out.append(f"- `{name}`: " + "; ".join(parts))

    out += ["", "## Relations", ""]
    all_fks = sorted(
        by_type["fks"],
        key=lambda f: (_qualified(f["schema"], f["table"]), f["name"]),
    )
    for fk in all_fks:
        source = _qualified(fk["schema"], fk["table"])
        target = _qualified(fk["schemaTo"], fk["tableTo"])
        out.append(
            f"- `{source}` ({', '.join(fk['columns'])}) → `{target}` "
            f"({', '.join(fk['columnsTo'])}), on delete {str(fk['onDelete']).lower()}"
        )

    out += ["", "## Row-level security", ""]
    out.append(
        "_The snapshot records whether RLS is enabled and each policy; whether it is "
        "FORCED is not recorded (see `packages/database` migrations)._"
    )
    out.append("")
    for table in tables:
        name = _qualified(table["schema"], table["name"])
        state = "enabled" if table.get("isRlsEnabled") else "off"
        names = ", ".join(
            f"{p['name']} ({str(p.get('for', 'ALL')).lower()})"
            for p in sorted(policies[name], key=lambda p: p["name"])
        )
        out.append(f"- `{name}`: RLS {state}; policies: {names or 'none'}")

    out += [
        "",
        "## Residuals",
        "",
        "Not shown here (read the snapshot or the schema source):",
        "",
        f"- {len(by_type['policies'])} policy expressions (`using` / `with check`): names only above",
        f"- {len(by_type['checks'])} check constraints",
        "- generated and identity columns",
        "- index methods, operator classes, sort order",
        "- roles, grants, triggers, functions, views",
    ]
    return "\n".join(out) + "\n"


def extract_data_model(root, docs_dir):  # noqa: ARG001 - Crux contract: (root, docs_dir)
    """Return `(markdown, {snapshot_path: sha256})`; the stub with `{}` on any problem."""
    try:
        root_path = Path(root)
        snapshot = _latest_snapshot(root_path)
        if snapshot is None:
            return _stub()
        raw = snapshot.read_bytes()
        ddl = json.loads(raw)["ddl"]
        markdown = _render(snapshot.parent.name, ddl)
        return markdown, {
            snapshot.relative_to(root_path).as_posix(): hashlib.sha256(raw).hexdigest()
        }
    except Exception as error:  # never raise into Crux: it would fall through anyway, loudly
        # Say what went wrong (type and message only, never file contents), so a
        # corrupt snapshot is not mistaken for "no extractor" by whoever reads the stub.
        print(
            f"drizzle_data_model: {type(error).__name__}: {error}; wrote the stub",
            file=sys.stderr,
        )
        return _stub()
