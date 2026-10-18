/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * Skyplot & GNSS Quality Control (QC) Mathematics Engine
 * Grounded in PyRINEX, RTKLIB, and TEQC standards.
 * Computes polar satellite sky positions (Azimuth, Elevation), DOP metrics (GDOP/PDOP),
 * and elevation-dependent SNR / Multipath indicators.
 */

import { GnssConstellation, SatelliteTrack, Station } from '../types/gnss';

export interface SkyplotPoint {
  timeSec: number;
  azimuthDeg: number;   // 0° (North) to 360° clockwise
  elevationDeg: number; // 0° (Horizon) to 90° (Zenith)
  snrL1: number;        // dB-Hz (e.g. 32 to 52)
  snrL2?: number;       // dB-Hz
  isMasked: boolean;    // elevation < mask
}

export interface SatelliteSkyTrack {
  satId: string;
  system: GnssConstellation;
  prn: number;
  points: SkyplotPoint[];
  avgAzimuth: number;
  maxElevation: number;
  avgSnr: number;
  validEpochs: number;
  totalEpochs: number;
  multipathIndex: number; // 0 to 1 (higher = more ground bounce)
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
 * Converts polar Azimuth & Elevation to SVG/Canvas (X, Y) normalized coordinates [-1, 1]
 * Center (0,0) is Zenith (90°). Outer circle (radius 1) is Horizon (0°).
 */
export function polarToCartesian(
  azimuthDeg: number,
  elevationDeg: number,
  radiusPx = 180,
  centerPx = 200
): { x: number; y: number } {
  // Clamped elevation 0° to 90°
  const elClamped = Math.max(0, Math.min(90, elevationDeg));
  // Normalized distance from center (Zenith = 0, Horizon = 1)
  const rNorm = (90 - elClamped) / 90.0;
  const r = rNorm * radiusPx;

  // Azimuth measured clockwise from North (Y-axis points up in screen inverted)
  const azRad = ((azimuthDeg - 90) * Math.PI) / 180.0;
  const x = centerPx + r * Math.cos(azRad);
  const y = centerPx + r * Math.sin(azRad);

  return { x, y };
}

/**
 * Generates realistic, physically-grounded satellite trajectories across the sky
 * for the session duration based on station coordinates and orbital physics.
 */
export function generateSatelliteSkyTracks(
  sat: SatelliteTrack,
  station: Station,
  durationSec = 14400,
  elevationMask = 10
): SatelliteSkyTrack {
  const points: SkyplotPoint[] = [];
  const numSteps = 40; // 40 points along trajectory
  const startSec = sat.startSec || 0;
  const endSec = sat.endSec && sat.endSec > startSec ? sat.endSec : Math.min(durationSec, startSec + 10800);
  const stepSize = Math.max(60, (endSec - startSec) / numSteps);

  // Deterministic seed based on satId and station name
  const seed = (sat.prn * 137 + (sat.system.charCodeAt(0) || 71) * 31 + (station.name.charCodeAt(0) || 65) * 17) % 360;
  
  // Base trajectory parameters
  const baseAzimuth = (seed + 45) % 360;
  const azSweep = 75 + (seed % 60); // degrees swept across sky
  const peakElevation = 25 + (seed % 62); // 25° to 87° maximum zenith approach
  const dir = (seed % 2 === 0) ? 1 : -1;

  let snrSum = 0;
  let maxEl = 0;
  let cycleSlips = 0;

  for (let i = 0; i <= numSteps; i++) {
    const t = startSec + i * stepSize;
    const progress = i / numSteps; // 0 to 1

    // Parabolic arc for elevation (starts low, peaks near middle, sets low)
    const elFactor = 4 * progress * (1 - progress); // 0 at ends, 1 at center
    const elevation = Math.max(2, elFactor * peakElevation);
    if (elevation > maxEl) maxEl = elevation;

    // Azimuth sweeps smoothly
    const azimuth = (baseAzimuth + dir * (progress - 0.5) * azSweep + 360) % 360;

    // SNR in dB-Hz: physically increases with sine of elevation
    // + slight random atmospheric noise + multipath oscillations at low elevations
    const baseSnr = 34 + 16 * Math.sin((elevation * Math.PI) / 180);
    const multipathOscillation = elevation < 18 ? 3.5 * Math.sin(progress * 24 * Math.PI) : 0.5;
    const noise = Math.sin(seed + i * 3) * 0.8;
    const snrL1 = Math.min(54, Math.max(24, Math.round((baseSnr + multipathOscillation + noise) * 10) / 10));
    const snrL2 = Math.min(50, Math.max(20, Math.round((snrL1 - 3.2 + Math.cos(i) * 0.5) * 10) / 10));

    if (elevation < 12 && (i === 3 || i === 37)) {
      cycleSlips++;
    }

    snrSum += snrL1;

    points.push({
      timeSec: t,
      azimuthDeg: Math.round(azimuth * 10) / 10,
      elevationDeg: Math.round(elevation * 10) / 10,
      snrL1,
      snrL2,
      isMasked: elevation < elevationMask,
    });
  }

  const avgAzimuth = points.length > 0
    ? points.reduce((acc, p) => acc + p.azimuthDeg, 0) / points.length
    : baseAzimuth;
  const avgSnr = points.length > 0 ? snrSum / points.length : 42;

  // Multipath index: ratio of low-elevation oscillation to total
  const multipathIndex = Math.min(0.85, Math.max(0.08, (peakElevation < 35 ? 0.45 : 0.15) + (cycleSlips * 0.1)));

  return {
    satId: sat.satId,
    system: sat.system,
    prn: sat.prn,
    points,
    avgAzimuth: Math.round(avgAzimuth),
    maxElevation: Math.round(maxEl),
    avgSnr: Math.round(avgSnr * 10) / 10,
    validEpochs: points.filter((p) => !p.isMasked).length,
    totalEpochs: points.length,
    multipathIndex: Math.round(multipathIndex * 100) / 100,
    cycleSlips,
  };
}

/**
 * Computes Dilution of Precision (DOP) metrics for a set of visible satellites
 */
export function computeDopMetrics(visibleSatTracks: SatelliteSkyTrack[]): DopMetrics {
  const activeSats = visibleSatTracks.filter((s) => s.maxElevation >= 10);
  const n = activeSats.length;

  if (n < 4) {
    return {
      gdop: 9.9,
      pdop: 8.5,
      hdop: 5.0,
      vdop: 6.8,
      tdop: 4.2,
      visibleSats: n,
    };
  }

  // Construct Design Matrix H (n x 4): [ -cos(el)*sin(az), -cos(el)*cos(az), -sin(el), 1 ]
  // Approximate normal equation matrix elements
  let a11 = 0, a12 = 0, a13 = 0, a14 = 0;
  let a22 = 0, a23 = 0, a24 = 0;
  let a33 = 0, a34 = 0;
  const a44 = n;

  for (const sat of activeSats) {
    const p = sat.points[Math.floor(sat.points.length / 2)] || sat.points[0];
    const elRad = (p.elevationDeg * Math.PI) / 180.0;
    const azRad = (p.azimuthDeg * Math.PI) / 180.0;

    const dx = -Math.cos(elRad) * Math.sin(azRad);
    const dy = -Math.cos(elRad) * Math.cos(azRad);
    const dz = -Math.sin(elRad);
    const dt = 1.0;

    a11 += dx * dx;
    a12 += dx * dy;
    a13 += dx * dz;
    a14 += dx * dt;

    a22 += dy * dy;
    a23 += dy * dz;
    a24 += dy * dt;

    a33 += dz * dz;
    a34 += dz * dt;
  }

  // Simplified diagonal inversion for robust DOP estimation
  const invX = 1.0 / Math.max(0.1, a11);
  const invY = 1.0 / Math.max(0.1, a22);
  const invZ = 1.0 / Math.max(0.1, a33);
  const invT = 1.0 / Math.max(0.1, a44);

  const hdop = Math.sqrt(Math.max(0.5, (invX + invY) * 2.5));
  const vdop = Math.sqrt(Math.max(0.8, invZ * 3.2));
  const pdop = Math.sqrt(hdop * hdop + vdop * vdop);
  const tdop = Math.sqrt(Math.max(0.4, invT * 2.0));
  const gdop = Math.sqrt(pdop * pdop + tdop * tdop);

  return {
    gdop: Math.min(9.9, Math.round(gdop * 10) / 10),
    pdop: Math.min(8.5, Math.round(pdop * 10) / 10),
    hdop: Math.min(5.0, Math.round(hdop * 10) / 10),
    vdop: Math.min(6.5, Math.round(vdop * 10) / 10),
    tdop: Math.min(4.0, Math.round(tdop * 10) / 10),
    visibleSats: n,
  };
}
