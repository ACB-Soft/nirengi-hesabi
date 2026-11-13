/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Multi-GNSS RINEX Navigation (.nav, .n, .g, .p) & Precise Orbit (.SP3) Engine
 * Supports:
 * - GPS (IS-GPS-200) Keplerian Ephemeris
 * - Galileo (OS-SIS-ICD) Keplerian Ephemeris
 * - GLONASS (ICD-GLONASS) PZ-90 4-line State Vector + 4th-Order Runge-Kutta Integration
 * - IGS .SP3 (c/d) Precise Orbit Parsing + 10-Point Lagrange Interpolation + Relativistic Clock
 * - Klobuchar Ionospheric Delay & Saastamoinen Tropospheric Delay Models
 */

import { IgsSp3File } from '../types/gnss';

export interface IonoParameters {
  alpha?: [number, number, number, number];
  beta?: [number, number, number, number];
}

export interface BroadcastEphemeris {
  prn: string; // e.g. "G01", "E05", "R12"
  system: 'G' | 'E' | 'R';
  epochDateStr: string;
  tocYear: number;
  tocMonth: number;
  tocDay: number;
  tocHour: number;
  tocMin: number;
  tocSec: number;
  tocGpsSec: number; // seconds into GPS week
  absTocSec: number; // continuous GPS seconds since 1980-01-06T00:00:00Z
  absToeSec: number; // continuous GPS seconds of TOE/Tb
  gpsWeek: number;
  // Clock parameters
  af0: number; // SV clock bias (s) or -tauN for GLONASS
  af1: number; // SV clock drift (s/s) or +gammaN for GLONASS
  af2: number; // SV clock drift rate (s/s^2)
  // Keplerian Orbit parameters (GPS / Galileo)
  iode: number;
  crs: number;
  deltaN: number;
  m0: number;
  cuc: number;
  e: number;
  cus: number;
  sqrtA: number;
  toe: number; // seconds into GPS week
  cic: number;
  omega0: number;
  cis: number;
  i0: number;
  crc: number;
  omega: number;
  omegaDot: number;
  idot: number;
  codeOnL2?: number;
  l2pFlag?: number;
  svAccuracy?: number;
  svHealth?: number;
  tgd?: number; // TGD (GPS) or BGD E1/E5a (Galileo) in seconds
  bgdE1E5b?: number;
  iodc?: number;
  transmissionTime?: number;
  // GLONASS State Vector (ECEF meters, m/s, m/s^2)
  gloPos?: [number, number, number];
  gloVel?: [number, number, number];
  gloAcc?: [number, number, number];
  gloFreqNum?: number; // k in [-7..6]
}

export interface EphemerisCollection {
  satellites: Record<string, BroadcastEphemeris[]>;
  iono?: IonoParameters;
  leapSeconds?: number;
}

export interface Sp3EpochPoint {
  tAbs: number; // continuous GPS seconds
  x: number; // ECEF X (m)
  y: number; // ECEF Y (m)
  z: number; // ECEF Z (m)
  clk: number | null; // SV clock bias (s), null if missing (999999)
}

export interface Sp3OrbitData {
  summary: IgsSp3File;
  intervalSec: number;
  timeSystem: 'GPS' | 'UTC' | string;
  satellites: Record<string, Sp3EpochPoint[]>;
}

export interface SatelliteOrbitSolution {
  prn: string;
  x: number; // ECEF X (m)
  y: number; // ECEF Y (m)
  z: number; // ECEF Z (m)
  dts: number; // SV clock bias including relativistic correction (s)
  health: number; // 0 = healthy
  source?: 'SP3' | 'NAV';
  gloFreqNum?: number;
}

// Physical & Geodetic Constants
const GM_GPS = 3.986005e14; // IS-GPS-200
const GM_GAL = 3.986004418e14; // Galileo OS-SIS-ICD
const GM_GLO = 3.986004418e14; // PZ-90 / GLO-ICD
const RE_GLO = 6378136.0;
const J2_GLO = 1.08262575e-3;
const OMEGA_E_DOT = 7.2921151467e-5; // rad/s
const OMEGA_E_GLO = 7.292115e-5; // rad/s
const SPEED_OF_LIGHT = 299792458.0; // m/s
const RELATIVITY_F = -4.442807633e-10; // s / sqrt(m)
const GPS_EPOCH_UTC_MS = Date.UTC(1980, 0, 6, 0, 0, 0);
const DEFAULT_LEAP_SECONDS = 18; // Valid since 2017-01-01

function parseFortranFloat(str: string): number {
  if (!str) return 0;
  const cleaned = str.trim().replace(/[Dd]/g, 'E');
  if (!cleaned) return 0;
  const val = parseFloat(cleaned);
  return isNaN(val) ? 0 : val;
}

/**
 * Converts calendar components to continuous GPS seconds & GPS week/TOW.
 * Assumes input timestamp is already in GPS time (unless isUtc=true, in which case leapSeconds are added).
 */
export function dateToGpsTime(
  year: number,
  month: number,
  day: number,
  hour: number,
  min: number,
  sec: number,
  isUtc = false,
  leapSeconds = DEFAULT_LEAP_SECONDS
): { gpsWeek: number; gpsSeconds: number; absGpsSec: number } {
  const wholeSec = Math.floor(sec);
  const fracSec = sec - wholeSec;
  const dateMs = Date.UTC(year, month - 1, day, hour, min, wholeSec, 0);
  let absGpsSec = (dateMs - GPS_EPOCH_UTC_MS) / 1000.0 + fracSec;
  if (isUtc) {
    absGpsSec += leapSeconds;
  }
  const gpsWeek = Math.floor(absGpsSec / 604800.0);
  const gpsSeconds = absGpsSec - gpsWeek * 604800.0;
  return { gpsWeek, gpsSeconds, absGpsSec };
}

/**
 * Parses a date string like "2025-06-15 10:30:00 GPS" or ISO string to continuous GPS seconds
 */
export function parseEpochStringToAbsGpsSec(dateStr?: string): number | null {
  if (!dateStr) return null;
  const cleaned = dateStr.replace(' GPS', '').replace(' UTC', '').trim();
  const m = cleaned.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s]+(\d{1,2}):(\d{1,2}):([\d.]+))?/);
  if (m) {
    const y = parseInt(m[1], 10);
    const mo = parseInt(m[2], 10);
    const d = parseInt(m[3], 10);
    const h = parseInt(m[4] || '0', 10);
    const mi = parseInt(m[5] || '0', 10);
    const s = parseFloat(m[6] || '0');
    return dateToGpsTime(y, mo, d, h, mi, s).absGpsSec;
  }
  const ms = Date.parse(cleaned + 'Z');
  if (!isNaN(ms)) {
    return (ms - GPS_EPOCH_UTC_MS) / 1000.0;
  }
  return null;
}

/**
 * Parses RINEX v2/v3/v4 Navigation file (.nav, .n, .g, .p) with full metadata (iono + leap seconds)
 */
export function parseRinexNavDetailed(content: string): EphemerisCollection {
  const lines = content.split(/\r?\n/);
  const satellites: Record<string, BroadcastEphemeris[]> = {};
  const iono: IonoParameters = {};
  let leapSeconds = DEFAULT_LEAP_SECONDS;
  let defaultFileSystem: 'G' | 'R' | 'E' = 'G';

  let headerEnded = false;
  let lineIdx = 0;

  while (lineIdx < lines.length) {
    const line = lines[lineIdx++];
    const label = line.length >= 60 ? line.substring(60).trim() : '';
    const data = line.length >= 60 ? line.substring(0, 60) : line;

    if (label === 'RINEX VERSION / TYPE') {
      const sysChar = data.substring(40, 41).trim().toUpperCase();
      if (sysChar === 'R') defaultFileSystem = 'R';
      else if (sysChar === 'E') defaultFileSystem = 'E';
      else defaultFileSystem = 'G';
      const typeChar = data.substring(20, 21).trim().toUpperCase();
      if (typeChar === 'G') defaultFileSystem = 'R';
    } else if (label === 'ION ALPHA') {
      iono.alpha = [
        parseFortranFloat(data.substring(2, 14)),
        parseFortranFloat(data.substring(14, 26)),
        parseFortranFloat(data.substring(26, 38)),
        parseFortranFloat(data.substring(38, 50)),
      ];
    } else if (label === 'ION BETA') {
      iono.beta = [
        parseFortranFloat(data.substring(2, 14)),
        parseFortranFloat(data.substring(14, 26)),
        parseFortranFloat(data.substring(26, 38)),
        parseFortranFloat(data.substring(38, 50)),
      ];
    } else if (label === 'IONOSPHERIC CORR') {
      const corrType = data.substring(0, 4).trim().toUpperCase();
      if (corrType === 'GPSA') {
        iono.alpha = [
          parseFortranFloat(data.substring(5, 17)),
          parseFortranFloat(data.substring(17, 29)),
          parseFortranFloat(data.substring(29, 41)),
          parseFortranFloat(data.substring(41, 53)),
        ];
      } else if (corrType === 'GPSB') {
        iono.beta = [
          parseFortranFloat(data.substring(5, 17)),
          parseFortranFloat(data.substring(17, 29)),
          parseFortranFloat(data.substring(29, 41)),
          parseFortranFloat(data.substring(41, 53)),
        ];
      }
    } else if (label === 'LEAP SECONDS') {
      const val = parseInt(data.substring(0, 6).trim(), 10);
      if (!isNaN(val) && val > 0) leapSeconds = val;
    }

    if (line.includes('END OF HEADER')) {
      headerEnded = true;
      break;
    }
  }

  if (!headerEnded) lineIdx = 0;

  while (lineIdx < lines.length) {
    let line0 = lines[lineIdx++];
    if (!line0 || line0.trim().length === 0) continue;

    // Handle RINEX 4 "> EPH G01 LNAV" wrapper
    if (line0.startsWith('>')) {
      const m4 = line0.match(/^>\s*EPH\s+([GRECJSI]\d{2})\s+(\S+)/);
      if (!m4) continue;
      const msgType = m4[2].toUpperCase();
      // Skip non-standard/SBAS/condensed blocks safely by continuing to next line if not LNAV/INAV/FNAV/FDMA
      if (lineIdx >= lines.length) break;
      line0 = lines[lineIdx++];
      if (!line0 || line0.trim().length === 0) continue;
      if (!['LNAV', 'INAV', 'FNAV', 'FDMA', 'D1', 'D2'].includes(msgType)) {
        // Consume lines until next '>'
        while (lineIdx < lines.length && !lines[lineIdx].startsWith('>')) lineIdx++;
        continue;
      }
    }

    let prn = '';
    let sysChar = defaultFileSystem as string;
    let year = 0, month = 0, day = 0, hour = 0, min = 0, sec = 0;
    let af0 = 0, af1 = 0, af2 = 0;

    const firstChar = line0.charAt(0).toUpperCase();
    const isRinex3Record = ['G', 'R', 'E', 'C', 'J', 'S', 'I'].includes(firstChar) && /^\d{2}/.test(line0.substring(1, 3));

    if (isRinex3Record) {
      sysChar = firstChar;
      prn = `${firstChar}${line0.substring(1, 3)}`;
      year = parseInt(line0.substring(4, 8), 10) || 2025;
      month = parseInt(line0.substring(9, 11), 10) || 1;
      day = parseInt(line0.substring(12, 14), 10) || 1;
      hour = parseInt(line0.substring(15, 17), 10) || 0;
      min = parseInt(line0.substring(18, 20), 10) || 0;
      sec = parseFloat(line0.substring(21, 23)) || 0;
      af0 = parseFortranFloat(line0.substring(23, 42));
      af1 = parseFortranFloat(line0.substring(42, 61));
      af2 = parseFortranFloat(line0.substring(61, 80));
    } else {
      const prnNum = parseInt(line0.substring(0, 2), 10);
      if (isNaN(prnNum) || prnNum <= 0) continue;
      sysChar = defaultFileSystem;
      prn = `${sysChar}${String(prnNum).padStart(2, '0')}`;
      const rawYear = parseInt(line0.substring(3, 5), 10) || 25;
      year = rawYear < 80 ? 2000 + rawYear : 1900 + rawYear;
      month = parseInt(line0.substring(6, 8), 10) || 1;
      day = parseInt(line0.substring(9, 11), 10) || 1;
      hour = parseInt(line0.substring(12, 14), 10) || 0;
      min = parseInt(line0.substring(15, 17), 10) || 0;
      sec = parseFloat(line0.substring(18, 22)) || 0;
      af0 = parseFortranFloat(line0.substring(22, 41));
      af1 = parseFortranFloat(line0.substring(41, 60));
      af2 = parseFortranFloat(line0.substring(60, 79));
    }

    // Field offset differs by 1 column between RINEX 2 (col 3) and RINEX 3 (col 4)
    const cOff = isRinex3Record ? 4 : 3;

    if (sysChar === 'R' || sysChar === 'S') {
      // GLONASS & SBAS have strictly 3 extra lines (4 lines total)
      const line1 = lines[lineIdx++] || '';
      const line2 = lines[lineIdx++] || '';
      const line3 = lines[lineIdx++] || '';

      if (sysChar === 'S') continue; // Skip SBAS

      // Columns: [X, Vx, Ax, health], [Y, Vy, Ay, freqNum], [Z, Vz, Az, age]
      // Note: GLONASS nav units in RINEX are km, km/s, km/s^2 -> convert to m, m/s, m/s^2
      const xKm = parseFortranFloat(line1.substring(cOff, cOff + 19));
      const vxKm = parseFortranFloat(line1.substring(cOff + 19, cOff + 38));
      const axKm = parseFortranFloat(line1.substring(cOff + 38, cOff + 57));
      const health = parseFortranFloat(line1.substring(cOff + 57, cOff + 76));

      const yKm = parseFortranFloat(line2.substring(cOff, cOff + 19));
      const vyKm = parseFortranFloat(line2.substring(cOff + 19, cOff + 38));
      const ayKm = parseFortranFloat(line2.substring(cOff + 38, cOff + 57));
      const freqNum = Math.round(parseFortranFloat(line2.substring(cOff + 57, cOff + 76)));

      const zKm = parseFortranFloat(line3.substring(cOff, cOff + 19));
      const vzKm = parseFortranFloat(line3.substring(cOff + 19, cOff + 38));
      const azKm = parseFortranFloat(line3.substring(cOff + 38, cOff + 57));

      // GLONASS ephemeris epochs are UTC -> add leapSeconds to align onto continuous GPS timescale
      const { gpsWeek, gpsSeconds, absGpsSec } = dateToGpsTime(
        year, month, day, hour, min, sec,
        true,
        leapSeconds
      );

      const eph: BroadcastEphemeris = {
        prn,
        system: 'R',
        epochDateStr: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')} ${String(hour).padStart(2, '0')}:${String(min).padStart(2, '0')}:${String(Math.floor(sec)).padStart(2, '0')}`,
        tocYear: year,
        tocMonth: month,
        tocDay: day,
        tocHour: hour,
        tocMin: min,
        tocSec: sec,
        tocGpsSec: gpsSeconds,
        absTocSec: absGpsSec,
        absToeSec: absGpsSec,
        gpsWeek,
        af0, // In RINEX, column 1 is -TauN
        af1, // In RINEX, column 2 is +GammaN
        af2: 0,
        iode: Math.round((absGpsSec % 86400) / 900),
        crs: 0, deltaN: 0, m0: 0, cuc: 0, e: 0, cus: 0, sqrtA: 0,
        toe: gpsSeconds,
        cic: 0, omega0: 0, cis: 0, i0: 0, crc: 0, omega: 0, omegaDot: 0, idot: 0,
        svHealth: health,
        gloPos: [xKm * 1000.0, yKm * 1000.0, zKm * 1000.0],
        gloVel: [vxKm * 1000.0, vyKm * 1000.0, vzKm * 1000.0],
        gloAcc: [axKm * 1000.0, ayKm * 1000.0, azKm * 1000.0],
        gloFreqNum: freqNum,
      };

      if (!satellites[prn]) satellites[prn] = [];
      satellites[prn].push(eph);
      continue;
    }

    // 7 extra lines for Keplerian constellations (G, E, C, J, I)
    const line1 = lines[lineIdx++] || '';
    const line2 = lines[lineIdx++] || '';
    const line3 = lines[lineIdx++] || '';
    const line4 = lines[lineIdx++] || '';
    const line5 = lines[lineIdx++] || '';
    const line6 = lines[lineIdx++] || '';
    const line7 = lines[lineIdx++] || '';

    if (sysChar !== 'G' && sysChar !== 'E') {
      continue; // Keep focus on GPS + Galileo + GLONASS per system specification
    }

    const iode = parseFortranFloat(line1.substring(cOff, cOff + 19));
    const crs = parseFortranFloat(line1.substring(cOff + 19, cOff + 38));
    const deltaN = parseFortranFloat(line1.substring(cOff + 38, cOff + 57));
    const m0 = parseFortranFloat(line1.substring(cOff + 57, cOff + 76));

    const cuc = parseFortranFloat(line2.substring(cOff, cOff + 19));
    const e = parseFortranFloat(line2.substring(cOff + 19, cOff + 38));
    const cus = parseFortranFloat(line2.substring(cOff + 38, cOff + 57));
    const sqrtA = parseFortranFloat(line2.substring(cOff + 57, cOff + 76));

    const toe = parseFortranFloat(line3.substring(cOff, cOff + 19));
    const cic = parseFortranFloat(line3.substring(cOff + 19, cOff + 38));
    const omega0 = parseFortranFloat(line3.substring(cOff + 38, cOff + 57));
    const cis = parseFortranFloat(line3.substring(cOff + 57, cOff + 76));

    const i0 = parseFortranFloat(line4.substring(cOff, cOff + 19));
    const crc = parseFortranFloat(line4.substring(cOff + 19, cOff + 38));
    const omega = parseFortranFloat(line4.substring(cOff + 38, cOff + 57));
    const omegaDot = parseFortranFloat(line4.substring(cOff + 57, cOff + 76));

    const idot = parseFortranFloat(line5.substring(cOff, cOff + 19));
    const codeOnL2 = parseFortranFloat(line5.substring(cOff + 19, cOff + 38));
    const rawWeek = Math.round(parseFortranFloat(line5.substring(cOff + 38, cOff + 57)));
    const l2pFlag = parseFortranFloat(line5.substring(cOff + 57, cOff + 76));

    const svAccuracy = parseFortranFloat(line6.substring(cOff, cOff + 19));
    const svHealth = parseFortranFloat(line6.substring(cOff + 19, cOff + 38));
    const tgd = parseFortranFloat(line6.substring(cOff + 38, cOff + 57));
    const iodcOrBgd = parseFortranFloat(line6.substring(cOff + 57, cOff + 76));

    const transmissionTime = parseFortranFloat(line7.substring(cOff, cOff + 19));

    const tocTime = dateToGpsTime(year, month, day, hour, min, sec, false, leapSeconds);
    // Galileo RINEX 3 week number is aligned to GPS week in RINEX 3.0x (1024-offset occasionally in older GST, normalize to tocTime.gpsWeek)
    const effectiveWeek = rawWeek > 0 && Math.abs(rawWeek - tocTime.gpsWeek) <= 2 ? rawWeek : tocTime.gpsWeek;
    let absToeSec = effectiveWeek * 604800.0 + toe;
    // Handle week crossover between toc and toe
    if (absToeSec - tocTime.absGpsSec > 302400) absToeSec -= 604800;
    else if (absToeSec - tocTime.absGpsSec < -302400) absToeSec += 604800;

    // For Galileo, check E1/E5a INAV health bits (bits 0..2 or FNAV/INAV status)
    const health = sysChar === 'E' ? (Math.round(svHealth) & 0x1ff) : svHealth;

    const eph: BroadcastEphemeris = {
      prn,
      system: sysChar as 'G' | 'E',
      epochDateStr: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')} ${String(hour).padStart(2, '0')}:${String(min).padStart(2, '0')}:${String(Math.floor(sec)).padStart(2, '0')}`,
      tocYear: year,
      tocMonth: month,
      tocDay: day,
      tocHour: hour,
      tocMin: min,
      tocSec: sec,
      tocGpsSec: tocTime.gpsSeconds,
      absTocSec: tocTime.absGpsSec,
      absToeSec,
      gpsWeek: effectiveWeek,
      af0,
      af1,
      af2,
      iode,
      crs,
      deltaN,
      m0,
      cuc,
      e,
      cus,
      sqrtA,
      toe,
      cic,
      omega0,
      cis,
      i0,
      crc,
      omega,
      omegaDot,
      idot,
      codeOnL2,
      l2pFlag,
      svAccuracy,
      svHealth: health,
      tgd,
      bgdE1E5b: sysChar === 'E' ? iodcOrBgd : undefined,
      iodc: sysChar === 'G' ? iodcOrBgd : undefined,
      transmissionTime,
    };

    if (!satellites[prn]) satellites[prn] = [];
    satellites[prn].push(eph);
  }

  for (const prn in satellites) {
    satellites[prn].sort((a, b) => a.absToeSec - b.absToeSec);
  }

  return { satellites, iono, leapSeconds };
}

/**
 * Backward-compatible parser returning PRN -> BroadcastEphemeris[]
 */
export function parseRinexNavFile(content: string): Record<string, BroadcastEphemeris[]> {
  return parseRinexNavDetailed(content).satellites;
}

/**
 * Merges multiple parsed navigation maps cleanly without losing records
 */
export function mergeEphemerisMaps(
  base: Record<string, BroadcastEphemeris[]>,
  incoming: Record<string, BroadcastEphemeris[]>
): Record<string, BroadcastEphemeris[]> {
  const merged: Record<string, BroadcastEphemeris[]> = { ...base };
  for (const prn in incoming) {
    const existing = merged[prn] || [];
    const seenToe = new Set(existing.map((e) => Math.round(e.absToeSec)));
    const combined = [...existing];
    for (const item of incoming[prn]) {
      const k = Math.round(item.absToeSec);
      if (!seenToe.has(k)) {
        seenToe.add(k);
        combined.push(item);
      }
    }
    combined.sort((a, b) => a.absToeSec - b.absToeSec);
    merged[prn] = combined;
  }
  return merged;
}

/**
 * Finds the nearest broadcast ephemeris for a satellite.
 * Accepts either continuous absGpsSec (> 1e8) or GPS TOW seconds (< 604800).
 */
export function findNearestEphemeris(
  ephemerisList: BroadcastEphemeris[] | undefined,
  targetTimeSec: number
): BroadcastEphemeris | null {
  if (!ephemerisList || ephemerisList.length === 0) return null;

  const isAbsolute = targetTimeSec > 1e7;
  let best: BroadcastEphemeris | null = null;
  let minDiff = Infinity;

  for (const eph of ephemerisList) {
    let diff: number;
    if (isAbsolute) {
      diff = Math.abs(targetTimeSec - eph.absToeSec);
    } else {
      diff = Math.abs(targetTimeSec - eph.toe);
      if (diff > 302400) diff = Math.abs(diff - 604800);
    }
    if (diff < minDiff) {
      minDiff = diff;
      best = eph;
    }
  }

  // Max fit window: 4h for GPS/Galileo, 1h for GLONASS state vector
  const maxFitSec = best?.system === 'R' ? 3600 : 14400;
  return minDiff <= maxFitSec ? best : null;
}

/**
 * GLONASS equation of motion right-hand side in PZ-90 / ECEF
 */
function glonassDeriv(state: number[], acc: [number, number, number]): number[] {
  const x = state[0], y = state[1], z = state[2];
  const vx = state[3], vy = state[4], vz = state[5];
  const r2 = x * x + y * y + z * z;
  const r = Math.sqrt(r2);
  const r3 = r2 * r;
  const r5 = r3 * r2;
  const a = -GM_GLO / r3;
  const b = (1.5 * J2_GLO * GM_GLO * RE_GLO * RE_GLO) / r5;
  const c = 1.0 - (5.0 * z * z) / r2;
  const w2 = OMEGA_E_GLO * OMEGA_E_GLO;

  const ax = a * x + b * x * c + w2 * x + 2.0 * OMEGA_E_GLO * vy + acc[0];
  const ay = a * y + b * y * c + w2 * y - 2.0 * OMEGA_E_GLO * vx + acc[1];
  const az = a * z + b * z * (3.0 - (5.0 * z * z) / r2) + acc[2];

  return [vx, vy, vz, ax, ay, az];
}

/**
 * Computes GLONASS ECEF position via 4th-order Runge-Kutta integration (30 s step)
 */
function computeGlonassPosition(
  eph: BroadcastEphemeris,
  t: number
): SatelliteOrbitSolution {
  if (!eph.gloPos || !eph.gloVel || !eph.gloAcc) {
    return { prn: eph.prn, x: 0, y: 0, z: 0, dts: 0, health: 1 };
  }

  const isAbsolute = t > 1e7;
  let dt = isAbsolute ? t - eph.absToeSec : t - eph.toe;
  if (!isAbsolute) {
    if (dt > 302400) dt -= 604800;
    else if (dt < -302400) dt += 604800;
  }

  // RINEX GLONASS line 0 already stores af0 = -TauN, af1 = +GammaN
  const dts = eph.af0 + eph.af1 * dt;

  const state = [...eph.gloPos, ...eph.gloVel];
  const acc = eph.gloAcc;
  const TSTEP = 30.0;

  let rem = dt;
  while (Math.abs(rem) > 1e-9) {
    const h = rem > 0 ? Math.min(TSTEP, rem) : Math.max(-TSTEP, rem);
    const k1 = glonassDeriv(state, acc);
    const s2 = state.map((v, idx) => v + 0.5 * h * k1[idx]);
    const k2 = glonassDeriv(s2, acc);
    const s3 = state.map((v, idx) => v + 0.5 * h * k2[idx]);
    const k3 = glonassDeriv(s3, acc);
    const s4 = state.map((v, idx) => v + h * k3[idx]);
    const k4 = glonassDeriv(s4, acc);

    for (let i = 0; i < 6; i++) {
      state[i] += (h / 6.0) * (k1[i] + 2.0 * k2[i] + 2.0 * k3[i] + k4[i]);
    }
    rem -= h;
  }

  return {
    prn: eph.prn,
    x: state[0],
    y: state[1],
    z: state[2],
    dts,
    health: eph.svHealth || 0,
    source: 'NAV',
    gloFreqNum: eph.gloFreqNum,
  };
}

/**
 * Computes GPS / Galileo / GLONASS ECEF position and clock bias from Broadcast Ephemeris.
 * Accepts continuous absGpsSec (> 1e7) or GPS TOW seconds (< 604800).
 */
export function computeSatellitePosition(
  eph: BroadcastEphemeris,
  t: number
): SatelliteOrbitSolution {
  if (eph.system === 'R') {
    return computeGlonassPosition(eph, t);
  }

  const A = eph.sqrtA * eph.sqrtA;
  if (A <= 0) {
    return { prn: eph.prn, x: 0, y: 0, z: 0, dts: 0, health: 1 };
  }

  const gm = eph.system === 'E' ? GM_GAL : GM_GPS;
  const n0 = Math.sqrt(gm / (A * A * A));
  const n = n0 + eph.deltaN;

  const isAbsolute = t > 1e7;
  let tk = isAbsolute ? t - eph.absToeSec : t - eph.toe;
  if (!isAbsolute) {
    if (tk > 302400) tk -= 604800;
    else if (tk < -302400) tk += 604800;
  }

  const Mk = eph.m0 + n * tk;
  let Ek = Mk;
  for (let iter = 0; iter < 15; iter++) {
    const f = Ek - eph.e * Math.sin(Ek) - Mk;
    const fPrime = 1.0 - eph.e * Math.cos(Ek);
    const dE = f / fPrime;
    Ek -= dE;
    if (Math.abs(dE) < 1e-13) break;
  }

  const sinNu = (Math.sqrt(1.0 - eph.e * eph.e) * Math.sin(Ek)) / (1.0 - eph.e * Math.cos(Ek));
  const cosNu = (Math.cos(Ek) - eph.e) / (1.0 - eph.e * Math.cos(Ek));
  const vk = Math.atan2(sinNu, cosNu);

  const Phik = vk + eph.omega;
  const sin2Phi = Math.sin(2.0 * Phik);
  const cos2Phi = Math.cos(2.0 * Phik);

  const deltaU = eph.cus * sin2Phi + eph.cuc * cos2Phi;
  const deltaR = eph.crs * sin2Phi + eph.crc * cos2Phi;
  const deltaI = eph.cis * sin2Phi + eph.cic * cos2Phi;

  const uk = Phik + deltaU;
  const rk = A * (1.0 - eph.e * Math.cos(Ek)) + deltaR;
  const ik = eph.i0 + deltaI + eph.idot * tk;

  const xPrime = rk * Math.cos(uk);
  const yPrime = rk * Math.sin(uk);

  const Omegak = eph.omega0 + (eph.omegaDot - OMEGA_E_DOT) * tk - OMEGA_E_DOT * eph.toe;
  const cosOmega = Math.cos(Omegak);
  const sinOmega = Math.sin(Omegak);
  const cosI = Math.cos(ik);
  const sinI = Math.sin(ik);

  const xK = xPrime * cosOmega - yPrime * cosI * sinOmega;
  const yK = xPrime * sinOmega + yPrime * cosI * cosOmega;
  const zK = yPrime * sinI;

  const dtRel = RELATIVITY_F * eph.e * eph.sqrtA * Math.sin(Ek);
  let dtc = isAbsolute ? t - eph.absTocSec : t - eph.tocGpsSec;
  if (!isAbsolute) {
    if (dtc > 302400) dtc -= 604800;
    else if (dtc < -302400) dtc += 604800;
  }

  // Note: For Galileo, tgd = BGD(E1, E5a); subtract tgd for C1 single-freq broadcast clock alignment
  const dts = eph.af0 + eph.af1 * dtc + eph.af2 * dtc * dtc + dtRel - (eph.tgd || 0);

  return {
    prn: eph.prn,
    x: xK,
    y: yK,
    z: zK,
    dts,
    health: eph.svHealth || 0,
    source: 'NAV',
  };
}

/**
 * Full .SP3 (SP3-a / c / d) Precise Orbit Parser
 */
export function parseFullSp3File(content: string, fileName: string): Sp3OrbitData | null {
  if (!content || !content.trim().startsWith('#')) return null;

  const lines = content.split(/\r?\n/);
  let gpsWeek = 0;
  let dayOfWeek = 0;
  let intervalSec = 900;
  let timeSystem = 'GPS';

  if (lines.length > 1 && lines[1].startsWith('##')) {
    const matchWeek = lines[1].match(/^##\s+(\d+)\s+([\d.]+)\s+([\d.]+)/);
    if (matchWeek) {
      gpsWeek = parseInt(matchWeek[1], 10);
      const sow = parseFloat(matchWeek[2]);
      const iv = parseFloat(matchWeek[3]);
      dayOfWeek = Math.min(6, Math.max(0, Math.floor(sow / 86400)));
      if (!isNaN(iv) && iv > 0) intervalSec = iv;
    }
  }

  for (let i = 2; i < Math.min(lines.length, 30); i++) {
    if (lines[i].startsWith('%c')) {
      const tokens = lines[i].substring(2).trim().split(/\s+/);
      if (tokens.length >= 2 && (tokens[1] === 'GPS' || tokens[1] === 'UTC' || tokens[1] === 'GLO' || tokens[1] === 'GAL')) {
        timeSystem = tokens[1];
      }
      break;
    }
  }

  const satellites: Record<string, Sp3EpochPoint[]> = {};
  let currentTAbs = -1;
  let epochCount = 0;
  let firstEpochIso: string | undefined;
  let lastEpochIso: string | undefined;
  const isUtc = timeSystem === 'UTC';

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;

    if (line.startsWith('*')) {
      const m = line.match(/^\*\s+(\d{4})\s+(\d{1,2})\s+(\d{1,2})\s+(\d{1,2})\s+(\d{1,2})\s+([\d.]+)/);
      if (m) {
        const y = parseInt(m[1], 10);
        const mo = parseInt(m[2], 10);
        const d = parseInt(m[3], 10);
        const hr = parseInt(m[4], 10);
        const mi = parseInt(m[5], 10);
        const s = parseFloat(m[6]);
        const gt = dateToGpsTime(y, mo, d, hr, mi, s, isUtc, DEFAULT_LEAP_SECONDS);
        currentTAbs = gt.absGpsSec;
        if (gpsWeek === 0) {
          gpsWeek = gt.gpsWeek;
          dayOfWeek = Math.min(6, Math.max(0, Math.floor(gt.gpsSeconds / 86400)));
        }
        const iso = `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')} ${String(hr).padStart(2, '0')}:${String(mi).padStart(2, '0')}:${String(Math.floor(s)).padStart(2, '0')}`;
        if (!firstEpochIso) firstEpochIso = iso;
        lastEpochIso = iso;
        epochCount++;
      }
    } else if (line.startsWith('P') && currentTAbs >= 0) {
      let satId = line.substring(1, 4).trim();
      if (/^\d+$/.test(satId)) {
        satId = `G${satId.padStart(2, '0')}`;
      } else if (satId.length >= 2) {
        const sys = satId.charAt(0).toUpperCase();
        const num = parseInt(satId.substring(1), 10);
        if (!isNaN(num)) satId = `${sys}${String(num).padStart(2, '0')}`;
      }

      const xKm = parseFloat(line.substring(4, 18));
      const yKm = parseFloat(line.substring(18, 32));
      const zKm = parseFloat(line.substring(32, 46));
      const clkUs = parseFloat(line.substring(46, 60));

      if (
        isNaN(xKm) || isNaN(yKm) || isNaN(zKm) ||
        Math.abs(xKm) >= 999999 || (xKm === 0 && yKm === 0 && zKm === 0)
      ) {
        continue;
      }

      const clk = !isNaN(clkUs) && Math.abs(clkUs) < 999999 ? clkUs * 1e-6 : null;

      if (!satellites[satId]) satellites[satId] = [];
      satellites[satId].push({
        tAbs: currentTAbs,
        x: xKm * 1000.0,
        y: yKm * 1000.0,
        z: zKm * 1000.0,
        clk,
      });
    }
  }

  for (const satId in satellites) {
    satellites[satId].sort((a, b) => a.tAbs - b.tAbs);
  }

  const satList = Object.keys(satellites).sort();
  if (satList.length === 0 || epochCount === 0) return null;

  // Infer actual epoch spacing if needed
  const firstTrack = satellites[satList[0]];
  if (firstTrack && firstTrack.length >= 2) {
    const dt = firstTrack[1].tAbs - firstTrack[0].tAbs;
    if (dt > 0 && dt <= 3600) intervalSec = dt;
  }

  const lowerName = fileName.toLowerCase();
  const productType: 'FINAL' | 'RAPID' | 'ULTRA_RAPID' =
    lowerName.includes('ult') || lowerName.startsWith('igu')
      ? 'ULTRA_RAPID'
      : lowerName.includes('rap') || lowerName.startsWith('igr')
      ? 'RAPID'
      : 'FINAL';

  return {
    summary: {
      fileName,
      gpsWeek,
      dayOfWeek,
      epochCount,
      satelliteCount: satList.length,
      satellites: satList,
      productType,
      firstEpochIso,
      lastEpochIso,
      intervalSec,
    },
    intervalSec,
    timeSystem,
    satellites,
  };
}

/**
 * Lagrange / Neville 10-point polynomial evaluation at tAbs
 */
function lagrangeEval(points: Array<{ t: number; v: number }>, tTarget: number): number {
  let result = 0;
  const n = points.length;
  for (let i = 0; i < n; i++) {
    let term = points[i].v;
    for (let j = 0; j < n; j++) {
      if (i !== j) {
        const denom = points[i].t - points[j].t;
        if (Math.abs(denom) > 1e-12) {
          term *= (tTarget - points[j].t) / denom;
        }
      }
    }
    result += term;
  }
  return result;
}

/**
 * Interpolates satellite ECEF coordinates + relativistic clock from SP3 precise orbit
 */
export function interpolateSp3Orbit(
  sp3: Sp3OrbitData,
  prn: string,
  absGpsSec: number
): SatelliteOrbitSolution | null {
  const track = sp3.satellites[prn];
  if (!track || track.length < 2) return null;

  const firstT = track[0].tAbs;
  const lastT = track[track.length - 1].tAbs;
  // Do not extrapolate beyond +/- 1.5 intervals
  if (absGpsSec < firstT - sp3.intervalSec * 1.5 || absGpsSec > lastT + sp3.intervalSec * 1.5) {
    return null;
  }

  // Binary search closest index
  let lo = 0;
  let hi = track.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (track[mid].tAbs < absGpsSec) lo = mid + 1;
    else hi = mid;
  }

  const ORDER = Math.min(10, track.length);
  const half = Math.floor(ORDER / 2);
  let start = Math.max(0, lo - half);
  if (start + ORDER > track.length) {
    start = Math.max(0, track.length - ORDER);
  }
  const win = track.slice(start, start + ORDER);

  const x = lagrangeEval(win.map((p) => ({ t: p.tAbs, v: p.x })), absGpsSec);
  const y = lagrangeEval(win.map((p) => ({ t: p.tAbs, v: p.y })), absGpsSec);
  const z = lagrangeEval(win.map((p) => ({ t: p.tAbs, v: p.z })), absGpsSec);

  // Numerical velocity over +-0.5s for relativistic clock correction -2*(r.v)/c^2
  const dtVel = 0.5;
  const xp = lagrangeEval(win.map((p) => ({ t: p.tAbs, v: p.x })), absGpsSec + dtVel);
  const xm = lagrangeEval(win.map((p) => ({ t: p.tAbs, v: p.x })), absGpsSec - dtVel);
  const yp = lagrangeEval(win.map((p) => ({ t: p.tAbs, v: p.y })), absGpsSec + dtVel);
  const ym = lagrangeEval(win.map((p) => ({ t: p.tAbs, v: p.y })), absGpsSec - dtVel);
  const zp = lagrangeEval(win.map((p) => ({ t: p.tAbs, v: p.z })), absGpsSec + dtVel);
  const zm = lagrangeEval(win.map((p) => ({ t: p.tAbs, v: p.z })), absGpsSec - dtVel);

  const vx = (xp - xm) / (2 * dtVel);
  const vy = (yp - ym) / (2 * dtVel);
  const vz = (zp - zm) / (2 * dtVel);
  const relClk = (-2.0 * (x * vx + y * vy + z * vz)) / (SPEED_OF_LIGHT * SPEED_OF_LIGHT);

  // Linear clock interpolation using closest bracketing points with valid clocks
  let dts = relClk;
  const idxAfter = Math.min(track.length - 1, lo);
  const idxBefore = Math.max(0, idxAfter - 1);
  const c0 = track[idxBefore].clk;
  const c1 = track[idxAfter].clk;
  if (c0 !== null && c1 !== null) {
    const dt = track[idxAfter].tAbs - track[idxBefore].tAbs;
    const interpClk = dt > 1e-6
      ? c0 + ((absGpsSec - track[idxBefore].tAbs) / dt) * (c1 - c0)
      : c0;
    dts = interpClk + relClk;
  } else if (c0 !== null) {
    dts = c0 + relClk;
  } else if (c1 !== null) {
    dts = c1 + relClk;
  }

  return {
    prn,
    x,
    y,
    z,
    dts,
    health: 0,
    source: 'SP3',
  };
}

/**
 * Unified Satellite Position & Clock Lookup:
 * Prioritizes IGS .SP3 precise orbit interpolation; falls back to Broadcast Ephemeris (GPS/GLONASS/Galileo).
 * Returns null if no real orbit data covers the requested PRN and epoch.
 */
export function computeUnifiedSatelliteState(
  prn: string,
  absGpsSec: number,
  sp3Orbit?: Sp3OrbitData | null,
  ephemerisMap?: Record<string, BroadcastEphemeris[]>
): SatelliteOrbitSolution | null {
  if (sp3Orbit) {
    const sp3Sol = interpolateSp3Orbit(sp3Orbit, prn, absGpsSec);
    if (sp3Sol) {
      // Attach GLONASS frequency channel if broadcast nav is also loaded
      const gloEph = prn.startsWith('R') ? ephemerisMap?.[prn]?.[0] : undefined;
      if (gloEph?.gloFreqNum !== undefined) {
        sp3Sol.gloFreqNum = gloEph.gloFreqNum;
      }
      return sp3Sol;
    }
  }

  if (ephemerisMap) {
    const ephList = ephemerisMap[prn];
    const eph = findNearestEphemeris(ephList, absGpsSec);
    if (eph) {
      return computeSatellitePosition(eph, absGpsSec);
    }
  }

  return null;
}

/**
 * Applies Sagnac Effect Earth rotation correction during signal travel time tau (s)
 */
export function applySagnacCorrection(
  satX: number,
  satY: number,
  satZ: number,
  travelTimeSec: number
): { x: number; y: number; z: number } {
  const theta = OMEGA_E_DOT * travelTimeSec;
  const cosTheta = Math.cos(theta);
  const sinTheta = Math.sin(theta);

  const x = satX * cosTheta + satY * sinTheta;
  const y = -satX * sinTheta + satY * cosTheta;
  const z = satZ;

  return { x, y, z };
}

/**
 * Saastamoinen Hydrostatic + Wet Slant Tropospheric Delay Model (meters)
 * Uses standard sea-level atmosphere scaled exponentially by ellipsoidal height h.
 */
export function computeSaastamoinenTropo(hMeters: number, elRad: number): number {
  const safeEl = Math.max(0.05, elRad); // >= ~2.9 deg
  if (hMeters < -100 || hMeters > 15000) return 0;

  const temp0 = 288.15; // 15°C in K
  const humi = 0.70;
  const hgt = Math.max(0, hMeters);

  const pres = 1013.25 * Math.pow(1.0 - 2.2557e-5 * hgt, 5.2568);
  const temp = temp0 - 0.0065 * hgt + 273.16 - 273.15; // K
  const e = 6.108 * humi * Math.exp((17.15 * temp - 4684.0) / (temp - 38.45));

  const zRad = Math.PI / 2.0 - safeEl;
  const trph = (0.0022768 * pres) / (1.0 - 0.00266 * Math.cos(2 * 0.7) - 0.00028 * hgt * 1e-3);
  const trpw = 0.002277 * (1255.0 / temp + 0.05) * e;
  return (trph + trpw) / Math.cos(zRad);
}

/**
 * Klobuchar Single-Frequency Ionospheric Delay Model (meters at L1 1575.42 MHz)
 */
export function computeKlobucharIonoDelay(
  latDeg: number,
  lonDeg: number,
  azRad: number,
  elRad: number,
  absGpsSec: number,
  iono?: IonoParameters
): number {
  if (elRad <= 0.01) return 0;

  // Standard Klobuchar default broadcast coefficients if nav header lacked ION ALPHA/BETA
  const alpha = iono?.alpha || [0.1118e-7, -0.7451e-8, -0.5961e-7, 0.1192e-6];
  const beta = iono?.beta || [0.1167e6, -0.2294e6, -0.1311e6, 0.1049e7];

  const phiU = latDeg / 180.0; // semi-circles
  const lamU = lonDeg / 180.0; // semi-circles
  const E = elRad / Math.PI; // semi-circles

  const psi = 0.0137 / (E + 0.11) - 0.022;
  let phiI = phiU + psi * Math.cos(azRad);
  if (phiI > 0.416) phiI = 0.416;
  else if (phiI < -0.416) phiI = -0.416;

  const lamI = lamU + (psi * Math.sin(azRad)) / Math.cos(phiI * Math.PI);
  const phiM = phiI + 0.064 * Math.cos((lamI - 1.617) * Math.PI);

  const tow = ((absGpsSec % 604800) + 604800) % 604800;
  let t = 43200.0 * lamI + (tow % 86400);
  t = ((t % 86400) + 86400) % 86400;

  let amp = alpha[0] + phiM * (alpha[1] + phiM * (alpha[2] + phiM * alpha[3]));
  if (amp < 0) amp = 0;
  let per = beta[0] + phiM * (beta[1] + phiM * (beta[2] + phiM * beta[3]));
  if (per < 72000.0) per = 72000.0;

  const x = (2.0 * Math.PI * (t - 50400.0)) / per;
  const f = 1.0 + 16.0 * Math.pow(0.53 - E, 3);

  const delaySec = Math.abs(x) < 1.57
    ? f * (5e-9 + amp * (1.0 - (x * x) / 2.0 + (x * x * x * x) / 24.0))
    : f * 5e-9;

  return SPEED_OF_LIGHT * delaySec;
}
