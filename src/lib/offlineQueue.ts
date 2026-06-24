export interface PendingMessage {
  id: string;
  chatId: string;
  senderId: string;
  content: string | null;
  encryptedContent?: string;
  encryptionIv?: string;
  encryptionVersion?: number;
  createdAt: string;
}

const DB_NAME = '3schat-offline-queue';
const STORE = 'pending-messages';

function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: 'id' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function queueMessage(message: PendingMessage) {
  const db = await database();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(STORE, 'readwrite');
    transaction.objectStore(STORE).put(message);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
  db.close();
}

export async function pendingMessages(senderId: string): Promise<PendingMessage[]> {
  const db = await database();
  const values = await new Promise<PendingMessage[]>((resolve, reject) => {
    const request = db.transaction(STORE).objectStore(STORE).getAll();
    request.onsuccess = () => resolve((request.result as PendingMessage[]).filter((entry) => entry.senderId === senderId));
    request.onerror = () => reject(request.error);
  });
  db.close();
  return values;
}

export async function removePendingMessage(id: string) {
  const db = await database();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(STORE, 'readwrite');
    transaction.objectStore(STORE).delete(id);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
  db.close();
}
