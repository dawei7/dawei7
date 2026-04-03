#!/usr/bin/env python3
"""
GEDCOM → PostgreSQL importer for the ancestry app.

Usage:
    python scripts/gedcom_import.py path/to/export.ged

Requirements (install once):
    pip install psycopg2-binary python-dotenv

The script reads DATABASE_URL from the environment or from the .env file at the
project root. It is safe to re-run: all inserts use ON CONFLICT ... DO UPDATE so
existing records are updated rather than duplicated.
"""

import argparse
import os
import re
import sys

try:
    import psycopg2
except ImportError:
    sys.exit("Missing dependency: pip install psycopg2-binary")

try:
    from dotenv import load_dotenv
except ImportError:
    sys.exit("Missing dependency: pip install python-dotenv")


# ─── GEDCOM parser ────────────────────────────────────────────────────────────

def parse_gedcom(path: str) -> tuple[dict, dict]:
    """
    Parse a GEDCOM file.

    Returns:
        individuals: dict  gedcom_id → person dict
        families:    dict  gedcom_id → family dict
    """
    individuals: dict = {}
    families: dict = {}

    current: dict | None = None
    current_type: str | None = None   # "INDI" or "FAM"
    current_event: str | None = None  # "BIRT", "DEAT", "MARR", …
    current_name_is_maiden: bool = False  # True while processing a maiden NAME context

    with open(path, encoding="utf-8-sig") as fh:
        for raw in fh:
            line = raw.rstrip("\r\n").strip()
            if not line:
                continue

            parts = line.split(" ", 2)
            if len(parts) < 2:
                continue

            try:
                level = int(parts[0])
            except ValueError:
                continue

            tag_or_xref = parts[1]
            value = parts[2] if len(parts) > 2 else ""

            # ── Level 0: start of a new top-level record ──────────────────
            if level == 0:
                current_event = None
                current_name_is_maiden = False
                if tag_or_xref.startswith("@") and value in ("INDI", "FAM"):
                    gedcom_id = tag_or_xref.strip("@")
                    current = {"gedcom_id": gedcom_id}
                    current_type = value
                    if value == "INDI":
                        individuals[gedcom_id] = current
                    else:
                        families[gedcom_id] = current
                else:
                    current = None
                    current_type = None
                continue

            if current is None:
                continue

            # ── Level 1 ───────────────────────────────────────────────────
            if level == 1:
                current_event = None
                current_name_is_maiden = False

                if tag_or_xref == "NAME":
                    # "First /Last/"  or  "/Last/"  or  "First //"
                    m = re.match(r"^(.*?)\s*/(.*)/$", value.strip())
                    if m:
                        fn, ln = m.group(1).strip(), m.group(2).strip()
                    else:
                        fn, ln = value.strip(), ""
                    # Store tentatively; _MTYPE at level 2 may reclassify as maiden
                    current["_pending_name"] = (fn, ln)
                    if "first_name" not in current:
                        current["first_name"] = fn
                        current["last_name"] = ln

                elif tag_or_xref == "_MNAM":
                    # MyHeritage alternate maiden-name tag (level 1)
                    m = re.match(r"^(.*?)\s*/(.*)/$", value.strip())
                    current["maiden_name"] = m.group(2).strip() if m else value.strip()

                elif tag_or_xref == "SEX":
                    v = value.strip().upper()[:1]
                    if v in ("M", "F"):
                        current["sex"] = v

                elif tag_or_xref in ("BIRT", "DEAT", "MARR", "DIV", "BURI"):
                    current_event = tag_or_xref
                    current.setdefault(tag_or_xref, {})

                elif tag_or_xref == "OCCU":
                    current["occupation"] = value.strip()

                elif tag_or_xref == "NOTE":
                    current["notes"] = value.strip()

                elif tag_or_xref == "HUSB":
                    current["husband_id"] = value.strip().strip("@")

                elif tag_or_xref == "WIFE":
                    current["wife_id"] = value.strip().strip("@")

                elif tag_or_xref == "CHIL":
                    current.setdefault("children", []).append(value.strip().strip("@"))

            # ── Level 2 ───────────────────────────────────────────────────
            elif level == 2:
                if current_event and tag_or_xref == "DATE":
                    current[current_event]["date"] = value.strip()
                elif current_event and tag_or_xref == "PLAC":
                    current[current_event]["place"] = value.strip()
                elif tag_or_xref == "_MTYPE" and value.strip().upper() == "MAIDEN":
                    # The most recent NAME tag was the maiden name
                    if "_pending_name" in current:
                        fn, ln = current["_pending_name"]
                        current["maiden_name"] = ln or fn
                        # If this was mistakenly set as primary name, undo it
                        if current.get("first_name") == fn and current.get("last_name") == ln:
                            current.pop("first_name", None)
                            current.pop("last_name", None)
                elif tag_or_xref == "CONT" and "notes" in current:
                    current["notes"] += "\n" + value
                elif tag_or_xref == "CONC" and "notes" in current:
                    current["notes"] += value

    return individuals, families


# ─── DB import ────────────────────────────────────────────────────────────────

def import_to_db(individuals: dict, families: dict, conn) -> None:
    cur = conn.cursor()
    person_id_map: dict[str, str] = {}

    print(f"  Importing {len(individuals)} individuals…")
    for gedcom_id, person in individuals.items():
        birth = person.get("BIRT", {})
        death = person.get("DEAT", {})

        burial = person.get("BURI", {})

        cur.execute(
            """
            INSERT INTO persons
                (gedcom_id, first_name, last_name, maiden_name, sex,
                 birth_date, birth_place, death_date, death_place,
                 burial_date, burial_place, occupation, notes)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT (gedcom_id) DO UPDATE SET
                first_name   = EXCLUDED.first_name,
                last_name    = EXCLUDED.last_name,
                maiden_name  = EXCLUDED.maiden_name,
                sex          = EXCLUDED.sex,
                birth_date   = EXCLUDED.birth_date,
                birth_place  = EXCLUDED.birth_place,
                death_date   = EXCLUDED.death_date,
                death_place  = EXCLUDED.death_place,
                burial_date  = EXCLUDED.burial_date,
                burial_place = EXCLUDED.burial_place,
                occupation   = EXCLUDED.occupation,
                notes        = EXCLUDED.notes
            RETURNING id
            """,
            (
                gedcom_id,
                person.get("first_name") or None,
                person.get("last_name") or None,
                person.get("maiden_name") or None,
                person.get("sex") or None,
                birth.get("date") or None,
                birth.get("place") or None,
                death.get("date") or None,
                death.get("place") or None,
                burial.get("date") or None,
                burial.get("place") or None,
                person.get("occupation") or None,
                person.get("notes") or None,
            ),
        )
        row = cur.fetchone()
        person_id_map[gedcom_id] = str(row[0])

    print(f"  Importing {len(families)} families…")
    for gedcom_id, fam in families.items():
        husband_uuid = person_id_map.get(fam.get("husband_id", ""))
        wife_uuid = person_id_map.get(fam.get("wife_id", ""))
        marr = fam.get("MARR", {})

        div = fam.get("DIV", {})

        cur.execute(
            """
            INSERT INTO families
                (gedcom_id, husband_id, wife_id,
                 marriage_date, marriage_place,
                 divorce_date, divorce_place)
            VALUES (%s, %s::uuid, %s::uuid, %s, %s, %s, %s)
            ON CONFLICT (gedcom_id) DO UPDATE SET
                husband_id     = EXCLUDED.husband_id,
                wife_id        = EXCLUDED.wife_id,
                marriage_date  = EXCLUDED.marriage_date,
                marriage_place = EXCLUDED.marriage_place,
                divorce_date   = EXCLUDED.divorce_date,
                divorce_place  = EXCLUDED.divorce_place
            RETURNING id
            """,
            (
                gedcom_id,
                husband_uuid,
                wife_uuid,
                marr.get("date") or None,
                marr.get("place") or None,
                div.get("date") or None,
                div.get("place") or None,
            ),
        )
        family_uuid = str(cur.fetchone()[0])

        for child_gedcom in fam.get("children", []):
            child_uuid = person_id_map.get(child_gedcom)
            if child_uuid:
                cur.execute(
                    """
                    INSERT INTO family_children (family_id, person_id)
                    VALUES (%s::uuid, %s::uuid)
                    ON CONFLICT DO NOTHING
                    """,
                    (family_uuid, child_uuid),
                )

    conn.commit()


# ─── Entry point ──────────────────────────────────────────────────────────────

def main() -> None:
    parser = argparse.ArgumentParser(
        description="Import a MyHeritage GEDCOM export into the ancestry PostgreSQL database."
    )
    parser.add_argument("gedcom_file", help="Path to the .ged file exported from MyHeritage")
    args = parser.parse_args()

    # Load .env from project root (one directory up from scripts/)
    env_path = os.path.join(os.path.dirname(__file__), "..", ".env")
    load_dotenv(env_path)

    database_url = os.environ.get("DATABASE_URL")
    if not database_url:
        user = os.environ.get("POSTGRES_USER", "dawei")
        password = os.environ.get("POSTGRES_PASSWORD", "")
        host = os.environ.get("POSTGRES_HOST", "localhost")
        port = os.environ.get("POSTGRES_PORT", "5432")
        dbname = os.environ.get("POSTGRES_DB", "dawei_db")
        database_url = f"postgresql://{user}:{password}@{host}:{port}/{dbname}"

    print(f"Parsing {args.gedcom_file}…")
    individuals, families = parse_gedcom(args.gedcom_file)
    print(f"Found {len(individuals)} individuals and {len(families)} families.")

    print("Connecting to database…")
    conn = psycopg2.connect(database_url)
    try:
        import_to_db(individuals, families, conn)
    finally:
        conn.close()

    print(f"Done! {len(individuals)} people and {len(families)} families imported.")


if __name__ == "__main__":
    main()
