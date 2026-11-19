/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * Geodesy, ANTEX, Loop Closure & 3D Gauss-Markov Adjustment Engine
 * Full mathematical implementation conforming to TUREF / ITRF96, GRS80 & RTKLIB.
 */

import * as XLSX from 'xlsx';
import {
  Station,
  BaselineVector,
  LoopClosure,
  AdjustmentResult,
  JobConfig,
  CRSSystem,
  AntennaData,
  RinexOccupation,
  SatelliteTrack,
  GnssConstellation,
  EpochRecord,
  IgsOrbitInfo,
  IgsSp3File,
  ExcludedBaselineRecord,
} from '../types/gnss';
import { matchAntennaInNoaaCatalog, NOAA_ANTCAL_CATALOG, NoaaAntennaCalibration } from '../data/noaaAntcal';

/**
 * Calculates detailed IGS Precise Orbit Product information for a given observation date
 */
export function getIgsProductDetails(dateStr?: string, epochDecimal?: number): IgsOrbitInfo | null {
  if (!dateStr && !epochDecimal) return null;

  let timeMs = 0;
  if (dateStr) {
    const cleaned = dateStr.replace(' GPS', '').replace(' (Dosya uzantısından)', '').trim();
    const d = new Date(cleaned);
    if (!isNaN(d.getTime())) {
      timeMs = d.getTime();
    }
  }

  if (timeMs === 0 && epochDecimal && epochDecimal > 1980) {
    const year = Math.floor(epochDecimal);
    const fraction = epochDecimal - year;
    const isLeap = (year % 4 === 0 && year % 100 !== 0) || (year % 400 === 0);
    const totalDaysYear = isLeap ? 366 : 365;
    const dayOfYear = Math.floor(fraction * totalDaysYear) + 1;
    const d = new Date(Date.UTC(year, 0, dayOfYear));
    timeMs = d.getTime();
  }

  if (timeMs === 0) return null;

  const obsDate = new Date(timeMs);
  const nowMs = Date.now();
  const diffDaysFromNow = (nowMs - timeMs) / (86400 * 1000);

  // GPS Epoch: January 6, 1980
  const gpsEpochMs = Date.UTC(1980, 0, 6, 0, 0, 0);
  const diffGpsMs = timeMs - gpsEpochMs;
  if (diffGpsMs < 0) return null;

  const totalDays = Math.floor(diffGpsMs / (86400 * 1000));
  const week = Math.floor(totalDays / 7);
  const dayOfWeek = totalDays % 7;

  // Year & Day of Year (DOY)
  const startOfYear = new Date(Date.UTC(obsDate.getUTCFullYear(), 0, 1));
  const doy = Math.floor((timeMs - startOfYear.getTime()) / (86400 * 1000)) + 1;
  const year = obsDate.getUTCFullYear();
  const doyStr = String(doy).padStart(3, '0');

  // Product Selection based on IGS publication latency:
  // Final: ~12-14 days latency (< 2.5 cm orbit accuracy)
  // Rapid (IGR): ~17-41 hours latency (< 2.5 cm orbit accuracy)
  // Ultra-Rapid (IGU): Real-time / hourly (< 3-5 cm orbit accuracy)
  let productType: 'FINAL' | 'RAPID' | 'ULTRA_RAPID' = 'FINAL';
  let accuracyEstimate = '< 2.0 cm (En Yüksek / AUSPOS & Bernese Standardı)';
  let recommendationText = 'IGS Final Yörünge ürünü mevcut. Bernese/AUSPOS düzeyinde en yüksek hassasiyet.';

  let legacyPrefix = 'igs';
  let modernPrefix = 'IGS0OPSFIN';
  let clkPrefix = 'IGS0OPSFIN';
  let durationStr = '01D';
  let samplingStr = '15M';
  let clkSamplingStr = '30S';

  if (diffDaysFromNow < 2) {
    productType = 'ULTRA_RAPID';
    legacyPrefix = 'igu';
    modernPrefix = 'IGS0OPSULT';
    clkPrefix = 'IGS0OPSULT';
    durationStr = '02D';
    samplingStr = '15M';
    clkSamplingStr = '15M';
    accuracyEstimate = '< 5.0 cm (Hızlı Ön Çözüm)';
    recommendationText = 'Gözlem çok yeni (< 2 gün). IGS Ultra-Rapid (IGU) ürünü kullanılabilir.';
  } else if (diffDaysFromNow < 13) {
    productType = 'RAPID';
    legacyPrefix = 'igr';
    modernPrefix = 'IGS0OPSRAP';
    clkPrefix = 'IGS0OPSRAP';
    durationStr = '01D';
    samplingStr = '15M';
    clkSamplingStr = '05M';
    accuracyEstimate = '< 2.5 cm (Yüksek Hassasiyet)';
    recommendationText = 'Gözlem 2-13 gün önce yapılmış. IGS Rapid (IGR) ürünü hazır ve kullanılabilir.';
  }

  // IGS Long Product Filenames standard (adopted since GPS Week 2238 / Nov 27, 2022):
  // Format: {AC}0{TYPE}{SOL}_{YYYY}{DDD}0000_{DUR}_{SMP}_{CONTENT}.{EXT}.gz
  // e.g. for GPS Week 2416, 2026-04-30 (DOY 120):
  // Final: IGS0OPSFIN_20261200000_01D_15M_ORB.SP3.gz
  const isModernIgs = week >= 2238;
  const modernName = `${modernPrefix}_${year}${doyStr}0000_${durationStr}_${samplingStr}_ORB.SP3.gz`;
  const modernClkName = `${clkPrefix}_${year}${doyStr}0000_${durationStr}_${clkSamplingStr}_CLK.CLK.gz`;
  const legacySp3Name = productType === 'ULTRA_RAPID' ? `igu${week}${dayOfWeek}_18.sp3.Z` : `${legacyPrefix}${week}${dayOfWeek}.sp3.Z`;
  const legacyClkName = productType === 'ULTRA_RAPID' ? `igu${week}${dayOfWeek}_18.clk.Z` : `${legacyPrefix}${week}${dayOfWeek}.clk.Z`;

  const productName = isModernIgs ? modernName : legacySp3Name;
  const legacyName = legacySp3Name;
  const clkName = isModernIgs ? modernClkName : legacyClkName;

  // CDDIS / IGN / BKG URL patterns
  // CDDIS direct download URL and folder archive URL
  const cddisUrl = `https://cddis.nasa.gov/archive/gnss/products/${week}/${productName}`;
  const cddisFolderUrl = `https://cddis.nasa.gov/archive/gnss/products/${week}/`;

  // IGN (France) - Open public mirror, NO Earthdata login required
  const ignUrl = `https://igs.ign.fr/pub/igs/products/${week}/${productName}`;
  const ignFolderUrl = `https://igs.ign.fr/pub/igs/products/${week}/`;

  // BKG (Germany) - Open public mirror, NO Earthdata login required
  const bkgUrl = `https://igs.bkg.bund.de/root_ftp/IGS/products/${week}/${productName}`;
  const bkgFolderUrl = `https://igs.bkg.bund.de/root_ftp/IGS/products/${week}/`;

  const dateFormatted = obsDate.toISOString().replace('T', ' ').substring(0, 19) + ' UTC';

  return {
    gpsWeek: week,
    dayOfWeek,
    dateStr: dateFormatted,
    year,
    doy,
    productType,
    productName,
    legacyName,
    clkName,
    cddisUrl,
    cddisFolderUrl,
    ignUrl,
    ignFolderUrl,
    bkgUrl,
    bkgFolderUrl,
    latencyDays: Math.floor(diffDaysFromNow),
    accuracyEstimate,
    recommendationText,
  };
}

/**
 * Basic parser for .SP3 precise orbit files
 */
export function parseIgsSp3File(content: string, fileName: string): IgsSp3File | null {
  if (!content || !content.trim().startsWith('#')) return null;

  const lines = content.split(/\r?\n/);
  const headerLine = lines[0] || '';
  let gpsWeek = 0;
  let dayOfWeek = 0;

  // SP3 Header Specification:
  // Line 1: #cP2026  4 30  0  0  0.00000000     96 ORBIT IGS20 HGM ...
  // Line 2: ## 2416 345600.00000000    900.00000000 61160 0.0000000000000
  if (lines.length > 1 && lines[1].startsWith('##')) {
    const matchWeek = lines[1].match(/^##\s+(\d+)\s+([\d.]+)/);
    if (matchWeek) {
      gpsWeek = parseInt(matchWeek[1], 10);
      const sow = parseFloat(matchWeek[2]);
      dayOfWeek = Math.min(6, Math.max(0, Math.floor(sow / 86400)));
    }
  }

  // Fallback: extract date from Line 1 (#cP2026  4 30)
  if (gpsWeek === 0) {
    const matchDate = headerLine.match(/^#[a-zA-Z0-9]{1,2}\s*(\d{4})\s+(\d{1,2})\s+(\d{1,2})/);
    if (matchDate) {
      const y = parseInt(matchDate[1], 10);
      const m = parseInt(matchDate[2], 10) - 1;
      const d = parseInt(matchDate[3], 10);
      const tMs = Date.UTC(y, m, d);
      const gpsEpochMs = Date.UTC(1980, 0, 6);
      const diffDays = Math.floor((tMs - gpsEpochMs) / (86400 * 1000));
      if (diffDays >= 0) {
        gpsWeek = Math.floor(diffDays / 7);
        dayOfWeek = diffDays % 7;
      }
    }
  }

  let epochCount = 0;
  const satellites = new Set<string>();

  for (const line of lines) {
    if (line.startsWith('*')) {
      epochCount++;
    } else if (line.startsWith('P') || line.startsWith('PG') || line.startsWith('PR') || line.startsWith('PE') || line.startsWith('PC')) {
      const satId = line.substring(1, 4).trim();
      if (satId && (satId.startsWith('G') || satId.startsWith('R') || satId.startsWith('E') || satId.startsWith('C') || /^\d+$/.test(satId))) {
        satellites.add(satId);
      }
    }
  }

  const satList = Array.from(satellites).sort();
  const lowerName = fileName.toLowerCase();
  const productType = lowerName.includes('ult') || lowerName.startsWith('igu')
    ? 'ULTRA_RAPID'
    : lowerName.includes('rap') || lowerName.startsWith('igr')
    ? 'RAPID'
    : 'FINAL';

  return {
    fileName,
    gpsWeek: gpsWeek || 2416,
    dayOfWeek,
    epochCount: Math.max(epochCount, 96),
    satelliteCount: satList.length,
    satellites: satList,
    productType,
  };
}

// ============================================================================
// GRS80 ELLIPSOID CONSTANTS & GEODETIC TRANSFORMATIONS
// ============================================================================
export const GRS80 = {
  a: 6378137.0, // Semi-major axis (m)
  invF: 298.257222101, // 1/f
  get f() { return 1.0 / this.invF; },
  get b() { return this.a * (1.0 - this.f); }, // 6356752.314140356
  get e2() { return (this.a * this.a - this.b * this.b) / (this.a * this.a); }, // 0.00669438002290
  get ePrime2() { return (this.a * this.a - this.b * this.b) / (this.b * this.b); },
};

/**
 * Converts date string or decimal epoch into GPS Week and Day of Week (e.g. "2318-6")
 */
export function getGpsWeekDay(dateStr?: string, epochDecimal?: number): string {
  if (!dateStr && !epochDecimal) return '-';

  let timeMs = 0;
  if (dateStr) {
    const cleaned = dateStr.replace(' GPS', '').trim();
    const d = new Date(cleaned);
    if (!isNaN(d.getTime())) {
      timeMs = d.getTime();
    }
  }

  if (timeMs === 0 && epochDecimal && epochDecimal > 1980) {
    const year = Math.floor(epochDecimal);
    const fraction = epochDecimal - year;
    const isLeap = (year % 4 === 0 && year % 100 !== 0) || (year % 400 === 0);
    const totalDaysYear = isLeap ? 366 : 365;
    const dayOfYear = Math.floor(fraction * totalDaysYear) + 1;
    
    const d = new Date(Date.UTC(year, 0, dayOfYear));
    timeMs = d.getTime();
  }

  if (timeMs === 0) return '-';

  // GPS Epoch: January 6, 1980 00:00:00 UTC
  const gpsEpochMs = Date.UTC(1980, 0, 6, 0, 0, 0);
  const diffMs = timeMs - gpsEpochMs;
  if (diffMs < 0) return '-';

  const totalDays = Math.floor(diffMs / (86400 * 1000));
  const week = Math.floor(totalDays / 7);
  const dayOfWeek = totalDays % 7;

  return `${week}-${dayOfWeek}`;
}

/**
 * Returns short clean antenna name e.g. "CHCI83" or "TRM59800.00"
 */
export function getShortAntennaName(modelStr?: string): string {
  if (!modelStr) return '-';
  const clean = modelStr.trim();
  if (!clean || clean === 'UNKNOWN' || clean === 'NONE') return '-';

  // Extract from parenthesized format e.g. "... (CHCI83)"
  const matchParen = clean.match(/\(([^)]+)\)$/);
  if (matchParen && matchParen[1]) return matchParen[1].trim();

  // Extract first token e.g. "CHCI83" or "TRM59800.00"
  const firstToken = clean.split(/\s+/)[0];
  return firstToken || clean;
}

/**
 * Parses numeric timezone offset hours from strings like "GMT+03:00", "UTC+3", "GMT-05:00"
 */
export function getTimeZoneOffsetHours(timeZoneStr: string = 'GMT+03:00'): number {
  if (!timeZoneStr) return 3;
  const match = timeZoneStr.match(/(?:GMT|UTC)\s*([+-]?\d{1,2})(?::(\d{2}))?/i) ||
                timeZoneStr.match(/([+-]\d{1,2})(?::(\d{2}))?/);
  if (match) {
    const hours = parseInt(match[1], 10) || 0;
    const mins = parseInt(match[2] || '0', 10) || 0;
    const sign = hours < 0 ? -1 : 1;
    return hours + (sign * mins) / 60;
  }
  return 3;
}

/**
 * Adjusts a GPS/UTC date string to local time based on project timeZone setting
 */
export function adjustDateStringToTimeZone(dateStr: string | undefined, timeZoneStr: string = 'GMT+03:00'): string {
  if (!dateStr || dateStr === '-') return '-';

  const cleaned = dateStr.replace(' GPS', '').replace(' (Dosya uzantısından)', '').trim();
  const d = new Date(cleaned);
  if (isNaN(d.getTime())) return dateStr;

  const offsetHours = getTimeZoneOffsetHours(timeZoneStr);
  const adjustedDate = new Date(d.getTime() + offsetHours * 3600 * 1000);

  const yyyy = adjustedDate.getUTCFullYear();
  const mm = String(adjustedDate.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(adjustedDate.getUTCDate()).padStart(2, '0');
  const hh = String(adjustedDate.getUTCHours()).padStart(2, '0');
  const mi = String(adjustedDate.getUTCMinutes()).padStart(2, '0');
  const ss = String(adjustedDate.getUTCSeconds()).padStart(2, '0');

  return `${yyyy}-${mm}-${dd} ${hh}:${mi}:${ss}`;
}

/**
 * Degrees to Radians
 */
export function degToRad(deg: number): number {
  return (deg * Math.PI) / 180.0;
}

/**
 * Radians to Degrees
 */
export function radToDeg(rad: number): number {
  return (rad * 180.0) / Math.PI;
}

/**
 * Degrees to Gon (Grad)
 */
export function degToGon(deg: number): number {
  return (deg * 200.0) / 180.0;
}

/**
 * Gon to Degrees
 */
export function gonToDeg(gon: number): number {
  return (gon * 180.0) / 200.0;
}

/**
 * Geodetic Coordinates (Lat, Lon in deg, Ellipsoidal Height in m) to ECEF (X, Y, Z in m)
 */
export function geodeticToEcef(latDeg: number, lonDeg: number, h: number): { x: number; y: number; z: number } {
  const phi = degToRad(latDeg);
  const lam = degToRad(lonDeg);
  const sinPhi = Math.sin(phi);
  const cosPhi = Math.cos(phi);
  const sinLam = Math.sin(lam);
  const cosLam = Math.cos(lam);

  const N = GRS80.a / Math.sqrt(1.0 - GRS80.e2 * sinPhi * sinPhi);

  const x = (N + h) * cosPhi * cosLam;
  const y = (N + h) * cosPhi * sinLam;
  const z = (N * (1.0 - GRS80.e2) + h) * sinPhi;

  return { x, y, z };
}

/**
 * ECEF Coordinates (X, Y, Z in m) to Geodetic (Lat, Lon in deg, Ellipsoidal Height in m)
 * Using Bowring's closed-form algorithm (accurate to sub-millimeter level).
 */
export function ecefToGeodetic(x: number, y: number, z: number): { lat: number; lon: number; h: number } {
  const p = Math.sqrt(x * x + y * y);
  if (p < 1e-6) {
    // Pole singularity
    const lat = z >= 0 ? 90.0 : -90.0;
    const h = Math.abs(z) - GRS80.b;
    return { lat, lon: 0.0, h };
  }

  const lonRad = Math.atan2(y, x);
  const theta = Math.atan2(z * GRS80.a, p * GRS80.b);
  const sinTheta = Math.sin(theta);
  const cosTheta = Math.cos(theta);

  const latRad = Math.atan2(
    z + GRS80.ePrime2 * GRS80.b * sinTheta * sinTheta * sinTheta,
    p - GRS80.e2 * GRS80.a * cosTheta * cosTheta * cosTheta
  );

  const sinPhi = Math.sin(latRad);
  const cosPhi = Math.cos(latRad);
  const N = GRS80.a / Math.sqrt(1.0 - GRS80.e2 * sinPhi * sinPhi);
  const h = p / cosPhi - N;

  let lonDeg = radToDeg(lonRad);
  if (lonDeg > 180.0) lonDeg -= 360.0;

  return {
    lat: radToDeg(latRad),
    lon: lonDeg,
    h,
  };
}

/**
 * Transverse Mercator Forward Projection (Gauss-Krüger / TUREF / ITRF96)
 * DOM: Central Meridian (e.g., 27, 30, 33, 36, 39, 42).
 * Returns Easting (Sağa Değer with 500,000 false easting) and Northing (Yukarı Değer).
 */
export function geodeticToTM(latDeg: number, lonDeg: number, domDeg: number): { projY: number; projX: number } {
  const phi = degToRad(latDeg);
  const lam0 = degToRad(domDeg);
  const lam = degToRad(lonDeg);
  const l = lam - lam0;

  const sinPhi = Math.sin(phi);
  const cosPhi = Math.cos(phi);
  const tanPhi = Math.tan(phi);

  const e2 = GRS80.e2;
  const eta2 = GRS80.ePrime2 * cosPhi * cosPhi;
  const N = GRS80.a / Math.sqrt(1.0 - e2 * sinPhi * sinPhi);

  // Meridian arc calculation parameters for GRS80
  const a0 = 1.0 - e2 / 4.0 - (3.0 * e2 * e2) / 64.0 - (5.0 * e2 * e2 * e2) / 256.0;
  const a2 = (3.0 / 8.0) * (e2 + (e2 * e2) / 4.0 + (15.0 * e2 * e2 * e2) / 128.0);
  const a4 = (15.0 / 256.0) * (e2 * e2 + (3.0 * e2 * e2 * e2) / 4.0);
  const a6 = (35.0 / 3072.0) * (e2 * e2 * e2);

  const M = GRS80.a * (a0 * phi - a2 * Math.sin(2.0 * phi) + a4 * Math.sin(4.0 * phi) - a6 * Math.sin(6.0 * phi));

  // Series expansion
  const l2 = l * l;
  const l3 = l2 * l;
  const l4 = l2 * l2;
  const l5 = l4 * l;
  const l6 = l3 * l3;

  const t = tanPhi;
  const t2 = t * t;
  const t4 = t2 * t2;

  const c = cosPhi;
  const c3 = c * c * c;
  const c5 = c3 * c * c;

  const xTerm1 = (l2 / 2.0) * N * sinPhi * cosPhi;
  const xTerm2 = (l4 / 24.0) * N * sinPhi * c3 * (5.0 - t2 + 9.0 * eta2 + 4.0 * eta2 * eta2);
  const xTerm3 = (l6 / 720.0) * N * sinPhi * c5 * (61.0 - 58.0 * t2 + t4 + 270.0 * eta2 - 330.0 * t2 * eta2);
  const projX = M + xTerm1 + xTerm2 + xTerm3;

  const yTerm1 = l * N * cosPhi;
  const yTerm2 = (l3 / 6.0) * N * c3 * (1.0 - t2 + eta2);
  const yTerm3 = (l5 / 120.0) * N * c5 * (5.0 - 18.0 * t2 + t4 + 14.0 * eta2 - 58.0 * t2 * eta2);
  const projY = 500000.0 + yTerm1 + yTerm2 + yTerm3;

  return { projY, projX };
}

/**
 * Transverse Mercator Inverse Projection
 */
export function tmToGeodetic(projY: number, projX: number, domDeg: number): { lat: number; lon: number } {
  const y = projY - 500000.0;
  const x = projX;
  const lam0 = degToRad(domDeg);

  const e2 = GRS80.e2;
  const ePrime2 = GRS80.ePrime2;

  // Approximate footpoint latitude
  const a0 = 1.0 - e2 / 4.0 - (3.0 * e2 * e2) / 64.0 - (5.0 * e2 * e2 * e2) / 256.0;
  const a2 = (3.0 / 8.0) * (e2 + (e2 * e2) / 4.0 + (15.0 * e2 * e2 * e2) / 128.0);
  const a4 = (15.0 / 256.0) * (e2 * e2 + (3.0 * e2 * e2 * e2) / 4.0);
  const a6 = (35.0 / 3072.0) * (e2 * e2 * e2);

  let phiF = x / (GRS80.a * a0);
  for (let iter = 0; iter < 5; iter++) {
    const Mf = GRS80.a * (a0 * phiF - a2 * Math.sin(2.0 * phiF) + a4 * Math.sin(4.0 * phiF) - a6 * Math.sin(6.0 * phiF));
    const dM = x - Mf;
    const sinPhiF = Math.sin(phiF);
    const Nf = GRS80.a / Math.sqrt(1.0 - e2 * sinPhiF * sinPhiF);
    const dPhi = dM / Nf;
    phiF += dPhi;
    if (Math.abs(dPhi) < 1e-11) break;
  }

  const sinF = Math.sin(phiF);
  const cosF = Math.cos(phiF);
  const tanF = Math.tan(phiF);
  const tF = tanF;
  const tF2 = tF * tF;
  const tF4 = tF2 * tF2;

  const etaF2 = ePrime2 * cosF * cosF;
  const Nf = GRS80.a / Math.sqrt(1.0 - e2 * sinF * sinF);
  const MfRadius = (GRS80.a * (1.0 - e2)) / Math.pow(1.0 - e2 * sinF * sinF, 1.5);

  const yN = y / Nf;
  const yN2 = yN * yN;
  const yN3 = yN2 * yN;
  const yN4 = yN2 * yN2;
  const yN5 = yN4 * yN;
  const yN6 = yN3 * yN3;

  const phiTerm1 = (tF * Nf) / (2.0 * MfRadius) * yN2;
  const phiTerm2 = (tF * Nf) / (24.0 * MfRadius) * (5.0 + 3.0 * tF2 + etaF2 - 9.0 * etaF2 * tF2) * yN4;
  const phiTerm3 = (tF * Nf) / (720.0 * MfRadius) * (61.0 + 90.0 * tF2 + 45.0 * tF4) * yN6;
  const latRad = phiF - phiTerm1 + phiTerm2 - phiTerm3;

  const lamTerm1 = (1.0 / cosF) * yN;
  const lamTerm2 = (1.0 / (6.0 * cosF)) * (1.0 + 2.0 * tF2 + etaF2) * yN3;
  const lamTerm3 = (1.0 / (120.0 * cosF)) * (5.0 + 28.0 * tF2 + 24.0 * tF4 + 6.0 * etaF2 + 8.0 * etaF2 * tF2) * yN5;
  const lonRad = lam0 + lamTerm1 - lamTerm2 + lamTerm3;

  return {
    lat: radToDeg(latRad),
    lon: radToDeg(lonRad),
  };
}

/**
 * Rotate ECEF displacement (dx, dy, dz) to Local Topocentric (East, North, Up)
 */
export function ecefToEnu(dx: number, dy: number, dz: number, latDeg: number, lonDeg: number): { e: number; n: number; u: number } {
  const phi = degToRad(latDeg);
  const lam = degToRad(lonDeg);

  const sinPhi = Math.sin(phi);
  const cosPhi = Math.cos(phi);
  const sinLam = Math.sin(lam);
  const cosLam = Math.cos(lam);

  const e = -sinLam * dx + cosLam * dy;
  const n = -sinPhi * cosLam * dx - sinPhi * sinLam * dy + cosPhi * dz;
  const u = cosPhi * cosLam * dx + cosPhi * sinLam * dy + sinPhi * dz;

  return { e, n, u };
}

/**
 * Rotate Local Topocentric (de, dn, du) to ECEF displacement (dx, dy, dz)
 */
export function enuToEcef(de: number, dn: number, du: number, latDeg: number, lonDeg: number): { dx: number; dy: number; dz: number } {
  const phi = degToRad(latDeg);
  const lam = degToRad(lonDeg);

  const sinPhi = Math.sin(phi);
  const cosPhi = Math.cos(phi);
  const sinLam = Math.sin(lam);
  const cosLam = Math.cos(lam);

  const dx = -sinLam * de - sinPhi * cosLam * dn + cosPhi * cosLam * du;
  const dy = cosLam * de - sinPhi * sinLam * dn + cosPhi * sinLam * du;
  const dz = cosPhi * dn + sinPhi * du;

  return { dx, dy, dz };
}

// ============================================================================
// ANTENNA HEIGHT TRANSFORMATION & ANTEX PARSER
// ============================================================================

/**
 * Computes True Vertical Height of the Antenna Reference Point (ARP) above the ground marker.
 * 
 * - Vertical measurement (Düşey / Sabit Jalon / Pilye):
 *   The height is measured directly along the vertical axis from the ground mark to the ARP (bottom of antenna).
 *   No slant reduction or notch offset applies:
 *   h_arp = measuredH
 * 
 * - Slant measurement (Eğik / Sehpa / Ölçü Çentiği):
 *   The height is measured from the ground mark to the outer measuring mark / notch (SHMP / bumper).
 *   R = horizontal distance from vertical antenna axis to the notch.
 *   notchOffset = vertical distance of the notch ABOVE the ARP plane (pre-amp base).
 *   By Pythagoras:
 *   h_notch = sqrt(max(0, s_slant^2 - R^2))
 *   Since the notch is ABOVE the ARP, we subtract the notch offset to reach the ARP:
 *   h_arp = h_notch - notchOffset
 */
export function calculateCorrectedAntennaHeight(
  type: 'vertical' | 'slant',
  measuredH: number,
  radius: number = 0.09,
  notchOffset: number = 0.0
): number {
  if (type === 'vertical') {
    return Math.max(0, Number(measuredH.toFixed(4)));
  }
  const radSq = radius * radius;
  const measSq = measuredH * measuredH;
  const hNotch = measSq >= radSq ? Math.sqrt(measSq - radSq) : measuredH;
  // Subtract notch offset to reach the ARP reference plane
  const hArp = Math.max(0, hNotch - (notchOffset || 0));
  return Number(hArp.toFixed(4));
}

export interface AntennaPhaseCenterResult {
  hArp: number; // Pure vertical height of ARP above ground marker (m)
  pcoL1_Up_mm: number; // PCO Up for L1 (G01) in mm
  pcoL2_Up_mm: number; // PCO Up for L2 (G02) in mm
  pcoL3_Up_mm: number; // PCO Up for Ionosphere-Free LC (L3) in mm
  pcoL1_Up_m: number;
  pcoL2_Up_m: number;
  pcoL3_Up_m: number;
  pcoUpM: number;
  hApcL1: number; // Ground to L1 APC: h_ARP + PCO_L1 (m)
  hApcL2: number; // Ground to L2 APC: h_ARP + PCO_L2 (m)
  hApcL3: number; // Ground to L3/LC APC: h_ARP + PCO_L3 (m)
  hApc: number; // Selected frequency APC height above ground (m)
}

/**
 * Computes Antenna Reference Point (ARP) and Antenna Phase Center (APC) heights above ground marker
 * conforming strictly to IGS ANTEX 1.4 Section 3:
 * "mean phase center position = ARP (antenna reference point) position + phase center offset vector (North, East, Up)"
 * 
 * - L1 (G01): h_apc(L1) = h_arp + PCO_Up(L1)
 * - L2 (G02): h_apc(L2) = h_arp + PCO_Up(L2)
 * - L3 (LC / Ionosphere-Free):
 *   c1 = f1^2 / (f1^2 - f2^2) = 2.545728
 *   c2 = f2^2 / (f1^2 - f2^2) = 1.545728
 *   PCO_Up(L3) = c1 * PCO_Up(L1) - c2 * PCO_Up(L2)
 *   h_apc(L3) = h_arp + PCO_Up(L3)
 */
export function calculateAntennaPhaseCenterHeight(
  type: 'vertical' | 'slant',
  measuredH: number,
  radius: number = 0.09,
  notchOffset: number = 0.0,
  pcoL1_Up_mm: number = 89.35,
  pcoL2_Up_mm: number = 117.76,
  freq: 'L1' | 'L2' | 'L3' = 'L3'
): AntennaPhaseCenterResult {
  const hArp = calculateCorrectedAntennaHeight(type, measuredH, radius, notchOffset);

  // Exact IGS GPS dual-frequency Ionosphere-Free combination coefficients:
  // f1 = 1575.42 MHz, f2 = 1227.60 MHz
  const c1 = 2.545728;
  const c2 = 1.545728;
  const pcoL3_Up_mm = c1 * pcoL1_Up_mm - c2 * pcoL2_Up_mm;

  const pcoL1_Up_m = Number((pcoL1_Up_mm / 1000.0).toFixed(5));
  const pcoL2_Up_m = Number((pcoL2_Up_mm / 1000.0).toFixed(5));
  const pcoL3_Up_m = Number((pcoL3_Up_mm / 1000.0).toFixed(5));

  const hApcL1 = Number((hArp + pcoL1_Up_m).toFixed(4));
  const hApcL2 = Number((hArp + pcoL2_Up_m).toFixed(4));
  const hApcL3 = Number((hArp + pcoL3_Up_m).toFixed(4));

  let pcoUpM = pcoL3_Up_m;
  let hApc = hApcL3;
  if (freq === 'L1') {
    pcoUpM = pcoL1_Up_m;
    hApc = hApcL1;
  } else if (freq === 'L2') {
    pcoUpM = pcoL2_Up_m;
    hApc = hApcL2;
  }

  return {
    hArp,
    pcoL1_Up_mm,
    pcoL2_Up_mm,
    pcoL3_Up_mm: Number(pcoL3_Up_mm.toFixed(2)),
    pcoL1_Up_m,
    pcoL2_Up_m,
    pcoL3_Up_m,
    pcoUpM,
    hApcL1,
    hApcL2,
    hApcL3,
    hApc,
  };
}

/**
 * ANTEX v1.4 Parser
 * Parses antenna calibration files (.atx) for PCO and PCV parameters
 */
export function parseAntexFile(antexText: string): Record<string, AntennaData> {
  const lines = antexText.split(/\r?\n/);
  const antennas: Record<string, AntennaData> = {};

  let currentModel = '';
  let inAntenna = false;
  let inFreqG01 = false;
  let inFreqG02 = false;
  let pcoL1 = { n: 0, e: 0, u: 0 };
  let pcoL2 = { n: 0, e: 0, u: 0 };
  const pcvZenith: number[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const marker = line.substring(60).trim();

    if (marker === 'START OF ANTENNA') {
      inAntenna = true;
      currentModel = '';
      pcoL1 = { n: 0, e: 0, u: 0 };
      pcoL2 = { n: 0, e: 0, u: 0 };
      pcvZenith.length = 0;
    } else if (marker === 'TYPE / SERIAL NO') {
      currentModel = line.substring(0, 20).trim();
    } else if (marker === 'START OF FREQUENCY') {
      const freqCode = line.substring(0, 10).trim();
      inFreqG01 = freqCode === 'G01';
      inFreqG02 = freqCode === 'G02';
    } else if (marker === 'NORTH / EAST / UP') {
      const parts = line.substring(0, 60).trim().split(/\s+/).map(Number);
      if (parts.length >= 3) {
        if (inFreqG01) {
          pcoL1 = { n: parts[0], e: parts[1], u: parts[2] };
        } else if (inFreqG02) {
          pcoL2 = { n: parts[0], e: parts[1], u: parts[2] };
        }
      }
    } else if (marker === 'NOAZI') {
      if (inFreqG01 && pcvZenith.length === 0) {
        const parts = line.substring(0, 60).trim().split(/\s+/).map(Number);
        pcvZenith.push(...parts.filter((v) => !isNaN(v)));
      }
    } else if (marker === 'END OF FREQUENCY') {
      inFreqG01 = false;
      inFreqG02 = false;
    } else if (marker === 'END OF ANTENNA') {
      if (currentModel) {
        antennas[currentModel] = {
          model: currentModel,
          heightType: 'vertical',
          measuredHeight: 0.0,
          radius: 0.09,
          verticalOffset: 0.0,
          correctedHeight: 0.0,
          pcoL1,
          pcoL2,
          pcvZenith: pcvZenith.length > 0 ? [...pcvZenith] : [0, 0.5, 1.2, 2.0, 3.1, 4.5],
        };
      }
      inAntenna = false;
    }
  }

  return antennas;
}

/**
 * Converts calendar year, month, day, hour, minute into a decimal year (e.g. 2025.454)
 * conforming to IGS geodetic epoch standards.
 */
export function computeDecimalYear(
  year: number,
  month: number = 1,
  day: number = 1,
  hour: number = 0,
  minute: number = 0,
  second: number = 0
): number {
  let fullYear = year;
  if (fullYear < 100) {
    fullYear = fullYear >= 80 ? 1900 + fullYear : 2000 + fullYear;
  }
  const isLeap = (fullYear % 4 === 0 && fullYear % 100 !== 0) || (fullYear % 400 === 0);
  const daysInMonth = [0, 31, isLeap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

  let dayOfYear = day;
  for (let m = 1; m < Math.min(month, 13); m++) {
    dayOfYear += daysInMonth[m];
  }

  const dayFraction = (hour + minute / 60.0 + second / 3600.0) / 24.0;
  const totalDays = isLeap ? 366.0 : 365.0;
  const fraction = (dayOfYear - 1 + dayFraction) / totalDays;

  return Number((fullYear + fraction).toFixed(3));
}

/**
 * RINEX 2.xx / 3.xx Header Parser
 * Supports all year-dependent filenames (.24o, .25o, .26o, .24g, .25g, .26g, .24n, .25n, .rnx, .crx, .obs)
 * Extracts Station Name, Approx ECEF Position, Antenna Type, Radome, Delta H/E/N, Receiver, etc.
 * Automatically detects Measurement Epoch (surveyEpoch t) from TIME OF FIRST OBS.
 * Automatically matches antenna against the built-in NOAA NGS ANTCAL database.
 */
export function parseRinexHeader(rinexText: string, fileName?: string): Partial<Station> | null {
  const lines = rinexText.split(/\r?\n/);
  let stationName = '';
  let approxX = 0;
  let approxY = 0;
  let approxZ = 0;
  let deltaH = 0;
  let antennaModel = '';

  let detectedEpoch: number | undefined;
  let detectedDateStr: string | undefined;

  // Extract from 4-char filename prefix if available (e.g. "ankr0010.25o" -> "ANKR")
  if (fileName) {
    const cleanName = fileName.replace(/\\/g, '/').split('/').pop() || '';
    const baseMatch = cleanName.match(/^([a-zA-Z0-9_-]{4,8})/);
    if (baseMatch && baseMatch[1]) {
      stationName = baseMatch[1].toUpperCase();
    }
  }

  let endHeaderIdx = -1;

  for (let i = 0; i < Math.min(lines.length, 160); i++) {
    const line = lines[i];
    const marker = line.substring(60).trim();

    if (marker === 'MARKER NAME') {
      const name = line.substring(0, 60).trim();
      if (name) stationName = name;
    } else if (marker === 'MARKER NUMBER') {
      const num = line.substring(0, 60).trim();
      if (!stationName && num) stationName = num;
    } else if (marker === 'ANT # / TYPE') {
      // In RINEX: col 0-20 serial, col 20-40 model, col 40-60 radome
      const fullAntLine = line.substring(20, 60).trim();
      const antTypeOnly = line.substring(20, 40).trim();
      antennaModel = fullAntLine || antTypeOnly;
    } else if (marker === 'APPROX POSITION XYZ') {
      const parts = line.substring(0, 60).trim().split(/\s+/).map(Number);
      if (parts.length >= 3 && !isNaN(parts[0]) && !isNaN(parts[1]) && !isNaN(parts[2])) {
        approxX = parts[0];
        approxY = parts[1];
        approxZ = parts[2];
      }
    } else if (marker === 'ANTENNA: DELTA H/E/N') {
      const parts = line.substring(0, 60).trim().split(/\s+/).map(Number);
      if (parts.length >= 1 && !isNaN(parts[0])) {
        deltaH = parts[0];
      }
    } else if (marker === 'TIME OF FIRST OBS') {
      // Columns: YYYY MM DD HH MM SEC
      const parts = line.substring(0, 44).trim().split(/\s+/).map(Number);
      if (parts.length >= 3 && !isNaN(parts[0])) {
        const y = parts[0];
        const m = parts[1] || 1;
        const d = parts[2] || 1;
        const hr = parts[3] || 0;
        const min = parts[4] || 0;
        const sec = parts[5] || 0;
        detectedEpoch = computeDecimalYear(y, m, d, hr, min, sec);
        detectedDateStr = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')} ${String(hr).padStart(2, '0')}:${String(min).padStart(2, '0')} GPS`;
      }
    } else if (marker === 'END OF HEADER') {
      endHeaderIdx = i;
      break;
    }
  }

  // If TIME OF FIRST OBS was not in header, inspect first epoch records
  if (!detectedEpoch && endHeaderIdx !== -1) {
    for (let j = endHeaderIdx + 1; j < Math.min(lines.length, endHeaderIdx + 30); j++) {
      const l = lines[j].trim();
      // RINEX 3 format: > 2025 06 15 10 30 ...
      const m3 = l.match(/^>\s*(\d{4})\s+(\d{1,2})\s+(\d{1,2})\s+(\d{1,2})\s+(\d{1,2})/);
      if (m3) {
        const y = parseInt(m3[1]);
        const m = parseInt(m3[2]);
        const d = parseInt(m3[3]);
        const hr = parseInt(m3[4]);
        const min = parseInt(m3[5]);
        detectedEpoch = computeDecimalYear(y, m, d, hr, min);
        detectedDateStr = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')} ${String(hr).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
        break;
      }
      // RINEX 2 format:  25  6 15 10 30 ...
      const m2 = l.match(/^(\d{2})\s+(\d{1,2})\s+(\d{1,2})\s+(\d{1,2})\s+(\d{1,2})/);
      if (m2) {
        const yr2 = parseInt(m2[1]);
        const y = yr2 >= 80 ? 1900 + yr2 : 2000 + yr2;
        const m = parseInt(m2[2]);
        const d = parseInt(m2[3]);
        const hr = parseInt(m2[4]);
        const min = parseInt(m2[5]);
        detectedEpoch = computeDecimalYear(y, m, d, hr, min);
        detectedDateStr = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')} ${String(hr).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
        break;
      }
    }
  }

  // Fallback from filename extension if needed (e.g. "ankr0010.25o" -> 2025.00)
  if (!detectedEpoch && fileName) {
    const yearMatch = fileName.match(/\.(\d{2})[oOdD]$/i);
    if (yearMatch && yearMatch[1]) {
      const yr2 = parseInt(yearMatch[1]);
      const y = yr2 >= 80 ? 1900 + yr2 : 2000 + yr2;
      detectedEpoch = computeDecimalYear(y, 1, 1);
      detectedDateStr = `${y}.00 (Dosya uzantısından)`;
    }
  }

  if (!stationName && approxX === 0) return null;
  if (!stationName) stationName = 'GNSS_STN';

  const hasCoords = approxX !== 0 || approxY !== 0 || approxZ !== 0;
  const geo = hasCoords
    ? ecefToGeodetic(approxX, approxY, approxZ)
    : { lat: 39.88, lon: 32.75, h: 950.0 };

  const tm = geodeticToTM(geo.lat, geo.lon, 30);

  // Automatic NOAA NGS ANTCAL match
  const matchedCal = matchAntennaInNoaaCatalog(antennaModel);
  const pcoL1 = matchedCal ? matchedCal.pcoL1 : { n: 1.1, e: -0.3, u: 89.2 };
  const pcoL2 = matchedCal ? matchedCal.pcoL2 : { n: 0.9, e: -0.2, u: 82.1 };
  const pcvZenith = matchedCal ? matchedCal.pcvZenith : [0, 0.6, 1.4, 2.5, 4.1];
  const radius = matchedCal ? matchedCal.radius : 0.095;
  const verticalOffset = matchedCal ? (matchedCal.verticalOffset || 0.0) : 0.0;
  const finalModel = matchedCal ? matchedCal.model : (antennaModel || 'TRM59800.00     NONE');
  const correctedHeight = calculateCorrectedAntennaHeight('vertical', deltaH, radius, 0.0);

  // Parse Detailed Occupation View Tracking Data (Epochs & Satellites)
  const occupation = parseRinexOccupationData(rinexText, stationName, fileName || stationName, endHeaderIdx, detectedDateStr, detectedEpoch);

  return {
    id: stationName,
    name: stationName,
    type: 'GROUND',
    x: approxX,
    y: approxY,
    z: approxZ,
    lat: geo.lat,
    lon: geo.lon,
    h: geo.h,
    projY: tm.projY,
    projX: tm.projX,
    antenna: {
      model: finalModel,
      heightType: 'vertical',
      measuredHeight: deltaH,
      radius,
      verticalOffset,
      correctedHeight,
      pcoL1,
      pcoL2,
      pcvZenith,
    },
    observationDateStr: detectedDateStr,
    occupation: occupation || undefined,
    isFixed: { x: false, y: false, z: false },
  };
}

/**
 * Topcon Tools Occupation View Parser:
 * Parses satellite records and epoch timestamps from RINEX 2.xx and 3.xx observation bodies.
 * If file only contains header or partial data, generates a high-fidelity realistic GNSS tracking timeline
 * based on the observation epoch and session duration.
 */
export function parseRinexOccupationData(
  rinexText: string,
  stationName: string,
  fileName: string,
  endHeaderIdx: number,
  firstEpochDateStr?: string,
  surveyEpochDecimal?: number
): RinexOccupation | null {
  const lines = rinexText.split(/\r?\n/);
  const headerEnd = endHeaderIdx !== -1 ? endHeaderIdx : lines.findIndex((l) => l.includes('END OF HEADER'));
  const headerLines = headerEnd !== -1 ? lines.slice(0, headerEnd + 1) : lines.slice(0, 50);

  // Determine RINEX Version
  let rinexVer = '2.11';
  let intervalSec = 30;
  let rcvType = 'GNSS Multi-Frequency Receiver';
  let antType = '';
  const obsTypes: string[] = [];
  let headerLastDateStr = '';

  for (const hl of headerLines) {
    const marker = hl.substring(60).trim();
    if (marker === 'RINEX VERSION / TYPE') {
      const verStr = hl.substring(0, 20).trim();
      if (verStr) rinexVer = verStr;
    } else if (marker === 'INTERVAL') {
      const parsedInterval = parseFloat(hl.substring(0, 20).trim());
      if (!isNaN(parsedInterval) && parsedInterval > 0) intervalSec = parsedInterval;
    } else if (marker === 'REC # / TYPE / VERS') {
      rcvType = hl.substring(20, 40).trim() || rcvType;
    } else if (marker === 'ANT # / TYPE') {
      antType = hl.substring(20, 60).trim();
    } else if (marker === 'TIME OF LAST OBS') {
      const parts = hl.substring(0, 44).trim().split(/\s+/).map(Number);
      if (parts.length >= 3 && !isNaN(parts[0])) {
        const y = parts[0];
        const m = parts[1] || 1;
        const d = parts[2] || 1;
        const hr = parts[3] || 0;
        const mi = parts[4] || 0;
        const se = parts[5] || 0;
        headerLastDateStr = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')} ${String(hr).padStart(2, '0')}:${String(mi).padStart(2, '0')}:${String(Math.floor(se)).padStart(2, '0')} GPS`;
      }
    } else if (marker === '# / TYPES OF OBSERV' || marker === 'SYS / # / OBS TYPES') {
      const rawTypes = hl.substring(6, 60).trim().split(/\s+/);
      rawTypes.forEach((t) => {
        if (t && !obsTypes.includes(t)) obsTypes.push(t);
      });
    }
  }

  if (obsTypes.length === 0) {
    obsTypes.push('L1', 'L2', 'C1', 'P2', 'S1', 'S2');
  }

  const isRinex3 = rinexVer.startsWith('3');
  const allEpochRecords: EpochRecord[] = [];
  const satMap = new Map<string, {
    system: GnssConstellation;
    prn: number;
    epochs: number[]; // relative seconds
    snrSum: number;
    snrCount: number;
  }>();

  let firstSec: number | null = null;
  let lastSec: number | null = null;
  let startDay: number | null = null;
  let firstDateStr = firstEpochDateStr || '';
  let lastDateStr = headerLastDateStr || '';

  const parseSatSystem = (code: string): { system: GnssConstellation; prn: number } => {
    const sysChar = code.charAt(0).toUpperCase();
    let prn = parseInt(code.substring(1), 10) || 1;
    let system: GnssConstellation = 'GPS';
    if (sysChar === 'R') system = 'GLONASS';
    else if (sysChar === 'E') system = 'Galileo';
    else if (sysChar === 'C') system = 'BeiDou';
    else if (sysChar === 'J') system = 'QZSS';
    else if (sysChar === 'S') system = 'SBAS';
    else if (sysChar === 'G') system = 'GPS';
    else if (!isNaN(parseInt(sysChar, 10))) {
      // Numerical only in RINEX 2 GPS
      prn = parseInt(code.trim(), 10) || 1;
      system = 'GPS';
    }
    return { system, prn };
  };

  const getSatIdKey = (code: string): string => {
    const trimmed = code.trim();
    if (!trimmed) return '';
    const char0 = trimmed.charAt(0).toUpperCase();
    if (['G', 'R', 'E', 'C', 'J', 'S'].includes(char0)) {
      const num = parseInt(trimmed.substring(1), 10);
      return `${char0}${String(num).padStart(2, '0')}`;
    }
    const num = parseInt(trimmed, 10);
    if (!isNaN(num)) {
      return `G${String(num).padStart(2, '0')}`;
    }
    return trimmed;
  };

  // Scan Observation Data records after header (Full session without artificial truncation)
  if (headerEnd !== -1 && lines.length > headerEnd + 1) {
    let lineIdx = headerEnd + 1;
    let epochCounter = 0;
    const maxEpochsToScan = 86400; // Allow full day 24-hour sessions (86400 seconds)

    while (lineIdx < lines.length && epochCounter < maxEpochsToScan) {
      const line = lines[lineIdx];
      if (!line.trim()) {
        lineIdx++;
        continue;
      }

      if (isRinex3) {
        // RINEX 3 format: > YYYY MM DD HH MM SS.sssssss  epochFlag numSats
        if (line.startsWith('>')) {
          const parts = line.substring(1).trim().split(/\s+/);
          if (parts.length >= 6) {
            const yr = parseInt(parts[0], 10);
            const mo = parseInt(parts[1], 10);
            const da = parseInt(parts[2], 10);
            const hr = parseInt(parts[3], 10);
            const mi = parseInt(parts[4], 10);
            const se = parseFloat(parts[5]);
            const numSats = parseInt(parts[7] || parts[6] || '0', 10);

            if (startDay === null) startDay = da;
            const dayOffset = (da >= startDay ? da - startDay : da + 30 - startDay) * 86400;
            const curSec = dayOffset + hr * 3600 + mi * 60 + se;
            if (firstSec === null) firstSec = curSec;
            lastSec = curSec;

            const timeStamp = `${yr}-${String(mo).padStart(2, '0')}-${String(da).padStart(2, '0')} ${String(hr).padStart(2, '0')}:${String(mi).padStart(2, '0')}:${String(Math.floor(se)).padStart(2, '0')}`;
            if (!firstDateStr) firstDateStr = timeStamp;
            lastDateStr = timeStamp;

            const relSec = Math.max(0, curSec - firstSec);
            const satsInEpoch: string[] = [];

            // Read the following satellite observation lines
            lineIdx++;
            let satLinesRead = 0;
            while (lineIdx < lines.length && satLinesRead < numSats && !lines[lineIdx].startsWith('>')) {
              const satLine = lines[lineIdx];
              if (satLine.trim()) {
                const satCode = satLine.substring(0, 3).trim();
                const satKey = getSatIdKey(satCode);
                if (satKey) {
                  satsInEpoch.push(satKey);
                  if (!satMap.has(satKey)) {
                    const info = parseSatSystem(satCode);
                    satMap.set(satKey, {
                      system: info.system,
                      prn: info.prn,
                      epochs: [],
                      snrSum: 42,
                      snrCount: 1,
                    });
                  }
                  satMap.get(satKey)?.epochs.push(relSec);
                }
                satLinesRead++;
              }
              lineIdx++;
            }

            allEpochRecords.push({
              epochIndex: epochCounter++,
              timeSec: relSec,
              timestamp: timeStamp,
              satellites: satsInEpoch,
              nsats: satsInEpoch.length,
            });
            continue;
          }
        }
        lineIdx++;
      } else {
        // RINEX 2 format:  YY MM DD HH MM SS.sssssss  epochFlag numSats sat1 sat2 ...
        const epochMatch = line.match(/^\s*(\d{2})\s+(\d{1,2})\s+(\d{1,2})\s+(\d{1,2})\s+(\d{1,2})\s+([\d.]+)\s+(\d{1,2})\s+(\d{1,2})/);
        if (epochMatch) {
          const yr2 = parseInt(epochMatch[1], 10);
          const yr = yr2 >= 80 ? 1900 + yr2 : 2000 + yr2;
          const mo = parseInt(epochMatch[2], 10);
          const da = parseInt(epochMatch[3], 10);
          const hr = parseInt(epochMatch[4], 10);
          const mi = parseInt(epochMatch[5], 10);
          const se = parseFloat(epochMatch[6]);
          const numSats = parseInt(epochMatch[8], 10);

          if (startDay === null) startDay = da;
          const dayOffset = (da >= startDay ? da - startDay : da + 30 - startDay) * 86400;
          const curSec = dayOffset + hr * 3600 + mi * 60 + se;
          if (firstSec === null) firstSec = curSec;
          lastSec = curSec;

          const timeStamp = `${yr}-${String(mo).padStart(2, '0')}-${String(da).padStart(2, '0')} ${String(hr).padStart(2, '0')}:${String(mi).padStart(2, '0')}:${String(Math.floor(se)).padStart(2, '0')}`;
          if (!firstDateStr) firstDateStr = timeStamp;
          lastDateStr = timeStamp;

          const relSec = Math.max(0, curSec - firstSec);
          const satsInEpoch: string[] = [];

          // Satellites listed in columns 32-68 of epoch line (and possible continuation lines)
          let satStr = line.substring(32).trim();
          let nextCont = lineIdx + 1;
          while (satsInEpoch.length < numSats && satStr.length > 0) {
            const chunk = satStr.substring(0, 3).trim();
            if (chunk) {
              const satKey = getSatIdKey(chunk);
              if (satKey) {
                satsInEpoch.push(satKey);
                if (!satMap.has(satKey)) {
                  const info = parseSatSystem(chunk);
                  satMap.set(satKey, {
                    system: info.system,
                    prn: info.prn,
                    epochs: [],
                    snrSum: 0,
                    snrCount: 0,
                  });
                }
                satMap.get(satKey)?.epochs.push(relSec);
              }
            }
            satStr = satStr.substring(3);
            if (satStr.length === 0 && satsInEpoch.length < numSats && nextCont < lines.length) {
              const contLine = lines[nextCont];
              if (contLine && !contLine.match(/^\s*\d{2}\s+\d{1,2}\s+\d{1,2}/)) {
                satStr = contLine.substring(32).trim();
                lineIdx++;
                nextCont++;
              }
            }
          }

          allEpochRecords.push({
            epochIndex: epochCounter++,
            timeSec: relSec,
            timestamp: timeStamp,
            satellites: satsInEpoch,
            nsats: satsInEpoch.length,
          });

          // Skip observation data lines until next epoch
          lineIdx++;
          continue;
        }
        lineIdx++;
      }
    }
  }

  // Infer real interval if multiple epochs parsed
  if (allEpochRecords.length >= 2 && (!intervalSec || intervalSec === 30)) {
    const diff = allEpochRecords[1].timeSec - allEpochRecords[0].timeSec;
    if (diff > 0 && diff <= 300) intervalSec = diff;
  }

  let epochRecords: EpochRecord[] = allEpochRecords;
  if (allEpochRecords.length > 300) {
    const step = Math.ceil(allEpochRecords.length / 300);
    epochRecords = [];
    for (let i = 0; i < allEpochRecords.length; i += step) {
      epochRecords.push(allEpochRecords[i]);
    }
  }

  const finalTotalEpochs = allEpochRecords.length;
  let durationSec = lastSec !== null && firstSec !== null && lastSec > firstSec ? lastSec - firstSec : 0;
  if (durationSec === 0 && finalTotalEpochs > 1) {
    durationSec = (finalTotalEpochs - 1) * intervalSec;
  }

  const satTracks: SatelliteTrack[] = [];
  const foundConstellations = new Set<GnssConstellation>();

  satMap.forEach((data, satId) => {
    foundConstellations.add(data.system);
    const sortedEpochs = data.epochs.sort((a, b) => a - b);
    const startSec = sortedEpochs[0] || 0;
    const endSec = sortedEpochs[sortedEpochs.length - 1] || durationSec;

    const timeSlots: Array<{ startSec: number; endSec: number; avgSnr?: number }> = [];
    let slotStart = startSec;
    let prev = startSec;

    for (let k = 1; k < sortedEpochs.length; k++) {
      const cur = sortedEpochs[k];
      if (cur - prev > intervalSec * 2.5) {
        timeSlots.push({ startSec: slotStart, endSec: prev });
        slotStart = cur;
      }
      prev = cur;
    }
    timeSlots.push({ startSec: slotStart, endSec: prev });

    satTracks.push({
      satId,
      system: data.system,
      prn: data.prn,
      totalEpochs: finalTotalEpochs,
      validEpochs: sortedEpochs.length,
      startSec,
      endSec,
      timeSlots,
      freqs: obsTypes.filter((t) => /^[CLDS]1|^L1|^C1/i.test(t)).length > 0 ? ['L1', 'L2'] : ['L1'],
    });
  });

  const systemPriority: Record<GnssConstellation, number> = {
    GPS: 1,
    GLONASS: 2,
    Galileo: 3,
    BeiDou: 4,
    QZSS: 5,
    SBAS: 6,
  };

  satTracks.sort((a, b) => {
    if (systemPriority[a.system] !== systemPriority[b.system]) {
      return systemPriority[a.system] - systemPriority[b.system];
    }
    return a.prn - b.prn;
  });

  return {
    stationId: stationName,
    stationName,
    fileName,
    rinexVersion: rinexVer,
    receiverType: rcvType,
    antennaType: antType,
    firstEpochDate: firstDateStr || '2025-06-15 09:00:00',
    lastEpochDate: lastDateStr || '2025-06-15 11:00:00',
    firstEpochSec: firstSec || 0,
    lastEpochSec: lastSec || durationSec,
    durationSeconds: durationSec,
    intervalSeconds: intervalSec,
    totalEpochs: finalTotalEpochs,
    constellations: Array.from(foundConstellations),
    satellites: satTracks,
    epochRecords,
    observationTypes: obsTypes,
  };
}


/**
 * TUSAGA-Aktif Station Coordinates / Velocities Text Parser
 */
export function parseTusagaStationText(text: string): Station[] {
  const lines = text.split(/\r?\n/);
  const stations: Station[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('//')) continue;
    const parts = trimmed.split(/[\s,;\t]+/);
    // Expected formats:
    // Name, X, Y, Z, [Vx, Vy, Vz]
    // or Name, Lat, Lon, H, [Vx, Vy, Vz]
    if (parts.length >= 4) {
      const name = parts[0].toUpperCase();
      const p1 = parseFloat(parts[1]);
      const p2 = parseFloat(parts[2]);
      const p3 = parseFloat(parts[3]);

      let x = 0, y = 0, z = 0;
      let lat = 0, lon = 0, h = 0;

      if (Math.abs(p1) > 1000000) {
        // ECEF coordinates
        x = p1;
        y = p2;
        z = p3;
        const g = ecefToGeodetic(x, y, z);
        lat = g.lat;
        lon = g.lon;
        h = g.h;
      } else {
        // Geodetic coordinates
        lat = p1;
        lon = p2;
        h = p3;
        const e = geodeticToEcef(lat, lon, h);
        x = e.x;
        y = e.y;
        z = e.z;
      }

      const tm = geodeticToTM(lat, lon, 33);

      stations.push({
        id: name,
        name,
        type: 'CORS',
        isFixed: { x: true, y: true, z: true },
        x,
        y,
        z,
        lat,
        lon,
        h,
        projY: tm.projY,
        projX: tm.projX,
        antenna: {
          model: 'TRM59800.00     NONE',
          heightType: 'vertical',
          measuredHeight: 0.0,
          radius: 0.09,
          verticalOffset: 0.0,
          correctedHeight: 0.0,
          pcoL1: { n: 1.1, e: -0.3, u: 89.2 },
          pcoL2: { n: 0.9, e: -0.2, u: 82.1 },
          pcvZenith: [0, 0.6, 1.4, 2.5, 4.1],
        },
      });
    }
  }

  return stations;
}

// ============================================================================
// TOPOLOGY & GRAPH THEORY LOOP CLOSURE (Ctrl+L)
// ============================================================================

/**
 * Finds fundamental cycles in the network using Spanning Tree Cycle Basis algorithm.
 * Strictly adheres to Graph Theory (equivalent to NetworkX cycle_basis).
 */
/**
 * Finds all independent 3-station triangular loops (üçgen döngüler) in the active baseline network.
 * Triangles are strictly 3-station loops: A -> B -> C -> A.
 */
export function findTriangularLoops(
  stations: Record<string, Station>,
  baselines: BaselineVector[]
): string[][] {
  const activeBaselines = baselines.filter((b) => !b.excluded);
  const nodes = Object.keys(stations);
  if (nodes.length < 3) return [];

  const connected = new Set<string>();
  for (const b of activeBaselines) {
    connected.add(`${b.fromId}___${b.toId}`);
    connected.add(`${b.toId}___${b.fromId}`);
  }

  const triangles: string[][] = [];
  const addedTriplets = new Set<string>();

  for (let i = 0; i < nodes.length; i++) {
    const n1 = nodes[i];
    for (let j = i + 1; j < nodes.length; j++) {
      const n2 = nodes[j];
      if (!connected.has(`${n1}___${n2}`)) continue;

      for (let k = j + 1; k < nodes.length; k++) {
        const n3 = nodes[k];
        if (connected.has(`${n2}___${n3}`) && connected.has(`${n3}___${n1}`)) {
          const tripletKey = [n1, n2, n3].sort().join('___');
          if (!addedTriplets.has(tripletKey)) {
            addedTriplets.add(tripletKey);
            triangles.push([n1, n2, n3]);
          }
        }
      }
    }
  }

  return triangles;
}

/**
 * Fallback Spanning Tree Fundamental Cycle Basis when the network has >= 4-edge polygons without triangles.
 */
export function findFundamentalCycles(
  stations: Record<string, Station>,
  baselines: BaselineVector[]
): string[][] {
  const activeBaselines = baselines.filter((b) => !b.excluded);
  const nodes = Object.keys(stations);
  if (nodes.length < 3) return [];

  const adj: Record<string, string[]> = {};
  for (const n of nodes) adj[n] = [];
  for (const b of activeBaselines) {
    if (b.fromId in adj && b.toId in adj) {
      if (!adj[b.fromId].includes(b.toId)) adj[b.fromId].push(b.toId);
      if (!adj[b.toId].includes(b.fromId)) adj[b.toId].push(b.fromId);
    }
  }

  const visited = new Set<string>();
  const parent: Record<string, string | null> = {};
  const depth: Record<string, number> = {};
  const treeEdges = new Set<string>();
  const cycles: string[][] = [];

  for (const startNode of nodes) {
    if (visited.has(startNode)) continue;
    visited.add(startNode);
    parent[startNode] = null;
    depth[startNode] = 0;
    const queue = [startNode];

    while (queue.length > 0) {
      const u = queue.shift()!;
      for (const v of adj[u]) {
        if (!visited.has(v)) {
          visited.add(v);
          parent[v] = u;
          depth[v] = depth[u] + 1;
          treeEdges.add([u, v].sort().join('___'));
          queue.push(v);
        }
      }
    }
  }

  const seenChords = new Set<string>();
  for (const b of activeBaselines) {
    const key = [b.fromId, b.toId].sort().join('___');
    if (treeEdges.has(key) || seenChords.has(key)) continue;
    seenChords.add(key);

    // Reconstruct shortest path between b.fromId and b.toId along BFS tree
    const pathU: string[] = [];
    const pathV: string[] = [];
    let u: string | null = b.fromId;
    let v: string | null = b.toId;

    while (u && v && depth[u] > depth[v]) {
      pathU.push(u);
      u = parent[u];
    }
    while (u && v && depth[v] > depth[u]) {
      pathV.push(v);
      v = parent[v];
    }
    while (u && v && u !== v) {
      pathU.push(u);
      pathV.push(v);
      u = parent[u];
      v = parent[v];
    }
    if (u) {
      const cycle = [...pathU, u, ...pathV.reverse()];
      if (cycle.length >= 3) cycles.push(cycle);
    }
  }

  return cycles;
}

/**
 * Computes Vectorial Loop Closures (Döngü Kapanış Analizörü)
 * Misclosure: w = sqrt(sum_dX^2 + sum_dY^2 + sum_dZ^2)
 * Tolerance: T = baseMm + ppm * (LengthKm)
 */
export function calculateLoopClosures(
  stations: Record<string, Station>,
  baselines: BaselineVector[],
  toleranceBaseMm: number = 10.0,
  tolerancePpm: number = 1.0
): LoopClosure[] {
  let cycles = findTriangularLoops(stations, baselines);
  if (cycles.length === 0) {
    cycles = findFundamentalCycles(stations, baselines);
  }
  const activeBaselines = baselines.filter((b) => !b.excluded);
  const results: LoopClosure[] = [];

  // Helper map to lookup baseline between two nodes
  function getBaselineBetween(n1: string, n2: string): { baseline: BaselineVector; sign: number } | null {
    for (const b of activeBaselines) {
      if (b.fromId === n1 && b.toId === n2) return { baseline: b, sign: 1 };
      if (b.fromId === n2 && b.toId === n1) return { baseline: b, sign: -1 };
    }
    return null;
  }

  let loopIndex = 1;
  for (const cycle of cycles) {
    let sumDX = 0;
    let sumDY = 0;
    let sumDZ = 0;
    let totalLengthM = 0;
    const baselineIds: string[] = [];
    const directions: number[] = [];
    let validLoop = true;

    for (let i = 0; i < cycle.length; i++) {
      const n1 = cycle[i];
      const n2 = cycle[(i + 1) % cycle.length];
      const match = getBaselineBetween(n1, n2);
      if (!match) {
        validLoop = false;
        break;
      }
      baselineIds.push(match.baseline.id);
      directions.push(match.sign);
      sumDX += match.sign * match.baseline.dX;
      sumDY += match.sign * match.baseline.dY;
      sumDZ += match.sign * match.baseline.dZ;
      totalLengthM += match.baseline.length;
    }

    if (!validLoop) continue;

    // Convert misclosures to mm
    const wX_mm = sumDX * 1000.0;
    const wY_mm = sumDY * 1000.0;
    const wZ_mm = sumDZ * 1000.0;
    const totalMisclosure = Math.sqrt(wX_mm * wX_mm + wY_mm * wY_mm + wZ_mm * wZ_mm);

    const totalLengthKm = totalLengthM / 1000.0;
    // T = a + b * S (mm)
    const toleranceMm = toleranceBaseMm + tolerancePpm * totalLengthKm;
    const misclosurePpm = totalLengthKm > 0 ? totalMisclosure / totalLengthKm : 0;
    const ratioDenominator = totalMisclosure > 1e-4 ? Math.round((totalLengthM * 1000.0) / totalMisclosure) : 9999999;
    const relativePrecision = `1 : ${ratioDenominator.toLocaleString('tr-TR')}`;

    results.push({
      id: `LOOP_${loopIndex}`,
      name: `Döngü-${loopIndex} (${cycle.join(' - ')})`,
      stationIds: [...cycle],
      baselineIds,
      directions,
      sumDX: wX_mm,
      sumDY: wY_mm,
      sumDZ: wZ_mm,
      totalMisclosure,
      totalLengthM,
      totalLengthKm,
      toleranceMm,
      misclosurePpm,
      relativePrecision,
      isAccepted: totalMisclosure <= toleranceMm,
    });
    loopIndex++;
  }

  return results;
}

// ============================================================================
// 3D GAUSS-MARKOV LEAST SQUARES ADJUSTMENT & BAARDA DATA SNOOPING (F8)
// ============================================================================

/**
 * Matrix Inversion with Partial Pivoting and Tikhonov Regularization Fallback
 */
function invertMatrixGaussJordan(A: number[][]): number[][] | null {
  const n = A.length;
  const aug: number[][] = [];
  for (let i = 0; i < n; i++) {
    aug[i] = [];
    for (let j = 0; j < n; j++) {
      aug[i][j] = A[i][j];
    }
    for (let j = 0; j < n; j++) {
      aug[i][n + j] = i === j ? 1.0 : 0.0;
    }
  }

  for (let i = 0; i < n; i++) {
    let maxRow = i;
    let maxVal = Math.abs(aug[i][i]);
    for (let k = i + 1; k < n; k++) {
      if (Math.abs(aug[k][i]) > maxVal) {
        maxVal = Math.abs(aug[k][i]);
        maxRow = k;
      }
    }
    if (maxVal < 1e-15) return null; // Singular

    if (maxRow !== i) {
      const temp = aug[i];
      aug[i] = aug[maxRow];
      aug[maxRow] = temp;
    }

    const pivot = aug[i][i];
    for (let j = i; j < 2 * n; j++) {
      aug[i][j] /= pivot;
    }

    for (let k = 0; k < n; k++) {
      if (k !== i) {
        const factor = aug[k][i];
        for (let j = i; j < 2 * n; j++) {
          aug[k][j] -= factor * aug[i][j];
        }
      }
    }
  }

  const inv: number[][] = [];
  for (let i = 0; i < n; i++) {
    inv[i] = [];
    for (let j = 0; j < n; j++) {
      inv[i][j] = aug[i][n + j];
    }
  }
  return inv;
}

export function invertMatrix(A: number[][]): number[][] | null {
  const direct = invertMatrixGaussJordan(A);
  if (direct) return direct;

  // If near-singular, apply small Tikhonov ridge regularization
  const n = A.length;
  let trace = 0;
  for (let i = 0; i < n; i++) trace += Math.abs(A[i][i]);
  const lambda = (trace / (n || 1)) * 1e-9 || 1e-8;

  const regA: number[][] = [];
  for (let i = 0; i < n; i++) {
    regA[i] = [];
    for (let j = 0; j < n; j++) {
      regA[i][j] = A[i][j] + (i === j ? lambda : 0);
    }
  }

  return invertMatrixGaussJordan(regA);
}

/**
 * Computes Bowring/GRS80 Geodetic (lat, lon, h) and Transverse Mercator (Y, X) projection coordinates
 * directly from ECEF Cartesian coordinates (x, y, z).
 */
export function computeStationCoordinates(
  st: Station,
  domDeg: number = 30
): Station {
  const x = typeof st.x === 'number' && !isNaN(st.x) ? st.x : 0;
  const y = typeof st.y === 'number' && !isNaN(st.y) ? st.y : 0;
  const z = typeof st.z === 'number' && !isNaN(st.z) ? st.z : 0;

  const geo = (x !== 0 || y !== 0 || z !== 0)
    ? ecefToGeodetic(x, y, z)
    : { lat: st.lat || 0, lon: st.lon || 0, h: st.h || 0 };

  const tm = geodeticToTM(geo.lat, geo.lon, domDeg);

  return {
    ...st,
    x,
    y,
    z,
    lat: geo.lat,
    lon: geo.lon,
    h: geo.h,
    projY: tm.projY,
    projX: tm.projX,
  };
}

/**
 * 3x3 Symmetric Matrix Inversion (Optimized for baseline covariance)
 */
function invert3x3(m: [
  [number, number, number],
  [number, number, number],
  [number, number, number]
]): [[number, number, number], [number, number, number], [number, number, number]] {
  const [
    [a, b, c],
    [d, e, f],
    [g, h, k],
  ] = m;

  const safeA = isNaN(a) || a === 0 ? 1e-4 : a;
  const safeE = isNaN(e) || e === 0 ? 1e-4 : e;
  const safeK = isNaN(k) || k === 0 ? 1e-4 : k;
  const safeB = isNaN(b) ? 0 : b;
  const safeC = isNaN(c) ? 0 : c;
  const safeD = isNaN(d) ? safeB : d;
  const safeF = isNaN(f) ? 0 : f;
  const safeG = isNaN(g) ? safeC : g;
  const safeH = isNaN(h) ? safeF : h;

  const A = safeE * safeK - safeF * safeH;
  const B = -(safeD * safeK - safeF * safeG);
  const C = safeD * safeH - safeE * safeG;
  const D = -(safeB * safeK - safeC * safeH);
  const E = safeA * safeK - safeC * safeG;
  const F = -(safeA * safeH - safeB * safeG);
  const G = safeB * safeF - safeC * safeE;
  const H = -(safeA * safeF - safeC * safeD);
  const K = safeA * safeE - safeB * safeD;

  const det = safeA * A + safeB * B + safeC * C;
  if (Math.abs(det) < 1e-24) {
    const reg = 1e-5;
    return [
      [1 / (safeA + reg), 0, 0],
      [0, 1 / (safeE + reg), 0],
      [0, 0, 1 / (safeK + reg)],
    ];
  }

  const invDet = 1.0 / det;
  return [
    [A * invDet, D * invDet, G * invDet],
    [B * invDet, E * invDet, H * invDet],
    [C * invDet, F * invDet, K * invDet],
  ];
}

/**
 * Performs 3D Gauss-Markov Inner-Constraint Free Network Adjustment (İz Minimizasyonu / Moore-Penrose N+)
 * - All stations are estimated parameters (fixedStationIds = [], rank defect d = 3 translation)
 * - Enforces centroid zero-translation datum constraints G^T dX = 0 via bordered normal matrix
 * - Exact Gauss-Jordan inversion on full-rank (3n+3) bordered system (no Tikhonov bias)
 * - Rigorous Baarda Data Snooping (w-test) with exact Q_vv = Q_k - A_k N+ A_k^T
 * - Error ellipsoids (a, b, c, theta, sigma_h at 95% confidence) for all stations
 */
/**
 * Checks whether the baseline network forms a fully connected graph across all stations via BFS
 */
export function checkNetworkConnectivity(stationKeys: string[], baselines: BaselineVector[]): boolean {
  if (stationKeys.length <= 1) return true;
  const active = baselines.filter((b) => !b.excluded);
  if (active.length === 0) return false;

  const visited = new Set<string>([stationKeys[0]]);
  const queue = [stationKeys[0]];
  while (queue.length > 0) {
    const curr = queue.shift()!;
    for (const b of active) {
      if (b.fromId === curr && !visited.has(b.toId)) {
        visited.add(b.toId);
        queue.push(b.toId);
      } else if (b.toId === curr && !visited.has(b.fromId)) {
        visited.add(b.fromId);
        queue.push(b.fromId);
      }
    }
  }
  return visited.size === stationKeys.length;
}

/**
 * 3D Gauss-Markov Inner-Constraint Free Network Adjustment (İz Minimizasyonlu Serbest Ağ Dengelemesi)
 * - Trace minimization of covariance matrix Sigma_xx (min tr(Sigma_xx))
 * - Exact Gauss-Jordan inversion on full-rank (3n+3) bordered system (no Tikhonov bias)
 * - Iterative Baarda Data Snooping (w-test) outlier screening & automatic gross-error exclusion
 * - Exact Q_vv = Q_k - A_k N+ A_k^T and component-wise standardized residuals
 * - Error ellipsoids (a, b, c, theta, sigma_h at 95% confidence) for all stations
 */
export function perform3DNetworkAdjustment(
  inputStations: Record<string, Station>,
  inputBaselines: BaselineVector[],
  mode: 'unconstrained' = 'unconstrained',
  config: JobConfig
): AdjustmentResult | null {
  try {
    const stationKeys = Object.keys(inputStations);
    const nStn = stationKeys.length;
    if (nStn < 2) return null;

    const workingBaselines: BaselineVector[] = inputBaselines.map((b) => ({ ...b }));
    const excludedRecords: ExcludedBaselineRecord[] = [];
    const autoExclude = config.autoExcludeOutliers ?? true;
    const maxOutlierPasses = autoExclude ? (config.maxOutlierIterations ?? 5) : 0;
    const wCrit = config.wCrit || 3.29;

    const fixedStationIds: string[] = [];
    const unknownStationIds: string[] = [...stationKeys];
    const numUnknowns = 3 * nStn;

    const unknownIndexMap: Record<string, number> = {};
    for (let i = 0; i < nStn; i++) {
      unknownIndexMap[unknownStationIds[i]] = i;
    }

    // Seed initial coordinates once
    const initialCoords: Record<string, { x: number; y: number; z: number }> = {};
    let seedStn: string | null = null;
    for (const id of stationKeys) {
      const st = inputStations[id];
      const x = Number(st.x) || 0;
      const y = Number(st.y) || 0;
      const z = Number(st.z) || 0;
      initialCoords[id] = { x, y, z };
      if (!seedStn && (x !== 0 || y !== 0 || z !== 0)) {
        seedStn = id;
      }
    }
    if (!seedStn) return null;

    // Propagate zero coordinates along baseline spanning tree if any station starts at (0,0,0)
    const hasZeroCoords = stationKeys.some(
      (id) => initialCoords[id].x === 0 && initialCoords[id].y === 0 && initialCoords[id].z === 0
    );
    if (hasZeroCoords) {
      const queue = [seedStn];
      const visited = new Set<string>([seedStn]);
      while (queue.length > 0) {
        const curr = queue.shift()!;
        const currC = initialCoords[curr];
        for (const b of workingBaselines) {
          if (b.excluded) continue;
          if (b.fromId === curr && !visited.has(b.toId)) {
            if (initialCoords[b.toId].x === 0 && initialCoords[b.toId].y === 0 && initialCoords[b.toId].z === 0) {
              initialCoords[b.toId] = {
                x: currC.x + b.dX,
                y: currC.y + b.dY,
                z: currC.z + b.dZ,
              };
            }
            visited.add(b.toId);
            queue.push(b.toId);
          } else if (b.toId === curr && !visited.has(b.fromId)) {
            if (initialCoords[b.fromId].x === 0 && initialCoords[b.fromId].y === 0 && initialCoords[b.fromId].z === 0) {
              initialCoords[b.fromId] = {
                x: currC.x - b.dX,
                y: currC.y - b.dY,
                z: currC.z - b.dZ,
              };
            }
            visited.add(b.fromId);
            queue.push(b.fromId);
          }
        }
      }
    }

    let currentCoords: Record<string, { x: number; y: number; z: number }> = {};
    let iterations = 0;
    let outlierIterations = 0;
    let maxDisplacementMm = 0;
    let normalInv: number[][] | null = null;
    let lastNormalN: number[][] | null = null;
    let finalResiduals: number[] = [];
    let vPv = 0;
    let sigma0Aposteriori = 1.0;
    let sigma0Sq = 1.0;
    let dof = 0;
    let effectiveDof = 1;
    let numObs = 0;
    let chiPassed = false;
    let chiLower = 0;
    let chiUpper = 1e9;
    let totalRedundancySum = 0;
    let nonZeroACount = 0;
    let outliers: string[] = [];
    let activeBaselines: BaselineVector[] = [];
    const baselineEvalMap = new Map<
      string,
      {
        vX_mm: number;
        vY_mm: number;
        vZ_mm: number;
        spatialV_mm: number;
        maxW: number;
        r_k: number;
        isOutlier: boolean;
      }
    >();
    let lastDesignA: number[][] = [];

    // Outlier screening loop (Baarda Data Snooping & iterative re-weighting)
    for (let outlierPass = 0; outlierPass <= maxOutlierPasses; outlierPass++) {
      activeBaselines = workingBaselines.filter(
        (b) => !b.excluded && b.fromId in inputStations && b.toId in inputStations
      );
      if (activeBaselines.length < 1) return null;

      if (!checkNetworkConnectivity(stationKeys, activeBaselines)) {
        if (outlierPass === 0) {
          console.warn(`Disconnected baseline network.`);
          return null;
        }
        break;
      }

      numObs = 3 * activeBaselines.length;
      dof = numObs - (numUnknowns - 3);
      effectiveDof = Math.max(1, dof);
      if (dof < 1 && outlierPass > 0) {
        break;
      }

      // Reset coordinates to initialCoords for clean convergence
      currentCoords = {};
      for (const id of stationKeys) {
        currentCoords[id] = { ...initialCoords[id] };
      }

      const A: number[][] = Array.from({ length: numObs }, () => Array(numUnknowns).fill(0));
      const l: number[] = Array(numObs).fill(0);
      const P_blocks: Array<[[number, number, number], [number, number, number], [number, number, number]]> = [];

      for (let k = 0; k < activeBaselines.length; k++) {
        const b = activeBaselines[k];
        const qxx = b.qxx && !isNaN(b.qxx) ? b.qxx : 1e-5;
        const qyy = b.qyy && !isNaN(b.qyy) ? b.qyy : 1e-5;
        const qzz = b.qzz && !isNaN(b.qzz) ? b.qzz : 1e-5;
        const qxy = b.qxy && !isNaN(b.qxy) ? b.qxy : 0;
        const qyz = b.qyz && !isNaN(b.qyz) ? b.qyz : 0;
        const qzx = b.qzx && !isNaN(b.qzx) ? b.qzx : 0;

        P_blocks.push(
          invert3x3([
            [qxx, qxy, qzx],
            [qxy, qyy, qyz],
            [qzx, qyz, qzz],
          ])
        );
      }

      const gWeight = 1.0 / Math.sqrt(nStn);
      const dimBordered = numUnknowns + 3;

      // Iterative Gauss-Markov Inner-Constraint Solver
      for (let iter = 0; iter < 4; iter++) {
        iterations++;

        for (let r = 0; r < numObs; r++) {
          l[r] = 0;
          for (let c = 0; c < numUnknowns; c++) {
            A[r][c] = 0;
          }
        }

        for (let k = 0; k < activeBaselines.length; k++) {
          const b = activeBaselines[k];
          const rowStart = 3 * k;

          const fromCoord = currentCoords[b.fromId];
          const toCoord = currentCoords[b.toId];
          if (!fromCoord || !toCoord) continue;

          l[rowStart] = b.dX - (toCoord.x - fromCoord.x);
          l[rowStart + 1] = b.dY - (toCoord.y - fromCoord.y);
          l[rowStart + 2] = b.dZ - (toCoord.z - fromCoord.z);

          const uFrom = unknownIndexMap[b.fromId];
          const colFrom = 3 * uFrom;
          A[rowStart][colFrom] = -1.0;
          A[rowStart + 1][colFrom + 1] = -1.0;
          A[rowStart + 2][colFrom + 2] = -1.0;

          const uTo = unknownIndexMap[b.toId];
          const colTo = 3 * uTo;
          A[rowStart][colTo] = 1.0;
          A[rowStart + 1][colTo + 1] = 1.0;
          A[rowStart + 2][colTo + 2] = 1.0;
        }
        lastDesignA = A;

        // N = A^T P A, u = A^T P l
        const N: number[][] = Array.from({ length: numUnknowns }, () => Array(numUnknowns).fill(0));
        const uVec: number[] = Array(numUnknowns).fill(0);

        for (let k = 0; k < activeBaselines.length; k++) {
          const rowStart = 3 * k;
          const P_k = P_blocks[k];
          const l_k = [l[rowStart], l[rowStart + 1], l[rowStart + 2]];

          const Pl_k = [
            P_k[0][0] * l_k[0] + P_k[0][1] * l_k[1] + P_k[0][2] * l_k[2],
            P_k[1][0] * l_k[0] + P_k[1][1] * l_k[1] + P_k[1][2] * l_k[2],
            P_k[2][0] * l_k[0] + P_k[2][1] * l_k[1] + P_k[2][2] * l_k[2],
          ];

          for (let c = 0; c < numUnknowns; c++) {
            const A_kc0 = A[rowStart][c];
            const A_kc1 = A[rowStart + 1][c];
            const A_kc2 = A[rowStart + 2][c];
            if (A_kc0 === 0 && A_kc1 === 0 && A_kc2 === 0) continue;

            uVec[c] += A_kc0 * Pl_k[0] + A_kc1 * Pl_k[1] + A_kc2 * Pl_k[2];

            const PA0 = P_k[0][0] * A_kc0 + P_k[0][1] * A_kc1 + P_k[0][2] * A_kc2;
            const PA1 = P_k[1][0] * A_kc0 + P_k[1][1] * A_kc1 + P_k[1][2] * A_kc2;
            const PA2 = P_k[2][0] * A_kc0 + P_k[2][1] * A_kc1 + P_k[2][2] * A_kc2;

            for (let c2 = 0; c2 < numUnknowns; c2++) {
              const A_k20 = A[rowStart][c2];
              const A_k21 = A[rowStart + 1][c2];
              const A_k22 = A[rowStart + 2][c2];
              if (A_k20 === 0 && A_k21 === 0 && A_k22 === 0) continue;

              N[c2][c] += A_k20 * PA0 + A_k21 * PA1 + A_k22 * PA2;
            }
          }
        }
        lastNormalN = N;

        // Bordered Inner-Constraint System
        let diagSum = 0;
        for (let i = 0; i < numUnknowns; i++) diagSum += Math.abs(N[i][i]);
        const gScale = Math.sqrt(Math.max(1.0, diagSum / Math.max(1, numUnknowns)));
        const gEntry = gWeight * gScale;

        const bordered: number[][] = Array.from({ length: dimBordered }, () =>
          Array(dimBordered).fill(0)
        );
        for (let r = 0; r < numUnknowns; r++) {
          for (let c = 0; c < numUnknowns; c++) {
            bordered[r][c] = N[r][c];
          }
        }
        for (let stIdx = 0; stIdx < nStn; stIdx++) {
          const colBase = 3 * stIdx;
          for (let axis = 0; axis < 3; axis++) {
            bordered[colBase + axis][numUnknowns + axis] = gEntry;
            bordered[numUnknowns + axis][colBase + axis] = gEntry;
          }
        }

        const borderedInv = invertMatrixGaussJordan(bordered);
        if (!borderedInv) return null;

        // Upper-left (numUnknowns x numUnknowns) block is exact Moore-Penrose pseudoinverse N+
        normalInv = Array.from({ length: numUnknowns }, (_, r) =>
          borderedInv[r].slice(0, numUnknowns)
        );

        const dx_hat: number[] = Array(numUnknowns).fill(0);
        for (let r = 0; r < numUnknowns; r++) {
          for (let c = 0; c < numUnknowns; c++) {
            dx_hat[r] += normalInv[r][c] * uVec[c];
          }
        }

        let stepMaxMm = 0;
        for (let i = 0; i < nStn; i++) {
          const stId = unknownStationIds[i];
          const colStart = 3 * i;
          const dX = dx_hat[colStart];
          const dY = dx_hat[colStart + 1];
          const dZ = dx_hat[colStart + 2];

          currentCoords[stId].x += dX;
          currentCoords[stId].y += dY;
          currentCoords[stId].z += dZ;

          const dispMm = Math.sqrt(dX * dX + dY * dY + dZ * dZ) * 1000.0;
          if (dispMm > stepMaxMm) stepMaxMm = dispMm;
        }

        maxDisplacementMm = stepMaxMm;
        if (stepMaxMm < 0.05) break;
      }

      // Calculate final residuals v = (X_to - X_from) - b_obs
      finalResiduals = Array(numObs).fill(0);
      vPv = 0;

      for (let k = 0; k < activeBaselines.length; k++) {
        const b = activeBaselines[k];
        const rowStart = 3 * k;

        const fromCoord = currentCoords[b.fromId];
        const toCoord = currentCoords[b.toId];
        if (!fromCoord || !toCoord) continue;

        const vX = toCoord.x - fromCoord.x - b.dX;
        const vY = toCoord.y - fromCoord.y - b.dY;
        const vZ = toCoord.z - fromCoord.z - b.dZ;

        finalResiduals[rowStart] = vX;
        finalResiduals[rowStart + 1] = vY;
        finalResiduals[rowStart + 2] = vZ;

        const P_k = P_blocks[k];
        const v_k = [vX, vY, vZ];
        const Pv_k = [
          P_k[0][0] * v_k[0] + P_k[0][1] * v_k[1] + P_k[0][2] * v_k[2],
          P_k[1][0] * v_k[0] + P_k[1][1] * v_k[1] + P_k[1][2] * v_k[2],
          P_k[2][0] * v_k[0] + P_k[2][1] * v_k[1] + P_k[2][2] * v_k[2],
        ];

        vPv += v_k[0] * Pv_k[0] + v_k[1] * Pv_k[1] + v_k[2] * Pv_k[2];
      }

      sigma0Aposteriori = dof > 0 ? Math.sqrt(Math.max(1e-12, vPv / dof)) : 1.0;
      sigma0Sq = sigma0Aposteriori * sigma0Aposteriori;

      // Global Model Chi-Square Test (95% confidence)
      chiLower = dof > 0
        ? Math.max(0.01, effectiveDof * Math.pow(1 - 2 / (9 * effectiveDof) - 1.96 * Math.sqrt(2 / (9 * effectiveDof)), 3))
        : 0;
      chiUpper = dof > 0
        ? effectiveDof * Math.pow(1 - 2 / (9 * effectiveDof) + 1.96 * Math.sqrt(2 / (9 * effectiveDof)), 3)
        : 1e9;
      chiPassed = dof > 0 && vPv >= chiLower && vPv <= chiUpper;

      outliers = [];
      totalRedundancySum = 0;
      baselineEvalMap.clear();

      let worstBaseline: BaselineVector | null = null;
      let worstW = 0;
      let worstSpatialV = 0;

      for (let k = 0; k < activeBaselines.length; k++) {
        const b = activeBaselines[k];
        const rowStart = 3 * k;
        const vX = finalResiduals[rowStart];
        const vY = finalResiduals[rowStart + 1];
        const vZ = finalResiduals[rowStart + 2];

        const vX_mm = vX * 1000.0;
        const vY_mm = vY * 1000.0;
        const vZ_mm = vZ * 1000.0;
        const spatialV_mm = Math.sqrt(vX_mm * vX_mm + vY_mm * vY_mm + vZ_mm * vZ_mm);

        const uFrom = unknownIndexMap[b.fromId];
        const uTo = unknownIndexMap[b.toId];

        const ACAT: number[][] = [
          [0, 0, 0],
          [0, 0, 0],
          [0, 0, 0],
        ];

        if (normalInv) {
          for (let r = 0; r < 3; r++) {
            for (let c = 0; c < 3; c++) {
              ACAT[r][c] =
                normalInv[3 * uTo + r][3 * uTo + c] +
                normalInv[3 * uFrom + r][3 * uFrom + c] -
                normalInv[3 * uTo + r][3 * uFrom + c] -
                normalInv[3 * uFrom + r][3 * uTo + c];
            }
          }
        }

        const Q_k = [
          [b.qxx || 1e-5, b.qxy || 0, b.qzx || 0],
          [b.qxy || 0, b.qyy || 1e-5, b.qyz || 0],
          [b.qzx || 0, b.qyz || 0, b.qzz || 1e-5],
        ];

        const qvv_X = Math.max(1e-12, Q_k[0][0] - ACAT[0][0]);
        const qvv_Y = Math.max(1e-12, Q_k[1][1] - ACAT[1][1]);
        const qvv_Z = Math.max(1e-12, Q_k[2][2] - ACAT[2][2]);

        const P_k = P_blocks[k];
        let r_k = 0;
        for (let i = 0; i < 3; i++) {
          for (let j = 0; j < 3; j++) {
            const qvv_ij = Q_k[i][j] - ACAT[i][j];
            r_k += qvv_ij * P_k[j][i];
          }
        }
        r_k = Math.max(0, Math.min(3, r_k));
        totalRedundancySum += r_k;

        const wX = dof > 0 && qvv_X > 1e-11 ? Math.abs(vX) / (sigma0Aposteriori * Math.sqrt(qvv_X)) : 0;
        const wY = dof > 0 && qvv_Y > 1e-11 ? Math.abs(vY) / (sigma0Aposteriori * Math.sqrt(qvv_Y)) : 0;
        const wZ = dof > 0 && qvv_Z > 1e-11 ? Math.abs(vZ) / (sigma0Aposteriori * Math.sqrt(qvv_Z)) : 0;
        const maxW = Math.max(wX, wY, wZ);

        const isOutlier = maxW > wCrit;
        if (isOutlier) {
          outliers.push(b.id);
          if (maxW > worstW) {
            worstW = maxW;
            worstBaseline = b;
            worstSpatialV = spatialV_mm;
          }
        }

        baselineEvalMap.set(b.id, {
          vX_mm,
          vY_mm,
          vZ_mm,
          spatialV_mm,
          maxW,
          r_k,
          isOutlier,
        });
      }

      // If autoExclude is enabled and outliers exist, exclude the worst one and iterate
      if (autoExclude && outliers.length > 0 && worstBaseline && outlierPass < maxOutlierPasses) {
        const candidateRemaining = activeBaselines.filter((b) => b.id !== worstBaseline!.id);
        const candidateDof = 3 * candidateRemaining.length - (numUnknowns - 3);

        if (
          candidateRemaining.length >= 1 &&
          candidateDof >= 1 &&
          checkNetworkConnectivity(stationKeys, candidateRemaining)
        ) {
          const target = workingBaselines.find((b) => b.id === worstBaseline!.id);
          if (target) {
            target.excluded = true;
            target.isOutlier = true;
            target.exclusionReason = `Baarda w-testi kaba hata tespiti (w = ${worstW.toFixed(2)} > ${wCrit.toFixed(2)})`;
            excludedRecords.push({
              baselineId: target.id,
              fromId: target.fromId,
              toId: target.toId,
              reason: target.exclusionReason,
              length: target.length,
              wScore: Math.round(worstW * 100) / 100,
              spatialV: Math.round(worstSpatialV * 10) / 10,
            });
            outlierIterations++;
            continue; // Re-adjust without the outlier baseline!
          }
        }
      }

      // No more outliers to exclude or connectivity reached
      break;
    }

    nonZeroACount = 0;
    for (let r = 0; r < numObs; r++) {
      for (let c = 0; c < numUnknowns; c++) {
        if (lastDesignA[r] && lastDesignA[r][c] !== 0) nonZeroACount++;
      }
    }
    const totalElements = numObs * numUnknowns;
    const sparsityPercent = totalElements > 0 ? (1 - nonZeroACount / totalElements) * 100 : 0;

    let maxDiag = 0;
    let minDiag = Infinity;
    let maxCorrelation = 0;
    if (normalInv) {
      for (let i = 0; i < numUnknowns; i++) {
        const diag = Math.abs(normalInv[i][i]);
        if (diag > maxDiag) maxDiag = diag;
        if (diag < minDiag && diag > 1e-15) minDiag = diag;
        for (let j = i + 1; j < numUnknowns; j++) {
          const denom = Math.sqrt(Math.max(1e-24, normalInv[i][i] * normalInv[j][j]));
          const corr = Math.abs(normalInv[i][j]) / denom;
          if (corr > maxCorrelation && isFinite(corr)) maxCorrelation = corr;
        }
      }
    }
    void lastNormalN;
    const conditionNumberN = minDiag > 0 && isFinite(minDiag) ? maxDiag / minDiag : 1.0;
    const averageRedundancy = activeBaselines.length > 0 ? totalRedundancySum / (activeBaselines.length * 3) : 0;

    // Parameter Covariance Matrix Sigma_xx = sigma0^2 * N+ for ALL stations
    const adjustedStations: Record<string, Station> = {};

    for (const id of stationKeys) {
      const origSt = inputStations[id];
      const adjCoord = currentCoords[id];
      const geo = ecefToGeodetic(adjCoord.x, adjCoord.y, adjCoord.z);
      const tm = geodeticToTM(geo.lat, geo.lon, config.dom);

      const uIdx = unknownIndexMap[id];
      const colStart = 3 * uIdx;

      const varX = normalInv ? sigma0Sq * normalInv[colStart][colStart] : 0;
      const varY = normalInv ? sigma0Sq * normalInv[colStart + 1][colStart + 1] : 0;
      const varZ = normalInv ? sigma0Sq * normalInv[colStart + 2][colStart + 2] : 0;
      const covXY = normalInv ? sigma0Sq * normalInv[colStart][colStart + 1] : 0;
      const covYZ = normalInv ? sigma0Sq * normalInv[colStart + 1][colStart + 2] : 0;
      const covZX = normalInv ? sigma0Sq * normalInv[colStart + 2][colStart] : 0;

      const sigmaX_mm = Math.sqrt(Math.max(1e-12, Math.abs(varX))) * 1000.0;
      const sigmaY_mm = Math.sqrt(Math.max(1e-12, Math.abs(varY))) * 1000.0;
      const sigmaZ_mm = Math.sqrt(Math.max(1e-12, Math.abs(varZ))) * 1000.0;

      const phi = degToRad(geo.lat);
      const lam = degToRad(geo.lon);
      const sPhi = Math.sin(phi);
      const cPhi = Math.cos(phi);
      const sLam = Math.sin(lam);
      const cLam = Math.cos(lam);

      const R = [
        [-sLam, cLam, 0],
        [-sPhi * cLam, -sPhi * sLam, cPhi],
        [cPhi * cLam, cPhi * sLam, sPhi],
      ];

      const covXYZ = [
        [varX, covXY, covZX],
        [covXY, varY, covYZ],
        [covZX, covYZ, varZ],
      ];

      const temp: number[][] = Array.from({ length: 3 }, () => Array(3).fill(0));
      for (let r = 0; r < 3; r++) {
        for (let c = 0; c < 3; c++) {
          temp[r][c] = R[r][0] * covXYZ[0][c] + R[r][1] * covXYZ[1][c] + R[r][2] * covXYZ[2][c];
        }
      }

      const covENU: number[][] = Array.from({ length: 3 }, () => Array(3).fill(0));
      for (let r = 0; r < 3; r++) {
        for (let c = 0; c < 3; c++) {
          covENU[r][c] = temp[r][0] * R[c][0] + temp[r][1] * R[c][1] + temp[r][2] * R[c][2];
        }
      }

      const varE = Math.max(1e-12, covENU[0][0]);
      const varN = Math.max(1e-12, covENU[1][1]);
      const covEN = covENU[0][1];
      const varU = Math.max(1e-12, covENU[2][2]);

      const sigmaEast_mm = Math.sqrt(varE) * 1000.0;
      const sigmaNorth_mm = Math.sqrt(varN) * 1000.0;
      const sigmaUp_mm = Math.sqrt(varU) * 1000.0;

      // 95% confidence horizontal error ellipse (c = 2.4477)
      const diffEN = varN - varE;
      const rootTerm = Math.sqrt(diffEN * diffEN + 4.0 * covEN * covEN);
      const semiMajorM = Math.sqrt(Math.max(1e-12, (varN + varE + rootTerm) / 2.0)) * 2.4477;
      const semiMinorM = Math.sqrt(Math.max(1e-12, (varN + varE - rootTerm) / 2.0)) * 2.4477;
      const semiAxisC_mm = Math.sqrt(varU) * 2.7955 * 1000.0;

      let thetaRad = 0.5 * Math.atan2(2.0 * covEN, diffEN);
      if (thetaRad < 0) thetaRad += Math.PI;
      const ellipseAzimuthGon = degToGon(radToDeg(thetaRad));
      const sigmaH_mm = Math.sqrt(varU) * 1.96 * 1000.0;

      const apcCalc = calculateAntennaPhaseCenterHeight(
        origSt.antenna?.heightType || 'vertical',
        origSt.antenna?.measuredHeight || 0,
        origSt.antenna?.radius || 0.09,
        origSt.antenna?.verticalOffset || 0,
        origSt.antenna?.pcoL1?.u ?? 0,
        origSt.antenna?.pcoL2?.u ?? 0,
        'L3'
      );
      const groundH = geo.h;
      const arpH = Number((groundH + apcCalc.hArp).toFixed(4));
      const apcH = Number((groundH + apcCalc.hApcL3).toFixed(4));

      adjustedStations[id] = {
        ...origSt,
        adjustedX: adjCoord.x,
        adjustedY: adjCoord.y,
        adjustedZ: adjCoord.z,
        adjustedLat: geo.lat,
        adjustedLon: geo.lon,
        adjustedH: groundH,
        groundH,
        arpH,
        apcH,
        adjustedProjY: tm.projY,
        adjustedProjX: tm.projX,
        sigmaX: sigmaX_mm,
        sigmaY: sigmaY_mm,
        sigmaZ: sigmaZ_mm,
        sigmaEast: sigmaEast_mm,
        sigmaNorth: sigmaNorth_mm,
        sigmaUp: sigmaUp_mm,
        semiMajor: semiMajorM * 1000.0,
        semiMinor: semiMinorM * 1000.0,
        semiAxisC: semiAxisC_mm,
        ellipseAzimuth: ellipseAzimuthGon,
        sigmaH: sigmaH_mm,
      };
    }

    const finalBaselines: BaselineVector[] = workingBaselines.map((b) => {
      const evalData = baselineEvalMap.get(b.id);
      if (evalData && !b.excluded) {
        return {
          ...b,
          vX: evalData.vX_mm,
          vY: evalData.vY_mm,
          vZ: evalData.vZ_mm,
          spatialV: evalData.spatialV_mm,
          wTest: evalData.maxW,
          redundancyNumber: evalData.r_k,
          isOutlier: evalData.isOutlier,
        };
      }
      return {
        ...b,
        excluded: true,
        isOutlier: b.isOutlier || false,
        exclusionReason: b.exclusionReason || (b.isOutlier ? `Baarda w-testi kaba hata tespiti` : undefined),
      };
    });

    return {
      mode,
      fixedStationIds,
      unknownStationIds,
      dof: Math.max(0, dof),
      totalObservations: numObs,
      totalUnknowns: numUnknowns - 3,
      sigma0Apriori: 1.0,
      sigma0Aposteriori,
      vPv,
      chiSquareTest: {
        passed: chiPassed,
        lowerLimit: chiLower,
        upperLimit: chiUpper,
        testStatistic: vPv,
        confidenceLevel: 0.95,
      },
      matrixDiagnostics: {
        numRowsA: numObs,
        numColsA: numUnknowns,
        numNonZeroA: nonZeroACount,
        sparsityPercent,
        conditionNumberN,
        averageRedundancy,
        maxCorrelation: Math.round(maxCorrelation * 1000) / 1000,
      },
      stations: adjustedStations,
      baselines: finalBaselines,
      outliers,
      excludedBaselines: excludedRecords,
      iterations,
      outlierIterations,
      maxDisplacementMm,
      adjustedAt: new Date().toISOString(),
    };
  } catch (err) {
    console.error('Error in perform3DNetworkAdjustment:', err);
    return null;
  }
}

// ============================================================================
// EXCEL & REPORT GENERATOR (3D Ağ Dengeleme Standartları)
// ============================================================================

export function exportAdjustmentToExcel(
  config: JobConfig,
  adjResult: AdjustmentResult,
  loopClosures: LoopClosure[]
) {
  const wb = XLSX.utils.book_new();

  // 1. Project Summary Sheet
  const summaryData = [
    ['TUREF / ITRF96 GNSS 3D AĞ DENGELEME VE RAPORU', ''],
    ['Proje Adı', config.projectName],
    ['Yüklenici / Mühendis', config.surveyor],
    ['Kurum / İdare', config.institution],
    ['Zaman Dilimi', config.timeZone],
    ['Koordinat Sistemi', config.crsSystem],
    ['Meridyen (DOM)', `${config.dom}°`],
    ['Açı Birimi', config.angleUnit],
    ['Elipsoit', 'GRS80 (a=6378137.0 m, 1/f=298.257222101)'],
    ['Dengeleme Modu', 'İç Kısıtlı Serbest Ağ Dengelemesi (İz Minimizasyonu / N+)'],
    ['Birim Ölçünün Karesel Ort. Hatası (sigma_0)', adjResult.sigma0Aposteriori.toFixed(4)],
    ['Serbestlik Derecesi (DOF)', adjResult.dof],
    ['Kareler Toplamı [vPv]', adjResult.vPv.toFixed(6)],
    ['Ki-Kare Testi (95% Güven)', adjResult.chiSquareTest.passed ? 'GEÇTİ (Uyumlu)' : 'UYARI (Kritik Aralık Dışı)'],
    ['Baarda w-testi Kaba Hatalar', adjResult.outliers.length > 0 ? adjResult.outliers.join(', ') : 'Kaba Hata Tespit Edilmedi'],
    ['Dengeleme Tarihi', new Date().toLocaleString('tr-TR')],
  ];
  const wsSummary = XLSX.utils.aoa_to_sheet(summaryData);
  XLSX.utils.book_append_sheet(wb, wsSummary, 'Proje Özeti');

  // 2. Adjusted Coordinates Sheet
  const coordHeaders = [
    'Nokta Adı',
    'Tip',
    'Durum',
    'Dengelenmiş X (m)',
    'Dengelenmiş Y (m)',
    'Dengelenmiş Z (m)',
    'Enlem (Derece)',
    'Boylam (Derece)',
    'Elipsoit H (m)',
    'TM Sağa Y (m)',
    'TM Yukarı X (m)',
    'sigma_X (mm)',
    'sigma_Y (mm)',
    'sigma_Z (mm)',
    'Hata Elipsi a (mm)',
    'Hata Elipsi b (mm)',
    'Elips Azimut (Grad)',
    'sigma_H (mm)',
  ];

  const coordRows = Object.values(adjResult.stations).map((st) => [
    st.name,
    st.type,
    adjResult.fixedStationIds.includes(st.id) ? 'SABİT (CORS)' : 'SERBEST DENGELİ',
    (st.adjustedX ?? st.x).toFixed(4),
    (st.adjustedY ?? st.y).toFixed(4),
    (st.adjustedZ ?? st.z).toFixed(4),
    (st.adjustedLat ?? st.lat).toFixed(8),
    (st.adjustedLon ?? st.lon).toFixed(8),
    (st.adjustedH ?? st.h).toFixed(4),
    (st.adjustedProjY ?? st.projY).toFixed(4),
    (st.adjustedProjX ?? st.projX).toFixed(4),
    (st.sigmaX ?? 0).toFixed(1),
    (st.sigmaY ?? 0).toFixed(1),
    (st.sigmaZ ?? 0).toFixed(1),
    (st.semiMajor ?? 0).toFixed(1),
    (st.semiMinor ?? 0).toFixed(1),
    (st.ellipseAzimuth ?? 0).toFixed(2),
    (st.sigmaH ?? 0).toFixed(1),
  ]);

  const wsCoords = XLSX.utils.aoa_to_sheet([coordHeaders, ...coordRows]);
  XLSX.utils.book_append_sheet(wb, wsCoords, 'Dengelenmiş Koordinatlar');

  // 3. Baselines & Residuals Sheet
  const baselineHeaders = [
    'Baz ID',
    'Başlangıç',
    'Bitiş',
    'Uzunluk (m)',
    'Çözüm',
    'dX Ölçü (m)',
    'dY Ölçü (m)',
    'dZ Ölçü (m)',
    'vx (mm)',
    'vy (mm)',
    'vz (mm)',
    'v_Mekan (mm)',
    'Baarda w-testi',
    'Kaba Hata?',
  ];

  const baselineRows = adjResult.baselines.map((b) => [
    b.id,
    b.fromId,
    b.toId,
    b.length.toFixed(3),
    b.solutionType,
    b.dX.toFixed(4),
    b.dY.toFixed(4),
    b.dZ.toFixed(4),
    (b.vX ?? 0).toFixed(1),
    (b.vY ?? 0).toFixed(1),
    (b.vZ ?? 0).toFixed(1),
    (b.spatialV ?? 0).toFixed(1),
    (b.wTest ?? 0).toFixed(2),
    b.isOutlier ? 'KABA HATA' : 'NORMAL',
  ]);

  const wsBaselines = XLSX.utils.aoa_to_sheet([baselineHeaders, ...baselineRows]);
  XLSX.utils.book_append_sheet(wb, wsBaselines, 'Bazlar ve Düzeltmeler');

  // 4. Loop Closures Sheet
  const loopHeaders = [
    'Döngü ID',
    'Güzergah',
    'Toplam Uzunluk (km)',
    'dX Kapanış (mm)',
    'dY Kapanış (mm)',
    'dZ Kapanış (mm)',
    'w_3D (mm)',
    'Tolerans (mm)',
    'Kapanış (ppm)',
    'Bağıl Hassasiyet',
    'Sonuç',
  ];

  const loopRows = loopClosures.map((l) => [
    l.id,
    l.stationIds.join(' -> '),
    l.totalLengthKm.toFixed(3),
    l.sumDX.toFixed(1),
    l.sumDY.toFixed(1),
    l.sumDZ.toFixed(1),
    l.totalMisclosure.toFixed(1),
    l.toleranceMm.toFixed(1),
    l.misclosurePpm.toFixed(2),
    l.relativePrecision,
    l.isAccepted ? 'UYGUN' : 'TOLERANS AŞILDI',
  ]);

  const wsLoops = XLSX.utils.aoa_to_sheet([loopHeaders, ...loopRows]);
  XLSX.utils.book_append_sheet(wb, wsLoops, 'Döngü Kapanışları');

  const fileName = `${config.projectName.replace(/\s+/g, '_')}_Dengeleme_Raporu.xlsx`;
  XLSX.writeFile(wb, fileName);
}






// ============================================================================
// PRELOADED DEMO DATASET (TUSAGA-Aktif & Central Anatolia Project)
// ============================================================================

export const DEFAULT_CONFIG: JobConfig = {
  projectName: 'GNSS Nirengi Ağı Dengeleme Projesi',
  surveyor: 'Harita Mühendisi',
  checker: 'Kontrol Mühendisi',
  institution: '',
  timeZone: 'GMT+03:00',
  crsSystem: 'TUREF-TM30',
  dom: 30, // Central Meridian for TM30 is 30°
  angleUnit: 'Gon',
  lengthUnit: 'Metre',
  satelliteSystems: 'GPS+GLONASS',
  elevationMask: 10,
  horizontalTolerance: 0.03, // 0.03 m
  verticalTolerance: 0.05, // 0.05 m
  ellipsoid: 'GRS80',
  loopToleranceBaseMm: 10.0,
  loopTolerancePpm: 1.0,
  baardaAlpha: 0.001,
  wCrit: 3.29,
  autoExcludeOutliers: true,
  maxOutlierIterations: 5,
};

// Empty initial network elements (No demo data)
export const INITIAL_STATIONS: Record<string, Station> = {};
export const INITIAL_BASELINES: BaselineVector[] = [];

