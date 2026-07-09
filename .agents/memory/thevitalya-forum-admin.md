---
name: theVitalya forum admin/role system
description: How roles/bans are enforced for the theVITALYA Firebase forum, and the firestore.rules deployment gap.
---

The forum (artifacts/thevitalya) is a pure client-side Firebase app (no custom backend). Roles ("owner"|"admin"|"user") and a `banned` flag live on `forum_users` docs. Username `vitaliy` (case-insensitive) is the permanent super-admin ("owner"), self-healed on every login/auth-state load in case the doc predates the role system.

**Why:** client-only apps can't trust role checks written only in app code — anyone can call Firestore SDK methods directly from devtools. Real enforcement must live in `firestore.rules`.

**How to apply:** a `firestore.rules` file at the repo root encodes the same permission model (owner manages roles, owner+admin ban/delete lower-ranked content). It has NOT been deployed — this environment has no Firebase CLI/project credentials, so the user must paste it into Firebase Console → Firestore → Rules → Publish themselves. Until published, admin/ban enforcement is client-side only (bypassable via devtools). Any future change to role/ban/moderation logic in `forum.ts` must be mirrored in `firestore.rules`, especially the allowed diff keys for post/reply updates (reaction counters use field-path updates like `reactions.<emoji>`, not whole-document rewrites).
