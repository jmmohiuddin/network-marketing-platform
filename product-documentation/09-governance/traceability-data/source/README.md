# Structured source for the generated documents

The documents listed as "Generated" in `09-governance/01_DOCUMENTATION_INDEX.md` are produced from the files in this folder, so that requirement, story, rule, test, screen, API and table identifiers cannot drift apart between documents. These scripts are documentation tooling only; they are not application code.

| File | Content |
|---|---|
| `fr1.txt`, `fr2.txt`, `fr3.txt` | Functional requirements (one block per requirement) |
| `stories.txt` | User stories and their acceptance criteria |
| `br.txt` | Business rules by group |
| `tests.txt` | Test scenarios and the criteria and rules each proves |
| `screens.txt` | Screen inventory |
| `apis.txt` | API endpoint catalogue |
| `entities.txt` | Database tables, columns, keys, constraints |
| `static/` | Fixed introductions and closing sections of generated documents |
| `wf_screens.py` | Layout specifications of the low-fidelity wireframes |
| `build.py` | Validates every cross-reference, then writes the generated documents and `../spec.json` |
| `wf.py`, `wfdocs.py` | Draw the wireframe SVG files and write the wireframe documents |
| `check_consistency.py` | Checks that every identifier, link and document reference in the whole set resolves, and that every requirement is on the roadmap |
| `check_diagrams.py` | Renders every Mermaid diagram (needs the Mermaid command-line tool `mmdc`) |

## Regenerating

Python 3 standard library only.

```
python3 build.py             # stops with a list if any reference is broken
python3 wf.py
python3 wfdocs.py
python3 check_consistency.py
python3 check_diagrams.py    # optional
```

The scripts write into the `product-documentation` folder three levels above this one; set `DOC_OUT` to write elsewhere. Hand-written documents are not touched.

## Editing rules

- Never reuse or renumber an identifier.
- A requirement needs a research trace (`trace:`), at least one story, and screens, APIs and entities where they apply; `build.py` refuses unknown references.
- After any change, regenerate and run the checks before raising a document version.
