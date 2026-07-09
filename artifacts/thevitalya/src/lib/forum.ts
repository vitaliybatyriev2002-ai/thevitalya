import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
} from "firebase/auth";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  increment,
  limit,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from "firebase/firestore";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { auth, db, storage } from "./firebase";

/* ─── Roles / Admin ─── */
export type ForumRole = "owner" | "admin" | "user";

/** The single hardcoded super-administrator account. Case-insensitive. */
const SUPER_ADMIN_USERNAME = "vitaliy";

export function isSuperAdminUsername(username: string): boolean {
  return username.trim().toLowerCase() === SUPER_ADMIN_USERNAME;
}

function defaultRoleFor(username: string): ForumRole {
  return isSuperAdminUsername(username) ? "owner" : "user";
}

export function roleRank(role: ForumRole): number {
  return role === "owner" ? 2 : role === "admin" ? 1 : 0;
}

/** Owner and admin can moderate (delete content, ban regular users). Only owner manages admin roles. */
export function canModerate(role: ForumRole): boolean { return role === "owner" || role === "admin"; }
export function canManageRoles(role: ForumRole): boolean { return role === "owner"; }

/* ─── Types ─── */
export interface ForumUser  { uid: string; username: string; role: ForumRole; banned: boolean; }
export interface ForumPost  { id: string; authorId: string; authorName: string; title: string; body: string; createdAt: number | null; replyCount: number; imageUrl?: string; reactions?: Record<string, number>; }
export interface ForumReply { id: string; authorId: string; authorName: string; body: string; createdAt: number | null; imageUrl?: string; reactions?: Record<string, number>; }
export interface ForumAdminUser { uid: string; username: string; role: ForumRole; banned: boolean; createdAt: number | null; }

export const REACTION_EMOJIS = ["👍", "❤️", "😂"] as const;

/* ─── Helpers ─── */
function toEmail(username: string): string {
  return `${username.toLowerCase()}@forum.thevitalya`;
}

export function validateUsername(u: string): string | null {
  if (!/^[a-zA-Z0-9_]{3,20}$/.test(u))
    return "Никнейм: 3–20 символов, только буквы, цифры и _";
  return null;
}

/* ─── Reactions ─── */
export async function toggleReaction(
  user: ForumUser,
  targetId: string,
  emoji: string,
  targetDocRef: ReturnType<typeof doc>,
): Promise<void> {
  const reactionRef = doc(db, "forum_reactions", `${user.uid}_${targetId}`);
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(reactionRef);
    const existing: string | null = snap.exists() ? (snap.data() as { emoji: string }).emoji : null;
    if (existing === emoji) {
      tx.delete(reactionRef);
      tx.update(targetDocRef, { [`reactions.${emoji}`]: increment(-1) });
    } else {
      if (existing) tx.update(targetDocRef, { [`reactions.${existing}`]: increment(-1) });
      tx.set(reactionRef, { userId: user.uid, targetId, emoji });
      tx.update(targetDocRef, { [`reactions.${emoji}`]: increment(1) });
    }
  });
}

export function subscribeToUserReactions(
  userId: string,
  onChange: (map: Record<string, string>) => void,
): () => void {
  const q = query(collection(db, "forum_reactions"), where("userId", "==", userId));
  return onSnapshot(q, (snap) => {
    const map: Record<string, string> = {};
    snap.docs.forEach((d) => {
      const data = d.data() as { targetId: string; emoji: string };
      map[data.targetId] = data.emoji;
    });
    onChange(map);
  });
}

export function postDocRef(postId: string) { return doc(db, "forum_posts", postId); }
export function replyDocRef(postId: string, replyId: string) { return doc(db, "forum_posts", postId, "replies", replyId); }

/* ─── Image Upload ─── */
export async function uploadImage(file: File, path: string): Promise<string> {
  const storageRef = ref(storage, path);
  await uploadBytes(storageRef, file);
  return getDownloadURL(storageRef);
}

/* ─── Auth ─── */
export async function registerUser(username: string, password: string): Promise<ForumUser> {
  const cred = await createUserWithEmailAndPassword(auth, toEmail(username), password);
  const role = defaultRoleFor(username);
  await setDoc(doc(db, "forum_users", cred.user.uid), {
    username, role, banned: false, createdAt: serverTimestamp(),
  });
  return { uid: cred.user.uid, username, role, banned: false };
}

/**
 * Reads the user doc and, if this account is the reserved super-admin
 * username but its stored role has drifted (e.g. an account created before
 * the role system existed), heals it back to "owner". Never demotes anyone.
 */
async function loadAndHealUser(uid: string, fallbackUsername: string): Promise<ForumUser> {
  const ref  = doc(db, "forum_users", uid);
  const snap = await getDoc(ref);
  const data = snap.data() as { username?: string; role?: ForumRole; banned?: boolean } | undefined;
  const username = data?.username ?? fallbackUsername;
  const storedRole   = data?.role;   // raw values actually persisted in Firestore, not a fallback
  const storedBanned = data?.banned;
  let role = storedRole ?? defaultRoleFor(username);

  // Heal based on what's ACTUALLY stored, not the locally-computed fallback
  // above — otherwise the fallback already "looks like" owner/unbanned and
  // the write that makes it real in the database never fires. Role and ban
  // are healed independently so either drifted field gets corrected.
  if (isSuperAdminUsername(username)) {
    const needsRoleHeal   = storedRole !== "owner";
    const needsBannedHeal = storedBanned === true;
    if (needsRoleHeal || needsBannedHeal) {
      role = "owner";
      try { await updateDoc(ref, { role: "owner", banned: false }); } catch { /* rules may reject; ignore */ }
    }
  }

  const banned = data?.banned ?? false;
  return { uid, username, role, banned: isSuperAdminUsername(username) ? false : banned };
}

export async function loginUser(username: string, password: string): Promise<ForumUser> {
  const cred = await signInWithEmailAndPassword(auth, toEmail(username), password);
  const user = await loadAndHealUser(cred.user.uid, username);
  if (user.banned) {
    await signOut(auth);
    throw new Error("BANNED");
  }
  return user;
}

export function logoutUser(): Promise<void> { return signOut(auth); }

export function subscribeToAuthState(
  onChange: (user: ForumUser | null) => void,
): () => void {
  return onAuthStateChanged(auth, async (u) => {
    if (!u) { onChange(null); return; }
    const user = await loadAndHealUser(u.uid, "");
    if (user.banned) { await signOut(auth); onChange(null); return; }
    onChange(user);
  });
}

/* ─── Admin: user management ─── */
export function subscribeToAllUsers(
  onChange: (users: ForumAdminUser[]) => void,
): () => void {
  const q = query(collection(db, "forum_users"), orderBy("username", "asc"));
  return onSnapshot(q, (snap) => {
    onChange(
      snap.docs.map((d) => {
        const x = d.data() as Record<string, unknown>;
        return {
          uid:       d.id,
          username:  String(x.username ?? ""),
          role:      (x.role as ForumRole | undefined) ?? "user",
          banned:    Boolean(x.banned ?? false),
          createdAt: (x.createdAt as { toMillis?: () => number } | null)?.toMillis?.() ?? null,
        };
      }),
    );
  });
}

export async function setUserRole(actor: ForumUser, targetUid: string, role: "admin" | "user"): Promise<void> {
  if (!canManageRoles(actor.role)) throw new Error("Недостаточно прав для изменения ролей");
  if (targetUid === actor.uid) throw new Error("Нельзя изменить собственную роль");
  await updateDoc(doc(db, "forum_users", targetUid), { role });
}

export async function setUserBanned(actor: ForumUser, target: ForumAdminUser, banned: boolean): Promise<void> {
  if (!canModerate(actor.role)) throw new Error("Недостаточно прав");
  if (target.uid === actor.uid) throw new Error("Нельзя забанить самого себя");
  if (roleRank(target.role) >= roleRank(actor.role)) throw new Error("Недостаточно прав для этого действия");
  await updateDoc(doc(db, "forum_users", target.uid), { banned });
}

/* ─── Admin: content moderation ─── */
export async function deletePost(actor: ForumUser, postId: string): Promise<void> {
  if (!canModerate(actor.role)) throw new Error("Недостаточно прав");
  await deleteDoc(doc(db, "forum_posts", postId));
}

export async function deleteReply(actor: ForumUser, postId: string, replyId: string): Promise<void> {
  if (!canModerate(actor.role)) throw new Error("Недостаточно прав");
  await deleteDoc(doc(db, "forum_posts", postId, "replies", replyId));
  await updateDoc(doc(db, "forum_posts", postId), { replyCount: increment(-1) });
}

/* ─── Posts ─── */
export function subscribeToPostList(
  onChange: (posts: ForumPost[]) => void,
): () => void {
  const q = query(collection(db, "forum_posts"), orderBy("createdAt", "desc"), limit(50));
  return onSnapshot(q, (snap) => {
    onChange(
      snap.docs.map((d) => {
        const x = d.data() as Record<string, unknown>;
        return {
          id:         d.id,
          authorId:   String(x.authorId   ?? ""),
          authorName: String(x.authorName ?? ""),
          title:      String(x.title      ?? ""),
          body:       String(x.body       ?? ""),
          createdAt:  (x.createdAt as { toMillis?: () => number } | null)?.toMillis?.() ?? null,
          replyCount: Number(x.replyCount ?? 0),
          imageUrl:   x.imageUrl ? String(x.imageUrl) : undefined,
          reactions:  (x.reactions as Record<string, number> | undefined) ?? {},
        };
      }),
    );
  });
}

export async function createPost(user: ForumUser, title: string, body: string, imageUrl?: string): Promise<string> {
  if (user.banned) throw new Error("Ваш аккаунт заблокирован администрацией");
  const data: Record<string, unknown> = {
    authorId: user.uid, authorName: user.username,
    title: title.trim(), body: body.trim(),
    createdAt: serverTimestamp(), replyCount: 0,
  };
  if (imageUrl) data.imageUrl = imageUrl;
  const r = await addDoc(collection(db, "forum_posts"), data);
  return r.id;
}

/* ─── Replies ─── */
export function subscribeToReplies(
  postId: string,
  onChange: (replies: ForumReply[]) => void,
): () => void {
  const q = query(
    collection(db, "forum_posts", postId, "replies"),
    orderBy("createdAt", "asc"),
    limit(200),
  );
  return onSnapshot(q, (snap) => {
    onChange(
      snap.docs.map((d) => {
        const x = d.data() as Record<string, unknown>;
        return {
          id:         d.id,
          authorId:   String(x.authorId   ?? ""),
          authorName: String(x.authorName ?? ""),
          body:       String(x.body       ?? ""),
          createdAt:  (x.createdAt as { toMillis?: () => number } | null)?.toMillis?.() ?? null,
          imageUrl:   x.imageUrl ? String(x.imageUrl) : undefined,
          reactions:  (x.reactions as Record<string, number> | undefined) ?? {},
        };
      }),
    );
  });
}

export async function createReply(user: ForumUser, postId: string, body: string, imageUrl?: string): Promise<void> {
  if (user.banned) throw new Error("Ваш аккаунт заблокирован администрацией");
  const data: Record<string, unknown> = {
    authorId: user.uid, authorName: user.username,
    body: body.trim(), createdAt: serverTimestamp(),
  };
  if (imageUrl) data.imageUrl = imageUrl;
  await addDoc(collection(db, "forum_posts", postId, "replies"), data);
  await updateDoc(doc(db, "forum_posts", postId), { replyCount: increment(1) });
}

/* ─── Formatters ─── */
export function formatDate(ms: number | null): string {
  if (!ms) return "—";
  const d = new Date(ms);
  return d.toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" });
}
