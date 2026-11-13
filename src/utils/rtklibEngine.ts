/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * RTKLIB-Standard Multi-GNSS Double Difference (DD) Baseline Orchestrator
 * Coordinates asynchronous Web Worker (with seamless main-thread fallback),
 * forwards SP3 + Broadcast ephemeris + Klobuchar Iono + cached RINEX File handles,
 * and derives ANTEX / marker-to-marker baseline vectors and covariance matrices.
 */

import { BaselineVector, Station, SolutionStatus } from '../types/gnss';
import { degToRad, calculateCorrectedAntennaHeight } from './geodesy';
import {
  PreparedStationData,
  WorkerBaselineJob,
  WorkerInputMessage,
  WorkerProgressMessage,
  solveNativeBaselineAsync,
} from '../workers/gnssBaselineWorker';
import { BroadcastEphemeris, IonoParameters, Sp3OrbitData } from './rinexNavParser';
import { getCachedFilesRecord } from './opfsStorage';

export interface RtklibProcessingOptions {
  frequencies?: 'L1' | 'L1+L2' | 'Multi-GNSS';
  elevationMaskDeg?: number; // default 10°
  ratioThreshold?: number;   // default 3.0
  dynamics?: 'STATIC' | 'KINEMATIC';
  ionoOption?: 'OFF' | 'IONO_FREE';
  tropoOption?: 'SAASTAMOINEN';
  snrMaskDeg?: number;
  ephemerisMap?: Record<string, BroadcastEphemeris[]>;
  sp3Orbit?: Sp3OrbitData | null;
  iono?: IonoParameters;
}

export interface DoubleDifferenceSolution {
  fromId: string;
  toId: string;
  dX: number; // m
  dY: number; // m
  dZ: number; // m
  length: number; // m
  covMatrix: {
    qxx: number;
    qyy: number;
    qzz: number;
    qxy: number;
    qyz: number;
    qzx: number;
  };
  stdDevMm: {
    sigmaX: number;
    sigmaY: number;
    sigmaZ: number;
    sigmaSpatial: number;
  };
  correlation: {
    rxy: number;
    ryz: number;
    rzx: number;
  };
  status: SolutionStatus;
  ratio: number;
  pivotSatellite: string;
  commonSatellites: string[];
  rmsMeters: number;
  durationMin: number;
  pdop: number;
  orbitSource?: 'SP3' | 'NAV';
  frequencyMode?: string;
  commonEpochs?: number;
  cycleSlips?: number;
  diagnostics?: string;
}

/**
 * Computes antenna Phase Center Offset (PCO) + ARP Height in ECEF frame
 */
export function computeAntennaEcefOffset(st: Station): { dx: number; dy: number; dz: number } {
  const pcoL1 = st.antenna.pcoL1 || { n: 0, e: 0, u: 0 };
  const pcoL2 = st.antenna.pcoL2 || { n: 0, e: 0, u: 0 };

  const c1 = 2.545728;
  const c2 = 1.545728;
  const pcoE_m = (c1 * pcoL1.e - c2 * pcoL2.e) / 1000.0 + (st.antenna.deltaE || 0);
  const pcoN_m = (c1 * pcoL1.n - c2 * pcoL2.n) / 1000.0 + (st.antenna.deltaN || 0);
  const pcoU_m = (c1 * pcoL1.u - c2 * pcoL2.u) / 1000.0;

  const arpHeightM = calculateCorrectedAntennaHeight(
    st.antenna.heightType,
    st.antenna.measuredHeight,
    st.antenna.radius,
    st.antenna.verticalOffset
  );
  const totalUp_m = arpHeightM + pcoU_m;

  const phi = degToRad(st.lat);
  const lam = degToRad(st.lon);
  const sPhi = Math.sin(phi);
  const cPhi = Math.cos(phi);
  const sLam = Math.sin(lam);
  const cLam = Math.cos(lam);

  const dEcefX = -sLam * pcoE_m - sPhi * cLam * pcoN_m + cPhi * cLam * totalUp_m;
  const dEcefY = cLam * pcoE_m - sPhi * sLam * pcoN_m + cPhi * sLam * totalUp_m;
  const dEcefZ = cPhi * pcoN_m + sPhi * totalUp_m;

  return { dx: dEcefX, dy: dEcefY, dz: dEcefZ };
}

/**
 * Solves a single Double Difference Baseline asynchronously from real RINEX files in OPFS
 */
export async function solveDoubleDifferenceBaselineAsync(
  fromStn: Station,
  toStn: Station,
  options: RtklibProcessingOptions = {}
): Promise<DoubleDifferenceSolution> {
  const stationFiles = getCachedFilesRecord();
  const nativeSol = await solveNativeBaselineAsync(
    fromStn,
    toStn,
    `BASE_${fromStn.id}_${toStn.id}`,
    {
      ephemerisMap: options.ephemerisMap,
      sp3Orbit: options.sp3Orbit,
      iono: options.iono,
      stationFiles,
      elevationMaskDeg: options.elevationMaskDeg ?? 10,
      ratioThreshold: options.ratioThreshold ?? 3.0,
      frequencies: options.frequencies ?? 'L1+L2',
    }
  );

  const sigmaX = Math.sqrt(Math.max(1e-12, nativeSol.qxx)) * 1000.0;
  const sigmaY = Math.sqrt(Math.max(1e-12, nativeSol.qyy)) * 1000.0;
  const sigmaZ = Math.sqrt(Math.max(1e-12, nativeSol.qzz)) * 1000.0;
  const sigmaSpatial = Math.sqrt(sigmaX * sigmaX + sigmaY * sigmaY + sigmaZ * sigmaZ);

  const denomXY = Math.sqrt(Math.max(1e-18, nativeSol.qxx * nativeSol.qyy));
  const denomYZ = Math.sqrt(Math.max(1e-18, nativeSol.qyy * nativeSol.qzz));
  const denomZX = Math.sqrt(Math.max(1e-18, nativeSol.qzz * nativeSol.qxx));

  const rxy = nativeSol.qxy / denomXY;
  const ryz = nativeSol.qyz / denomYZ;
  const rzx = nativeSol.qzx / denomZX;

  const fromSats = new Set(fromStn.occupation?.satellites?.map((s) => s.satId) || []);
  const toSats = new Set(toStn.occupation?.satellites?.map((s) => s.satId) || []);
  const commonSats = Array.from(fromSats).filter((id) => toSats.has(id));

  return {
    fromId: fromStn.id,
    toId: toStn.id,
    dX: nativeSol.dX,
    dY: nativeSol.dY,
    dZ: nativeSol.dZ,
    length: nativeSol.length,
    covMatrix: {
      qxx: nativeSol.qxx,
      qyy: nativeSol.qyy,
      qzz: nativeSol.qzz,
      qxy: nativeSol.qxy,
      qyz: nativeSol.qyz,
      qzx: nativeSol.qzx,
    },
    stdDevMm: {
      sigmaX: Math.round(sigmaX * 10) / 10,
      sigmaY: Math.round(sigmaY * 10) / 10,
      sigmaZ: Math.round(sigmaZ * 10) / 10,
      sigmaSpatial: Math.round(sigmaSpatial * 10) / 10,
    },
    correlation: {
      rxy: Math.round((isFinite(rxy) ? rxy : 0) * 100) / 100,
      ryz: Math.round((isFinite(ryz) ? ryz : 0) * 100) / 100,
      rzx: Math.round((isFinite(rzx) ? rzx : 0) * 100) / 100,
    },
    status: nativeSol.solutionType,
    ratio: nativeSol.ratio,
    pivotSatellite: nativeSol.pivotSatellite || '-',
    commonSatellites: commonSats,
    rmsMeters: nativeSol.rms,
    durationMin: nativeSol.durationMin,
    pdop: nativeSol.pdop,
    orbitSource: nativeSol.orbitSource,
    frequencyMode: nativeSol.frequencyMode,
    commonEpochs: nativeSol.commonEpochs,
    cycleSlips: nativeSol.cycleSlips,
    diagnostics: nativeSol.diagnostics,
  };
}

/**
 * Builds standard closed-loop network baseline topology (CORS-Rover + CORS-CORS + Rover-Rover)
 */
export function buildNetworkBaselineJobs(stations: Record<string, Station>): WorkerBaselineJob[] {
  const stationList = Object.values(stations);
  if (stationList.length < 2) return [];

  const baseStations = stationList.filter((s) => s.type === 'CORS' || (s.isFixed.x && s.isFixed.y && s.isFixed.z));
  const roverStations = stationList.filter((s) => !baseStations.includes(s));

  const pairsToProcess: Array<[Station, Station]> = [];
  const processedKeys = new Set<string>();

  for (const base of baseStations) {
    for (const rover of roverStations) {
      pairsToProcess.push([base, rover]);
    }
  }

  for (let i = 0; i < baseStations.length; i++) {
    for (let j = i + 1; j < baseStations.length; j++) {
      pairsToProcess.push([baseStations[i], baseStations[j]]);
    }
  }

  for (let i = 0; i < roverStations.length; i++) {
    for (let j = i + 1; j < roverStations.length; j++) {
      pairsToProcess.push([roverStations[i], roverStations[j]]);
    }
  }

  if (pairsToProcess.length === 0) {
    for (let i = 0; i < stationList.length; i++) {
      for (let j = i + 1; j < stationList.length; j++) {
        pairsToProcess.push([stationList[i], stationList[j]]);
      }
    }
  }

  const jobs: WorkerBaselineJob[] = [];
  let bIdx = 1;

  for (const [s1, s2] of pairsToProcess) {
    const pairKey = [s1.id, s2.id].sort().join('___');
    if (processedKeys.has(pairKey)) continue;
    processedKeys.add(pairKey);

    jobs.push({
      id: `BASE_${String(bIdx).padStart(2, '0')}`,
      fromStn: s1,
      toStn: s2,
    });
    bIdx++;
  }

  return jobs;
}

/**
 * Asynchronous Multithreaded Web Worker Network Baseline Processor
 */
export async function batchProcessNetworkBaselinesAsync(
  stations: Record<string, Station>,
  options: RtklibProcessingOptions = {},
  onProgress?: (progress: WorkerProgressMessage) => void
): Promise<BaselineVector[]> {
  const jobs = buildNetworkBaselineJobs(stations);
  if (jobs.length === 0) return [];

  const stationFiles = getCachedFilesRecord();

  // Attempt Web Worker execution
  if (typeof Worker !== 'undefined') {
    try {
      return await new Promise<BaselineVector[]>((resolve, reject) => {
        const worker = new Worker(
          new URL('../workers/gnssBaselineWorker.ts', import.meta.url),
          { type: 'module' }
        );

        worker.onmessage = (e: MessageEvent<any>) => {
          const msg = e.data;
          if (msg.type === 'PROGRESS') {
            if (onProgress) onProgress(msg);
          } else if (msg.type === 'SUCCESS') {
            worker.terminate();
            resolve(msg.results);
          } else if (msg.type === 'ERROR') {
            worker.terminate();
            reject(new Error(msg.error));
          }
        };

        worker.onerror = (err) => {
          worker.terminate();
          reject(err);
        };

        const startMsg: WorkerInputMessage = {
          type: 'START_BATCH_PROCESSING',
          jobs,
          ephemerisMap: options.ephemerisMap,
          sp3Orbit: options.sp3Orbit,
          iono: options.iono,
          stationFiles,
          options: {
            elevationMaskDeg: options.elevationMaskDeg ?? 10,
            ratioThreshold: options.ratioThreshold ?? 3.0,
            frequencies: options.frequencies ?? 'L1+L2',
          },
        };

        worker.postMessage(startMsg);
      });
    } catch (err) {
      console.warn('Worker initialization fallback to async main thread:', err);
    }
  }

  // Reliable main-thread async fallback
  const results: BaselineVector[] = [];
  const stationCache = new Map<string, PreparedStationData | null>();

  for (let i = 0; i < jobs.length; i++) {
    const job = jobs[i];
    const sol = await solveNativeBaselineAsync(job.fromStn, job.toStn, job.id, {
      ephemerisMap: options.ephemerisMap,
      sp3Orbit: options.sp3Orbit,
      iono: options.iono,
      stationFiles,
      stationCache,
      elevationMaskDeg: options.elevationMaskDeg,
      ratioThreshold: options.ratioThreshold,
      frequencies: options.frequencies,
    });
    results.push(sol);

    if (onProgress) {
      onProgress({
        type: 'PROGRESS',
        currentIdx: i + 1,
        totalJobs: jobs.length,
        percent: Math.round(((i + 1) / jobs.length) * 100),
        currentBaselineId: job.id,
        fromName: job.fromStn.name,
        toName: job.toStn.name,
        status: sol.solutionType,
        ratio: sol.ratio,
      });
    }
    await new Promise((r) => setTimeout(r, 10));
  }
  return results;
}
