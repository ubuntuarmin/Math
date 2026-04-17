import { db } from "./firebase.js";
import {
  collection,
  doc,
  documentId,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  startAfter,
  writeBatch,
} from "https://www.gstatic.com/firebasejs/12.7.0/firebase-firestore.js";
import { buildCanonicalUrlKey, normalizeUrlForDedup } from "./urlDedup.js";

const CLEANUP_STATE_PATH = ["maintenance", "linkDuplicateCleanup"];
const LOCK_DURATION_MS = 10 * 60 * 1000;

function toMillis(ts) {
  return typeof ts?.toMillis === "function" ? ts.toMillis() : 0;
}

async function claimCleanupLock(stateRef, adminUid) {
  let result = { acquired: false };
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(stateRef);
    const data = snap.exists() ? snap.data() : {};
    const now = Date.now();
    const lockExpiresAt = Number(data.lockExpiresAt || 0);

    if (data.running && lockExpiresAt > now) {
      result = { acquired: false };
      return;
    }

    result = {
      acquired: true,
      cursorCreatedAt: data.cursorCreatedAt || null,
      cursorDocId: data.cursorDocId || "",
    };

    tx.set(stateRef, {
      running:      true,
      lockExpiresAt: now + LOCK_DURATION_MS,
      lastStartedAt: serverTimestamp(),
      lastRunBy:    adminUid || "",
    }, { merge: true });
  });
  return result;
}

export async function runDuplicateLinkCleanupPass({
  isAdmin = false,
  adminUid = "",
  maxPages = 4,
  pageSize = 250,
} = {}) {
  if (!isAdmin) return { skipped: true, reason: "not-admin" };

  const stateRef = doc(db, CLEANUP_STATE_PATH[0], CLEANUP_STATE_PATH[1]);
  const lock = await claimCleanupLock(stateRef, adminUid);
  if (!lock.acquired) return { skipped: true, reason: "locked" };

  let cursorCreatedAt = lock.cursorCreatedAt;
  let cursorDocId = lock.cursorDocId;

  let processed = 0;
  let deleted = 0;
  let indexed = 0;
  let backfilled = 0;
  let done = false;

  try {
    for (let page = 0; page < maxPages; page++) {
      const constraints = [
        orderBy("createdAt", "asc"),
        orderBy(documentId(), "asc"),
        limit(pageSize),
      ];

      if (cursorCreatedAt && cursorDocId) {
        constraints.push(startAfter(cursorCreatedAt, cursorDocId));
      }

      const snap = await getDocs(query(collection(db, "sharedLinks"), ...constraints));
      if (snap.empty) {
        done = true;
        break;
      }

      let batch = writeBatch(db);
      let ops = 0;

      for (const linkDoc of snap.docs) {
        processed++;
        const data = linkDoc.data();
        if (data.type !== "url") continue;

        const rawUrl = String(data.url || "").trim();
        if (!rawUrl) continue;

        const canonicalUrl = normalizeUrlForDedup(rawUrl);
        if (!canonicalUrl) continue;

        const canonicalKey = await buildCanonicalUrlKey(canonicalUrl);
        if (!canonicalKey) continue;

        const indexRef = doc(db, "sharedLinkCanonicalIndex", canonicalKey);
        const indexSnap = await getDoc(indexRef);
        const createdAt = data.createdAt || null;
        const createdMs = toMillis(createdAt);

        if (!indexSnap.exists()) {
          batch.set(indexRef, {
            canonicalUrl,
            firstLinkId:    linkDoc.id,
            firstCreatedAt: createdAt || serverTimestamp(),
            submittedBy:    data.submittedBy || "",
            createdAt:      serverTimestamp(),
            updatedAt:      serverTimestamp(),
          });
          ops++;
          indexed++;
        } else {
          const idx = indexSnap.data();
          if (idx.canonicalUrl !== canonicalUrl) continue;

          const firstLinkId = String(idx.firstLinkId || "");
          const firstCreatedMs = toMillis(idx.firstCreatedAt);
          const currentIsOlder = !!firstLinkId && (
            firstCreatedMs === 0 ||
            createdMs < firstCreatedMs ||
            (createdMs === firstCreatedMs && linkDoc.id < firstLinkId)
          );

          if (firstLinkId && firstLinkId !== linkDoc.id) {
            if (currentIsOlder) {
              batch.delete(doc(db, "sharedLinks", firstLinkId));
              batch.set(indexRef, {
                firstLinkId:    linkDoc.id,
                firstCreatedAt: createdAt || serverTimestamp(),
                submittedBy:    data.submittedBy || idx.submittedBy || "",
                updatedAt:      serverTimestamp(),
              }, { merge: true });
              ops += 2;
              deleted++;
            } else {
              batch.delete(linkDoc.ref);
              ops++;
              deleted++;
            }
          }
        }

        if (data.canonicalUrl !== canonicalUrl) {
          batch.update(linkDoc.ref, { canonicalUrl });
          ops++;
          backfilled++;
        }

        if (ops >= 420) {
          await batch.commit();
          batch = writeBatch(db);
          ops = 0;
        }
      }

      if (ops > 0) await batch.commit();

      const lastDoc = snap.docs[snap.docs.length - 1];
      cursorCreatedAt = lastDoc.get("createdAt") || cursorCreatedAt;
      cursorDocId = lastDoc.id || cursorDocId;

      if (snap.size < pageSize) {
        done = true;
        break;
      }
    }

    await setDoc(stateRef, {
      running:         false,
      lockExpiresAt:   0,
      cursorCreatedAt,
      cursorDocId,
      completed:       done,
      lastFinishedAt:  serverTimestamp(),
      lastSummary: {
        processed,
        deleted,
        indexed,
        backfilled,
      },
    }, { merge: true });

    return { processed, deleted, indexed, backfilled, done };
  } catch (error) {
    await setDoc(stateRef, {
      running:       false,
      lockExpiresAt: 0,
      lastError:     String(error?.message || error || "unknown"),
      lastFinishedAt: serverTimestamp(),
    }, { merge: true });
    throw error;
  }
}
