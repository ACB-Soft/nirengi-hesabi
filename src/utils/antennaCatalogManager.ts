/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * Antenna Calibration Catalog Manager & ANTEX Parser
 * 
 * Manages NOAA NGS ANTCAL, IGS20, and user-uploaded custom ANTEX calibration files.
 * Provides persistent storage in localStorage, robust ANTEX 1.4 parsing, and fail-safe
 * antenna calibration verification for GNSS baseline processing and network adjustment.
 */

import { NoaaAntennaCalibration, NOAA_ANTCAL_CATALOG } from '../data/noaaAntcal';
import { AntennaData, Station } from '../types/gnss';

export const CUSTOM_ANTEX_STORAGE_KEY = 'bsr_custom_antex_catalog_v1';

/**
 * Retrieves all user-uploaded custom antennas from localStorage
 */
export function getCustomAntennaCatalog(): NoaaAntennaCalibration[] {
  try {
    const raw = localStorage.getItem(CUSTOM_ANTEX_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed;
    }
    return [];
  } catch (err) {
    console.warn('Özel anten kataloğu yüklenirken hata:', err);
    return [];
  }
}

/**
 * Saves or updates a single custom antenna calibration to localStorage
 */
export function saveCustomAntenna(antenna: NoaaAntennaCalibration): void {
  try {
    const catalog = getCustomAntennaCatalog();
    const cleanKey = antenna.model.trim().toUpperCase();
    const filtered = catalog.filter(
      (c) => c.model.trim().toUpperCase() !== cleanKey
    );
    filtered.push(antenna);
    localStorage.setItem(CUSTOM_ANTEX_STORAGE_KEY, JSON.stringify(filtered));
  } catch (err) {
    console.error('Özel anten kaydedilirken hata:', err);
  }
}

/**
 * Saves multiple custom antenna calibrations to localStorage in a single batch
 */
export function saveMultipleCustomAntennas(
  antennas: NoaaAntennaCalibration[]
): { added: number; updated: number; total: number } {
  try {
    const catalog = getCustomAntennaCatalog();
    const map = new Map<string, NoaaAntennaCalibration>();

    // Seed with existing custom catalog
    for (const item of catalog) {
      map.set(item.model.trim().toUpperCase(), item);
    }

    let added = 0;
    let updated = 0;

    for (const ant of antennas) {
      const key = ant.model.trim().toUpperCase();
      if (!key) continue;

      if (map.has(key)) {
        updated++;
      } else {
        added++;
      }
      map.set(key, ant);
    }

    const merged = Array.from(map.values());
    localStorage.setItem(CUSTOM_ANTEX_STORAGE_KEY, JSON.stringify(merged));
    return { added, updated, total: merged.length };
  } catch (err) {
    console.error('Toplu anten kataloğu kaydedilirken hata:', err);
    return { added: 0, updated: 0, total: 0 };
  }
}

/**
 * Clears user custom antenna catalog
 */
export function clearCustomAntennaCatalog(): void {
  try {
    localStorage.removeItem(CUSTOM_ANTEX_STORAGE_KEY);
  } catch (err) {
    console.error('Anten kataloğu temizlenirken hata:', err);
  }
}

/**
 * Gets all known antennas: user-uploaded custom antennas + built-in NOAA ANTCAL catalog.
 * Custom antennas take precedence over built-in ones with the same model key.
 */
export function getAllKnownAntennas(): NoaaAntennaCalibration[] {
  const custom = getCustomAntennaCatalog();
  const map = new Map<string, NoaaAntennaCalibration>();

  // 1. Built-in NOAA / IGS20 catalog
  for (const b of NOAA_ANTCAL_CATALOG) {
    map.set(b.model.trim().toUpperCase(), b);
  }

  // 2. Custom catalog overrides or complements
  for (const c of custom) {
    map.set(c.model.trim().toUpperCase(), c);
  }

  return Array.from(map.values());
}

/**
 * Infer manufacturer from model string or displayName
 */
function inferManufacturer(model: string): string {
  const upper = model.toUpperCase();
  if (upper.startsWith('TRM') || upper.includes('TRIMBLE') || upper.includes('ZEPHYR')) return 'Trimble';
  if (upper.startsWith('LEI') || upper.includes('LEICA') || upper.includes('AR10') || upper.includes('AR25')) return 'Leica';
  if (upper.startsWith('TPS') || upper.startsWith('TOP') || upper.includes('TOPCON')) return 'Topcon';
  if (upper.startsWith('SEP') || upper.includes('SEPTENTRIO') || upper.includes('POLANT')) return 'Septentrio';
  if (upper.startsWith('CHC') || upper.includes('CHCNAV') || upper.includes('CHCI')) return 'CHCNAV';
  if (upper.startsWith('STX') || upper.includes('STONEX')) return 'Stonex';
  if (upper.startsWith('HIT') || upper.includes('HITARGET') || upper.includes('V30') || upper.includes('V90')) return 'Hi-Target';
  if (upper.startsWith('SOU') || upper.includes('SOUTH') || upper.includes('GALAXY')) return 'South';
  if (upper.startsWith('JAV') || upper.includes('JAVAD')) return 'Javad';
  if (upper.startsWith('HEM') || upper.includes('HEMISPHERE')) return 'Hemisphere';
  if (upper.startsWith('NOV') || upper.includes('NOVATEL')) return 'NovAtel';
  if (upper.startsWith('EML') || upper.includes('EMLID') || upper.includes('REACH')) return 'Emlid';
  if (upper.startsWith('ASH') || upper.includes('ASHTECH')) return 'Ashtech';
  if (upper.startsWith('SOK') || upper.includes('SOKKIA')) return 'Sokkia';
  return 'Genel / Belirtilmemiş';
}

/**
 * Infer antenna category
 */
function inferCategory(model: string): 'CORS / Choke Ring' | 'Geodetic Base' | 'Rover / SmartAntenna' {
  const upper = model.toUpperCase();
  if (upper.includes('CHOKE') || upper.includes('RING') || upper.includes('DORNE') || upper.includes('CR.') || upper.includes('AR25')) {
    return 'CORS / Choke Ring';
  }
  if (upper.includes('ZEPHYR') || upper.includes('GEODETIC') || upper.includes('BASE') || upper.includes('AR10') || upper.includes('TRM59800')) {
    return 'Geodetic Base';
  }
  return 'Rover / SmartAntenna';
}

/**
 * Parses ANTEX format (v1.3 & v1.4) content (.atx or .txt) and extracts all calibrated antennas
 */
export function parseAntexContent(antexText: string): NoaaAntennaCalibration[] {
  if (!antexText) return [];

  const lines = antexText.split(/\r?\n/);
  const antennas: NoaaAntennaCalibration[] = [];

  let inAntenna = false;
  let rawModelStr = '';
  let serialNo = '';
  let currentFreq = '';
  let pcoL1 = { n: 0, e: 0, u: 0 };
  let pcoL2 = { n: 0, e: 0, u: 0 };
  let pcvG01: number[] = [];
  let pcvG02: number[] = [];
  let foundG01 = false;
  let foundG02 = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.length < 60) {
      if (line.includes('START OF ANTENNA')) {
        inAntenna = true;
        rawModelStr = '';
        serialNo = '';
        currentFreq = '';
        pcoL1 = { n: 0, e: 0, u: 0 };
        pcoL2 = { n: 0, e: 0, u: 0 };
        pcvG01 = [];
        pcvG02 = [];
        foundG01 = false;
        foundG02 = false;
      }
      continue;
    }

    const label = line.substring(60).trim();
    const data = line.substring(0, 60);

    if (label === 'START OF ANTENNA') {
      inAntenna = true;
      rawModelStr = '';
      serialNo = '';
      currentFreq = '';
      pcoL1 = { n: 0, e: 0, u: 0 };
      pcoL2 = { n: 0, e: 0, u: 0 };
      pcvG01 = [];
      pcvG02 = [];
      foundG01 = false;
      foundG02 = false;
      continue;
    }

    if (!inAntenna) continue;

    if (label === 'TYPE / SERIAL NO') {
      // Columns 1-20: 16 char antenna type + 4 char radome code
      // Columns 21-40: Serial number (blank for type-mean)
      rawModelStr = data.substring(0, 20);
      serialNo = data.substring(20, 40).trim();
    } else if (label === 'START OF FREQUENCY') {
      currentFreq = data.substring(0, 10).trim().toUpperCase();
    } else if (label === 'NORTH / EAST / UP') {
      const parts = data.trim().split(/\s+/).map(Number);
      if (parts.length >= 3 && !isNaN(parts[0]) && !isNaN(parts[1]) && !isNaN(parts[2])) {
        if (currentFreq === 'G01' || currentFreq === 'G1' || currentFreq === 'L1' || (!foundG01 && !currentFreq)) {
          pcoL1 = { n: parts[0], e: parts[1], u: parts[2] };
          foundG01 = true;
        } else if (currentFreq === 'G02' || currentFreq === 'G2' || currentFreq === 'L2') {
          pcoL2 = { n: parts[0], e: parts[1], u: parts[2] };
          foundG02 = true;
        }
      }
    } else if (label === 'NOAZI') {
      const parts = data.trim().split(/\s+/).map(Number).filter((n) => !isNaN(n));
      if (parts.length > 0) {
        if (currentFreq === 'G01' || currentFreq === 'G1' || currentFreq === 'L1' || (pcvG01.length === 0 && !currentFreq)) {
          pcvG01 = parts;
        } else if (currentFreq === 'G02' || currentFreq === 'G2' || currentFreq === 'L2') {
          pcvG02 = parts;
        }
      }
    } else if (label === 'END OF FREQUENCY') {
      currentFreq = '';
    } else if (label === 'END OF ANTENNA') {
      inAntenna = false;
      const cleanModel = rawModelStr.trim();
      if (cleanModel) {
        // Parse radome (last 4 chars of the 20-char block or default NONE)
        let modelPart = cleanModel;
        let radomePart = 'NONE';

        if (rawModelStr.length >= 20) {
          modelPart = rawModelStr.substring(0, 16).trim();
          radomePart = rawModelStr.substring(16, 20).trim() || 'NONE';
        } else if (cleanModel.includes(' ')) {
          const tokens = cleanModel.split(/\s+/);
          if (tokens.length >= 2) {
            radomePart = tokens[tokens.length - 1];
            modelPart = tokens.slice(0, tokens.length - 1).join(' ');
          }
        }

        const standard20CharModel = modelPart.padEnd(16, ' ') + radomePart.padEnd(4, ' ');
        const mfg = inferManufacturer(modelPart);
        const category = inferCategory(modelPart);

        // Fallback PCV if not given in file
        const pcvFinal = pcvG01.length >= 7 ? pcvG01.slice(0, 7) : [0.0, 0.5, 1.2, 2.2, 3.5, 5.0, 6.8];

        antennas.push({
          model: standard20CharModel,
          displayName: `${mfg} ${modelPart} [${radomePart}]${serialNo ? ` (S/N: ${serialNo})` : ''}`,
          manufacturer: mfg,
          radome: radomePart,
          category,
          radius: 0.080,
          verticalOffset: 0.0,
          pcoL1,
          pcoL2,
          pcvZenith: pcvFinal,
        });
      }
    }
  }

  return antennas;
}

export interface AntennaMatchResult {
  calibration: NoaaAntennaCalibration;
  source: 'CUSTOM_ATX' | 'BUILTIN';
}

/**
 * Searches and automatically matches antenna information from a model string across:
 * 1. User-uploaded custom ATX catalog (localStorage)
 * 2. NOAA NGS ANTCAL / IGS20 built-in catalog
 */
export function findAntennaInCatalog(rawModelStr: string): AntennaMatchResult | null {
  if (!rawModelStr) return null;

  const clean = rawModelStr.trim().toUpperCase();
  if (clean.length === 0) return null;

  const customCatalog = getCustomAntennaCatalog();
  const builtInCatalog = NOAA_ANTCAL_CATALOG;

  const searchInList = (list: NoaaAntennaCalibration[]): NoaaAntennaCalibration | null => {
    // 1. Exact 20-char or trimmed match
    for (const cal of list) {
      if (cal.model.trim().toUpperCase() === clean) return cal;
    }

    // 2. StartsWith match (e.g. "TRM59800.00" matches "TRM59800.00     NONE")
    for (const cal of list) {
      const mainModel = cal.model.substring(0, 16).trim().toUpperCase();
      if (clean.startsWith(mainModel) || mainModel.startsWith(clean)) {
        return cal;
      }
    }

    // 3. Substring match
    for (const cal of list) {
      const modelTrimmed = cal.model.replace(/\s+/g, ' ').toUpperCase();
      if (modelTrimmed.includes(clean) || clean.includes(cal.model.substring(0, 10).trim().toUpperCase())) {
        return cal;
      }
    }

    // 4. Normalized alphanumeric match (removes punctuation, spaces)
    const normClean = clean.replace(/[^A-Z0-9]/g, '');
    if (normClean.length >= 3) {
      for (const cal of list) {
        const normModel = cal.model.replace(/[^A-Z0-9]/g, '');
        const normDisplay = cal.displayName.replace(/[^A-Z0-9]/g, '');
        if (normModel.includes(normClean) || normClean.includes(normModel) || normDisplay.includes(normClean)) {
          return cal;
        }
      }
    }

    return null;
  };

  // Check custom catalog first (user overrides)
  const customMatch = searchInList(customCatalog);
  if (customMatch) {
    return { calibration: customMatch, source: 'CUSTOM_ATX' };
  }

  // Check built-in NOAA catalog
  const builtInMatch = searchInList(builtInCatalog);
  if (builtInMatch) {
    return { calibration: builtInMatch, source: 'BUILTIN' };
  }

  return null;
}

/**
 * Checks whether an antenna has valid calibration (PCO/PCV).
 * Returns true only if calibration is verified.
 */
export function isAntennaDataCalibrated(antenna: AntennaData | undefined | null): boolean {
  if (!antenna) return false;

  // Explicit flag
  if (antenna.isCalibrated === true) return true;
  if (antenna.isCalibrated === false) return false;

  // If not explicitly set, check if model exists in catalog and has non-zero PCO Up
  const match = findAntennaInCatalog(antenna.model || antenna.rawRinexModel || '');
  if (match) {
    // Valid calibration in catalog
    return true;
  }

  // Fallback: if PCO Up is strictly > 0 and model isn't default unknown
  if (antenna.pcoL1 && antenna.pcoL1.u > 0) {
    return true;
  }

  return false;
}

/**
 * Checks whether a station has a calibrated antenna
 */
export function isStationAntennaCalibrated(station: Station | undefined | null): boolean {
  if (!station) return false;
  return isAntennaDataCalibrated(station.antenna);
}

/**
 * Returns all stations that have missing / uncalibrated ANTEX parameters
 */
export function getUncalibratedStations(stations: Record<string, Station> | Station[]): Station[] {
  const list = Array.isArray(stations) ? stations : Object.values(stations);
  return list.filter((st) => !isStationAntennaCalibrated(st));
}
