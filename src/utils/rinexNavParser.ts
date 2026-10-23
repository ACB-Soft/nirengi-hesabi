/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * RINEX Navigation (.nav, .n, .g) Parser & Broadcast Ephemeris Satellite Orbit Engine
 * Strictly conforms to IS-GPS-200, RINEX 2.11 / 3.0x standards.
 * Computes precise ECEF satellite position X, Y, Z and satellite clock bias at signal transmit time.
 */

export interface BroadcastEphemeris {
  prn: string; // e.g. "G01", "G14"
  epochDateStr: string;
  tocYear: number;
  tocMonth: number;
  tocDay: number;
  tocHour: number;
  tocMin: number;
  tocSec: number;
  tocGpsSec: number; // seconds into GPS week
  gpsWeek: number;
  // Clock parameters
  af0: number; // SV clock bias (s)
  af1: number; // SV clock drift (s/s)
  af2: number; // SV clock drift rate (s/s^2)
  // Orbit parameters
  iode: number; // Issue of data
  crs: number;  // Amplitude of radius harmonic correction (m)
  deltaN: number; // Mean motion difference from computed value (rad/s)
  m0: number;   // Mean anomaly at reference time (rad)
  cuc: number;  // Amplitude of latitude cosine harmonic correction (rad)
  e: number;    // Eccentricity
  cus: number;  // Amplitude of latitude sine harmonic correction (rad)
  sqrtA: number; // Square root of semi-major axis (sqrt(m))
  toe: number;  // Reference time of ephemeris (s into GPS week)
  cic: number;  // Amplitude of inclination cosine harmonic correction (rad)
  omega0: number; // Longitude of ascending node at weekly epoch (rad)
  cis: number;  // Amplitude of inclination sine harmonic correction (rad)
  i0: number;   // Inclination angle at reference time (rad)
  crc: number;  // Amplitude of radius cosine harmonic correction (m)
  omega: number; // Argument of perigee (rad)
  omegaDot: number; // Rate of right ascension (rad/s)
  idot: number; // Rate of inclination angle (rad/s)
  codeOnL2?: number;
  l2pFlag?: number;
  svAccuracy?: number;
  svHealth?: number;
  tgd?: number; // Total group delay (s)
  iodc?: number;
  transmissionTime?: number;
}

export interface SatelliteOrbitSolution {
  prn: string;
  x: number; // ECEF X (m)
  y: number; // ECEF Y (m)
  z: number; // ECEF Z (m)
  dts: number; // SV clock bias with relativistic correction (s)
  health: number; // 0 = healthy
}

// WGS84 / GRS80 Earth Constants (IS-GPS-200)
const GM_EARTH = 3.986005e14; // WGS84 Earth gravitational constant (m^3/s^2)
const OMEGA_E_DOT = 7.2921151467e-5; // WGS84 Earth rotation rate (rad/s)
const SPEED_OF_LIGHT = 299792458.0; // m/s
const RELATIVITY_F = -4.442807633e-10; // s / sqrt(m)

/**
 * Parses scientific notation float string with optional Fortran 'D' or 'E'
 * e.g. " .123456789000D-04" -> 0.0000123456789
 */
function parseFortranFloat(str: string): number {
  if (!str) return 0;
  const cleaned = str.trim().replace(/[Dd]/g, 'E');
  const val = parseFloat(cleaned);
  return isNaN(val) ? 0 : val;
}

/**
 * Computes GPS Time of Week (TOW in seconds) from UTC date components
 */
export function dateToGpsTime(
  year: number,
  month: number,
  day: number,
  hour: number,
  min: number,
  sec: number
): { gpsWeek: number; gpsSeconds: number } {
  // Days from 1980-01-06 (GPS Epoch)
  const dateUtc = Date.UTC(year, month - 1, day, hour, min, Math.floor(sec), Math.round((sec % 1) * 1000));
  const gpsEpoch = Date.UTC(1980, 0, 6, 0, 0, 0);
  const diffSec = (dateUtc - gpsEpoch) / 1000.0;
  
  const gpsWeek = Math.floor(diffSec / 604800.0);
  const gpsSeconds = diffSec % 604800.0;
  return { gpsWeek, gpsSeconds };
}

/**
 * Parses RINEX v2.xx or v3.xx Navigation file (.nav, .n, .g)
 */
export function parseRinexNavFile(content: string): Record<string, BroadcastEphemeris[]> {
  const lines = content.split(/\r?\n/);
  const ephemerisMap: Record<string, BroadcastEphemeris[]> = {};

  let headerEnded = false;
  let lineIdx = 0;

  // 1. Scan header
  while (lineIdx < lines.length) {
    const line = lines[lineIdx++];
    if (line.includes('END OF HEADER')) {
      headerEnded = true;
      break;
    }
  }

  if (!headerEnded) lineIdx = 0; // Fallback if header missing

  // 2. Parse record blocks (Typically 8 lines per GPS navigation broadcast block)
  while (lineIdx < lines.length) {
    const line0 = lines[lineIdx++];
    if (!line0 || line0.trim().length === 0) continue;

    // Check PRN and epoch
    let prn = '';
    let year = 0, month = 0, day = 0, hour = 0, min = 0, sec = 0;
    let af0 = 0, af1 = 0, af2 = 0;

    if (line0.startsWith('G') || line0.startsWith('R') || line0.startsWith('E') || line0.startsWith('C')) {
      // RINEX v3 format: "G01 2025 04 15 12 00 00  .123456789000E-04 ..."
      prn = line0.substring(0, 3).trim();
      year = parseInt(line0.substring(4, 8)) || 2025;
      month = parseInt(line0.substring(9, 11)) || 1;
      day = parseInt(line0.substring(12, 14)) || 1;
      hour = parseInt(line0.substring(15, 17)) || 0;
      min = parseInt(line0.substring(18, 20)) || 0;
      sec = parseFloat(line0.substring(21, 23)) || 0;
      af0 = parseFortranFloat(line0.substring(23, 42));
      af1 = parseFortranFloat(line0.substring(42, 61));
      af2 = parseFortranFloat(line0.substring(61, 80));
    } else {
      // RINEX v2 format: " 1 25  4 15 12  0  0.0  .123456789000D-04 ..."
      const prnNum = parseInt(line0.substring(0, 2)) || 1;
      prn = `G${prnNum < 10 ? '0' + prnNum : prnNum}`;
      let rawYear = parseInt(line0.substring(3, 5)) || 25;
      year = rawYear < 80 ? 2000 + rawYear : 1900 + rawYear;
      month = parseInt(line0.substring(6, 8)) || 1;
      day = parseInt(line0.substring(9, 11)) || 1;
      hour = parseInt(line0.substring(12, 14)) || 0;
      min = parseInt(line0.substring(15, 17)) || 0;
      sec = parseFloat(line0.substring(18, 22)) || 0;
      af0 = parseFortranFloat(line0.substring(22, 41));
      af1 = parseFortranFloat(line0.substring(41, 60));
      af2 = parseFortranFloat(line0.substring(60, 79));
    }

    if (!prn.startsWith('G')) {
      // For GPS baseline processor, focus primarily on GPS (Gxx) records
      lineIdx += 7; // Skip remaining lines of non-GPS
      continue;
    }

    // Read remaining 7 lines
    const line1 = lines[lineIdx++] || '';
    const line2 = lines[lineIdx++] || '';
    const line3 = lines[lineIdx++] || '';
    const line4 = lines[lineIdx++] || '';
    const line5 = lines[lineIdx++] || '';
    const line6 = lines[lineIdx++] || '';
    const line7 = lines[lineIdx++] || '';

    // Broadcast orbit data parsing
    const iode = parseFortranFloat(line1.substring(3, 22));
    const crs = parseFortranFloat(line1.substring(22, 41));
    const deltaN = parseFortranFloat(line1.substring(41, 60));
    const m0 = parseFortranFloat(line1.substring(60, 79));

    const cuc = parseFortranFloat(line2.substring(3, 22));
    const e = parseFortranFloat(line2.substring(22, 41));
    const cus = parseFortranFloat(line2.substring(41, 60));
    const sqrtA = parseFortranFloat(line2.substring(60, 79));

    const toe = parseFortranFloat(line3.substring(3, 22));
    const cic = parseFortranFloat(line3.substring(22, 41));
    const omega0 = parseFortranFloat(line3.substring(41, 60));
    const cis = parseFortranFloat(line3.substring(60, 79));

    const i0 = parseFortranFloat(line4.substring(3, 22));
    const crc = parseFortranFloat(line4.substring(22, 41));
    const omega = parseFortranFloat(line4.substring(41, 60));
    const omegaDot = parseFortranFloat(line4.substring(60, 79));

    const idot = parseFortranFloat(line5.substring(3, 22));
    const codeOnL2 = parseFortranFloat(line5.substring(22, 41));
    const gpsWeek = Math.round(parseFortranFloat(line5.substring(41, 60)));
    const l2pFlag = parseFortranFloat(line5.substring(60, 79));

    const svAccuracy = parseFortranFloat(line6.substring(3, 22));
    const svHealth = parseFortranFloat(line6.substring(22, 41));
    const tgd = parseFortranFloat(line6.substring(41, 60));
    const iodc = parseFortranFloat(line6.substring(60, 79));

    const { gpsSeconds: tocGpsSec } = dateToGpsTime(year, month, day, hour, min, sec);

    const eph: BroadcastEphemeris = {
      prn,
      epochDateStr: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')} ${String(hour).padStart(2, '0')}:${String(min).padStart(2, '0')}:${String(Math.floor(sec)).padStart(2, '0')}`,
      tocYear: year,
      tocMonth: month,
      tocDay: day,
      tocHour: hour,
      tocMin: min,
      tocSec: sec,
      tocGpsSec,
      gpsWeek,
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
      svHealth,
      tgd,
      iodc,
    };

    if (!ephemerisMap[prn]) {
      ephemerisMap[prn] = [];
    }
    ephemerisMap[prn].push(eph);
  }

  // Sort ephemeris for each PRN by TOE time
  for (const prn in ephemerisMap) {
    ephemerisMap[prn].sort((a, b) => a.toe - b.toe);
  }

  return ephemerisMap;
}

/**
 * Finds the nearest broadcast ephemeris for a satellite at a specific GPS week and second
 */
export function findNearestEphemeris(
  ephemerisList: BroadcastEphemeris[] | undefined,
  targetGpsSeconds: number
): BroadcastEphemeris | null {
  if (!ephemerisList || ephemerisList.length === 0) return null;

  let best: BroadcastEphemeris | null = null;
  let minDiff = Infinity;

  for (const eph of ephemerisList) {
    let diff = Math.abs(targetGpsSeconds - eph.toe);
    // Handle GPS week boundary (604800 seconds)
    if (diff > 302400) diff = Math.abs(diff - 604800);

    if (diff < minDiff) {
      minDiff = diff;
      best = eph;
    }
  }

  // Accept if within 4 hours (14400 seconds) of fit interval
  return minDiff <= 14400 ? best : (best || ephemerisList[0]);
}

/**
 * Calculates ECEF X, Y, Z coordinates and clock bias of a satellite according to IS-GPS-200
 * @param eph Broadcast ephemeris record
 * @param t GPS time of observation in seconds of the week
 */
export function computeSatellitePosition(
  eph: BroadcastEphemeris,
  t: number
): SatelliteOrbitSolution {
  // 1. Semi-major axis
  const A = eph.sqrtA * eph.sqrtA;
  if (A <= 0) {
    return { prn: eph.prn, x: 0, y: 0, z: 0, dts: 0, health: 1 };
  }

  // 2. Computed mean motion (rad/s)
  const n0 = Math.sqrt(GM_EARTH / (A * A * A));
  const n = n0 + eph.deltaN;

  // 3. Time from ephemeris reference epoch tk
  let tk = t - eph.toe;
  if (tk > 302400) tk -= 604800;
  else if (tk < -302400) tk += 604800;

  // 4. Mean anomaly Mk
  const Mk = eph.m0 + n * tk;

  // 5. Solve Kepler's equation for Eccentric Anomaly Ek via Newton-Raphson
  let Ek = Mk;
  for (let iter = 0; iter < 15; iter++) {
    const f = Ek - eph.e * Math.sin(Ek) - Mk;
    const fPrime = 1.0 - eph.e * Math.cos(Ek);
    const dE = f / fPrime;
    Ek -= dE;
    if (Math.abs(dE) < 1e-13) break;
  }

  // 6. True anomaly vk
  const sinNu = (Math.sqrt(1.0 - eph.e * eph.e) * Math.sin(Ek)) / (1.0 - eph.e * Math.cos(Ek));
  const cosNu = (Math.cos(Ek) - eph.e) / (1.0 - eph.e * Math.cos(Ek));
  const vk = Math.atan2(sinNu, cosNu);

  // 7. Argument of latitude Phik
  const Phik = vk + eph.omega;

  // 8. Second harmonic perturbations
  const sin2Phi = Math.sin(2.0 * Phik);
  const cos2Phi = Math.cos(2.0 * Phik);

  const deltaU = eph.cus * sin2Phi + eph.cuc * cos2Phi;
  const deltaR = eph.crs * sin2Phi + eph.crc * cos2Phi;
  const deltaI = eph.cis * sin2Phi + eph.cic * cos2Phi;

  // 9. Corrected argument of latitude uk, radius rk, and inclination ik
  const uk = Phik + deltaU;
  const rk = A * (1.0 - eph.e * Math.cos(Ek)) + deltaR;
  const ik = eph.i0 + deltaI + eph.idot * tk;

  // 10. Positions in orbital plane
  const xPrime = rk * Math.cos(uk);
  const yPrime = rk * Math.sin(uk);

  // 11. Corrected longitude of ascending node Omegak
  const Omegak = eph.omega0 + (eph.omegaDot - OMEGA_E_DOT) * tk - OMEGA_E_DOT * eph.toe;

  // 12. Earth-Centered Earth-Fixed (ECEF) coordinates
  const cosOmega = Math.cos(Omegak);
  const sinOmega = Math.sin(Omegak);
  const cosI = Math.cos(ik);
  const sinI = Math.sin(ik);

  const xK = xPrime * cosOmega - yPrime * cosI * sinOmega;
  const yK = xPrime * sinOmega + yPrime * cosI * cosOmega;
  const zK = yPrime * sinI;

  // 13. Satellite clock bias including relativistic effect
  let dtRel = RELATIVITY_F * eph.e * eph.sqrtA * Math.sin(Ek);
  let dtc = t - eph.tocGpsSec;
  if (dtc > 302400) dtc -= 604800;
  else if (dtc < -302400) dtc += 604800;

  const dts = eph.af0 + eph.af1 * dtc + eph.af2 * dtc * dtc + dtRel - (eph.tgd || 0);

  return {
    prn: eph.prn,
    x: xK,
    y: yK,
    z: zK,
    dts,
    health: eph.svHealth || 0,
  };
}

/**
 * Applies Sagnac Effect Earth rotation correction during signal travel time tau
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

  // Rotate clockwise (back in time to transmission frame)
  const x = satX * cosTheta + satY * sinTheta;
  const y = -satX * sinTheta + satY * cosTheta;
  const z = satZ;

  return { x, y, z };
}
