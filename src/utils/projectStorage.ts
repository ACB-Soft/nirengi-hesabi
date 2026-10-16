/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * GNSS Ağ Dengeleme & Hız Hesabı Proje Depolama ve Yönetim Servisi
 */

import {
  JobConfig,
  Station,
  BaselineVector,
  LoopClosure,
  AdjustmentResult,
} from '../types/gnss';

export interface SavedProject {
  id: string;
  name: string;
  calculatedAt?: string;
  updatedAt: string;
  stationCount: number;
  baselineCount: number;
  pointCount?: number;
  sigma0?: number;
  isAccepted?: boolean;
  data: {
    config: JobConfig;
    stations: Record<string, Station>;
    baselines: BaselineVector[];
    loopClosures?: LoopClosure[];
    unconstrainedResult?: AdjustmentResult | null;
    constrainedResult?: AdjustmentResult | null;
    adjustmentResult?: AdjustmentResult | null;
  };
}

const STORAGE_KEY = 'bsr_gnss_nirengi_projects_v1';

export function getSavedProjects(): SavedProject[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      // Exclude any legacy sample projects
      const cleaned = parsed.filter((p) => p && p.id !== 'sample-bursa-gnss-2025');
      if (cleaned.length !== parsed.length) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(cleaned));
      }
      return cleaned;
    }
    return [];
  } catch (err) {
    console.warn('Kayıtlı projeler yüklenirken hata:', err);
    return [];
  }
}

export function saveProjectToStorage(project: SavedProject): void {
  try {
    const list = getSavedProjects();
    const existingIndex = list.findIndex((p) => p.id === project.id);
    let updated: SavedProject[];
    if (existingIndex >= 0) {
      updated = [...list];
      updated[existingIndex] = project;
    } else {
      updated = [project, ...list];
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  } catch (err) {
    console.warn('Proje kaydedilirken hata:', err);
  }
}

export function updateProjectNameInStorage(id: string, newName: string): void {
  try {
    const list = getSavedProjects();
    const updated = list.map((p) => {
      if (p.id === id) {
        return {
          ...p,
          name: newName.trim(),
          updatedAt: new Date().toLocaleDateString('tr-TR') + ' ' + new Date().toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }),
        };
      }
      return p;
    });
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  } catch (err) {
    console.warn('Proje ismi güncellenirken hata:', err);
  }
}

export function deleteProjectFromStorage(id: string): void {
  try {
    const list = getSavedProjects();
    const updated = list.filter((p) => p.id !== id);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  } catch (err) {
    console.warn('Proje silinirken hata:', err);
  }
}
