/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * Origin Private File System (OPFS) & Offline Storage Manager
 * Allows storing multi-megabyte 24h RINEX .obs/.nav files directly on client's local storage
 * with zero server upload, high I/O throughput, and 100% offline persistence.
 */

const RINEX_DIR_NAME = 'gnss_rinex_files';

// In-memory fallback map if OPFS is not available in current browser context
const memoryFileCache = new Map<string, File>();

/**
 * Checks if OPFS (Origin Private File System) is supported in current browser
 */
export function isOpfsSupported(): boolean {
  return typeof navigator !== 'undefined' &&
    !!navigator.storage &&
    typeof navigator.storage.getDirectory === 'function';
}

/**
 * Gets or creates the private RINEX directory inside OPFS
 */
async function getRinexDirectory(): Promise<FileSystemDirectoryHandle | null> {
  if (!isOpfsSupported()) return null;
  try {
    const root = await navigator.storage.getDirectory();
    return await root.getDirectoryHandle(RINEX_DIR_NAME, { create: true });
  } catch (err) {
    console.warn('OPFS getDirectory error, falling back to cache:', err);
    return null;
  }
}

export interface StoredRinexFile {
  name: string;
  size: number;
  lastModified: number;
  isOpfs: boolean;
}

/**
 * Saves a RINEX File to client-side OPFS storage
 */
export async function saveRinexFileToOpfs(file: File): Promise<StoredRinexFile> {
  const dir = await getRinexDirectory();

  if (dir) {
    try {
      const fileHandle = await dir.getFileHandle(file.name, { create: true });
      // Create a writable stream to write the file chunks
      const writable = await fileHandle.createWritable();
      await writable.write(file);
      await writable.close();

      return {
        name: file.name,
        size: file.size,
        lastModified: file.lastModified || Date.now(),
        isOpfs: true,
      };
    } catch (err) {
      console.warn('Failed writing to OPFS, falling back to memory cache:', err);
    }
  }

  // Fallback to memory cache
  memoryFileCache.set(file.name, file);
  return {
    name: file.name,
    size: file.size,
    lastModified: file.lastModified || Date.now(),
    isOpfs: false,
  };
}

/**
 * Lists all stored RINEX files in OPFS / client storage
 */
export async function listRinexFilesInOpfs(): Promise<StoredRinexFile[]> {
  const dir = await getRinexDirectory();
  const results: StoredRinexFile[] = [];

  if (dir) {
    try {
      for await (const [name, handle] of (dir as any).entries()) {
        if (handle.kind === 'file') {
          const fileHandle = handle as FileSystemFileHandle;
          const file = await fileHandle.getFile();
          results.push({
            name,
            size: file.size,
            lastModified: file.lastModified,
            isOpfs: true,
          });
        }
      }
      return results;
    } catch (err) {
      console.warn('Error reading OPFS directory entries:', err);
    }
  }

  // Fallback
  memoryFileCache.forEach((file, name) => {
    results.push({
      name,
      size: file.size,
      lastModified: file.lastModified || Date.now(),
      isOpfs: false,
    });
  });

  return results;
}

/**
 * Reads a stored RINEX file as a standard File object
 */
export async function loadRinexFileFromOpfs(fileName: string): Promise<File | null> {
  const dir = await getRinexDirectory();

  if (dir) {
    try {
      const fileHandle = await dir.getFileHandle(fileName, { create: false });
      return await fileHandle.getFile();
    } catch (err) {
      console.warn(`File ${fileName} not found in OPFS:`, err);
    }
  }

  return memoryFileCache.get(fileName) || null;
}

/**
 * Deletes a stored file from OPFS
 */
export async function deleteRinexFileFromOpfs(fileName: string): Promise<boolean> {
  const dir = await getRinexDirectory();

  if (dir) {
    try {
      await dir.removeEntry(fileName);
      return true;
    } catch (err) {
      console.warn(`Failed to delete ${fileName} from OPFS:`, err);
    }
  }

  return memoryFileCache.delete(fileName);
}

/**
 * Clears all files in OPFS directory
 */
export async function clearOpfsRinexDirectory(): Promise<void> {
  const dir = await getRinexDirectory();

  if (dir) {
    try {
      for await (const [name] of (dir as any).entries()) {
        await dir.removeEntry(name);
      }
    } catch (err) {
      console.warn('Failed clearing OPFS directory:', err);
    }
  }

  memoryFileCache.clear();
}
