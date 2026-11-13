/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Skyplot & GNSS Quality Control (QC) Mathematics Engine
 * Computes real polar satellite trajectories (Azimuth, Elevation) from loaded
 * .SP3 Precise Orbits or Broadcast Ephemeris, exact 4x4 (H^T H)^-1 DOP metrics,
 * real SNR profiles, TEQC Multipath MP1/MP2, and cycle-slip counts.
 */

import { GnssConstellation, SatelliteTrack, Station } from '../types/gnss';
import {
  BroadcastEphemeris,
  Sp3OrbitData,
  applySagnacCorrection,
  computeUnifiedSatelliteState,
  parseEpochStringToAbsGpsSec,
} from './rinexNavParser';
import { ParsedRinexObsEpoch } from './rinexStreamParser';
import { degToRad, invertMatrix, radToDeg } from './geodesy';

export interface SkyplotPoint {
  timeSec: number;
  azimuthDeg: number;   // 0° (North) to 360° clockwise
  elevationDeg: number; // 0° (Horizon) to 90° (Zenith)
  snrL1?: number;       // dB-Hz (from actual observation file if available)
  snrL2?: number;       // dB-Hz
  isMasked: boolean;    // elevation < mask
}

export interface SatelliteSkyTrack {
  satId: string;
  system: GnssConstellation;
  prn: number;
  points: SkyplotPoint[];
  hasOrbit: boolean;
  avgAzimuth: number;
  maxElevation: number;
  avgSnr: number;
  validEpochs: number;
  totalEpochs: number;
  multipathMp1?: number;
  multipathMp2?: number;
  multipathIndex: number;
  cycleSlips: number;
}

export interface DopMetrics {
  gdop: number;
  pdop: number;
  hdop: number;
  vdop: number;
  tdop: number;
  visibleSats: number;
}

/**
 * Converts polar Azimuth & Elevation to SVG/Canvas (X, Y)
 * Center is Zenith (90°). Outer circle is Horizon (0°).
 */
export function polarToCartesian(
  azimuthDeg: number,
  elevationDeg: number,
  radiusPx = 180,
  centerPx = 200
): { x: number; y: number } {
  const elClamped = Math.max(0, Math.min(90, elevationDeg));
  const rNorm = (90 - elClamped) / 90.0;
  const r = rNorm * radiusPx;

  const azRad = ((azimuthDeg - 90) * Math.PI) / 180.0;
  const x = centerPx + r * Math.cos(azRad);
  const y = centerPx + r * Math.sin(azRad);

  return { x, y };
}

function computeTopocentric(
  station: Station,
  satX: number,
  satY: number,
  satZ: number
): { azDeg: number; elDeg: number } {
  const phi = degToRad(station.lat);
  const lam = degToRad(station.lon);
  const sPhi = Math.sin(phi);
  const cPhi = Math.cos(phi);
  const sLam = Math.sin(lam);
  const cLam = Math.cos(lam);

  const dx = satX - station.x;
  const dy = satY - station.y;
  const dz = satZ - station.z;

  const e = -sLam * dx + cLam * dy;
  const n = -sPhi * cLam * dx - sPhi * sLam * dy + cPhi * dz;
  const u = cPhi * cLam * dx + cPhi * sLam * dy + sPhi * dz;

  const elDeg = radToDeg(Math.atan2(u, Math.sqrt(e * e + n * n)));
  let azDeg = radToDeg(Math.atan2(e, n));
  if (azDeg < 0) azDeg += 360.0;

  return { azDeg, elDeg };
}

/**
 * Computes true satellite Azimuth/Elevation tracks from loaded SP3 or Broadcast Ephemeris
 * and joins real SNR / Multipath / Cycle Slip values when parsed RINEX epochs are provided.
 * If no orbit exists for this PRN/epoch, `hasOrbit` is false and `points` is empty.
 */
export function generateSatelliteSkyTracks(
  sat: SatelliteTrack,
  station: Station,
  durationSec = 14400,
  elevationMask = 10,
  options?: {
    sp3Orbit?: Sp3OrbitData | null;
    ephemerisMap?: Record<string, BroadcastEphemeris[]>;
    obsEpochs?: ParsedRinexObsEpoch[];
  }
): SatelliteSkyTrack {
  const sp3Orbit = options?.sp3Orbit || null;
  const ephemerisMap = options?.ephemerisMap;
  const obsEpochs = options?.obsEpochs;

  const hasReceiverCoords = Math.hypot(station.x, station.y, station.z) > 1e6;
  const firstAbsSec =
    station.occupation?.firstEpochSec && station.occupation.firstEpochSec > 1e7
      ? station.occupation.firstEpochSec
      : parseEpochStringToAbsGpsSec(station.occupation?.firstEpochDate || station.observationDateStr);

  const points: SkyplotPoint[] = [];
  const startSec = sat.startSec || 0;
  const endSec = sat.endSec > startSec ? sat.endSec : Math.min(durationSec, startSec + (durationSec || 3600));

  let maxEl = 0;
  let snrSum = 0;
  let snrCount = 0;

  if (hasReceiverCoords && firstAbsSec !== null) {
    if (obsEpochs && obsEpochs.length > 0) {
      // Build track directly from actual parsed epochs containing this satellite
      const satEpochs = obsEpochs.filter((ep) => ep.sats[sat.satId] !== undefined);
      const stride = Math.max(1, Math.floor(satEpochs.length / 80));

      for (let i = 0; i < satEpochs.length; i += stride) {
        const ep = satEpochs[i];
        const meas = ep.sats[sat.satId];
        const orb = computeUnifiedSatelliteState(sat.satId, ep.absGpsSec - 0.075, sp3Orbit, ephemerisMap);
        if (!orb || orb.health !== 0) continue;

        const sag = applySagnacCorrection(orb.x, orb.y, orb.z, 0.075);
        const { azDeg, elDeg } = computeTopocentric(station, sag.x, sag.y, sag.z);
        if (elDeg < -5) continue;

        const elClamped = Math.max(0, elDeg);
        if (elClamped > maxEl) maxEl = elClamped;

        if (meas.s1 !== undefined && meas.s1 > 0) {
          snrSum += meas.s1;
          snrCount++;
        }

        points.push({
          timeSec: ep.relSec,
          azimuthDeg: Math.round(azDeg * 10) / 10,
          elevationDeg: Math.round(elClamped * 10) / 10,
          snrL1: meas.s1,
          snrL2: meas.s2,
          isMasked: elClamped < elevationMask,
        });
      }
    } else if (sp3Orbit || (ephemerisMap && Object.keys(ephemerisMap).length > 0)) {
      // Sample evenly over satellite tracking window using loaded ephemeris/SP3
      const steps = 40;
      const stepSize = Math.max(30, (endSec - startSec) / steps);

      for (let i = 0; i <= steps; i++) {
        const relT = startSec + i * stepSize;
        const absT = firstAbsSec + relT;
        const orb = computeUnifiedSatelliteState(sat.satId, absT - 0.075, sp3Orbit, ephemerisMap);
        if (!orb || orb.health !== 0) continue;

        const sag = applySagnacCorrection(orb.x, orb.y, orb.z, 0.075);
        const { azDeg, elDeg } = computeTopocentric(station, sag.x, sag.y, sag.z);
        if (elDeg < -5) continue;

        const elClamped = Math.max(0, elDeg);
        if (elClamped > maxEl) maxEl = elClamped;

        points.push({
          timeSec: relT,
          azimuthDeg: Math.round(azDeg * 10) / 10,
          elevationDeg: Math.round(elClamped * 10) / 10,
          snrL1: sat.avgSnr,
          isMasked: elClamped < elevationMask,
        });
      }
    }
  }

  const avgAzimuth = points.length > 0
    ? points.reduce((acc, p) => acc + p.azimuthDeg, 0) / points.length
    : 0;
  const avgSnr = snrCount > 0
    ? Math.round((snrSum / snrCount) * 10) / 10
    : (sat.avgSnr ?? 0);

  const mp1 = sat.multipathMp1;
  const mp2 = sat.multipathMp2;
  const multipathIndex = mp1 !== undefined
    ? Math.min(1, Math.round((mp1 / 1.5) * 100) / 100)
    : 0;

  return {
    satId: sat.satId,
    system: sat.system,
    prn: sat.prn,
    points,
    hasOrbit: points.length > 0,
    avgAzimuth: Math.round(avgAzimuth),
    maxElevation: Math.round(maxEl * 10) / 10,
    avgSnr,
    validEpochs: points.length > 0 ? points.filter((p) => !p.isMasked).length : sat.validEpochs,
    totalEpochs: points.length > 0 ? points.length : sat.totalEpochs,
    multipathMp1: mp1,
    multipathMp2: mp2,
    multipathIndex,
    cycleSlips: sat.cycleSlips ?? 0,
  };
}

/**
 * Computes Exact 4x4 (H^T H)^-1 Dilution of Precision (DOP) metrics
 * where H row = [-cos(el)*sin(az), -cos(el)*cos(az), -sin(el), 1] in ENU-Clock space
 */
export function computeDopMetrics(
  visibleSatTracks: SatelliteSkyTrack[],
  elevationMask = 10
): DopMetrics {
  const activeSats = visibleSatTracks.filter(
    (s) => s.hasOrbit && s.points.some((p) => p.elevationDeg >= elevationMask)
  );
  const n = activeSats.length;

  if (n < 4) {
    return {
      gdop: 0,
      pdop: 0,
      hdop: 0,
      vdop: 0,
      tdop: 0,
      visibleSats: n,
    };
  }

  const N: number[][] = [
    [0, 0, 0, 0],
    [0, 0, 0, 0],
    [0, 0, 0, 0],
    [0, 0, 0, 0],
  ];

  for (const sat of activeSats) {
    const mid = sat.points[Math.floor(sat.points.length / 2)] || sat.points[0];
    if (!mid) continue;
    const elRad = degToRad(mid.elevationDeg);
    const azRad = degToRad(mid.azimuthDeg);

    const h = [
      -Math.cos(elRad) * Math.sin(azRad),
      -Math.cos(elRad) * Math.cos(azRad),
      -Math.sin(elRad),
      1.0,
    ];

    for (let r = 0; r < 4; r++) {
      for (let c = 0; c < 4; c++) {
        N[r][c] += h[r] * h[c];
      }
    }
  }

  const Q = invertMatrix(N);
  if (!Q) {
    return {
      gdop: 99.9,
      pdop: 99.9,
      hdop: 99.9,
      vdop: 99.9,
      tdop: 99.9,
      visibleSats: n,
    };
  }

  const qEE = Math.max(0, Q[0][0]);
  const qNN = Math.max(0, Q[1][1]);
  const qUU = Math.max(0, Q[2][2]);
  const qTT = Math.max(0, Q[3][3]);

  const hdop = Math.sqrt(qEE + qNN);
  const vdop = Math.sqrt(qUU);
  const pdop = Math.sqrt(qEE + qNN + qUU);
  const tdop = Math.sqrt(qTT);
  const gdop = Math.sqrt(qEE + qNN + qUU + qTT);

  return {
    gdop: Math.min(99.9, Math.round(gdop * 10) / 10),
    pdop: Math.min(99.9, Math.round(pdop * 10) / 10),
    hdop: Math.min(99.9, Math.round(hdop * 10) / 10),
    vdop: Math.min(99.9, Math.round(vdop * 10) / 10),
    tdop: Math.min(99.9, Math.round(tdop * 10) / 10),
    visibleSats: n,
  };
}
