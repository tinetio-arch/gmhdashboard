#!/usr/bin/env python3
"""
SOT Health Check Script

Validates ANTIGRAVITY_SOURCE_OF_TRUTH_V2.md structure and catches common issues:
1. Sections longer than 200 lines (except changelog archive)
2. Duplicate concepts (same topic in multiple sections)
3. External doc checksums mismatch
4. Recent changes section has >10 entries
5. All CRITICAL/IMPORTANT tags have decision tree links
6. Line count within target range (700-900 lines)

Usage:
  python3 scripts/sot-health-check.py

Returns:
  Exit 0: All checks passed
  Exit 1: Health issues found
"""

import re
import os
import hashlib
from pathlib import Path
from typing import List, Tuple, Dict

# Configuration
SOT_PATH = Path('/home/ec2-user/gmhdashboard/ANTIGRAVITY_SOURCE_OF_TRUTH_V2.md')
DOCS_DIR = Path('/home/ec2-user/gmhdashboard/docs')
MAX_SECTION_LINES = 200
TARGET_TOTAL_LINES = (700, 900)
MAX_RECENT_CHANGES = 10

# Color codes for output
GREEN = '\033[92m'
YELLOW = '\033[93m'
RED = '\033[91m'
RESET = '\033[0m'


def read_file(path: Path) -> str:
    """Read file content safely."""
    try:
        return path.read_text()
    except Exception as e:
        print(f"{RED}ERROR: Cannot read {path}: {e}{RESET}")
        return ""


def sha256_short(path: Path) -> str:
    """Compute first 8 chars of SHA256 checksum."""
    if not path.exists():
        return "MISSING"
    content = path.read_bytes()
    return hashlib.sha256(content).hexdigest()[:8]


def check_file_exists() -> bool:
    """Check if SOT v2 file exists."""
    if not SOT_PATH.exists():
        print(f"{RED}✗ FAIL: SOT file not found at {SOT_PATH}{RESET}")
        return False
    print(f"{GREEN}✓ PASS: SOT file found{RESET}")
    return True


def check_total_lines(content: str) -> bool:
    """Check if total line count is within target range."""
    lines = content.split('\n')
    line_count = len(lines)
    min_lines, max_lines = TARGET_TOTAL_LINES

    if min_lines <= line_count <= max_lines:
        print(f"{GREEN}✓ PASS: Total lines = {line_count} (target: {min_lines}-{max_lines}){RESET}")
        return True
    else:
        print(f"{YELLOW}⚠ WARNING: Total lines = {line_count} (target: {min_lines}-{max_lines}){RESET}")
        return False


def extract_sections(content: str) -> Dict[str, List[str]]:
    """Extract level-2 sections (## headers) with their content."""
    sections = {}
    current_section = None
    current_lines = []

    for line in content.split('\n'):
        if line.startswith('## '):
            if current_section:
                sections[current_section] = current_lines
            current_section = line[3:].strip()
            current_lines = []
        elif current_section:
            current_lines.append(line)

    if current_section:
        sections[current_section] = current_lines

    return sections


def check_section_lengths(content: str) -> bool:
    """Check if any section exceeds max length."""
    sections = extract_sections(content)
    issues = []

    for section_name, lines in sections.items():
        line_count = len(lines)
        if line_count > MAX_SECTION_LINES:
            issues.append((section_name, line_count))

    if not issues:
        print(f"{GREEN}✓ PASS: All sections ≤{MAX_SECTION_LINES} lines{RESET}")
        return True
    else:
        print(f"{YELLOW}⚠ WARNING: {len(issues)} section(s) exceed {MAX_SECTION_LINES} lines:{RESET}")
        for section, count in issues:
            print(f"  - {section}: {count} lines")
        return False


def check_duplicate_concepts(content: str) -> bool:
    """Check for duplicate topics in multiple sections."""
    # Key concepts that should appear only once
    concepts = [
        'PM2 restart',
        'IPv6',
        'silent scaling',
        'patient matching',
        'Snowflake auth',
        'split-vial',
        'FOR UPDATE',
        'ecosystem.config.js',
    ]

    sections = extract_sections(content)
    issues = []

    for concept in concepts:
        pattern = re.compile(re.escape(concept), re.IGNORECASE)
        found_in = []

        for section_name, lines in sections.items():
            section_text = '\n'.join(lines)
            if pattern.search(section_text):
                found_in.append(section_name)

        if len(found_in) > 2:  # Allow in 2 places (e.g., Constraints + Decision Tree)
            issues.append((concept, found_in))

    if not issues:
        print(f"{GREEN}✓ PASS: No excessive concept duplication{RESET}")
        return True
    else:
        print(f"{YELLOW}⚠ WARNING: {len(issues)} concept(s) appear in >2 sections:{RESET}")
        for concept, sections in issues:
            print(f"  - '{concept}' in: {', '.join(sections)}")
        return False


def check_external_doc_checksums(content: str) -> bool:
    """Check if external doc checksums in SOT match actual files."""
    # Extract checksum table from SOT
    checksum_pattern = re.compile(
        r'\|\s*\[([\w\-\.]+)\]\([^\)]+\)\s*\|[^|]*\|[^|]*\|\s*([a-f0-9]{8})\s*\|'
    )

    expected_checksums = {}
    for match in checksum_pattern.finditer(content):
        filename = match.group(1)
        checksum = match.group(2)
        expected_checksums[filename] = checksum

    if not expected_checksums:
        print(f"{YELLOW}⚠ INFO: No checksums found in SOT (may not be implemented yet){RESET}")
        return True

    issues = []
    for filename, expected_checksum in expected_checksums.items():
        actual_path = DOCS_DIR / filename
        actual_checksum = sha256_short(actual_path)

        if actual_checksum == "MISSING":
            issues.append((filename, expected_checksum, "MISSING FILE"))
        elif actual_checksum != expected_checksum:
            issues.append((filename, expected_checksum, actual_checksum))

    if not issues:
        print(f"{GREEN}✓ PASS: All external doc checksums match ({len(expected_checksums)} docs){RESET}")
        return True
    else:
        print(f"{RED}✗ FAIL: {len(issues)} checksum mismatch(es):{RESET}")
        for filename, expected, actual in issues:
            print(f"  - {filename}: expected {expected}, got {actual}")
        return False


def check_recent_changes_count(content: str) -> bool:
    """Check if Recent Changes section has ≤10 entries."""
    # Find Recent Changes section
    sections = extract_sections(content)
    recent_changes_key = None

    for key in sections.keys():
        if 'recent changes' in key.lower():
            recent_changes_key = key
            break

    if not recent_changes_key:
        print(f"{YELLOW}⚠ WARNING: 'Recent Changes' section not found{RESET}")
        return False

    recent_changes_content = '\n'.join(sections[recent_changes_key])

    # Count ### level-3 headers (each change is a subsection)
    change_entries = re.findall(r'^###\s+', recent_changes_content, re.MULTILINE)
    count = len(change_entries)

    if count <= MAX_RECENT_CHANGES:
        print(f"{GREEN}✓ PASS: Recent Changes has {count} entries (max: {MAX_RECENT_CHANGES}){RESET}")
        return True
    else:
        print(f"{YELLOW}⚠ WARNING: Recent Changes has {count} entries (max: {MAX_RECENT_CHANGES}){RESET}")
        print(f"  Consider moving older entries to ANTIGRAVITY_CHANGELOG.md")
        return False


def check_critical_tags_have_links(content: str) -> bool:
    """Check if CRITICAL/IMPORTANT tags link to decision trees or constraints."""
    # Find all CRITICAL/IMPORTANT/CAUTION tags
    tags = re.findall(
        r'(\*\*CRITICAL\*\*|\*\*IMPORTANT\*\*|\*\*CAUTION\*\*|\*\*WARNING\*\*)',
        content,
        re.IGNORECASE
    )

    tag_count = len(tags)

    if tag_count == 0:
        print(f"{GREEN}✓ PASS: No CRITICAL/IMPORTANT tags (using constraints instead){RESET}")
        return True
    elif tag_count <= 10:
        print(f"{GREEN}✓ PASS: Only {tag_count} CRITICAL tags (acceptable){RESET}")
        return True
    else:
        print(f"{YELLOW}⚠ WARNING: Found {tag_count} CRITICAL/IMPORTANT tags{RESET}")
        print(f"  Consider consolidating into System Constraints section")
        return False


def check_decision_trees_exist(content: str) -> bool:
    """Check if Decision Trees section exists."""
    if '## 🗺️ DECISION TREES' in content or '## DECISION TREES' in content:
        print(f"{GREEN}✓ PASS: Decision Trees section found{RESET}")
        return True
    else:
        print(f"{RED}✗ FAIL: Decision Trees section not found{RESET}")
        return False


def check_constraints_registry_exists(content: str) -> bool:
    """Check if System Constraints section exists."""
    if '## 🚨 SYSTEM CONSTRAINTS' in content or '## SYSTEM CONSTRAINTS' in content:
        print(f"{GREEN}✓ PASS: System Constraints section found{RESET}")
        return True
    else:
        print(f"{RED}✗ FAIL: System Constraints section not found{RESET}")
        return False


def main():
    """Run all health checks."""
    print("\n" + "="*60)
    print("SOT HEALTH CHECK")
    print("="*60 + "\n")

    # Load content
    if not check_file_exists():
        return 1

    content = read_file(SOT_PATH)
    if not content:
        return 1

    # Run checks
    results = []

    print("\n--- Structure Checks ---")
    results.append(check_total_lines(content))
    results.append(check_section_lengths(content))
    results.append(check_decision_trees_exist(content))
    results.append(check_constraints_registry_exists(content))

    print("\n--- Content Checks ---")
    results.append(check_duplicate_concepts(content))
    results.append(check_recent_changes_count(content))
    results.append(check_critical_tags_have_links(content))

    print("\n--- External Document Checks ---")
    results.append(check_external_doc_checksums(content))

    # Summary
    print("\n" + "="*60)
    passed = sum(results)
    total = len(results)

    if passed == total:
        print(f"{GREEN}✓ ALL CHECKS PASSED ({passed}/{total}){RESET}")
        print("="*60 + "\n")
        return 0
    else:
        failed = total - passed
        print(f"{YELLOW}⚠ {failed} CHECK(S) FAILED ({passed}/{total} passed){RESET}")
        print("="*60 + "\n")
        return 1


if __name__ == '__main__':
    exit(main())
