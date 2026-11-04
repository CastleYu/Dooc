#!/usr/bin/env python3
"""Check Dooc frontmatter. Exit 0 when the file matches the shipped rules."""

import sys
from pathlib import Path

TYPES = [
    "architecture",
    "design",
    "adr",
    "api",
    "guide",
    "reference",
    "analysis",
]
LISTS = ["tags", "owners", "code_refs", "symbols"]
REST = [
    "title",
    "description",
    "status",
    "tags",
    "owners",
    "code_refs",
    "symbols",
    "created_at",
    "updated_at",
]


class FmCheck:
    @staticmethod
    def scalar(value):
        text = value.strip()
        if len(text) >= 2 and text[0] == text[-1] and text[0] in "\"'":
            return text[1:-1]
        return text

    @staticmethod
    def parse(text):
        src = text.lstrip("\ufeff")
        if not src.startswith("---"):
            return None
        end = src.find("\n---", 3)
        if end < 0:
            return None
        raw = src[4:end]
        if raw.startswith("\r\n"):
            raw = raw[2:]
        elif raw.startswith("\n"):
            raw = raw[1:]
        data = {}
        key = ""
        mode = ""
        for line in raw.splitlines():
            if not line.strip() or line.strip().startswith("#"):
                continue
            if key and mode == "list" and line[:1].isspace():
                idx = 0
                while idx < len(line) and line[idx] in " \t":
                    idx += 1
                if line[idx : idx + 2] == "- ":
                    data[key].append(FmCheck.scalar(line[idx + 2 :]))
                    continue
            if ":" in line and not line[0].isspace():
                name, _, val = line.partition(":")
                if name.replace("_", "").isalnum() and name[:1].isalpha():
                    key = name
                    val = val.strip()
                    if not val:
                        data[key] = []
                        mode = "list"
                    else:
                        data[key] = FmCheck.scalar(val)
                        mode = "scalar"
                    continue
        return data

    @staticmethod
    def check(text, expect_id=None):
        data = FmCheck.parse(text)
        if data is None:
            return ["frontmatter_missing"]
        errors = []
        ident = data.get("id", None)
        if not isinstance(ident, str) or len(ident) == 0:
            errors.append("id_missing")
        elif expect_id and ident != expect_id:
            errors.append("id_changed")
        kind = data.get("type", None)
        if not isinstance(kind, str) or kind not in TYPES:
            errors.append("type_invalid")
        for item in REST:
            if item not in data:
                errors.append(f"key_missing:{item}")
                continue
            val = data[item]
            if item in LISTS:
                if not isinstance(val, list):
                    errors.append(f"key_missing:{item}")
            elif not isinstance(val, str) or len(val) == 0:
                errors.append(f"key_missing:{item}")
        return sorted(errors)


def main(argv):
    if len(argv) < 2:
        print("usage: validate-frontmatter.py FILE [--expect-id ID]")
        return 2
    expect = None
    if "--expect-id" in argv:
        expect = argv[argv.index("--expect-id") + 1]
    text = Path(argv[1]).read_text(encoding="utf-8")
    errors = FmCheck.check(text, expect)
    if errors:
        print("\n".join(errors))
        return 1
    print("ok")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
