import {
  collection,
  doc,
  getDoc,
  limit,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
} from "firebase/firestore";
import { db } from "./firebase";

export interface GuestbookEntry {
  id: string;
  nickname: string;
  text: string;
  createdAt: number | null;
}

const COLLECTION = "guestbook";
export const MAX_LENGTH = 32;
export const MAX_NICKNAME_LENGTH = 20;

/** Firestore document IDs cannot contain "/" and cannot be exactly "." or "..". */
function sanitizeIpForDocId(ip: string): string {
  return ip.replace(/[/.:]/g, "_");
}

export async function getClientIp(): Promise<string> {
  const res = await fetch("https://api.ipify.org?format=json");
  if (!res.ok) {
    throw new Error("Не удалось определить IP-адрес");
  }
  const data = (await res.json()) as { ip: string };
  return data.ip;
}

export function subscribeToEntries(
  onChange: (entries: GuestbookEntry[]) => void,
  onError: (err: Error) => void,
) {
  const q = query(
    collection(db, COLLECTION),
    orderBy("createdAt", "asc"),
    limit(200),
  );
  return onSnapshot(
    q,
    (snap) => {
      const entries = snap.docs.map((d) => {
        const data = d.data() as { nickname?: string; text?: string; createdAt?: { toMillis: () => number } };
        return {
          id: d.id,
          nickname: data.nickname ?? "Гость",
          text: data.text ?? "",
          createdAt: data.createdAt?.toMillis?.() ?? null,
        };
      });
      onChange(entries);
    },
    (err) => onError(err as Error),
  );
}

export async function hasSubmitted(ip: string): Promise<boolean> {
  const id = sanitizeIpForDocId(ip);
  const snap = await getDoc(doc(db, COLLECTION, id));
  return snap.exists();
}

export async function submitEntry(ip: string, nickname: string, text: string): Promise<void> {
  const trimmedText = text.trim().slice(0, MAX_LENGTH);
  const trimmedNickname = nickname.trim().slice(0, MAX_NICKNAME_LENGTH) || "Гость";
  if (!trimmedText) {
    throw new Error("Текст не может быть пустым");
  }
  const id = sanitizeIpForDocId(ip);
  const ref = doc(db, COLLECTION, id);
  // Atomic check-and-write inside a transaction: prevents two near-simultaneous
  // submissions from the same IP from racing past the earlier hasSubmitted()
  // precheck and overwriting each other's entry.
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    if (snap.exists()) {
      throw new Error("Вы уже оставили запись здесь.");
    }
    tx.set(ref, {
      nickname: trimmedNickname,
      text: trimmedText,
      createdAt: serverTimestamp(),
    });
  });
}
