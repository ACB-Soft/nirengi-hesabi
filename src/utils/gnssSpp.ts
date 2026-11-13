/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Weighted Least-Squares GNSS Single Point Positioning (SPP) Engine
 * Computes:
 * 1. Iterative multi-epoch weighted pseudorange position (ECEF X, Y, Z)
 *    using GPS, GLONASS, and Galileo with per-constellation ISB parameters.
 * 2. Exact per-epoch receiver clock bias `epochClocks[absGpsSec]` in seconds
 *    for epoch synchronization between Base and Rover in Double-Difference EKF.
 */

import { Station } from '../types/gnss';
import { ParsedRinexObsEpoch, ParsedObsMeasurement } from './rinexStreamParser';
import {
  BroadcastEphemeris,
  IonoParameters,
  Sp3OrbitData,
  applySagnacCorrection,
  computeKlobucharIonoDelay,
  computeSaastamoinenTropo,
  computeUnifiedSatelliteState,
} from './rinexNavParser';
import { ecefToGeodetic, degToRad, invertMatrix } from './geodesy';

const SPEED_OF_LIGHT = 299792458.0;
const EARTH_RADIUS_M = 6371000.0;

export interface SppSolution {
  x: number;
  y: number;
  z: number;
  lat: number;
  lon: number;
  h: number;
  rms: number;
  epochsUsed: number;
  epochClocks: Record<number, number>; // rounded/keyed absGpsSec -> dt_rx (s)
}

function computeTopocentricAzEl(
  latDeg: number,
  lonDeg: number,
  rx: [number, number, number],
  sx: [number, number, number]
): { azRad: number; elRad: number; range: number } {
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
  return { azRad, elRad, range };
}

function getIonoFreePseudorange(m: ParsedObsMeasurement, tgdSec = 0): number | null {
  if (m.c1 === undefined) return null;
  if (m.c2 !== undefined && m.f2Hz && m.f2Hz !== m.f1Hz) {
    const f1Sq = m.f1Hz * m.f1Hz;
    const f2Sq = m.f2Hz * m.f2Hz;
    const denom = f1Sq - f2Sq;
    if (Math.abs(denom) > 1e6) {
      return (f1Sq * m.c1 - f2Sq * m.c2) / denom;
    }
  }
  // Single-frequency pseudorange; subtract broadcast TGD when needed (already deducted in orbit.dts for GPS L1, keep consistent)
  void tgdSec;
  return m.c1;
}

/**
 * Estimates receiver ECEF coordinates and per-epoch clock bias from RINEX pseudorange observations.
 */
export function runSppForStation(
  station: Pick<Station, 'x' | 'y' | 'z'>,
  epochs: ParsedRinexObsEpoch[],
  sp3Orbit?: Sp3OrbitData | null,
  ephemerisMap?: Record<string, BroadcastEphemeris[]>,
  iono?: IonoParameters,
  elevationMaskDeg = 10
): SppSolution | null {
  if (!epochs || epochs.length === 0) return null;
  if (!sp3Orbit && (!ephemerisMap || Object.keys(ephemerisMap).length === 0)) {
    return null;
  }

  // Pick initial XYZ: use station approx if non-zero, otherwise seed from Earth-radius projection of visible satellite centroid
  let rx = station.x || 0;
  let ry = station.y || 0;
  let rz = station.z || 0;

  if (Math.hypot(rx, ry, rz) < 1e6) {
    const ep0 = epochs[0];
    let sxSum = 0, sySum = 0, szSum = 0, count = 0;
    for (const satId of Object.keys(ep0.sats)) {
      const m = ep0.sats[satId];
      if (m.c1 === undefined) continue;
      const orb = computeUnifiedSatelliteState(satId, ep0.absGpsSec - 0.075, sp3Orbit, ephemerisMap);
      if (orb && orb.health === 0) {
        sxSum += orb.x;
        sySum += orb.y;
        szSum += orb.z;
        count++;
      }
    }
    if (count > 0) {
      const norm = Math.hypot(sxSum, sySum, szSum) || 1;
      rx = (sxSum / norm) * EARTH_RADIUS_M;
      ry = (sySum / norm) * EARTH_RADIUS_M;
      rz = (szSum / norm) * EARTH_RADIUS_M;
    } else {
      rx = 4150000;
      ry = 2800000;
      rz = 3950000;
    }
  }

  const elMaskRad = degToRad(elevationMaskDeg);

  // Choose up to 30 evenly spaced epochs for joint position estimation
  const posStep = Math.max(1, Math.floor(epochs.length / 30));
  const sampleEpochs: ParsedRinexObsEpoch[] = [];
  for (let i = 0; i < epochs.length && sampleEpochs.length < 30; i += posStep) {
    sampleEpochs.push(epochs[i]);
  }

  // Track clock bias (in meters: c * dt_rx) and inter-system biases per sample epoch
  const clkMeters = new Array(sampleEpochs.length).fill(0);
  let isbR = 0;
  let isbE = 0;
  let lastRms = 0;

  // Iterative Epoch-by-Epoch Clock Alignment + Multi-Epoch Gauss-Newton Coordinate Refinement
  for (let outer = 0; outer < 6; outer++) {
    const geo = ecefToGeodetic(rx, ry, rz);

    // 1. Update each sample epoch clock bias first so linearizations around clock are tight
    for (let eIdx = 0; eIdx < sampleEpochs.length; eIdx++) {
      const ep = sampleEpochs[eIdx];
      const satIds = Object.keys(ep.sats);
      const clockResids: number[] = [];

      for (const satId of satIds) {
        const m = ep.sats[satId];
        const pr = getIonoFreePseudorange(m);
        if (pr === null || pr < 1e7 || pr > 4e7) continue;

        const dtApprox = clkMeters[eIdx] / SPEED_OF_LIGHT;
        const tTx = ep.absGpsSec - dtApprox - pr / SPEED_OF_LIGHT;
        const orb = computeUnifiedSatelliteState(satId, tTx, sp3Orbit, ephemerisMap);
        if (!orb || orb.health !== 0) continue;

        const tau = pr / SPEED_OF_LIGHT;
        const sag = applySagnacCorrection(orb.x, orb.y, orb.z, tau);
        const dx = sag.x - rx;
        const dy = sag.y - ry;
        const dz = sag.z - rz;
        const geomDist = Math.sqrt(dx * dx + dy * dy + dz * dz);

        const sysOffset = m.system === 'R' ? isbR : m.system === 'E' ? isbE : 0;
        const rawClkRes = pr - geomDist + SPEED_OF_LIGHT * orb.dts - sysOffset;
        if (Math.abs(rawClkRes) < 3e7) {
          clockResids.push(rawClkRes);
        }
      }

      if (clockResids.length > 0) {
        clockResids.sort((a, b) => a - b);
        clkMeters[eIdx] = clockResids[Math.floor(clockResids.length / 2)];
      }
    }

    // 2. Build joint normal equations for [dX, dY, dZ, isbR, isbE] + eliminate epoch clocks via Schur complement or direct solve
    // Unknown vector: [dX, dY, dZ, dIsbR, dIsbE, dClk_0 ... dClk_{k-1}]
    const hasR = sampleEpochs.some((ep) => Object.values(ep.sats).some((m) => m.system === 'R' && m.c1 !== undefined));
    const hasE = sampleEpochs.some((ep) => Object.values(ep.sats).some((m) => m.system === 'E' && m.c1 !== undefined));
    const idxR = hasR ? 3 : -1;
    const idxE = hasE ? (hasR ? 4 : 3) : -1;
    const baseUnknowns = 3 + (hasR ? 1 : 0) + (hasE ? 1 : 0);

    // Eliminate epoch clocks analytically per epoch (1x1 block) into 5x5 global normal equations N_pos, u_pos
    const Np: number[][] = Array.from({ length: baseUnknowns }, () => new Array(baseUnknowns).fill(0));
    const up = new Array(baseUnknowns).fill(0);
    let sqErrSum = 0;
    let totalObsCount = 0;

    for (let eIdx = 0; eIdx < sampleEpochs.length; eIdx++) {
      const ep = sampleEpochs[eIdx];
      const H_rows: number[][] = [];
      const w_rows: number[] = [];
      const v_rows: number[] = [];

      for (const satId of Object.keys(ep.sats)) {
        const m = ep.sats[satId];
        const pr = getIonoFreePseudorange(m);
        if (pr === null || pr < 1e7 || pr > 4e7) continue;

        const dtRx = clkMeters[eIdx] / SPEED_OF_LIGHT;
        let tau = pr / SPEED_OF_LIGHT;
        let orb = computeUnifiedSatelliteState(satId, ep.absGpsSec - dtRx - tau, sp3Orbit, ephemerisMap);
        if (!orb || orb.health !== 0) continue;

        // 2nd light-time refinement using satellite clock
        tau = pr / SPEED_OF_LIGHT - orb.dts;
        orb = computeUnifiedSatelliteState(satId, ep.absGpsSec - dtRx - tau, sp3Orbit, ephemerisMap);
        if (!orb || orb.health !== 0) continue;

        const sag = applySagnacCorrection(orb.x, orb.y, orb.z, tau);
        const { azRad, elRad, range } = computeTopocentricAzEl(geo.lat, geo.lon, [rx, ry, rz], [sag.x, sag.y, sag.z]);
        if (outer >= 1 && elRad < elMaskRad) continue;

        const tropo = outer >= 1 ? computeSaastamoinenTropo(geo.h, elRad) : 0;
        const isDualFreq = m.c2 !== undefined && m.f2Hz !== undefined;
        const ionoDelay = (outer >= 1 && !isDualFreq)
          ? computeKlobucharIonoDelay(geo.lat, geo.lon, azRad, elRad, ep.absGpsSec, iono) * Math.pow(1575.42e6 / m.f1Hz, 2)
          : 0;

        const sysOffset = m.system === 'R' ? isbR : m.system === 'E' ? isbE : 0;
        const modeled = range + clkMeters[eIdx] - SPEED_OF_LIGHT * orb.dts + tropo + ionoDelay + sysOffset;
        const resid = pr - modeled;

        // Huber / outlier gate after initial alignment
        if (outer >= 2 && Math.abs(resid) > 25.0) continue;

        const sinEl = Math.max(0.15, Math.sin(Math.max(0.05, elRad)));
        const weight = (sinEl * sinEl) / (isDualFreq ? 2.25 : 4.0);

        const row = new Array(baseUnknowns).fill(0);
        row[0] = -(sag.x - rx) / range;
        row[1] = -(sag.y - ry) / range;
        row[2] = -(sag.z - rz) / range;
        if (m.system === 'R' && idxR >= 0) row[idxR] = 1.0;
        if (m.system === 'E' && idxE >= 0) row[idxE] = 1.0;

        H_rows.push(row);
        w_rows.push(weight);
        v_rows.push(resid);
        sqErrSum += resid * resid;
        totalObsCount++;
      }

      if (H_rows.length < 4) continue;

      // Eliminate single epoch clock parameter c_e via Schur complement:
      // sum_i w_i * (H_i * dx + dc_e - v_i)^2  =>  N_e = N_H - (g * g^T) / s
      let s = 0;
      const g = new Array(baseUnknowns).fill(0);
      let bClk = 0;

      for (let i = 0; i < H_rows.length; i++) {
        const w = w_rows[i];
        const r = H_rows[i];
        s += w;
        bClk += w * v_rows[i];
        for (let a = 0; a < baseUnknowns; a++) {
          g[a] += w * r[a];
          up[a] += w * r[a] * v_rows[i];
          for (let b = 0; b < baseUnknowns; b++) {
            Np[a][b] += w * r[a] * r[b];
          }
        }
      }

      if (s > 1e-12) {
        for (let a = 0; a < baseUnknowns; a++) {
          up[a] -= (g[a] * bClk) / s;
          for (let b = 0; b < baseUnknowns; b++) {
            Np[a][b] -= (g[a] * g[b]) / s;
          }
        }
      }
    }

    if (totalObsCount < 4) break;
    lastRms = Math.sqrt(sqErrSum / totalObsCount);

    const invN = invertMatrix(Np);
    if (!invN) break;

    const dx = new Array(baseUnknowns).fill(0);
    for (let r = 0; r < baseUnknowns; r++) {
      for (let c = 0; c < baseUnknowns; c++) {
        dx[r] += invN[r][c] * up[c];
      }
    }

    rx += dx[0];
    ry += dx[1];
    rz += dx[2];
    if (idxR >= 0) isbR += dx[idxR];
    if (idxE >= 0) isbE += dx[idxE];

    const stepNorm = Math.hypot(dx[0], dx[1], dx[2]);
    if (outer >= 2 && stepNorm < 1e-3) break;
  }

  // Solve exact clock bias for EVERY epoch with converged [rx, ry, rz]
  const finalGeo = ecefToGeodetic(rx, ry, rz);
  const epochClocks: Record<number, number> = {};
  let validEpochCount = 0;
  let finalSq = 0;
  let finalObs = 0;

  for (const ep of epochs) {
    let dtRxApprox = 0;

    for (let pass = 0; pass < 2; pass++) {
      const residList: number[] = [];

      for (const satId of Object.keys(ep.sats)) {
        const m = ep.sats[satId];
        const pr = getIonoFreePseudorange(m);
        if (pr === null || pr < 1e7 || pr > 4e7) continue;

        let tau = pr / SPEED_OF_LIGHT;
        let orb = computeUnifiedSatelliteState(satId, ep.absGpsSec - dtRxApprox - tau, sp3Orbit, ephemerisMap);
        if (!orb || orb.health !== 0) continue;

        tau = pr / SPEED_OF_LIGHT - orb.dts;
        orb = computeUnifiedSatelliteState(satId, ep.absGpsSec - dtRxApprox - tau, sp3Orbit, ephemerisMap);
        if (!orb || orb.health !== 0) continue;

        const sag = applySagnacCorrection(orb.x, orb.y, orb.z, tau);
        const { azRad, elRad, range } = computeTopocentricAzEl(finalGeo.lat, finalGeo.lon, [rx, ry, rz], [sag.x, sag.y, sag.z]);
        if (pass >= 1 && elRad < elMaskRad) continue;

        const tropo = computeSaastamoinenTropo(finalGeo.h, elRad);
        const isDual = m.c2 !== undefined && m.f2Hz !== undefined;
        const ionoDelay = !isDual
          ? computeKlobucharIonoDelay(finalGeo.lat, finalGeo.lon, azRad, elRad, ep.absGpsSec - dtRxApprox, iono) * Math.pow(1575.42e6 / m.f1Hz, 2)
          : 0;
        const sysOffset = m.system === 'R' ? isbR : m.system === 'E' ? isbE : 0;
        residList.push(pr - range + SPEED_OF_LIGHT * orb.dts - tropo - ionoDelay - sysOffset);
      }

      if (residList.length < 3) break;
      residList.sort((a, b) => a - b);
      const med = residList[Math.floor(residList.length / 2)];
      const inliers = residList.filter((v) => Math.abs(v - med) < 25.0);
      if (inliers.length === 0) break;

      const clkM = inliers.reduce((a, b) => a + b, 0) / inliers.length;
      dtRxApprox = clkM / SPEED_OF_LIGHT;

      if (pass === 1) {
        for (const v of inliers) {
          finalSq += (v - clkM) * (v - clkM);
          finalObs++;
        }
        epochClocks[Math.round(ep.absGpsSec * 10)] = dtRxApprox;
        validEpochCount++;
      }
    }
  }

  if (validEpochCount === 0) return null;

  return {
    x: rx,
    y: ry,
    z: rz,
    lat: finalGeo.lat,
    lon: finalGeo.lon,
    h: finalGeo.h,
    rms: finalObs > 0 ? Math.sqrt(finalSq / finalObs) : lastRms,
    epochsUsed: validEpochCount,
    epochClocks,
  };
}
