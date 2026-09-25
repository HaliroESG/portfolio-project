#!/usr/bin/env python3
from __future__ import annotations

import argparse
import os
import sys

CURRENT_DIR = os.path.dirname(__file__)
BACKEND_ROOT = os.path.dirname(CURRENT_DIR)
sys.path.append(BACKEND_ROOT)

from family_office.repository import FamilyOfficeRepository, create_service_client  # noqa: E402


def bootstrap_owner(email: str, redirect_to: str | None = None) -> dict[str, str | None]:
    normalized_email = email.strip().lower()
    if "@" not in normalized_email:
        raise ValueError("A valid owner email is required")
    client = create_service_client()
    repository = FamilyOfficeRepository(client)
    existing = repository.first("fo_owner_profiles")
    if existing:
        if existing["email"] != normalized_email:
            raise RuntimeError("A different owner is already registered")
        return {"status": "already_configured", "email": normalized_email, "user_id": existing["user_id"]}

    allowlist = repository.first("fo_owner_allowlist", filters={"email": normalized_email})
    if allowlist:
        repository.update("fo_owner_allowlist", {"is_active": True}, filters={"email": normalized_email})
    else:
        repository.insert("fo_owner_allowlist", {"email": normalized_email, "is_active": True})

    options = {"redirect_to": redirect_to} if redirect_to else None
    response = client.auth.admin.invite_user_by_email(normalized_email, options=options)
    user = response.user
    return {"status": "invited", "email": normalized_email, "user_id": str(user.id) if user else None}


def main() -> None:
    parser = argparse.ArgumentParser(description="Allowlist and invite the single Family Office owner")
    parser.add_argument("--email", required=True)
    parser.add_argument("--redirect-to", default=None)
    args = parser.parse_args()
    print(bootstrap_owner(args.email, args.redirect_to))


if __name__ == "__main__":
    main()
