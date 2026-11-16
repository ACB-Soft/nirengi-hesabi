/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * High-Performance Offline RINEX Streaming Parser
 * Handles RINEX v2.xx, v3.xx, v4.xx observation files via bounded chunk streaming:
 * - Multi-line `# / TYPES OF OBSERV`, `SYS / # / OBS TYPES`, and `GLONASS SLOT / FRQ #`
 * - Exact RINEX 2 continuation-line satellite lists & 5-obs-per-line blocks
 * - Exact RINEX 3/4 epoch records & 16-char fixed-width numeric cells (value, LLI, SSI)
 * - Band selection & FDMA frequencies for GPS (G), GLONASS (R), Galileo (E)
 */

import {
  Station,
  StationType,
  RinexHeaderMetadata,
  RinexParsedSummary,
  RinexOccupation,
  GnssConstellation,
  SatelliteTrack,
  EpochRecord,
} from '../types/gnss';
import {
  ecefToGeodetic,
  geodeticToTM,
  calculateCorrectedAntennaHeight,
} from './geodesy';
import { dateToGpsTime } from './rinexNavParser';
import { findAntennaInCatalog } from './antennaCatalogManager';

const CHUNK_SIZE = 64 * 1024;
const STREAM_CHUNK_SIZE = 512 * 1024;
const MAX_HEADER_SCAN = 512 * 1024;
const SPEED_OF_LIGHT = 299792458.0;

export interface ParsedObsMeasurement {
  prn: string;
  system: 'G' | 'R' | 'E';
  c1?: number;
  l1?: number; // carrier phase in cycles
  s1?: number; // SNR in dB-Hz
  lli1?: number;
  c2?: number;
  l2?: number; // carrier phase in cycles
  s2?: number; // SNR in dB-Hz
  lli2?: number;
  f1Hz: number;
  f2Hz?: number;
  lambda1: number;
  lambda2?: number;
  gloSlotK?: number;
}

export interface ParsedRinexObsEpoch {
  absGpsSec: number;
  relSec: number;
  timestamp: string;
  flag: number;
  clockOffsetSec?: number;
  sats: Record<string, ParsedObsMeasurement>;
}

export interface FullRinexObservationResult {
  metadata: RinexHeaderMetadata;
  headerEndByte: number;
  epochs: ParsedRinexObsEpoch[];
}

/**
 * Reads only the header section of a RINEX file using chunked slicing
 */
export async function readRinexHeaderChunk(
  file: File
): Promise<{ headerText: string; headerEndByte: number }> {
  let offset = 0;
  let accumulated = '';
  const fileSize = file.size;
  const decoder = new TextDecoder('utf-8');

  while (offset < Math.min(fileSize, MAX_HEADER_SCAN)) {
    const chunkBlob = file.slice(offset, offset + CHUNK_SIZE);
    const buffer = await chunkBlob.arrayBuffer();
    const text = decoder.decode(buffer, { stream: true });
    accumulated += text;

    const endIdx = accumulated.indexOf('END OF HEADER');
    if (endIdx !== -1) {
      const lineEnd = accumulated.indexOf('\n', endIdx);
      const headerEnd = lineEnd !== -1 ? lineEnd + 1 : endIdx + 13;
      const headerText = accumulated.substring(0, headerEnd);
      // Use byte length of UTF-8 text up to END OF HEADER line so byte slicing starts strictly after header
      const exactBytes = new TextEncoder().encode(headerText).byteLength;
      return {
        headerText,
        headerEndByte: exactBytes,
      };
    }

    offset += CHUNK_SIZE;
  }

  return {
    headerText: accumulated,
    headerEndByte: Math.min(fileSize, MAX_HEADER_SCAN),
  };
}

/**
 * Parses RINEX Header metadata thoroughly according to IGS RINEX v2/v3/v4 standard
 */
export function parseRinexHeaderMetadata(
  headerText: string,
  fileName: string,
  fileSize: number
): RinexHeaderMetadata {
  const lines = headerText.split(/\r?\n/);
  const warnings: string[] = [];

  let rinexVersion = '2.11';
  let fileType: 'OBSERVATION' | 'NAVIGATION' | 'METEOROLOGICAL' | 'UNKNOWN' = 'OBSERVATION';
  let satelliteSystem = 'GPS';
  let markerName = '';
  let markerNumber: string | undefined;
  let observer: string | undefined;
  let agency: string | undefined;
  let receiverNumber: string | undefined;
  let receiverType: string | undefined;
  let receiverVersion: string | undefined;
  let antennaNumber: string | undefined;
  let antennaType: string | undefined;
  let antennaRadome: string | undefined;
  let approxX = 0;
  let approxY = 0;
  let approxZ = 0;
  let deltaH = 0;
  let deltaE = 0;
  let deltaN = 0;
  let firstObsTime: string | undefined;
  let lastObsTime: string | undefined;
  let intervalSec: number | undefined;
  let leapSeconds: number | undefined;
  const obsTypesBySystem: Record<string, string[]> = {};
  const glonassSlotFreq: Record<number, number> = {};
  let lastObsSys = 'G';

  const cleanName = fileName.replace(/\\/g, '/').split('/').pop() || '';
  const baseMatch = cleanName.match(/^([a-zA-Z0-9_-]{4,8})/);
  if (baseMatch && baseMatch[1]) {
    markerName = baseMatch[1].toUpperCase();
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.length < 60) continue;

    const label = line.substring(60).trim();
    const data = line.substring(0, 60);

    switch (label) {
      case 'RINEX VERSION / TYPE': {
        const ver = data.substring(0, 20).trim();
        if (ver) rinexVersion = ver;

        const typeChar = data.substring(20, 21).trim().toUpperCase();
        if (typeChar === 'O') fileType = 'OBSERVATION';
        else if (typeChar === 'N' || typeChar === 'G' || typeChar === 'H' || typeChar === 'P') fileType = 'NAVIGATION';
        else if (typeChar === 'M') fileType = 'METEOROLOGICAL';
        else fileType = 'UNKNOWN';

        const sysChar = data.substring(40, 41).trim().toUpperCase();
        if (sysChar === 'G') satelliteSystem = 'GPS';
        else if (sysChar === 'R') satelliteSystem = 'GLONASS';
        else if (sysChar === 'E') satelliteSystem = 'Galileo';
        else if (sysChar === 'C') satelliteSystem = 'BeiDou';
        else if (sysChar === 'M') satelliteSystem = 'Mixed';
        break;
      }

      case 'MARKER NAME': {
        const name = data.trim();
        if (name) markerName = name;
        break;
      }

      case 'MARKER NUMBER': {
        const num = data.trim();
        if (num) markerNumber = num;
        break;
      }

      case 'OBSERVER / AGENCY': {
        observer = data.substring(0, 20).trim();
        agency = data.substring(20, 60).trim();
        break;
      }

      case 'REC # / TYPE / VERS': {
        receiverNumber = data.substring(0, 20).trim();
        receiverType = data.substring(20, 40).trim();
        receiverVersion = data.substring(40, 60).trim();
        break;
      }

      case 'ANT # / TYPE': {
        antennaNumber = data.substring(0, 20).trim();
        const fullAnt = data.substring(20, 60).trim();
        antennaType = data.substring(20, 40).trim() || fullAnt;
        antennaRadome = data.substring(40, 60).trim();
        break;
      }

      case 'APPROX POSITION XYZ': {
        const parts = data.trim().split(/\s+/).map(Number);
        if (parts.length >= 3 && !isNaN(parts[0]) && !isNaN(parts[1]) && !isNaN(parts[2])) {
          approxX = parts[0];
          approxY = parts[1];
          approxZ = parts[2];
        }
        break;
      }

      case 'ANTENNA: DELTA H/E/N': {
        const parts = data.trim().split(/\s+/).map(Number);
        if (parts.length >= 1 && !isNaN(parts[0])) deltaH = parts[0];
        if (parts.length >= 2 && !isNaN(parts[1])) deltaE = parts[1];
        if (parts.length >= 3 && !isNaN(parts[2])) deltaN = parts[2];
        break;
      }

      case 'TIME OF FIRST OBS': {
        const parts = data.trim().split(/\s+/).map(Number);
        if (parts.length >= 3 && !isNaN(parts[0])) {
          const y = parts[0];
          const m = parts[1] || 1;
          const d = parts[2] || 1;
          const hr = parts[3] || 0;
          const min = parts[4] || 0;
          const sec = parts[5] || 0;
          firstObsTime = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')} ${String(hr).padStart(2, '0')}:${String(min).padStart(2, '0')}:${String(Math.floor(sec)).padStart(2, '0')} GPS`;
        }
        break;
      }

      case 'TIME OF LAST OBS': {
        const parts = data.trim().split(/\s+/).map(Number);
        if (parts.length >= 3 && !isNaN(parts[0])) {
          const y = parts[0];
          const m = parts[1] || 1;
          const d = parts[2] || 1;
          const hr = parts[3] || 0;
          const min = parts[4] || 0;
          const sec = parts[5] || 0;
          lastObsTime = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')} ${String(hr).padStart(2, '0')}:${String(min).padStart(2, '0')}:${String(Math.floor(sec)).padStart(2, '0')} GPS`;
        }
        break;
      }

      case 'INTERVAL': {
        const val = parseFloat(data.trim());
        if (!isNaN(val) && val > 0) intervalSec = val;
        break;
      }

      case 'LEAP SECONDS': {
        const val = parseInt(data.trim(), 10);
        if (!isNaN(val)) leapSeconds = val;
        break;
      }

      case '# / TYPES OF OBSERV': {
        // RINEX 2.xx: first 6 cols contain total count on first line, blank on continuation lines
        const rawTypes = data.substring(6).trim().split(/\s+/);
        const sysKey = 'R2';
        if (!obsTypesBySystem[sysKey]) obsTypesBySystem[sysKey] = [];
        rawTypes.forEach((t) => {
          if (t) obsTypesBySystem[sysKey].push(t);
        });
        break;
      }

      case 'SYS / # / OBS TYPES': {
        // RINEX 3.xx / 4.xx: col 0 is system letter on first line, blank on continuation line
        const sysChar = data.substring(0, 1).trim().toUpperCase();
        if (sysChar) lastObsSys = sysChar;
        const sysCode = lastObsSys || 'G';
        const rawTypes = data.substring(6).trim().split(/\s+/);
        if (!obsTypesBySystem[sysCode]) obsTypesBySystem[sysCode] = [];
        rawTypes.forEach((t) => {
          if (t) obsTypesBySystem[sysCode].push(t);
        });
        break;
      }

      case 'GLONASS SLOT / FRQ #': {
        const matches = data.matchAll(/R(\d{2})\s+(-?\d+)/g);
        for (const m of matches) {
          const slot = parseInt(m[1], 10);
          const k = parseInt(m[2], 10);
          if (!isNaN(slot) && !isNaN(k)) {
            glonassSlotFreq[slot] = k;
          }
        }
        break;
      }
    }
  }

  if (!markerName) {
    markerName = 'PNT1';
  }

  if (approxX === 0 && approxY === 0 && approxZ === 0) {
    warnings.push('Yaklaşık ECEF koordinatları (APPROX POSITION XYZ) 0.000 bulundu. SPP ile otomatik hesaplanacaktır.');
  }

  if (deltaH === 0) {
    warnings.push('Anten yüksekliği (Delta H) 0.000 m okundu. Saha ölçü defterine göre teyit ediniz.');
  }

  if (!antennaType || antennaType === 'UNKNOWN') {
    warnings.push('Anten tipi başlıkta belirtilmemiş. ANTEX faz merkezi düzeltmeleri için manuel seçim yapınız.');
  }

  return {
    fileName,
    fileSizeBytes: fileSize,
    rinexVersion,
    fileType,
    satelliteSystem,
    markerName,
    markerNumber,
    observer,
    agency,
    receiverNumber,
    receiverType,
    receiverVersion,
    antennaNumber,
    antennaType,
    antennaRadome,
    approxX,
    approxY,
    approxZ,
    deltaH,
    deltaE,
    deltaN,
    firstObsTime,
    lastObsTime,
    intervalSec,
    leapSeconds,
    obsTypesBySystem,
    glonassSlotFreq: Object.keys(glonassSlotFreq).length > 0 ? glonassSlotFreq : undefined,
    warnings,
  };
}

function normalizeSatId(raw: string): { satId: string; sys: 'G' | 'R' | 'E' | 'C' | 'J' | 'S'; prn: number; constellation: GnssConstellation } | null {
  const cleaned = raw.trim().toUpperCase();
  if (!cleaned) return null;
  let sysChar = cleaned.charAt(0);
  let numStr = cleaned.substring(1);
  if (/^\d+$/.test(cleaned)) {
    sysChar = 'G';
    numStr = cleaned;
  }
  const prn = parseInt(numStr, 10);
  if (isNaN(prn) || prn <= 0) return null;
  const satId = `${sysChar}${String(prn).padStart(2, '0')}`;

  let constellation: GnssConstellation = 'GPS';
  if (sysChar === 'R') constellation = 'GLONASS';
  else if (sysChar === 'E') constellation = 'Galileo';
  else if (sysChar === 'C') constellation = 'BeiDou';
  else if (sysChar === 'J') constellation = 'QZSS';
  else if (sysChar === 'S') constellation = 'SBAS';
  else if (sysChar !== 'G') return null;

  return {
    satId,
    sys: sysChar as 'G' | 'R' | 'E' | 'C' | 'J' | 'S',
    prn,
    constellation,
  };
}

interface RawObsCell {
  val: number;
  lli: number;
  ssi: number;
}

function pickFirstCell(cells: Record<string, RawObsCell>, candidates: string[]): RawObsCell | undefined {
  for (const code of candidates) {
    if (cells[code] !== undefined) return cells[code];
  }
  return undefined;
}

function buildMeasurementFromCells(
  prn: string,
  sys: 'G' | 'R' | 'E',
  prnNum: number,
  cells: Record<string, RawObsCell>,
  glonassSlotFreq?: Record<number, number>
): ParsedObsMeasurement | null {
  let c1Cell: RawObsCell | undefined;
  let l1Cell: RawObsCell | undefined;
  let s1Cell: RawObsCell | undefined;
  let c2Cell: RawObsCell | undefined;
  let l2Cell: RawObsCell | undefined;
  let s2Cell: RawObsCell | undefined;
  let f1Hz = 1575.42e6;
  let f2Hz: number | undefined;
  let gloSlotK: number | undefined;

  if (sys === 'G') {
    c1Cell = pickFirstCell(cells, ['C1C', 'C1W', 'C1P', 'C1X', 'C1S', 'C1L', 'C1', 'P1']);
    l1Cell = pickFirstCell(cells, ['L1C', 'L1W', 'L1P', 'L1X', 'L1S', 'L1L', 'L1']);
    s1Cell = pickFirstCell(cells, ['S1C', 'S1W', 'S1P', 'S1X', 'S1S', 'S1L', 'S1']);

    c2Cell = pickFirstCell(cells, ['C2W', 'C2S', 'C2L', 'C2X', 'C2P', 'C2C', 'P2', 'C2']);
    l2Cell = pickFirstCell(cells, ['L2W', 'L2S', 'L2L', 'L2X', 'L2P', 'L2C', 'L2']);
    s2Cell = pickFirstCell(cells, ['S2W', 'S2S', 'S2L', 'S2X', 'S2P', 'S2C', 'S2']);
    if (c2Cell || l2Cell) {
      f2Hz = 1227.60e6;
    } else {
      c2Cell = pickFirstCell(cells, ['C5Q', 'C5X', 'C5I', 'C5']);
      l2Cell = pickFirstCell(cells, ['L5Q', 'L5X', 'L5I', 'L5']);
      s2Cell = pickFirstCell(cells, ['S5Q', 'S5X', 'S5I', 'S5']);
      if (c2Cell || l2Cell) f2Hz = 1176.45e6;
    }
  } else if (sys === 'R') {
    gloSlotK = glonassSlotFreq?.[prnNum];
    const kEff = gloSlotK ?? 0;
    f1Hz = (1602.0 + kEff * 0.5625) * 1e6;

    c1Cell = pickFirstCell(cells, ['C1C', 'C1P', 'C1', 'P1']);
    l1Cell = pickFirstCell(cells, ['L1C', 'L1P', 'L1']);
    s1Cell = pickFirstCell(cells, ['S1C', 'S1P', 'S1']);

    c2Cell = pickFirstCell(cells, ['C2C', 'C2P', 'P2', 'C2']);
    l2Cell = pickFirstCell(cells, ['L2C', 'L2P', 'L2']);
    s2Cell = pickFirstCell(cells, ['S2C', 'S2P', 'S2']);
    if (c2Cell || l2Cell) {
      f2Hz = (1246.0 + kEff * 0.4375) * 1e6;
    }
  } else if (sys === 'E') {
    f1Hz = 1575.42e6;
    c1Cell = pickFirstCell(cells, ['C1C', 'C1X', 'C1B', 'C1']);
    l1Cell = pickFirstCell(cells, ['L1C', 'L1X', 'L1B', 'L1']);
    s1Cell = pickFirstCell(cells, ['S1C', 'S1X', 'S1B', 'S1']);

    // Check E5a first (matches Galileo BGD E1/E5a broadcast & standard ionosphere-free), then E5b, then E5ab
    const c5 = pickFirstCell(cells, ['C5Q', 'C5X', 'C5I', 'C5']);
    const l5 = pickFirstCell(cells, ['L5Q', 'L5X', 'L5I', 'L5']);
    const s5 = pickFirstCell(cells, ['S5Q', 'S5X', 'S5I', 'S5']);
    if (c5 || l5) {
      c2Cell = c5;
      l2Cell = l5;
      s2Cell = s5;
      f2Hz = 1176.45e6;
    } else {
      const c7 = pickFirstCell(cells, ['C7Q', 'C7X', 'C7I', 'C7']);
      const l7 = pickFirstCell(cells, ['L7Q', 'L7X', 'L7I', 'L7']);
      const s7 = pickFirstCell(cells, ['S7Q', 'S7X', 'S7I', 'S7']);
      if (c7 || l7) {
        c2Cell = c7;
        l2Cell = l7;
        s2Cell = s7;
        f2Hz = 1207.14e6;
      } else {
        const c8 = pickFirstCell(cells, ['C8Q', 'C8X', 'C8I', 'C8']);
        const l8 = pickFirstCell(cells, ['L8Q', 'L8X', 'L8I', 'L8']);
        const s8 = pickFirstCell(cells, ['S8Q', 'S8X', 'S8I', 'S8']);
        if (c8 || l8) {
          c2Cell = c8;
          l2Cell = l8;
          s2Cell = s8;
          f2Hz = 1191.795e6;
        }
      }
    }
  }

  if (!c1Cell && !l1Cell && !c2Cell && !l2Cell) {
    return null;
  }

  const s1Val = s1Cell ? s1Cell.val : (l1Cell && l1Cell.ssi > 0 ? l1Cell.ssi * 6 : undefined);
  const s2Val = s2Cell ? s2Cell.val : (l2Cell && l2Cell.ssi > 0 ? l2Cell.ssi * 6 : undefined);

  return {
    prn,
    system: sys,
    c1: c1Cell?.val,
    l1: l1Cell?.val,
    s1: s1Val,
    lli1: l1Cell?.lli,
    c2: c2Cell?.val,
    l2: l2Cell?.val,
    s2: s2Val,
    lli2: l2Cell?.lli,
    f1Hz,
    f2Hz,
    lambda1: SPEED_OF_LIGHT / f1Hz,
    lambda2: f2Hz ? SPEED_OF_LIGHT / f2Hz : undefined,
    gloSlotK,
  };
}

/**
 * Streams a RINEX observation File line-by-line from headerEndByte without holding the entire text in memory
 */
async function streamFileLines(
  file: File,
  startByte: number,
  onLine: (line: string) => boolean | void
): Promise<void> {
  const decoder = new TextDecoder('utf-8');
  let offset = startByte;
  let carry = '';
  let stopped = false;

  while (offset < file.size && !stopped) {
    const end = Math.min(file.size, offset + STREAM_CHUNK_SIZE);
    const buf = await file.slice(offset, end).arrayBuffer();
    const isLast = end >= file.size;
    const text = carry + decoder.decode(buf, { stream: !isLast });
    const lines = text.split(/\r?\n/);
    carry = isLast ? '' : (lines.pop() || '');

    for (let i = 0; i < lines.length; i++) {
      if (onLine(lines[i]) === false) {
        stopped = true;
        break;
      }
    }
    offset = end;
  }

  if (!stopped && carry.length > 0) {
    onLine(carry);
  }
}

/**
 * Parses actual numeric RINEX v2/v3/v4 observation epochs (pseudoranges, carrier phases, LLI, SNR)
 * using streaming chunk reads. Supports optional sampling interval & maxEpochs cap for huge 1Hz files.
 */
export async function parseFullRinexObservations(
  file: File,
  options?: {
    maxEpochs?: number;
    minIntervalSec?: number;
  }
): Promise<FullRinexObservationResult> {
  const { headerText, headerEndByte } = await readRinexHeaderChunk(file);
  const metadata = parseRinexHeaderMetadata(headerText, file.name, file.size);
  const isRinex3 = metadata.rinexVersion.startsWith('3') || metadata.rinexVersion.startsWith('4');
  const maxEpochs = options?.maxEpochs ?? 2500;
  const minIntervalSec = options?.minIntervalSec ?? 0;

  const epochs: ParsedRinexObsEpoch[] = [];
  let firstTAbs: number | null = null;
  let lastKeptTAbs = -Infinity;

  // Parser state machine for line-by-line streaming
  let currentEpoch: {
    absGpsSec: number;
    timestamp: string;
    flag: number;
    clockOffsetSec?: number;
    nsats: number;
    satQueue: string[];
    satIdx: number;
    r2LinesPerSat: number;
    r2LineBuf: string[];
    r2NeedHeaderSats: number;
    sats: Record<string, ParsedObsMeasurement>;
    keepThisEpoch: boolean;
    skipLinesRemaining: number;
  } | null = null;

  const r2ObsTypes = metadata.obsTypesBySystem['R2'] || metadata.obsTypesBySystem['GPS'] || [];
  const r2LinesPerSat = Math.max(1, Math.ceil(r2ObsTypes.length / 5));

  const flushEpoch = () => {
    if (!currentEpoch) return;
    if (currentEpoch.keepThisEpoch && Object.keys(currentEpoch.sats).length > 0) {
      if (firstTAbs === null) firstTAbs = currentEpoch.absGpsSec;
      epochs.push({
        absGpsSec: currentEpoch.absGpsSec,
        relSec: Math.max(0, currentEpoch.absGpsSec - firstTAbs),
        timestamp: currentEpoch.timestamp,
        flag: currentEpoch.flag,
        clockOffsetSec: currentEpoch.clockOffsetSec,
        sats: currentEpoch.sats,
      });
    }
    currentEpoch = null;
  };

  await streamFileLines(file, headerEndByte, (line) => {
    if (epochs.length >= maxEpochs) return false;
    if (!line || !line.trim()) return;

    if (isRinex3) {
      if (line.startsWith('>')) {
        flushEpoch();
        if (epochs.length >= maxEpochs) return false;

        const m = line.match(/^>\s*(\d{4})\s+(\d{1,2})\s+(\d{1,2})\s+(\d{1,2})\s+(\d{1,2})\s+([\d.]+)\s+(\d+)\s+(\d+)/);
        if (!m) return;
        const yr = parseInt(m[1], 10);
        const mo = parseInt(m[2], 10);
        const da = parseInt(m[3], 10);
        const hr = parseInt(m[4], 10);
        const mi = parseInt(m[5], 10);
        const se = parseFloat(m[6]);
        const flag = parseInt(m[7], 10);
        const nsats = parseInt(m[8], 10);

        if (flag > 1) {
          // Special event / comment block in RINEX 3 -> skip nsats lines
          currentEpoch = {
            absGpsSec: 0,
            timestamp: '',
            flag,
            nsats,
            satQueue: [],
            satIdx: 0,
            r2LinesPerSat: 0,
            r2LineBuf: [],
            r2NeedHeaderSats: 0,
            sats: {},
            keepThisEpoch: false,
            skipLinesRemaining: nsats,
          };
          return;
        }

        const gt = dateToGpsTime(yr, mo, da, hr, mi, se);
        const keepThisEpoch = minIntervalSec <= 0 || gt.absGpsSec - lastKeptTAbs >= minIntervalSec - 1e-3;
        if (keepThisEpoch) lastKeptTAbs = gt.absGpsSec;

        const clkStr = line.length > 41 ? line.substring(41).trim() : '';
        const clockOffsetSec = clkStr ? parseFloat(clkStr) : undefined;

        currentEpoch = {
          absGpsSec: gt.absGpsSec,
          timestamp: `${yr}-${String(mo).padStart(2, '0')}-${String(da).padStart(2, '0')} ${String(hr).padStart(2, '0')}:${String(mi).padStart(2, '0')}:${String(Math.floor(se)).padStart(2, '0')}`,
          flag,
          clockOffsetSec: clockOffsetSec !== undefined && !isNaN(clockOffsetSec) ? clockOffsetSec : undefined,
          nsats,
          satQueue: [],
          satIdx: 0,
          r2LinesPerSat: 0,
          r2LineBuf: [],
          r2NeedHeaderSats: 0,
          sats: {},
          keepThisEpoch,
          skipLinesRemaining: 0,
        };
        return;
      }

      if (currentEpoch) {
        if (currentEpoch.skipLinesRemaining > 0) {
          currentEpoch.skipLinesRemaining--;
          return;
        }
        if (!currentEpoch.keepThisEpoch) return;

        const satInfo = normalizeSatId(line.substring(0, 3));
        if (!satInfo) return;
        if (satInfo.sys !== 'G' && satInfo.sys !== 'R' && satInfo.sys !== 'E') return;

        const obsTypes = metadata.obsTypesBySystem[satInfo.sys] || [];
        if (obsTypes.length === 0) return;

        const cells: Record<string, RawObsCell> = {};
        for (let j = 0; j < obsTypes.length; j++) {
          const col = 3 + j * 16;
          if (col >= line.length) break;
          const valStr = line.substring(col, col + 14).trim();
          if (!valStr) continue;
          const val = parseFloat(valStr);
          if (isNaN(val)) continue;
          const lliCh = line.length > col + 14 ? line.substring(col + 14, col + 15).trim() : '';
          const ssiCh = line.length > col + 15 ? line.substring(col + 15, col + 16).trim() : '';
          cells[obsTypes[j]] = {
            val,
            lli: lliCh ? (parseInt(lliCh, 10) || 0) : 0,
            ssi: ssiCh ? (parseInt(ssiCh, 10) || 0) : 0,
          };
        }

        const meas = buildMeasurementFromCells(
          satInfo.satId,
          satInfo.sys,
          satInfo.prn,
          cells,
          metadata.glonassSlotFreq
        );
        if (meas) {
          currentEpoch.sats[satInfo.satId] = meas;
        }
      }
    } else {
      // RINEX 2.xx parsing
      if (currentEpoch && currentEpoch.skipLinesRemaining > 0) {
        currentEpoch.skipLinesRemaining--;
        return;
      }

      // Check for RINEX 2 continuation of satellite list on epoch header
      if (currentEpoch && currentEpoch.r2NeedHeaderSats > 0) {
        const satSlice = line.substring(32, 68);
        for (let pos = 0; pos < satSlice.length && currentEpoch.r2NeedHeaderSats > 0; pos += 3) {
          const tok = satSlice.substring(pos, pos + 3).trim();
          if (tok) {
            currentEpoch.satQueue.push(tok);
            currentEpoch.r2NeedHeaderSats--;
          }
        }
        return;
      }

      // Detect new RINEX 2 epoch header line: YY MM DD HH MM SS.SSSSSSS flag nsats
      const m2 = line.match(/^\s*(\d{2})\s+(\d{1,2})\s+(\d{1,2})\s+(\d{1,2})\s+(\d{1,2})\s+([\d.]+)\s+(\d)\s+(\d{1,3})/);
      if (m2) {
        flushEpoch();
        if (epochs.length >= maxEpochs) return false;

        const yr2 = parseInt(m2[1], 10);
        const yr = yr2 >= 80 ? 1900 + yr2 : 2000 + yr2;
        const mo = parseInt(m2[2], 10);
        const da = parseInt(m2[3], 10);
        const hr = parseInt(m2[4], 10);
        const mi = parseInt(m2[5], 10);
        const se = parseFloat(m2[6]);
        const flag = parseInt(m2[7], 10);
        const nsats = parseInt(m2[8], 10);

        if (flag > 1) {
          currentEpoch = {
            absGpsSec: 0,
            timestamp: '',
            flag,
            nsats,
            satQueue: [],
            satIdx: 0,
            r2LinesPerSat: 0,
            r2LineBuf: [],
            r2NeedHeaderSats: 0,
            sats: {},
            keepThisEpoch: false,
            skipLinesRemaining: nsats,
          };
          return;
        }

        const gt = dateToGpsTime(yr, mo, da, hr, mi, se);
        const keepThisEpoch = minIntervalSec <= 0 || gt.absGpsSec - lastKeptTAbs >= minIntervalSec - 1e-3;
        if (keepThisEpoch) lastKeptTAbs = gt.absGpsSec;

        const satQueue: string[] = [];
        const satSlice = line.substring(32, 68);
        for (let pos = 0; pos < satSlice.length && satQueue.length < nsats; pos += 3) {
          const tok = satSlice.substring(pos, pos + 3).trim();
          if (tok) satQueue.push(tok);
        }

        const clkStr = line.length > 68 ? line.substring(68).trim() : '';
        const clockOffsetSec = clkStr ? parseFloat(clkStr) : undefined;

        currentEpoch = {
          absGpsSec: gt.absGpsSec,
          timestamp: `${yr}-${String(mo).padStart(2, '0')}-${String(da).padStart(2, '0')} ${String(hr).padStart(2, '0')}:${String(mi).padStart(2, '0')}:${String(Math.floor(se)).padStart(2, '0')}`,
          flag,
          clockOffsetSec: clockOffsetSec !== undefined && !isNaN(clockOffsetSec) ? clockOffsetSec : undefined,
          nsats,
          satQueue,
          satIdx: 0,
          r2LinesPerSat,
          r2LineBuf: [],
          r2NeedHeaderSats: Math.max(0, nsats - satQueue.length),
          sats: {},
          keepThisEpoch,
          skipLinesRemaining: keepThisEpoch ? 0 : nsats * r2LinesPerSat,
        };
        return;
      }

      if (currentEpoch && currentEpoch.keepThisEpoch && currentEpoch.satIdx < currentEpoch.satQueue.length) {
        currentEpoch.r2LineBuf.push(line);
        if (currentEpoch.r2LineBuf.length >= currentEpoch.r2LinesPerSat) {
          const satRaw = currentEpoch.satQueue[currentEpoch.satIdx++];
          const satLines = currentEpoch.r2LineBuf;
          currentEpoch.r2LineBuf = [];

          const satInfo = normalizeSatId(satRaw);
          if (satInfo && (satInfo.sys === 'G' || satInfo.sys === 'R' || satInfo.sys === 'E') && r2ObsTypes.length > 0) {
            const cells: Record<string, RawObsCell> = {};
            for (let j = 0; j < r2ObsTypes.length; j++) {
              const lineNo = Math.floor(j / 5);
              const colInLine = (j % 5) * 16;
              const targetLine = satLines[lineNo] || '';
              if (colInLine >= targetLine.length) continue;
              const valStr = targetLine.substring(colInLine, colInLine + 14).trim();
              if (!valStr) continue;
              const val = parseFloat(valStr);
              if (isNaN(val)) continue;
              const lliCh = targetLine.length > colInLine + 14 ? targetLine.substring(colInLine + 14, colInLine + 15).trim() : '';
              const ssiCh = targetLine.length > colInLine + 15 ? targetLine.substring(colInLine + 15, colInLine + 16).trim() : '';
              cells[r2ObsTypes[j]] = {
                val,
                lli: lliCh ? (parseInt(lliCh, 10) || 0) : 0,
                ssi: ssiCh ? (parseInt(ssiCh, 10) || 0) : 0,
              };
            }

            const meas = buildMeasurementFromCells(
              satInfo.satId,
              satInfo.sys,
              satInfo.prn,
              cells,
              metadata.glonassSlotFreq
            );
            if (meas) {
              currentEpoch.sats[satInfo.satId] = meas;
            }
          }
        }
      }
    }
  });

  flushEpoch();

  return {
    metadata,
    headerEndByte,
    epochs,
  };
}

/**
 * Samples observation epochs from the file body to build a lightweight satellite tracking timeline
 * for the Occupation View & QC Modal using real parsed epochs and real SNR/multipath metrics.
 */
export async function sampleRinexObservations(
  file: File,
  _headerEndByte: number,
  metadata: RinexHeaderMetadata
): Promise<Partial<RinexOccupation>> {
  const fullObs = await parseFullRinexObservations(file, {
    maxEpochs: 1200,
    minIntervalSec: metadata.intervalSec && metadata.intervalSec >= 15 ? 0 : 15,
  });

  const parsedEpochs = fullObs.epochs;
  if (parsedEpochs.length === 0) {
    return {
      satellites: [],
      epochRecords: [],
      totalEpochs: 0,
      firstEpochSec: 0,
      lastEpochSec: 0,
      durationSeconds: 0,
      intervalSeconds: metadata.intervalSec || 30,
      constellations: [],
      hasRealObsData: false,
    };
  }

  let inferredInterval = metadata.intervalSec || 30;
  if (parsedEpochs.length >= 2) {
    const dt = parsedEpochs[1].absGpsSec - parsedEpochs[0].absGpsSec;
    if (dt > 0 && dt <= 300) inferredInterval = dt;
  }

  const firstAbs = parsedEpochs[0].absGpsSec;
  const lastAbs = parsedEpochs[parsedEpochs.length - 1].absGpsSec;
  const durationSeconds = Math.max(0, lastAbs - firstAbs);

  const satTracker = new Map<string, {
    system: GnssConstellation;
    prn: number;
    epochs: number[];
    snrs: number[];
    slips: number;
    mp1Vals: number[];
    mp2Vals: number[];
    prevGf?: number;
    freqs: Set<string>;
  }>();

  const foundConstellations = new Set<GnssConstellation>();
  const epochRecords: EpochRecord[] = [];

  for (let idx = 0; idx < parsedEpochs.length; idx++) {
    const ep = parsedEpochs[idx];
    const relSec = ep.relSec;
    const satIds = Object.keys(ep.sats);

    epochRecords.push({
      epochIndex: idx,
      timeSec: relSec,
      timestamp: ep.timestamp,
      satellites: satIds,
      nsats: satIds.length,
    });

    for (const satId of satIds) {
      const m = ep.sats[satId];
      const sysName: GnssConstellation = m.system === 'R' ? 'GLONASS' : m.system === 'E' ? 'Galileo' : 'GPS';
      foundConstellations.add(sysName);

      if (!satTracker.has(satId)) {
        satTracker.set(satId, {
          system: sysName,
          prn: parseInt(satId.substring(1), 10) || 1,
          epochs: [],
          snrs: [],
          slips: 0,
          mp1Vals: [],
          mp2Vals: [],
          freqs: new Set<string>(),
        });
      }

      const st = satTracker.get(satId)!;
      st.epochs.push(relSec);
      if (m.s1 !== undefined && m.s1 > 0) st.snrs.push(m.s1);
      if (m.l1 !== undefined) st.freqs.add(m.system === 'E' ? 'E1' : 'L1');
      if (m.l2 !== undefined) st.freqs.add(m.system === 'E' ? 'E5' : 'L2');

      if ((m.lli1 && (m.lli1 & 3) !== 0) || (m.lli2 && (m.lli2 & 3) !== 0)) {
        st.slips++;
      }

      // TEQC Geometry-Free / Code-Carrier Multipath MP1 & MP2
      if (
        m.c1 !== undefined && m.l1 !== undefined && m.l2 !== undefined &&
        m.lambda1 && m.lambda2 && m.f2Hz
      ) {
        const phi1M = m.l1 * m.lambda1;
        const phi2M = m.l2 * m.lambda2;
        const alpha = (m.f1Hz * m.f1Hz) / (m.f2Hz * m.f2Hz);
        const mp1Raw = m.c1 - (1 + 2 / (alpha - 1)) * phi1M + (2 / (alpha - 1)) * phi2M;
        st.mp1Vals.push(mp1Raw);

        if (m.c2 !== undefined) {
          const mp2Raw = m.c2 - ((2 * alpha) / (alpha - 1)) * phi1M + ((2 * alpha) / (alpha - 1) - 1) * phi2M;
          st.mp2Vals.push(mp2Raw);
        }

        const gf = phi1M - phi2M;
        if (st.prevGf !== undefined && Math.abs(gf - st.prevGf) > 0.08) {
          st.slips++;
        }
        st.prevGf = gf;
      }
    }
  }

  const computeDetrendedRms = (vals: number[]): number | undefined => {
    if (vals.length < 3) return undefined;
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
    const sq = vals.reduce((a, v) => a + (v - mean) * (v - mean), 0) / (vals.length - 1);
    return Math.round(Math.sqrt(sq) * 1000) / 1000;
  };

  const satellites: SatelliteTrack[] = [];
  satTracker.forEach((val, satId) => {
    const startSec = val.epochs[0] ?? 0;
    const endSec = val.epochs[val.epochs.length - 1] ?? startSec;

    // Build contiguous visibility slots when gap > 2.5 * interval
    const timeSlots: Array<{ startSec: number; endSec: number; avgSnr?: number }> = [];
    let slotStart = startSec;
    let prev = startSec;
    for (let k = 1; k < val.epochs.length; k++) {
      const cur = val.epochs[k];
      if (cur - prev > inferredInterval * 2.5) {
        timeSlots.push({ startSec: slotStart, endSec: prev });
        slotStart = cur;
      }
      prev = cur;
    }
    const avgSnr = val.snrs.length > 0
      ? Math.round((val.snrs.reduce((a, b) => a + b, 0) / val.snrs.length) * 10) / 10
      : undefined;
    timeSlots.push({ startSec: slotStart, endSec: prev, avgSnr });

    satellites.push({
      satId,
      system: val.system,
      prn: val.prn,
      totalEpochs: parsedEpochs.length,
      validEpochs: val.epochs.length,
      startSec,
      endSec,
      timeSlots,
      avgSnr,
      multipathMp1: computeDetrendedRms(val.mp1Vals),
      multipathMp2: computeDetrendedRms(val.mp2Vals),
      cycleSlips: val.slips,
      freqs: val.freqs.size > 0 ? Array.from(val.freqs) : ['L1'],
    });
  });

  const systemOrder: Record<GnssConstellation, number> = {
    GPS: 1,
    GLONASS: 2,
    Galileo: 3,
    BeiDou: 4,
    QZSS: 5,
    SBAS: 6,
  };
  satellites.sort((a, b) => {
    if (systemOrder[a.system] !== systemOrder[b.system]) {
      return systemOrder[a.system] - systemOrder[b.system];
    }
    return a.prn - b.prn;
  });

  return {
    satellites,
    epochRecords: epochRecords.slice(0, 600),
    totalEpochs: parsedEpochs.length,
    firstEpochSec: firstAbs,
    lastEpochSec: lastAbs,
    firstEpochDate: parsedEpochs[0].timestamp + ' GPS',
    lastEpochDate: parsedEpochs[parsedEpochs.length - 1].timestamp + ' GPS',
    durationSeconds,
    intervalSeconds: inferredInterval,
    constellations: Array.from(foundConstellations),
    glonassSlotFreq: metadata.glonassSlotFreq,
    hasRealObsData: parsedEpochs.length >= 2,
  };
}

/**
 * Full Pipeline: Ingests a RINEX file, extracts metadata, parses actual epochs,
 * calculates geodetic & projection coordinates, and returns a complete summary.
 */
export async function parseRinexFile(
  file: File,
  dom = 30
): Promise<RinexParsedSummary> {
  const { headerText, headerEndByte } = await readRinexHeaderChunk(file);
  const metadata = parseRinexHeaderMetadata(headerText, file.name, file.size);

  let lat = 0;
  let lon = 0;
  let h = 0;
  let projY = 500000;
  let projX = 0;

  if (metadata.approxX !== 0 || metadata.approxY !== 0 || metadata.approxZ !== 0) {
    const geo = ecefToGeodetic(metadata.approxX, metadata.approxY, metadata.approxZ);
    lat = geo.lat;
    lon = geo.lon;
    h = geo.h;

    const tm = geodeticToTM(lat, lon, dom);
    projY = tm.projY;
    projX = tm.projX;
  }

  const isCorsCandidate = metadata.markerName.length <= 4 && !/rover|gezici|pnt/i.test(metadata.markerName);
  const detectedPointType: StationType = isCorsCandidate ? 'CORS' : 'GROUND';

  const sampledOccupation = await sampleRinexObservations(file, headerEndByte, metadata);

  const fullOccupation: RinexOccupation = {
    stationId: metadata.markerName,
    stationName: metadata.markerName,
    fileName: metadata.fileName,
    rinexVersion: metadata.rinexVersion,
    receiverType: metadata.receiverType,
    antennaType: metadata.antennaType,
    firstEpochDate: sampledOccupation.firstEpochDate || metadata.firstObsTime || '',
    lastEpochDate: sampledOccupation.lastEpochDate || metadata.lastObsTime || metadata.firstObsTime || '',
    firstEpochSec: sampledOccupation.firstEpochSec ?? 0,
    lastEpochSec: sampledOccupation.lastEpochSec ?? 0,
    durationSeconds: sampledOccupation.durationSeconds ?? 0,
    intervalSeconds: sampledOccupation.intervalSeconds ?? (metadata.intervalSec || 30),
    totalEpochs: sampledOccupation.totalEpochs ?? 0,
    constellations: sampledOccupation.constellations || [],
    satellites: sampledOccupation.satellites || [],
    epochRecords: sampledOccupation.epochRecords || [],
    observationTypes: Object.values(metadata.obsTypesBySystem).flat(),
    glonassSlotFreq: metadata.glonassSlotFreq,
    hasRealObsData: sampledOccupation.hasRealObsData || false,
    approxPosition: {
      x: metadata.approxX,
      y: metadata.approxY,
      z: metadata.approxZ,
    },
  };

  return {
    metadata,
    occupation: fullOccupation,
    storedOpfsKey: file.name,
    detectedPointType,
    geodeticApprox: {
      lat,
      lon,
      h,
      projY,
      projX,
    },
  };
}

/**
 * Creates a ready-to-use Station data object from parsed RINEX summary
 */
export function createStationFromSummary(
  summary: RinexParsedSummary,
  options: {
    dom?: number;
    forcedType?: StationType;
    existingStation?: Station;
  } = {}
): Station {
  const { metadata, geodeticApprox, occupation } = summary;
  const pointType: StationType = options.forcedType || summary.detectedPointType;
  const isFixed = pointType === 'CORS';

  const matchResult = findAntennaInCatalog(metadata.antennaType || '');
  const isCalibrated = !!matchResult;
  const matched = matchResult ? matchResult.calibration : null;
  const model = matched ? matched.model : (metadata.antennaType || 'BİLİNMEYEN ANTEN');
  const pcoL1 = matched ? matched.pcoL1 : { n: 0, e: 0, u: 0 };
  const pcoL2 = matched ? matched.pcoL2 : { n: 0, e: 0, u: 0 };
  const pcvZenith = matched ? matched.pcvZenith : [0, 0, 0, 0, 0, 0, 0];

  const existingAnt = options.existingStation?.antenna;
  const isUserEdited = existingAnt?.isUserEdited || (existingAnt?.measuredHeight !== undefined && existingAnt.measuredHeight > 0 && metadata.deltaH === 0);

  const heightType = isUserEdited && existingAnt ? existingAnt.heightType : 'vertical';
  const measuredHeight = isUserEdited && existingAnt ? existingAnt.measuredHeight : metadata.deltaH;
  const radius = isUserEdited && existingAnt?.radius !== undefined ? existingAnt.radius : (matched ? (matched.radius || 0.08) : 0.08);
  const verticalOffset = isUserEdited && existingAnt?.verticalOffset !== undefined ? existingAnt.verticalOffset : (matched ? (matched.verticalOffset || 0.0) : 0.0);
  const correctedHeight = calculateCorrectedAntennaHeight(heightType, measuredHeight, radius, verticalOffset);
  const heightSource: 'USER' | 'RINEX' = isUserEdited ? 'USER' : (metadata.deltaH > 0 ? 'RINEX' : 'USER');

  return {
    id: metadata.markerName,
    name: metadata.markerName,
    type: pointType,
    isFixed: { x: isFixed, y: isFixed, z: isFixed },
    x: metadata.approxX,
    y: metadata.approxY,
    z: metadata.approxZ,
    lat: geodeticApprox.lat,
    lon: geodeticApprox.lon,
    h: geodeticApprox.h,
    projY: geodeticApprox.projY,
    projX: geodeticApprox.projX,
    antenna: {
      model,
      heightType,
      measuredHeight,
      radius,
      verticalOffset,
      correctedHeight,
      heightSource,
      isUserEdited,
      deltaE: metadata.deltaE,
      deltaN: metadata.deltaN,
      pcoL1,
      pcoL2,
      pcvZenith,
      isCalibrated,
      calibrationSource: matchResult ? matchResult.source : undefined,
      rawRinexModel: metadata.antennaType || '',
    },
    observationDateStr: occupation?.firstEpochDate || metadata.firstObsTime,
    opfsFileName: summary.storedOpfsKey || metadata.fileName,
    hasRealObsData: occupation?.hasRealObsData || false,
    occupation,
  };
}
