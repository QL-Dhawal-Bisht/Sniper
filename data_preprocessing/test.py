#!/usr/bin/env python3
"""
Enhanced entity & context extraction from a directory of .txt files,
outputting both terminal summary + a CSV of every lead with context.

Usage:
    python extract_leads_with_context.py [INPUT_DIR]

If INPUT_DIR is not provided, defaults to "./deepscrape".
"""

import os
import re
import glob
import csv
import argparse
from collections import Counter
from urllib.parse import urlparse

try:
    import spacy
except ImportError:
    raise ImportError("Please install spaCy: pip install spacy")

try:
    import phonenumbers
except ImportError:
    raise ImportError("Please install python-phonenumbers: pip install phonenumbers")

# Load spaCy model
try:
    nlp = spacy.load("en_core_web_lg")
except OSError:
    raise OSError("Please download the spaCy model: python -m spacy download en_core_web_lg")

# Disable unused components for speed
for pipe in ["tagger", "parser", "attribute_ruler", "lemmatizer"]:
    if pipe in nlp.pipe_names:
        nlp.disable_pipe(pipe)

# -------------------------------------------------------------------
# Helpers
# -------------------------------------------------------------------

def context_snippet(text: str, term: str, window: int = 80) -> str:
    lc = text.lower()
    idx = lc.find(term.lower())
    if idx < 0:
        return ""
    start = max(0, idx - window)
    end   = min(len(text), idx + len(term) + window)
    snippet = text[start:end].strip()
    # Trim to sentence boundary if possible
    parts = re.split(r'(?<=[\.\?\!])\s+', snippet)
    return parts[-1].replace("\n", " ")

def is_valid_person_name(name: str) -> bool:
    name = name.strip()
    if not (2 <= len(name) <= 50): return False
    if not re.search(r"[A-Za-z]", name): return False
    if sum(c.isdigit() for c in name) > 0.3 * len(name): return False
    if name.isupper() and len(name) > 4: return False
    if any(tok in name.lower() for tok in ("http", "@", ".com")): return False
    if name.lower() in {"linkedin","twitter","facebook","google","amazon"}:
        return False
    return True

def is_valid_organization(org: str) -> bool:
    org = org.strip()
    if not (2 <= len(org) <= 100): return False
    if not re.search(r"[A-Za-z]", org): return False
    if sum(c.isdigit() for c in org) > 0.5 * len(org): return False
    if any(tok in org.lower() for tok in ("http", "@", "example.com")): return False
    return True

def clean_url(url: str) -> str|None:
    url = url.strip().rstrip('.,;!?')
    try:
        p = urlparse(url)
        if not (p.scheme and p.netloc):
            return None
    except:
        return None
    if any(domain in url.lower() for domain in ("example.com","localhost")):
        return None
    return url

def extract_phone_numbers(text: str) -> list[str]:
    patterns = [
        r'\+\d{1,3}[-.\s]?\(?\d{1,4}\)?[-.\s]?\d{1,4}[-.\s]?\d{1,4}',
        r'\(\d{3}\)[-.\s]?\d{3}[-.\s]?\d{4}',
        r'\b\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\b',
        r'\+91[-.\s]?\d{10}',
        r'\b\d{10}\b',
    ]
    found = set()
    for pat in patterns:
        for match in re.findall(pat, text):
            digits = re.findall(r'\d', match)
            if not (7 <= len(digits) <= 15):
                continue
            for region in ("US","IN","GB","CA","AU"):
                try:
                    num = phonenumbers.parse(match, region)
                    if phonenumbers.is_valid_number(num):
                        formatted = phonenumbers.format_number(
                            num, phonenumbers.PhoneNumberFormat.INTERNATIONAL
                        )
                        found.add(formatted)
                        break
                except:
                    pass
    return sorted(found)

def extract_entities_with_context(text: str, filename: str) -> list[dict]:
    records = []
    doc = nlp(text)

    # PERSON & ORG
    for ent in doc.ents:
        t = ent.text.strip()
        if ent.label_ == "PERSON" and is_valid_person_name(t):
            records.append({
                "file": filename,
                "type": "person",
                "entity": t,
                "snippet": context_snippet(text, t)
            })
        elif ent.label_ == "ORG" and is_valid_organization(t):
            records.append({
                "file": filename,
                "type": "organization",
                "entity": t,
                "snippet": context_snippet(text, t)
            })

    # URLs
    for url in set(re.findall(r'https?://[^\s<>"\[\]{}|\\^`]+', text)):
        clean = clean_url(url)
        if clean:
            records.append({
                "file": filename,
                "type": "url",
                "entity": clean,
                "snippet": context_snippet(text, clean)
            })

    # Emails
    for email in set(re.findall(r'\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b', text)):
        if not any(fake in email.lower() for fake in ("example","test","fake")):
            records.append({
                "file": filename,
                "type": "email",
                "entity": email,
                "snippet": context_snippet(text, email)
            })

    # Phones
    for phone in extract_phone_numbers(text):
        records.append({
            "file": filename,
            "type": "phone",
            "entity": phone,
            "snippet": context_snippet(text, phone)
        })

    return records

# -------------------------------------------------------------------
# Main processing
# -------------------------------------------------------------------
def process_all(input_dir: str):
    txt_files = glob.glob(os.path.join(input_dir, "*.txt"))
    if not txt_files:
        print(f"No .txt files found in '{input_dir}'.")
        return

    csv_path = "leads_with_context.csv"
    summary_counter = Counter()

    with open(csv_path, "w", newline="", encoding="utf8") as csvfile:
        writer = csv.DictWriter(csvfile, fieldnames=["file","type","entity","snippet"])
        writer.writeheader()

        for path in txt_files:
            fname = os.path.basename(path)
            print(f"Processing {fname}…")
            text = open(path, encoding="utf8", errors="ignore").read()
            recs = extract_entities_with_context(text, fname)

            for r in recs:
                writer.writerow(r)
                summary_counter[r["type"]] += 1

    print("\nExtraction complete.")
    print(f"→ Written {sum(summary_counter.values())} total records to {csv_path}")
    print("→ Breakdown by type:")
    for t, cnt in summary_counter.items():
        print(f"   - {t:12}: {cnt}")

if __name__ == "__main__":
    p = argparse.ArgumentParser(
        description="Extract leads + context from .txt files"
    )
    p.add_argument("input_dir", nargs="?", default="../cleaned_data",
                   help="Directory containing your .txt files")
    args = p.parse_args()

    if not os.path.isdir(args.input_dir):
        print(f"Error: '{args.input_dir}' is not a directory.")
        exit(1)

    process_all(args.input_dir)
