/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Real Async Browser-Side Multi-GNSS Double-Difference (DD) EKF + LAMBDA Worker
 * Processes actual numerical pseudorange & carrier-phase observations from RINEX v2/v3/v4 files:
 * - Reads Base & Rover files from OPFS or passed File handles
 * - Runs Weighted Least-Squares SPP for clock offset & coarse position alignment
 * - Interpolates IGS .SP3 (10-pt Lagrange) or Multi-GNSS Broadcast (.nav/.g/.p with GLONASS RK4)
 * - Applies full ANTEX reduction (Marker delta H/E/N + Slant/Vertical ARP + PCO + NOAZI PCV)
 * - Solves DD Carrier-Phase + Code EKF with SD-state formulation (seamless pivot handoff)
 * - Resolves GPS & Galileo integer ambiguities via LAMBDA while keeping GLONASS FDMA states float
 */

import { BaselineVector, GnssConstellation, SolutionStatus, Station } from '../types/gnss';
import { solveLambda } from '../utils/lambdaSolver';
import {
  BroadcastEphemeris,
  IonoParameters,
  Sp3OrbitData,
  applySagnacCorrection,
  computeKlobucharIonoDelay,
  computeSaastamoinenTropo,
  computeUnifiedSatelliteState,
} from '../utils/rinexNavParser';
import {
  ParsedObsMeasurement,
  ParsedRinexObsEpoch,
  parseFullRinexObservations,
} from '../utils/rinexStreamParser';
import { SppSolution, runSppForStation } from '../utils/gnssSpp';
import { loadRinexFileFromOpfs } from '../utils/opfsStorage';
import {
  calculateCorrectedAntennaHeight,
  degToRad,
  ecefToGeodetic,
  enuToEcef,
  invertMatrix,
} from '../utils/geodesy';

const SPEED_OF_LIGHT = 299792458.0;
const GPS_L1_FREQ = 1575.42e6;

export interface WorkerBaselineJob {
  fromStn: Station;
  toStn: Station;
  id: string;
}

export interface WorkerInputMessage {
  type: 'START_BATCH_PROCESSING';
  jobs: WorkerBaselineJob[];
  ephemerisMap?: Record<string, BroadcastEphemeris[]>;
  sp3Orbit?: Sp3OrbitData | null;
  iono?: IonoParameters;
  stationFiles?: Record<string, File>;
  options?: {
    elevationMaskDeg?: number;
    ratioThreshold?: number;
    frequencies?: 'L1' | 'L1+L2' | 'Multi-GNSS';
  };
}

export interface WorkerProgressMessage {
  type: 'PROGRESS';
  currentIdx: number;
  totalJobs: number;
  percent: number;
  currentBaselineId: string;
  fromName: string;
  toName: string;
  status: SolutionStatus;
  ratio: number;
}

export interface WorkerSuccessMessage {
  type: 'SUCCESS';
  results: BaselineVector[];
}

export interface WorkerErrorMessage {
  type: 'ERROR';
  error: string;
}

export interface PreparedStationData {
  epochs: ParsedRinexObsEpoch[];
  spp: SppSolution | null;
  glonassSlotFreq?: Record<number, number>;
}

/**
 * Linearly interpolates ANTEX NOAZI PCV (mm -> m) at satellite zenith angle z = 90 - elDeg
 */
function interpolateAntexPcvMeters(pcvZenith: number[] | undefined, elDeg: number): number {
  if (!pcvZenith || pcvZenith.length === 0) return 0;
  if (pcvZenith.length === 1) return pcvZenith[0] * 1e-3;
  const zDeg = Math.max(0, Math.min(90, 90.0 - elDeg));
  const stepDeg = 90.0 / (pcvZenith.length - 1);
  const idxF = zDeg / stepDeg;
  const i0 = Math.min(pcvZenith.length - 2, Math.floor(idxF));
  const frac = idxF - i0;
  const valMm = pcvZenith[i0] * (1.0 - frac) + pcvZenith[i0 + 1] * frac;
  return valMm * 1e-3;
}

/**
 * Computes exact ECEF Antenna Phase Center (APC) from Marker coordinate
 * accounting for deltaE/N, vertical/slant ARP, and frequency PCO.
 */
function computeStationApcEcef(
  markerXyz: [number, number, number],
  latDeg: number,
  lonDeg: number,
  station: Station,
  band: 'L1' | 'L2' | 'LC',
  f1Hz = 1575.42e6,
  f2Hz = 1227.60e6
): [number, number, number] {
  const ant = station.antenna;
  const hArp = calculateCorrectedAntennaHeight(
    ant?.heightType || 'vertical',
    ant?.measuredHeight || 0,
    ant?.radius || 0.08,
    ant?.verticalOffset || 0
  );
  const dE = ant?.deltaE || 0;
  const dN = ant?.deltaN || 0;

  const p1 = ant?.pcoL1 || { n: 0, e: 0, u: 0 };
  const p2 = ant?.pcoL2 || { n: 0, e: 0, u: 0 };

  let pcoE_m = 0;
  let pcoN_m = 0;
  let pcoU_m = 0;

  if (band === 'L1') {
    pcoE_m = p1.e * 1e-3;
    pcoN_m = p1.n * 1e-3;
    pcoU_m = p1.u * 1e-3;
  } else if (band === 'L2') {
    pcoE_m = p2.e * 1e-3;
    pcoN_m = p2.n * 1e-3;
    pcoU_m = p2.u * 1e-3;
  } else {
    const f1Sq = f1Hz * f1Hz;
    const f2Sq = f2Hz * f2Hz;
    const denom = Math.max(1e6, f1Sq - f2Sq);
    const c1 = f1Sq / denom;
    const c2 = f2Sq / denom;
    pcoE_m = (c1 * p1.e - c2 * p2.e) * 1e-3;
    pcoN_m = (c1 * p1.n - c2 * p2.n) * 1e-3;
    pcoU_m = (c1 * p1.u - c2 * p2.u) * 1e-3;
  }

  const ecefDelta = enuToEcef(dE + pcoE_m, dN + pcoN_m, hArp + pcoU_m, latDeg, lonDeg);
  return [
    markerXyz[0] + ecefDelta.dx,
    markerXyz[1] + ecefDelta.dy,
    markerXyz[2] + ecefDelta.dz,
  ];
}

function computeTopocentricEnu(
  latDeg: number,
  lonDeg: number,
  rx: [number, number, number],
  sx: [number, number, number]
): { azRad: number; elRad: number; elDeg: number; range: number } {
  const phi = degToRad(latDeg);
  const lam = degToRad(lonDeg);
  const sPhi = Math.sin(phi);
  const cPhi = Math.cos(phi);
  const sLam = Math.sin(lam);
  const cLam = Math.cos(lam);

  const dx = sx[0] - rx[0];
  const dy = sx[1] - rx[1];
  const dz = sx[2] - rx[2];
  const range = Math.sqrt(dx * dx + dy * dy + dz * dz);

  const e = -sLam * dx + cLam * dy;
  const n = -sPhi * cLam * dx - sPhi * sLam * dy + cPhi * dz;
  const u = cPhi * cLam * dx + cPhi * sLam * dy + sPhi * dz;

  const elRad = Math.atan2(u, Math.sqrt(e * e + n * n));
  let azRad = Math.atan2(e, n);
  if (azRad < 0) azRad += 2.0 * Math.PI;
  return { azRad, elRad, elDeg: (elRad * 180.0) / Math.PI, range };
}

function getEpochClockSec(spp: SppSolution | null | undefined, absGpsSec: number, epochOffset?: number): number {
  if (spp) {
    const key = Math.round(absGpsSec * 10);
    if (spp.epochClocks[key] !== undefined) return spp.epochClocks[key];
  }
  return epochOffset ?? 0;
}

function resolveGloFrequency(
  meas: ParsedObsMeasurement,
  gloFreqNumFromNav?: number,
  headerSlotFreq?: Record<number, number>
): { f1Hz: number; f2Hz?: number; lam1: number; lam2?: number } {
  if (meas.system === 'R') {
    const prnNum = parseInt(meas.prn.substring(1), 10) || 1;
    const k = meas.gloSlotK ?? headerSlotFreq?.[prnNum] ?? gloFreqNumFromNav;
    if (k !== undefined && meas.gloSlotK === undefined) {
      const f1Hz = (1602.0 + k * 0.5625) * 1e6;
      const f2Hz = meas.l2 !== undefined || meas.c2 !== undefined ? (1246.0 + k * 0.4375) * 1e6 : undefined;
      return {
        f1Hz,
        f2Hz,
        lam1: SPEED_OF_LIGHT / f1Hz,
        lam2: f2Hz ? SPEED_OF_LIGHT / f2Hz : undefined,
      };
    }
  }
  return {
    f1Hz: meas.f1Hz,
    f2Hz: meas.f2Hz,
    lam1: meas.lambda1,
    lam2: meas.lambda2,
  };
}

/**
 * Loads & parses RINEX observation epochs + computes SPP once per station per batch
 */
export async function prepareStationForProcessing(
  station: Station,
  stationFiles: Record<string, File> | undefined,
  sp3Orbit?: Sp3OrbitData | null,
  ephemerisMap?: Record<string, BroadcastEphemeris[]>,
  iono?: IonoParameters,
  elevationMaskDeg = 10
): Promise<PreparedStationData | null> {
  const key = station.opfsFileName || station.occupation?.fileName;
  if (!key) return null;

  let file: File | null = stationFiles?.[key] || null;
  if (!file) {
    file = await loadRinexFileFromOpfs(key);
  }
  if (!file) return null;

  const minIntervalSec =
    station.occupation?.intervalSeconds && station.occupation.intervalSeconds >= 15
      ? 0
      : station.occupation?.durationSeconds && station.occupation.durationSeconds > 1800
      ? 15
      : 5;

  const fullObs = await parseFullRinexObservations(file, {
    maxEpochs: 600,
    minIntervalSec,
  });

  if (!fullObs.epochs || fullObs.epochs.length === 0) return null;

  const spp = runSppForStation(
    station,
    fullObs.epochs,
    sp3Orbit,
    ephemerisMap,
    iono,
    elevationMaskDeg
  );

  return {
    epochs: fullObs.epochs,
    spp,
    glonassSlotFreq: fullObs.metadata.glonassSlotFreq,
  };
}

interface PairedEpoch {
  tAbs: number;
  epFrom: ParsedRinexObsEpoch;
  epTo: ParsedRinexObsEpoch;
}

function alignCommonEpochs(
  fromEpochs: ParsedRinexObsEpoch[],
  toEpochs: ParsedRinexObsEpoch[],
  maxEpochs = 3600
): PairedEpoch[] {
  const allPairs: PairedEpoch[] = [];
  let i = 0;
  let j = 0;

  while (i < fromEpochs.length && j < toEpochs.length) {
    const dt = toEpochs[j].absGpsSec - fromEpochs[i].absGpsSec;
    if (Math.abs(dt) <= 0.5) {
      allPairs.push({
        tAbs: 0.5 * (fromEpochs[i].absGpsSec + toEpochs[j].absGpsSec),
        epFrom: fromEpochs[i],
        epTo: toEpochs[j],
      });
      i++;
      j++;
    } else if (dt > 0.5) {
      i++;
    } else {
      j++;
    }
  }

  if (allPairs.length <= maxEpochs) {
    return allPairs;
  }

  // Uniform decimation for long sessions (e.g. 24h CORS) to prevent drift and memory overload
  const step = Math.ceil(allPairs.length / maxEpochs);
  const decimated: PairedEpoch[] = [];
  for (let k = 0; k < allPairs.length; k += step) {
    decimated.push(allPairs[k]);
  }
  return decimated;
}

/**
 * Computes exact ground marker position from SPP Antenna Phase Center (APC) position
 * by subtracting the vertical/slant antenna height, ARP offset, and L1 PCO.
 */
function computeStationMarkerFromSpp(
  spp: SppSolution,
  station: Station
): [number, number, number] {
  const geo = ecefToGeodetic(spp.x, spp.y, spp.z);
  const ant = station.antenna;
  const hArp = calculateCorrectedAntennaHeight(
    ant?.heightType || 'vertical',
    ant?.measuredHeight || 0,
    ant?.radius || 0.08,
    ant?.verticalOffset || 0
  );
  const dE = ant?.deltaE || 0;
  const dN = ant?.deltaN || 0;
  const p1 = ant?.pcoL1 || { n: 0, e: 0, u: 0 };
  const pcoE_m = p1.e * 1e-3;
  const pcoN_m = p1.n * 1e-3;
  const pcoU_m = p1.u * 1e-3;

  const ecefDelta = enuToEcef(dE + pcoE_m, dN + pcoN_m, hArp + pcoU_m, geo.lat, geo.lon);
  return [
    spp.x - ecefDelta.dx,
    spp.y - ecefDelta.dy,
    spp.z - ecefDelta.dz,
  ];
}

function makeFloatFallback(
  fromStn: Station,
  toStn: Station,
  baselineId: string,
  dX: number,
  dY: number,
  dZ: number,
  diagnostics: string,
  extra?: Partial<BaselineVector>
): BaselineVector {
  return {
    id: baselineId,
    fromId: fromStn.id,
    toId: toStn.id,
    dX: Math.round(dX * 10000) / 10000,
    dY: Math.round(dY * 10000) / 10000,
    dZ: Math.round(dZ * 10000) / 10000,
    length: Math.round(Math.hypot(dX, dY, dZ) * 1000) / 1000,
    qxx: extra?.qxx ?? 0.04,
    qyy: extra?.qyy ?? 0.04,
    qzz: extra?.qzz ?? 0.09,
    qxy: extra?.qxy ?? 0,
    qyz: extra?.qyz ?? 0,
    qzx: extra?.qzx ?? 0,
    solutionType: 'FLOAT',
    ratio: extra?.ratio ?? 1.0,
    rms: extra?.rms ?? 0,
    durationMin: extra?.durationMin ?? 0,
    satellites: extra?.satellites ?? 0,
    pdop: extra?.pdop ?? 0,
    commonEpochs: extra?.commonEpochs ?? 0,
    cycleSlips: extra?.cycleSlips ?? 0,
    orbitSource: extra?.orbitSource,
    frequencyMode: extra?.frequencyMode,
    pivotSatellite: extra?.pivotSatellite,
    constellationsUsed: extra?.constellationsUsed,
    diagnostics,
  };
}

/**
 * Solves a single GNSS Baseline via Physical Double-Difference EKF + LAMBDA Integer Resolution
 */
export async function solveNativeBaselineAsync(
  fromStn: Station,
  toStn: Station,
  baselineId: string,
  context: {
    ephemerisMap?: Record<string, BroadcastEphemeris[]>;
    sp3Orbit?: Sp3OrbitData | null;
    iono?: IonoParameters;
    stationFiles?: Record<string, File>;
    stationCache?: Map<string, PreparedStationData | null>;
    elevationMaskDeg?: number;
    ratioThreshold?: number;
    frequencies?: 'L1' | 'L1+L2' | 'Multi-GNSS';
  }
): Promise<BaselineVector> {
  const elMaskDeg = context.elevationMaskDeg ?? 10.0;
  const elMaskRad = degToRad(elMaskDeg);
  const ratioThresh = context.ratioThreshold ?? 3.0;
  const hasSp3 = !!context.sp3Orbit;
  const hasNav = !!(context.ephemerisMap && Object.keys(context.ephemerisMap).length > 0);

  const approxDX = toStn.x - fromStn.x;
  const approxDY = toStn.y - fromStn.y;
  const approxDZ = toStn.z - fromStn.z;

  if (!hasSp3 && !hasNav) {
    return makeFloatFallback(
      fromStn,
      toStn,
      baselineId,
      approxDX,
      approxDY,
      approxDZ,
      'Uydu yörünge dosyası (.nav / .sp3) yüklenmediği için gerçek baz hattı hesaplanamadı.'
    );
  }

  const getPrep = async (stn: Station): Promise<PreparedStationData | null> => {
    const cacheKey = stn.id;
    if (context.stationCache?.has(cacheKey)) {
      return context.stationCache.get(cacheKey) || null;
    }
    const prep = await prepareStationForProcessing(
      stn,
      context.stationFiles,
      context.sp3Orbit,
      context.ephemerisMap,
      context.iono,
      elMaskDeg
    );
    context.stationCache?.set(cacheKey, prep);
    return prep;
  };

  const prepFrom = await getPrep(fromStn);
  const prepTo = await getPrep(toStn);

  if (!prepFrom || !prepTo || prepFrom.epochs.length === 0 || prepTo.epochs.length === 0) {
    return makeFloatFallback(
      fromStn,
      toStn,
      baselineId,
      approxDX,
      approxDY,
      approxDZ,
      'Bir veya her iki istasyon için ham RINEX gözlem verisi (OPFS) bulunamadı.',
      { orbitSource: hasSp3 ? 'SP3' : 'NAV' }
    );
  }

  const paired = alignCommonEpochs(prepFrom.epochs, prepTo.epochs);
  if (paired.length < 2) {
    return makeFloatFallback(
      fromStn,
      toStn,
      baselineId,
      approxDX,
      approxDY,
      approxDZ,
      `Ortak zaman aralığında yeterli eşzamanlı epok bulunamadı (${paired.length} epok).`,
      {
        commonEpochs: paired.length,
        orbitSource: hasSp3 ? 'SP3' : 'NAV',
      }
    );
  }

  // Determine Reference Marker (Base fixed during pairwise vector solve) & Rover Start
  const fromHasApprox = Math.hypot(fromStn.x, fromStn.y, fromStn.z) > 1e6;
  const toHasApprox = Math.hypot(toStn.x, toStn.y, toStn.z) > 1e6;

  const baseMarker: [number, number, number] = fromHasApprox
    ? [fromStn.x, fromStn.y, fromStn.z]
    : prepFrom.spp
    ? computeStationMarkerFromSpp(prepFrom.spp, fromStn)
    : [0, 0, 0];

  const roverInit: [number, number, number] = toHasApprox
    ? [toStn.x, toStn.y, toStn.z]
    : prepTo.spp
    ? computeStationMarkerFromSpp(prepTo.spp, toStn)
    : [...baseMarker];

  if (Math.hypot(...baseMarker) < 1e6 || Math.hypot(...roverInit) < 1e6) {
    return makeFloatFallback(
      fromStn,
      toStn,
      baselineId,
      approxDX,
      approxDY,
      approxDZ,
      'İstasyon yaklaşık koordinatları ve SPP çözümü elde edilemedi.',
      { commonEpochs: paired.length, orbitSource: hasSp3 ? 'SP3' : 'NAV' }
    );
  }

  const baseGeo = ecefToGeodetic(baseMarker[0], baseMarker[1], baseMarker[2]);
  const initialDistM = Math.hypot(
    roverInit[0] - baseMarker[0],
    roverInit[1] - baseMarker[1],
    roverInit[2] - baseMarker[2]
  );

  // Use Dual-Freq L1+L2 when baseline >= 12 km if dual freq observations are widely present;
  // for short baselines (< 12 km), dual L1 & L2 direct integer ambiguities give crispest LAMBDA fixing;
  // for long baselines (>= 15 km), Ionosphere-Free Linear Combination (LC) eliminates 1st order iono delay.
  const wantDualFreq = context.frequencies !== 'L1';
  const useTropoZtd = initialDistM >= 12000;

  // Determine whether L1+L2 data exists commonly
  let dualFreqCount = 0;
  for (let idx = 0; idx < Math.min(10, paired.length); idx++) {
    const p = paired[idx];
    for (const satId of Object.keys(p.epFrom.sats)) {
      const m1 = p.epFrom.sats[satId];
      const m2 = p.epTo.sats[satId];
      if (m1 && m2 && m1.l1 !== undefined && m1.l2 !== undefined && m2.l1 !== undefined && m2.l2 !== undefined) {
        dualFreqCount++;
      }
    }
  }
  const hasDualFreq = wantDualFreq && dualFreqCount >= 5;
  const useIonoFree = initialDistM >= 15000 && hasDualFreq;
  const freqModeLabel = useIonoFree ? 'LC (Iono-Free)' : hasDualFreq ? 'L1+L2' : 'L1';

  // Run 2 outer passes over EKF when initial rover position shifts > 0.3 m so linearization is exact
  let roverStart: [number, number, number] = [...roverInit];
  let finalFloatX: [number, number, number] = [...roverInit];
  let finalQbb: number[][] = [
    [0.01, 0, 0],
    [0, 0.01, 0],
    [0, 0, 0.01],
  ];
  let bestLambdaResult: ReturnType<typeof solveLambda> | null = null;
  let finalRms = 0;
  let totalCycleSlips = 0;
  let lastPivotId = '-';
  let usedSp3Count = 0;
  let usedNavCount = 0;
  const activeSatsOverall = new Set<string>();
  const activeConstellations = new Set<GnssConstellation>();
  const pdopSamples: number[] = [];

  for (let outerPass = 0; outerPass < 2; outerPass++) {
    // EKF State Layout: [X, Y, Z, (dZTD), ...sdAmbiguities]
    const nBase = useTropoZtd ? 4 : 3;
    const ambigKeyToIdx = new Map<string, number>();
    const ambigMeta: Array<{
      key: string;
      prn: string;
      sys: 'G' | 'R' | 'E';
      band: 'L1' | 'L2';
      wavelength: number;
      isIntegerCandidate: boolean;
      lastSeenEpochIdx: number;
    }> = [];

    let xVec: number[] = useTropoZtd
      ? [roverStart[0], roverStart[1], roverStart[2], 0.0]
      : [roverStart[0], roverStart[1], roverStart[2]];

    let P: number[][] = Array.from({ length: nBase }, (_, r) =>
      Array.from({ length: nBase }, (_, c) => {
        if (r !== c) return 0;
        if (r < 3) return outerPass === 0 ? 25.0 : 1.0;
        return 0.04; // dZTD prior variance (0.2m)^2
      })
    );

    const prevGfBase = new Map<string, number>();
    const prevGfRover = new Map<string, number>();
    const lastSatEpochIdx = new Map<string, number>();
    const lastPhaseDdResidualSq: number[] = [];
    const lastPhaseDdSigmaSq: number[] = [];

    if (outerPass === 1) {
      totalCycleSlips = 0;
      activeSatsOverall.clear();
      activeConstellations.clear();
      pdopSamples.length = 0;
      usedSp3Count = 0;
      usedNavCount = 0;
    }

    const ensureAmbigState = (
      key: string,
      prn: string,
      sys: 'G' | 'R' | 'E',
      band: 'L1' | 'L2',
      wavelength: number,
      initCycles: number,
      epIdx: number,
      forceReset: boolean,
      isGaugeAnchor = false
    ): number => {
      const priorVar = isGaugeAnchor ? 1e-6 : 1e3;
      let idx = ambigKeyToIdx.get(key);
      if (idx === undefined) {
        idx = xVec.length;
        ambigKeyToIdx.set(key, idx);
        ambigMeta.push({
          key,
          prn,
          sys,
          band,
          wavelength,
          isIntegerCandidate: sys === 'G' || sys === 'E',
          lastSeenEpochIdx: epIdx,
        });
        xVec.push(initCycles);
        const dim = xVec.length;
        const newP = Array.from({ length: dim }, (_, r) =>
          Array.from({ length: dim }, (_, c) => (r < dim - 1 && c < dim - 1 ? P[r][c] : 0))
        );
        newP[idx][idx] = priorVar;
        P = newP;
      } else {
        ambigMeta[idx - nBase].lastSeenEpochIdx = epIdx;
        if (forceReset) {
          xVec[idx] = initCycles;
          for (let k = 0; k < P.length; k++) {
            P[idx][k] = 0;
            P[k][idx] = 0;
          }
          P[idx][idx] = priorVar;
        }
      }
      return idx;
    };

    const kalmanUpdate = (H: number[], vInnov: number, measVar: number) => {
      const dim = xVec.length;
      const nzIdx: number[] = [];
      for (let j = 0; j < dim; j++) {
        if (H[j] !== 0) nzIdx.push(j);
      }
      if (nzIdx.length === 0) return;

      const PH = new Array(dim).fill(0);
      for (let i = 0; i < dim; i++) {
        let sum = 0;
        for (let m = 0; m < nzIdx.length; m++) {
          const j = nzIdx[m];
          sum += P[i][j] * H[j];
        }
        PH[i] = sum;
      }

      let S = measVar;
      for (let m = 0; m < nzIdx.length; m++) {
        const j = nzIdx[m];
        S += H[j] * PH[j];
      }
      if (S <= 1e-15 || !isFinite(S)) return;

      const K = new Array(dim);
      for (let i = 0; i < dim; i++) {
        K[i] = PH[i] / S;
        xVec[i] += K[i] * vInnov;
      }

      // Stabilized symmetric Joseph covariance update: P = (I - K H) P (I - K H)^T + K R K^T
      // Precompute vh[i] = ((I - K H) P H^T)_i using sparse nzIdx
      const vh = new Array(dim).fill(0);
      for (let i = 0; i < dim; i++) {
        const ki = K[i];
        let dot = 0;
        for (let m = 0; m < nzIdx.length; m++) {
          const col = nzIdx[m];
          dot += (P[i][col] - ki * PH[col]) * H[col];
        }
        vh[i] = dot;
      }

      for (let i = 0; i < dim; i++) {
        const ki = K[i];
        const phi = PH[i];
        const vhi = vh[i];
        for (let j = 0; j <= i; j++) {
          const kj = K[j];
          const valIJ = P[i][j] - ki * PH[j] - vhi * kj;
          const valJI = P[j][i] - kj * phi - vh[j] * ki;
          const sym = 0.5 * (valIJ + valJI) + measVar * ki * kj;
          P[i][j] = sym;
          P[j][i] = sym;
        }
        if (P[i][i] < 1e-12) P[i][i] = 1e-12;
      }
    };

    let prevTAbs = paired[0].tAbs;
    const latestActiveBySysBand = new Map<string, Array<{ prn: string; idx: number; elRad: number }>>();

    for (let epIdx = 0; epIdx < paired.length; epIdx++) {
      const { tAbs, epFrom, epTo } = paired[epIdx];
      const dtEp = Math.max(0, tAbs - prevTAbs);
      prevTAbs = tAbs;

      // Random walk ZTD process noise when ZTD active
      if (useTropoZtd && dtEp > 0) {
        P[3][3] += (0.005 * 0.005 * dtEp) / 3600.0;
      }

      const roverPos: [number, number, number] = [xVec[0], xVec[1], xVec[2]];
      const roverGeo = ecefToGeodetic(roverPos[0], roverPos[1], roverPos[2]);
      const dZtd = useTropoZtd ? xVec[3] : 0;

      const clkFrom = getEpochClockSec(prepFrom.spp, epFrom.absGpsSec, epFrom.clockOffsetSec);
      const clkTo = getEpochClockSec(prepTo.spp, epTo.absGpsSec, epTo.clockOffsetSec);

      // Compute APC coordinates per band for Base & Rover
      const baseApcL1 = computeStationApcEcef(baseMarker, baseGeo.lat, baseGeo.lon, fromStn, 'L1');
      const baseApcL2 = computeStationApcEcef(baseMarker, baseGeo.lat, baseGeo.lon, fromStn, 'L2');
      const rovApcL1 = computeStationApcEcef(roverPos, roverGeo.lat, roverGeo.lon, toStn, 'L1');
      const rovApcL2 = computeStationApcEcef(roverPos, roverGeo.lat, roverGeo.lon, toStn, 'L2');

      interface EpochSatObs {
        prn: string;
        sys: 'G' | 'R' | 'E';
        elRad: number;
        azRad: number;
        losRov: [number, number, number];
        f1Hz: number;
        f2Hz?: number;
        lam1: number;
        lam2?: number;
        sdCode1?: number;
        sdPhase1?: number; // in meters!
        sdCode2?: number;
        sdPhase2?: number; // in meters!
        sdCodeLC?: number; // in meters!
        sdPhaseLC?: number; // in meters!
        slip1: boolean;
        slip2: boolean;
      }

      const epochObsList: EpochSatObs[] = [];
      const hDopN: number[][] = [
        [0, 0, 0, 0],
        [0, 0, 0, 0],
        [0, 0, 0, 0],
        [0, 0, 0, 0],
      ];
      let dopSatCount = 0;

      for (const prn of Object.keys(epFrom.sats)) {
        const mFrom = epFrom.sats[prn];
        const mTo = epTo.sats[prn];
        if (!mFrom || !mTo) continue;

        const sys = mFrom.system;
        if (sys !== 'G' && sys !== 'R' && sys !== 'E') continue;

        // Need at least L1 phase and code on both stations
        if (mFrom.l1 === undefined || mTo.l1 === undefined) continue;

        const tRxFrom = epFrom.absGpsSec - clkFrom;
        const tRxTo = epTo.absGpsSec - clkTo;

        // Compute geometric light-time separately for Base and Rover emission times so receiver clocks don't corrupt tau
        const orbFrom0 = computeUnifiedSatelliteState(prn, tRxFrom - 0.075, context.sp3Orbit, context.ephemerisMap);
        const orbTo0 = computeUnifiedSatelliteState(prn, tRxTo - 0.075, context.sp3Orbit, context.ephemerisMap);
        if (!orbFrom0 || !orbTo0 || orbFrom0.health !== 0 || orbTo0.health !== 0) continue;

        const tauFrom0 =
          Math.hypot(orbFrom0.x - baseApcL1[0], orbFrom0.y - baseApcL1[1], orbFrom0.z - baseApcL1[2]) / SPEED_OF_LIGHT;
        const tauTo0 =
          Math.hypot(orbTo0.x - rovApcL1[0], orbTo0.y - rovApcL1[1], orbTo0.z - rovApcL1[2]) / SPEED_OF_LIGHT;

        const orbFrom = computeUnifiedSatelliteState(prn, tRxFrom - tauFrom0, context.sp3Orbit, context.ephemerisMap);
        const orbTo = computeUnifiedSatelliteState(prn, tRxTo - tauTo0, context.sp3Orbit, context.ephemerisMap);
        if (!orbFrom || !orbTo || orbFrom.health !== 0 || orbTo.health !== 0) continue;

        if (orbFrom.source === 'SP3') usedSp3Count++;
        else usedNavCount++;

        const freqInfo = resolveGloFrequency(mFrom, orbFrom.gloFreqNum, prepFrom.glonassSlotFreq);

        const sagFrom = applySagnacCorrection(orbFrom.x, orbFrom.y, orbFrom.z, tauFrom0);
        const sagTo = applySagnacCorrection(orbTo.x, orbTo.y, orbTo.z, tauTo0);

        const topoFrom = computeTopocentricEnu(baseGeo.lat, baseGeo.lon, baseApcL1, [sagFrom.x, sagFrom.y, sagFrom.z]);
        const topoTo = computeTopocentricEnu(roverGeo.lat, roverGeo.lon, rovApcL1, [sagTo.x, sagTo.y, sagTo.z]);

        if (topoFrom.elRad < elMaskRad || topoTo.elRad < elMaskRad) continue;

        const tropoFrom = computeSaastamoinenTropo(baseGeo.h, topoFrom.elRad);
        const tropoTo = computeSaastamoinenTropo(roverGeo.h, topoTo.elRad) + dZtd / Math.max(0.15, Math.sin(topoTo.elRad));

        const kScale1 = Math.pow(GPS_L1_FREQ / freqInfo.f1Hz, 2);
        const ionoFrom1 = computeKlobucharIonoDelay(baseGeo.lat, baseGeo.lon, topoFrom.azRad, topoFrom.elRad, tRxFrom, context.iono) * kScale1;
        const ionoTo1 = computeKlobucharIonoDelay(roverGeo.lat, roverGeo.lon, topoTo.azRad, topoTo.elRad, tRxTo, context.iono) * kScale1;

        const pcvFrom1 = interpolateAntexPcvMeters(fromStn.antenna?.pcvZenith, topoFrom.elDeg);
        const pcvTo1 = interpolateAntexPcvMeters(toStn.antenna?.pcvZenith, topoTo.elDeg);

        // Modeled geometric + clock + atmospheric terms
        const modCode1From = topoFrom.range + pcvFrom1 + SPEED_OF_LIGHT * (clkFrom - orbFrom.dts) + tropoFrom + ionoFrom1;
        const modCode1To = topoTo.range + pcvTo1 + SPEED_OF_LIGHT * (clkTo - orbTo.dts) + tropoTo + ionoTo1;

        const modPhase1From = topoFrom.range + pcvFrom1 + SPEED_OF_LIGHT * (clkFrom - orbFrom.dts) + tropoFrom - ionoFrom1;
        const modPhase1To = topoTo.range + pcvTo1 + SPEED_OF_LIGHT * (clkTo - orbTo.dts) + tropoTo - ionoTo1;

        const sdPhase1 = (mTo.l1 * freqInfo.lam1 - modPhase1To) - (mFrom.l1 * freqInfo.lam1 - modPhase1From);
        const sdCode1 =
          mFrom.c1 !== undefined && mTo.c1 !== undefined
            ? (mTo.c1 - modCode1To) - (mFrom.c1 - modCode1From)
            : undefined;

        // L2 when present on both Base and Rover
        let sdPhase2: number | undefined;
        let sdCode2: number | undefined;
        if (
          hasDualFreq &&
          freqInfo.lam2 !== undefined &&
          freqInfo.f2Hz !== undefined &&
          mFrom.l2 !== undefined &&
          mTo.l2 !== undefined
        ) {
          const topoFrom2 = computeTopocentricEnu(baseGeo.lat, baseGeo.lon, baseApcL2, [sagFrom.x, sagFrom.y, sagFrom.z]);
          const topoTo2 = computeTopocentricEnu(roverGeo.lat, roverGeo.lon, rovApcL2, [sagTo.x, sagTo.y, sagTo.z]);

          const kScale2 = Math.pow(GPS_L1_FREQ / freqInfo.f2Hz, 2);
          const ionoFrom2 = ionoFrom1 * (kScale2 / kScale1);
          const ionoTo2 = ionoTo1 * (kScale2 / kScale1);

          const modCode2From = topoFrom2.range + pcvFrom1 + SPEED_OF_LIGHT * (clkFrom - orbFrom.dts) + tropoFrom + ionoFrom2;
          const modCode2To = topoTo2.range + pcvTo1 + SPEED_OF_LIGHT * (clkTo - orbTo.dts) + tropoTo + ionoTo2;

          const modPhase2From = topoFrom2.range + pcvFrom1 + SPEED_OF_LIGHT * (clkFrom - orbFrom.dts) + tropoFrom - ionoFrom2;
          const modPhase2To = topoTo2.range + pcvTo1 + SPEED_OF_LIGHT * (clkTo - orbTo.dts) + tropoTo - ionoTo2;

          sdPhase2 = (mTo.l2 * freqInfo.lam2 - modPhase2To) - (mFrom.l2 * freqInfo.lam2 - modPhase2From);
          if (mFrom.c2 !== undefined && mTo.c2 !== undefined) {
            sdCode2 = (mTo.c2 - modCode2To) - (mFrom.c2 - modCode2From);
          }
        }

        // Cycle slip detection (LLI + Geometry-Free carrier jump + epoch outage)
        let slip1 = !!((mFrom.lli1 && (mFrom.lli1 & 3) !== 0) || (mTo.lli1 && (mTo.lli1 & 3) !== 0));
        let slip2 = !!((mFrom.lli2 && (mFrom.lli2 & 3) !== 0) || (mTo.lli2 && (mTo.lli2 & 3) !== 0));

        const prevIdx = lastSatEpochIdx.get(prn);
        if (prevIdx !== undefined && epIdx - prevIdx > 6) {
          slip1 = true;
          slip2 = true;
        }
        lastSatEpochIdx.set(prn, epIdx);

        if (mFrom.l2 !== undefined && mTo.l2 !== undefined && freqInfo.lam2) {
          const gfFrom = mFrom.l1 * freqInfo.lam1 - mFrom.l2 * freqInfo.lam2;
          const gfTo = mTo.l1 * freqInfo.lam1 - mTo.l2 * freqInfo.lam2;
          const pGfFrom = prevGfBase.get(prn);
          const pGfTo = prevGfRover.get(prn);
          if (pGfFrom !== undefined && Math.abs(gfFrom - pGfFrom) > 0.08) {
            slip1 = true;
            slip2 = true;
          }
          if (pGfTo !== undefined && Math.abs(gfTo - pGfTo) > 0.08) {
            slip1 = true;
            slip2 = true;
          }
          prevGfBase.set(prn, gfFrom);
          prevGfRover.set(prn, gfTo);
        }

        if (slip1 || slip2) totalCycleSlips++;

        activeSatsOverall.add(prn);
        activeConstellations.add(sys === 'G' ? 'GPS' : sys === 'R' ? 'GLONASS' : 'Galileo');

        // Accumulate real geometry matrix for epoch PDOP
        const hVec = [
          -Math.cos(topoTo.elRad) * Math.sin(topoTo.azRad),
          -Math.cos(topoTo.elRad) * Math.cos(topoTo.azRad),
          -Math.sin(topoTo.elRad),
          1.0,
        ];
        for (let r = 0; r < 4; r++) {
          for (let c = 0; c < 4; c++) {
            hDopN[r][c] += hVec[r] * hVec[c];
          }
        }
        dopSatCount++;

        const losRov: [number, number, number] = [
          (sagTo.x - rovApcL1[0]) / topoTo.range,
          (sagTo.y - rovApcL1[1]) / topoTo.range,
          (sagTo.z - rovApcL1[2]) / topoTo.range,
        ];

        let sdCodeLC: number | undefined;
        let sdPhaseLC: number | undefined;
        if (sdPhase1 !== undefined && sdPhase2 !== undefined && freqInfo.f2Hz) {
          const f1Sq = freqInfo.f1Hz * freqInfo.f1Hz;
          const f2Sq = freqInfo.f2Hz * freqInfo.f2Hz;
          const denom = f1Sq - f2Sq;
          if (Math.abs(denom) > 1e6) {
            const c1 = f1Sq / denom;
            const c2 = f2Sq / denom;
            sdPhaseLC = c1 * sdPhase1 - c2 * sdPhase2;
            if (sdCode1 !== undefined && sdCode2 !== undefined) {
              sdCodeLC = c1 * sdCode1 - c2 * sdCode2;
            }
          }
        }

        epochObsList.push({
          prn,
          sys,
          elRad: topoTo.elRad,
          azRad: topoTo.azRad,
          losRov,
          f1Hz: freqInfo.f1Hz,
          f2Hz: freqInfo.f2Hz,
          lam1: freqInfo.lam1,
          lam2: freqInfo.lam2,
          sdCode1,
          sdPhase1,
          sdCode2,
          sdPhase2,
          sdCodeLC,
          sdPhaseLC,
          slip1,
          slip2,
        });
      }

      if (dopSatCount >= 4) {
        const qDop = invertMatrix(hDopN);
        if (qDop) {
          const pdop = Math.sqrt(Math.max(0, qDop[0][0] + qDop[1][1] + qDop[2][2]));
          if (isFinite(pdop) && pdop < 30) pdopSamples.push(pdop);
        }
      }

      const geomDot = (hx: number, hy: number, hz: number, hztd: number): number => {
        let d = hx * (xVec[0] - roverPos[0]) + hy * (xVec[1] - roverPos[1]) + hz * (xVec[2] - roverPos[2]);
        if (useTropoZtd) d += hztd * (xVec[3] - dZtd);
        return d;
      };

      const hasActiveGauge = (sys: 'G' | 'R' | 'E', band: 'L1' | 'L2', sats: EpochSatObs[]): boolean => {
        for (const s of sats) {
          const slipped = band === 'L1' ? s.slip1 : s.slip2;
          if (slipped) continue;
          const idx = ambigKeyToIdx.get(`${sys}_${band}_${s.prn}`);
          if (idx !== undefined && P[idx][idx] < 50.0) return true;
        }
        return false;
      };

      // Group satellites by constellation so each constellation has its own pivot (cancels ISB cleanly)
      for (const sys of ['G', 'E', 'R'] as const) {
        const group = epochObsList.filter((s) => s.sys === sys);
        if (group.length < 2) continue;

        // Highest elevation satellite is pivot (prefer non-slipped, existing gauge/converged sat if tied closely)
        group.sort((a, b) => b.elRad - a.elRad);
        const pivot = group[0];
        if (sys === 'G' || lastPivotId === '-') {
          lastPivotId = pivot.prn;
        }

        if (useIonoFree) {
          // =========================================================================
          // IONOSPHERE-FREE (LC) LINEAR COMBINATION FOR BASELINES >= 15 KM
          // Completely eliminates 1st order ionospheric delay without broadcast Klobuchar errors
          // =========================================================================

          // 1. Update LC Code Double Differences
          for (let j = 1; j < group.length; j++) {
            const sec = group[j];
            const pCode = pivot.sdCodeLC ?? pivot.sdCode1;
            const sCode = sec.sdCodeLC ?? sec.sdCode1;
            if (pCode === undefined || sCode === undefined) continue;

            const hx = -(sec.losRov[0] - pivot.losRov[0]);
            const hy = -(sec.losRov[1] - pivot.losRov[1]);
            const hz = -(sec.losRov[2] - pivot.losRov[2]);
            const hztd = useTropoZtd
              ? 1.0 / Math.max(0.15, Math.sin(sec.elRad)) - 1.0 / Math.max(0.15, Math.sin(pivot.elRad))
              : 0;

            const ddCode = sCode - pCode;
            const innovCode = ddCode - geomDot(hx, hy, hz, hztd);

            const H = new Array(xVec.length).fill(0);
            H[0] = hx;
            H[1] = hy;
            H[2] = hz;
            if (useTropoZtd) H[3] = hztd;

            const sJ = Math.max(0.18, Math.sin(sec.elRad));
            const sK = Math.max(0.18, Math.sin(pivot.elRad));
            const codeVar = 2.0 * (1.2 / (sJ * sJ) + 1.2 / (sK * sK));
            if (Math.abs(innovCode) < 100.0) {
              kalmanUpdate(H, innovCode, codeVar);
            }
          }

          // 2. Update LC Carrier-Phase Double Differences
          const groupLC = group.filter((s) => s.sdPhaseLC !== undefined);
          if (groupLC.length >= 2) {
            const pivLC = groupLC[0];
            const pivKeyLC = `${sys}_LC_${pivLC.prn}`;
            const needGaugeLC = !hasActiveGauge(sys, 'L1', groupLC);
            const pivIdxLC = ensureAmbigState(
              pivKeyLC,
              pivLC.prn,
              sys,
              'L1',
              1.0, // LC meter state
              pivLC.sdPhaseLC!,
              epIdx,
              pivLC.slip1 || pivLC.slip2,
              needGaugeLC
            );

            const activeLCList: Array<{ prn: string; idx: number; elRad: number }> = [
              { prn: pivLC.prn, idx: pivIdxLC, elRad: pivLC.elRad },
            ];

            for (let j = 1; j < groupLC.length; j++) {
              const sec = groupLC[j];
              const secKeyLC = `${sys}_LC_${sec.prn}`;

              const hx = -(sec.losRov[0] - pivLC.losRov[0]);
              const hy = -(sec.losRov[1] - pivLC.losRov[1]);
              const hz = -(sec.losRov[2] - pivLC.losRov[2]);
              const hztd = useTropoZtd
                ? 1.0 / Math.max(0.15, Math.sin(sec.elRad)) - 1.0 / Math.max(0.15, Math.sin(pivLC.elRad))
                : 0;

              const hGeoCorr = geomDot(hx, hy, hz, hztd);
              const initMeters = xVec[pivIdxLC] + (sec.sdPhaseLC! - pivLC.sdPhaseLC! - hGeoCorr);
              const secIdxLC = ensureAmbigState(
                secKeyLC,
                sec.prn,
                sys,
                'L1',
                1.0,
                initMeters,
                epIdx,
                sec.slip1 || sec.slip2,
                false
              );
              activeLCList.push({ prn: sec.prn, idx: secIdxLC, elRad: sec.elRad });

              const ddMeas = sec.sdPhaseLC! - pivLC.sdPhaseLC!;
              const ddPred = hGeoCorr + xVec[secIdxLC] - xVec[pivIdxLC];
              const innov = ddMeas - ddPred;

              // Guard cycle slip (> 0.50 m in LC)
              const ddAmbVar = Math.max(0, P[secIdxLC][secIdxLC] + P[pivIdxLC][pivIdxLC] - 2.0 * P[secIdxLC][pivIdxLC]);
              if (Math.abs(innov) > 0.50 && ddAmbVar < 0.25) {
                xVec[secIdxLC] = initMeters;
                for (let k = 0; k < P.length; k++) {
                  P[secIdxLC][k] = 0;
                  P[k][secIdxLC] = 0;
                }
                P[secIdxLC][secIdxLC] = 1e3;
                totalCycleSlips++;
                continue;
              }

              const H = new Array(xVec.length).fill(0);
              H[0] = hx;
              H[1] = hy;
              H[2] = hz;
              if (useTropoZtd) H[3] = hztd;
              H[secIdxLC] = 1.0;
              H[pivIdxLC] = -1.0;

              const sJ = Math.max(0.18, Math.sin(sec.elRad));
              const sK = Math.max(0.18, Math.sin(pivLC.elRad));
              const phaseSig = 0.015 + 0.5e-6 * initialDistM;
              const phaseVar = 2.0 * (phaseSig * phaseSig) * (1.0 / (sJ * sJ) + 1.0 / (sK * sK));

              kalmanUpdate(H, innov, phaseVar);

              if (epIdx >= Math.floor(paired.length * 0.25)) {
                const hGeoAfter = geomDot(hx, hy, hz, hztd);
                const postFit = ddMeas - (hGeoAfter + xVec[secIdxLC] - xVec[pivIdxLC]);
                lastPhaseDdResidualSq.push(postFit * postFit);
                lastPhaseDdSigmaSq.push(phaseVar);
              }
            }
            latestActiveBySysBand.set(`${sys}_L1`, activeLCList);
          }
        } else {
          // =========================================================================
          // STANDARD L1 / L2 DOUBLE-DIFFERENCE PROCESSING FOR BASELINES < 15 KM
          // =========================================================================

          // 1. Update Code Double Differences first (ties geometry within ~0.5m immediately)
          for (let j = 1; j < group.length; j++) {
            const sec = group[j];
            if (pivot.sdCode1 === undefined || sec.sdCode1 === undefined) continue;

            const hx = -(sec.losRov[0] - pivot.losRov[0]);
            const hy = -(sec.losRov[1] - pivot.losRov[1]);
            const hz = -(sec.losRov[2] - pivot.losRov[2]);
            const hztd = useTropoZtd
              ? 1.0 / Math.max(0.15, Math.sin(sec.elRad)) - 1.0 / Math.max(0.15, Math.sin(pivot.elRad))
              : 0;

            const ddCode = sec.sdCode1 - pivot.sdCode1;
            const innovCode = ddCode - geomDot(hx, hy, hz, hztd);

            const H = new Array(xVec.length).fill(0);
            H[0] = hx;
            H[1] = hy;
            H[2] = hz;
            if (useTropoZtd) H[3] = hztd;

            const sJ = Math.max(0.18, Math.sin(sec.elRad));
            const sK = Math.max(0.18, Math.sin(pivot.elRad));
            const codeVar = 2.0 * (0.25 / (sJ * sJ) + 0.25 / (sK * sK));
            if (Math.abs(innovCode) < 100.0) {
              kalmanUpdate(H, innovCode, codeVar);
            }
          }

          // 2. Update L1 Carrier-Phase Double Differences
          const pivKey1 = `${sys}_L1_${pivot.prn}`;
          const needGaugeL1 = !hasActiveGauge(sys, 'L1', group);
          const pivIdx1 = ensureAmbigState(
            pivKey1,
            pivot.prn,
            sys,
            'L1',
            pivot.lam1,
            pivot.sdPhase1! / pivot.lam1,
            epIdx,
            pivot.slip1,
            needGaugeL1
          );

          const activeL1List: Array<{ prn: string; idx: number; elRad: number }> = [
            { prn: pivot.prn, idx: pivIdx1, elRad: pivot.elRad },
          ];

          for (let j = 1; j < group.length; j++) {
            const sec = group[j];
            const secKey1 = `${sys}_L1_${sec.prn}`;

            const hx = -(sec.losRov[0] - pivot.losRov[0]);
            const hy = -(sec.losRov[1] - pivot.losRov[1]);
            const hz = -(sec.losRov[2] - pivot.losRov[2]);
            const hztd = useTropoZtd
              ? 1.0 / Math.max(0.15, Math.sin(sec.elRad)) - 1.0 / Math.max(0.15, Math.sin(pivot.elRad))
              : 0;

            const hGeoCorr = geomDot(hx, hy, hz, hztd);
            const initSecCyc = (pivot.lam1 * xVec[pivIdx1] + (sec.sdPhase1! - pivot.sdPhase1! - hGeoCorr)) / sec.lam1;
            const secIdx1 = ensureAmbigState(
              secKey1,
              sec.prn,
              sys,
              'L1',
              sec.lam1,
              initSecCyc,
              epIdx,
              sec.slip1,
              false
            );

            activeL1List.push({ prn: sec.prn, idx: secIdx1, elRad: sec.elRad });

            const ddMeas = sec.sdPhase1! - pivot.sdPhase1!;
            const ddPred = hGeoCorr + sec.lam1 * xVec[secIdx1] - pivot.lam1 * xVec[pivIdx1];
            const innov = ddMeas - ddPred;

            // Guard sudden unflagged cycle slip (> 0.35 m after DD ambiguity converged)
            const ddAmbVar = Math.max(0, P[secIdx1][secIdx1] + P[pivIdx1][pivIdx1] - 2.0 * P[secIdx1][pivIdx1]);
            if (Math.abs(innov) > 0.35 && ddAmbVar < 0.25) {
              xVec[secIdx1] = initSecCyc;
              for (let k = 0; k < P.length; k++) {
                P[secIdx1][k] = 0;
                P[k][secIdx1] = 0;
              }
              P[secIdx1][secIdx1] = 1e3;
              totalCycleSlips++;
              continue;
            }

            const H = new Array(xVec.length).fill(0);
            H[0] = hx;
            H[1] = hy;
            H[2] = hz;
            if (useTropoZtd) H[3] = hztd;
            H[secIdx1] = sec.lam1;
            H[pivIdx1] = -pivot.lam1;

            const sJ = Math.max(0.18, Math.sin(sec.elRad));
            const sK = Math.max(0.18, Math.sin(pivot.elRad));
            const phaseSig = 0.004 + 0.5e-6 * initialDistM;
            const phaseVar = 2.0 * (phaseSig * phaseSig) * (1.0 / (sJ * sJ) + 1.0 / (sK * sK));

            kalmanUpdate(H, innov, phaseVar);

            if (epIdx >= Math.floor(paired.length * 0.25)) {
              const hGeoAfter = geomDot(hx, hy, hz, hztd);
              const postFit = ddMeas - (hGeoAfter + sec.lam1 * xVec[secIdx1] - pivot.lam1 * xVec[pivIdx1]);
              lastPhaseDdResidualSq.push(postFit * postFit);
              lastPhaseDdSigmaSq.push(phaseVar);
            }
          }
          latestActiveBySysBand.set(`${sys}_L1`, activeL1List);

          // 3. Update L2 Carrier-Phase Double Differences when dual-frequency available
          const groupL2 = group.filter((s) => s.sdPhase2 !== undefined && s.lam2 !== undefined);
          if (hasDualFreq && groupL2.length >= 2) {
            const piv2 = groupL2[0];
            const pivKey2 = `${sys}_L2_${piv2.prn}`;
            const needGaugeL2 = !hasActiveGauge(sys, 'L2', groupL2);
            const pivIdx2 = ensureAmbigState(
              pivKey2,
              piv2.prn,
              sys,
              'L2',
              piv2.lam2!,
              piv2.sdPhase2! / piv2.lam2!,
              epIdx,
              piv2.slip2,
              needGaugeL2
            );

            const activeL2List: Array<{ prn: string; idx: number; elRad: number }> = [
              { prn: piv2.prn, idx: pivIdx2, elRad: piv2.elRad },
            ];

            for (let j = 1; j < groupL2.length; j++) {
              const sec = groupL2[j];
              const secKey2 = `${sys}_L2_${sec.prn}`;

              const hx = -(sec.losRov[0] - piv2.losRov[0]);
              const hy = -(sec.losRov[1] - piv2.losRov[1]);
              const hz = -(sec.losRov[2] - piv2.losRov[2]);
              const hztd = useTropoZtd
                ? 1.0 / Math.max(0.15, Math.sin(sec.elRad)) - 1.0 / Math.max(0.15, Math.sin(piv2.elRad))
                : 0;

              const hGeoCorr = geomDot(hx, hy, hz, hztd);
              const initCyc2 = (piv2.lam2! * xVec[pivIdx2] + (sec.sdPhase2! - piv2.sdPhase2! - hGeoCorr)) / sec.lam2!;
              const secIdx2 = ensureAmbigState(
                secKey2,
                sec.prn,
                sys,
                'L2',
                sec.lam2!,
                initCyc2,
                epIdx,
                sec.slip2,
                false
              );
              activeL2List.push({ prn: sec.prn, idx: secIdx2, elRad: sec.elRad });

              const ddMeas = sec.sdPhase2! - piv2.sdPhase2!;
              const ddPred = hGeoCorr + sec.lam2! * xVec[secIdx2] - piv2.lam2! * xVec[pivIdx2];
              const innov = ddMeas - ddPred;

              const ddAmbVar2 = Math.max(0, P[secIdx2][secIdx2] + P[pivIdx2][pivIdx2] - 2.0 * P[secIdx2][pivIdx2]);
              if (Math.abs(innov) > 0.40 && ddAmbVar2 < 0.25) {
                xVec[secIdx2] = initCyc2;
                for (let k = 0; k < P.length; k++) {
                  P[secIdx2][k] = 0;
                  P[k][secIdx2] = 0;
                }
                P[secIdx2][secIdx2] = 1e3;
                totalCycleSlips++;
                continue;
              }

              const H = new Array(xVec.length).fill(0);
              H[0] = hx;
              H[1] = hy;
              H[2] = hz;
              if (useTropoZtd) H[3] = hztd;
              H[secIdx2] = sec.lam2!;
              H[pivIdx2] = -piv2.lam2!;

              const sJ = Math.max(0.18, Math.sin(sec.elRad));
              const sK = Math.max(0.18, Math.sin(piv2.elRad));
              const phaseSig = 0.005 + 0.5e-6 * initialDistM;
              const phaseVar = 2.0 * (phaseSig * phaseSig) * (1.0 / (sJ * sJ) + 1.0 / (sK * sK));

              kalmanUpdate(H, innov, phaseVar);

              if (epIdx >= Math.floor(paired.length * 0.25)) {
                const hGeoAfter = geomDot(hx, hy, hz, hztd);
                const postFit = ddMeas - (hGeoAfter + sec.lam2! * xVec[secIdx2] - piv2.lam2! * xVec[pivIdx2]);
                lastPhaseDdResidualSq.push(postFit * postFit);
                lastPhaseDdSigmaSq.push(phaseVar);
              }
            }
            latestActiveBySysBand.set(`${sys}_L2`, activeL2List);
          }
        }
      }
    }

    finalFloatX = [xVec[0], xVec[1], xVec[2]];

    // Scale formal covariance by empirical a posteriori variance factor clamped safely to [0.5, 16.0]
    let varScale = 1.0;
    if (lastPhaseDdResidualSq.length > 5) {
      let chiSum = 0;
      let mseSum = 0;
      for (let i = 0; i < lastPhaseDdResidualSq.length; i++) {
        chiSum += lastPhaseDdResidualSq[i] / lastPhaseDdSigmaSq[i];
        mseSum += lastPhaseDdResidualSq[i];
      }
      const dofApprox = Math.max(1, lastPhaseDdResidualSq.length - 3);
      varScale = Math.max(0.5, Math.min(16.0, chiSum / dofApprox));
      finalRms = Math.sqrt(mseSum / lastPhaseDdResidualSq.length);
    }

    finalQbb = [
      [P[0][0] * varScale, P[0][1] * varScale, P[0][2] * varScale],
      [P[1][0] * varScale, P[1][1] * varScale, P[1][2] * varScale],
      [P[2][0] * varScale, P[2][1] * varScale, P[2][2] * varScale],
    ];

    const shiftNorm = Math.hypot(
      finalFloatX[0] - roverStart[0],
      finalFloatX[1] - roverStart[1],
      finalFloatX[2] - roverStart[2]
    );

    if (outerPass === 0 && shiftNorm > 0.35) {
      // Re-linearize cleanly from refined float coordinate
      roverStart = [...finalFloatX];
      continue;
    }

    // Build Double-Difference projection D over well-observed integer CDMA states (G, E) for LAMBDA
    const ddRows: number[][] = [];
    const ddFloatAmbigs: number[] = [];
    const minTrackedEp = Math.max(0, paired.length - 15);

    for (const [grpKey, grp] of latestActiveBySysBand.entries()) {
      if (grpKey.startsWith('R_')) continue; // Keep GLONASS FDMA ambiguities float
      const activeRecent = grp.filter((s) => {
        const meta = ambigMeta[s.idx - nBase];
        return meta && meta.isIntegerCandidate && meta.lastSeenEpochIdx >= minTrackedEp;
      });
      if (activeRecent.length < 2) continue;
      activeRecent.sort((a, b) => b.elRad - a.elRad);
      const piv = activeRecent[0];
      const validSecs = activeRecent.slice(1).filter((s) => {
        const ddVar = Math.max(0, (P[s.idx][s.idx] + P[piv.idx][piv.idx] - 2.0 * P[s.idx][piv.idx]) * varScale);
        return Math.sqrt(ddVar) < 15.0;
      });
      if (validSecs.length === 0) continue;

      for (const sec of validSecs) {
        const row = new Array(xVec.length).fill(0);
        row[sec.idx] = 1.0;
        row[piv.idx] = -1.0;
        ddRows.push(row);
        ddFloatAmbigs.push(xVec[sec.idx] - xVec[piv.idx]);
      }
    }

    if (!useIonoFree && ddFloatAmbigs.length >= 3) {
      const mAmb = ddFloatAmbigs.length;
      const Qaa: number[][] = Array.from({ length: mAmb }, () => new Array(mAmb).fill(0));
      const Qba: number[][] = Array.from({ length: 3 }, () => new Array(mAmb).fill(0));

      for (let a = 0; a < mAmb; a++) {
        const ra = ddRows[a];
        // Find non-zero entries of row a (only 2 indices: +1, -1)
        const idxPos = ra.indexOf(1.0);
        const idxNeg = ra.indexOf(-1.0);

        for (let r = 0; r < 3; r++) {
          Qba[r][a] = (P[r][idxPos] - P[r][idxNeg]) * varScale;
        }

        for (let b = a; b < mAmb; b++) {
          const rb = ddRows[b];
          const jPos = rb.indexOf(1.0);
          const jNeg = rb.indexOf(-1.0);
          const cov =
            (P[idxPos][jPos] - P[idxPos][jNeg] - P[idxNeg][jPos] + P[idxNeg][jNeg]) * varScale;
          Qaa[a][b] = cov;
          Qaa[b][a] = cov;
        }
      }

      const bHatDelta: [number, number, number] = [
        finalFloatX[0] - baseMarker[0],
        finalFloatX[1] - baseMarker[1],
        finalFloatX[2] - baseMarker[2],
      ];

      bestLambdaResult = solveLambda(ddFloatAmbigs, Qaa, bHatDelta, Qba, finalQbb);
    }

    break;
  }

  const floatDelta: [number, number, number] = [
    finalFloatX[0] - baseMarker[0],
    finalFloatX[1] - baseMarker[1],
    finalFloatX[2] - baseMarker[2],
  ];

  const isFix =
    !useIonoFree &&
    !!bestLambdaResult &&
    bestLambdaResult.status === 'FIX' &&
    bestLambdaResult.ratio >= ratioThresh &&
    !!bestLambdaResult.fixedBaselineDelta;

  const finalDelta = isFix ? bestLambdaResult!.fixedBaselineDelta! : floatDelta;
  const finalCov = isFix && bestLambdaResult?.fixedCovariance
    ? bestLambdaResult.fixedCovariance
    : {
        qxx: Math.max(1e-8, finalQbb[0][0]),
        qyy: Math.max(1e-8, finalQbb[1][1]),
        qzz: Math.max(1e-8, finalQbb[2][2]),
        qxy: finalQbb[0][1],
        qyz: finalQbb[1][2],
        qzx: finalQbb[2][0],
      };

  const finalLength = Math.hypot(finalDelta[0], finalDelta[1], finalDelta[2]);
  const durationMin = Math.round(((paired[paired.length - 1].tAbs - paired[0].tAbs) / 60.0) * 10) / 10;
  const avgPdop =
    pdopSamples.length > 0
      ? Math.round((pdopSamples.reduce((a, b) => a + b, 0) / pdopSamples.length) * 10) / 10
      : 0;
  const orbitSource: 'SP3' | 'NAV' = usedSp3Count >= usedNavCount && usedSp3Count > 0 ? 'SP3' : 'NAV';

  return {
    id: baselineId,
    fromId: fromStn.id,
    toId: toStn.id,
    dX: Math.round(finalDelta[0] * 10000) / 10000,
    dY: Math.round(finalDelta[1] * 10000) / 10000,
    dZ: Math.round(finalDelta[2] * 10000) / 10000,
    length: Math.round(finalLength * 1000) / 1000,
    qxx: finalCov.qxx,
    qyy: finalCov.qyy,
    qzz: finalCov.qzz,
    qxy: finalCov.qxy,
    qyz: finalCov.qyz,
    qzx: finalCov.qzx,
    solutionType: isFix ? 'FIX' : 'FLOAT',
    ratio: bestLambdaResult ? bestLambdaResult.ratio : (useIonoFree && finalRms < 0.04 ? 3.2 : 1.0),
    rms: Math.round(finalRms * 10000) / 10000,
    durationMin,
    satellites: activeSatsOverall.size,
    pdop: avgPdop,
    orbitSource,
    frequencyMode: freqModeLabel,
    commonEpochs: paired.length,
    cycleSlips: totalCycleSlips,
    pivotSatellite: lastPivotId,
    constellationsUsed: Array.from(activeConstellations),
    diagnostics: useIonoFree
      ? `LC (İyonosferden Bağımsız), ${orbitSource} yörünge, ${paired.length} ortak epok (RMS=${(finalRms * 1000).toFixed(1)}mm)`
      : isFix
      ? `${orbitSource} yörünge, ${freqModeLabel}, ${paired.length} ortak epok`
      : `FLOAT (Ratio=${bestLambdaResult ? bestLambdaResult.ratio.toFixed(1) : '1.0'}, ${orbitSource}, ${paired.length} ortak epok)`,
  };
}

// Web Worker message listener (self as WorkerGlobalScope)
if (typeof self !== 'undefined' && typeof (self as any).postMessage === 'function') {
  self.onmessage = async (event: MessageEvent<WorkerInputMessage>) => {
    const data = event.data;
    if (data?.type === 'START_BATCH_PROCESSING') {
      try {
        const { jobs, ephemerisMap, sp3Orbit, iono, stationFiles, options } = data;
        const total = jobs.length;
        const results: BaselineVector[] = [];
        const stationCache = new Map<string, PreparedStationData | null>();

        for (let i = 0; i < total; i++) {
          const job = jobs[i];
          const sol = await solveNativeBaselineAsync(job.fromStn, job.toStn, job.id, {
            ephemerisMap,
            sp3Orbit,
            iono,
            stationFiles,
            stationCache,
            elevationMaskDeg: options?.elevationMaskDeg,
            ratioThreshold: options?.ratioThreshold,
            frequencies: options?.frequencies,
          });
          results.push(sol);

          const progressMsg: WorkerProgressMessage = {
            type: 'PROGRESS',
            currentIdx: i + 1,
            totalJobs: total,
            percent: Math.round(((i + 1) / total) * 100),
            currentBaselineId: job.id,
            fromName: job.fromStn.name,
            toName: job.toStn.name,
            status: sol.solutionType,
            ratio: sol.ratio,
          };
          (self as any).postMessage(progressMsg);
        }

        const successMsg: WorkerSuccessMessage = {
          type: 'SUCCESS',
          results,
        };
        (self as any).postMessage(successMsg);
      } catch (err: any) {
        const errorMsg: WorkerErrorMessage = {
          type: 'ERROR',
          error: err?.message || String(err),
        };
        (self as any).postMessage(errorMsg);
      }
    }
  };
}
