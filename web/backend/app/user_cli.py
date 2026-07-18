"""CLI: Shopping-List user management (create, list, delete)."""
from __future__ import annotations

import argparse
import sys


def main() -> int:
    from .auth import hash_password
    from .db import delete_user, get_user_by_username, init_db, insert_user, list_users

    init_db()

    p = argparse.ArgumentParser(description="Shopping-List user management")
    sub = p.add_subparsers(dest="cmd", required=True)

    c = sub.add_parser("create-user", help="Add a user (admin or user)")
    c.add_argument("username")
    c.add_argument("password")
    c.add_argument("role", choices=["admin", "user"])

    sub.add_parser("list-users", help="Print all users")

    d = sub.add_parser("delete-user", help="Remove a user by username")
    d.add_argument("username")

    args = p.parse_args()

    if args.cmd == "create-user":
        u = args.username.strip()
        if not u:
            print("username required", file=sys.stderr)
            return 1
        if get_user_by_username(u):
            print(f"User {u!r} already exists", file=sys.stderr)
            return 1
        insert_user(u, hash_password(args.password), args.role)
        print(f"Created user {u!r} ({args.role})")
        return 0

    if args.cmd == "list-users":
        users = list_users()
        if not users:
            print("No users.")
            return 0
        for row in users:
            print(f"{row['username']}\t{row['role']}")
        return 0

    if args.cmd == "delete-user":
        u = args.username.strip()
        if not u:
            print("username required", file=sys.stderr)
            return 1
        if not get_user_by_username(u):
            print(f"No user named {u!r}", file=sys.stderr)
            return 1
        delete_user(u)
        print(f"Deleted user {u!r}")
        return 0

    return 1


if __name__ == "__main__":
    raise SystemExit(main())
