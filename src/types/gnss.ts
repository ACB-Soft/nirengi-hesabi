/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * GNSS Post-Processing & 3D Network Adjustment System
 * Types and Interfaces conforming to TUREF / ITRF96, GRS80, BÖHYY and RTKLIB standards.
 */

export type AngleUnit = 'Gon' | 'Degree' | 'DMS';
export type CoordinateFormat = 'TM' | 'ECEF' | 'Geodetic';
export type CRSSystem = 'TUREF-TM30' | 'TUREF-TM27' | 'TUREF-TM33' | 'TUREF-TM36' | 'TUREF-TM39' | 'TUREF-TM42';
export type AntennaHeightType = 'vertical' | 'slant';
export type StationType = 'CORS' | 'GROUND';
export type SolutionStatus = 'FIX' | 'FLOAT';
export type AdjustmentMode = 'unconstrained' | 'constrained';

export interface JobConfig {
  projectName: string;
  surveyor: string; // Hesaplayan
  checker: string; // Kontrol Eden
  institution?: string;
  timeZone: string; // User editable (e.g. GMT+03:00)
  crsSystem: CRSSystem;
  dom: number; // Central Meridian (DOM): 27, 30, 33, 36, 39, 42
  angleUnit: AngleUnit;
  lengthUnit: 'Metre';
  satelliteSystems: 'GPS Only' | 'GPS+GLONASS' | 'Multi-GNSS';
  elevationMask: number; // Degrees, default 10
  horizontalTolerance: number; // meters, default 0.03m
  verticalTolerance: number; // meters, default 0.05m
  ellipsoid: 'GRS80';
  refEpoch: number; // 2005.00
  surveyEpoch: number; // e.g. 2024.45
  loopToleranceBaseMm: number; // e.g. 10 mm
  loopTolerancePpm: number; // e.g. 1.0 ppm
  baardaAlpha: number; // e.g. 0.001
  wCrit: number; // 3.29
}

export interface AntennaData {
  model: string;
  heightType: AntennaHeightType;
  measuredHeight: number; // meters
  radius: number; // meters (for slant calculation)
  verticalOffset: number; // meters
  correctedHeight: number; // ARP vertical height (m)
  pcoL1: { n: number; e: number; u: number }; // Phase Center Offset (mm)
  pcoL2: { n: number; e: number; u: number }; // Phase Center Offset (mm)
  pcvZenith: number[]; // PCV variations (mm)
}

export interface StationVelocities {
  vx: number; // m/year (ECEF X)
  vy: number; // m/year (ECEF Y)
  vz: number; // m/year (ECEF Z)
  ve?: number; // mm/year (East)
  vn?: number; // mm/year (North)
  vu?: number; // mm/year (Up)
}

export interface Station {
  id: string;
  name: string;
  type: StationType;
  isFixed: {
    x: boolean;
    y: boolean;
    z: boolean;
  };
  // ECEF Coordinates (m) at survey epoch
  x: number;
  y: number;
  z: number;
  // Geodetic Coordinates
  lat: number; // decimal degrees
  lon: number; // decimal degrees
  h: number; // ellipsoidal height (m)
  // Projected Transverse Mercator (TUREF / ITRF96)
  projY: number; // Sağa Değer (Easting: with 500,000 false easting)
  projX: number; // Yukarı Değer (Northing)
  // Antenna & setup
  antenna: AntennaData;
  // Velocities for epoch shifting
  velocities: StationVelocities;
  // Observation Epoch (automatically parsed from RINEX TIME OF FIRST OBS)
  observationEpoch?: number; // e.g. 2025.45
  observationDateStr?: string; // e.g. "2025-06-15 10:30:00 GPS"
  // Detailed RINEX Occupation & Satellite tracking data for Topcon Tools Occupation View
  occupation?: RinexOccupation;
  // Adjusted values (after 3D adjustment)
  adjustedX?: number;
  adjustedY?: number;
  adjustedZ?: number;
  adjustedLat?: number;
  adjustedLon?: number;
  adjustedH?: number;
  adjustedProjY?: number;
  adjustedProjX?: number;
  sigmaX?: number; // mm
  sigmaY?: number; // mm
  sigmaZ?: number; // mm
  semiMajor?: number; // mm (2D error ellipse 'a' at 95% confidence)
  semiMinor?: number; // mm (2D error ellipse 'b' at 95% confidence)
  ellipseAzimuth?: number; // Gon or Deg
  sigmaH?: number; // mm (height standard deviation at 95% confidence)
}

export interface BaselineVector {
  id: string;
  fromId: string;
  toId: string;
  // Baseline differences in ECEF (m): To - From
  dX: number;
  dY: number;
  dZ: number;
  length: number; // 3D spatial distance in meters
  // Variance-Covariance Matrix elements (m^2)
  qxx: number;
  qyy: number;
  qzz: number;
  qxy: number;
  qyz: number;
  qzx: number;
  // RTKLIB Solution Quality
  solutionType: SolutionStatus; // Q=1 FIX, Q=2 FLOAT
  ratio: number; // Ambiguity validation ratio factor
  rms: number; // RMS residual in meters
  durationMin: number;
  satellites: number;
  pdop: number;
  // Adjustment results
  vX?: number; // residual in mm
  vY?: number; // residual in mm
  vZ?: number; // residual in mm
  spatialV?: number; // mm
  wTest?: number; // Baarda w-test statistic
  isOutlier?: boolean;
  excluded?: boolean;
}

export interface LoopClosure {
  id: string;
  name: string;
  stationIds: string[];
  baselineIds: string[];
  directions: number[]; // +1 if traversed along baseline direction, -1 if reverse
  sumDX: number; // mm
  sumDY: number; // mm
  sumDZ: number; // mm
  totalMisclosure: number; // mm: sqrt(wX^2 + wY^2 + wZ^2)
  totalLengthM: number;
  totalLengthKm: number;
  toleranceMm: number; // 10mm + 1ppm * S
  misclosurePpm: number;
  relativePrecision: string; // e.g. "1 / 245,000"
  isAccepted: boolean;
}

export interface AdjustmentResult {
  mode: AdjustmentMode;
  fixedStationIds: string[];
  unknownStationIds: string[];
  dof: number; // Degrees of Freedom: 3*m - 3*u
  totalObservations: number; // 3 * active baselines
  totalUnknowns: number; // 3 * unknown stations
  sigma0Apriori: number; // 1.000
  sigma0Aposteriori: number; // sqrt(v'Pv / dof)
  vPv: number;
  chiSquareTest: {
    passed: boolean;
    lowerLimit: number;
    upperLimit: number;
    testStatistic: number;
    confidenceLevel: number; // 0.95
  };
  stations: Record<string, Station>;
  baselines: BaselineVector[];
  outliers: string[]; // baseline IDs flagged by Baarda snooping
  iterations: number;
  maxDisplacementMm: number;
  adjustedAt: string;
}

export interface GeoCalcPoint {
  stationName: string;
  sourceEpoch: number;
  targetEpoch: number;
  // Source coordinates
  srcX: number;
  srcY: number;
  srcZ: number;
  srcLat: number;
  srcLon: number;
  srcH: number;
  srcProjY: number;
  srcProjX: number;
  // Velocities
  vx: number;
  vy: number;
  vz: number;
  // Target coordinates
  dstX: number;
  dstY: number;
  dstZ: number;
  dstLat: number;
  dstLon: number;
  dstH: number;
  dstProjY: number;
  dstProjX: number;
  // Shifts
  dX: number; // mm
  dY: number; // mm
  dZ: number; // mm
  dSpatial: number; // mm
}

export type GnssConstellation = 'GPS' | 'GLONASS' | 'Galileo' | 'BeiDou' | 'QZSS' | 'SBAS';

export interface SatelliteTrack {
  satId: string; // e.g. "G01", "R12", "E05", "C08"
  system: GnssConstellation;
  prn: number;
  totalEpochs: number;
  validEpochs: number;
  startSec: number; // seconds from session start
  endSec: number; // seconds from session start
  // Array of time-step records or time intervals where satellite was tracked
  timeSlots: Array<{
    startSec: number;
    endSec: number;
    avgSnr?: number; // dB-Hz
  }>;
  avgElevation?: number; // degrees (approximate or computed)
  avgSnr?: number; // dB-Hz (signal to noise)
  freqs: string[]; // e.g. ["L1", "L2", "L5"] or ["C1C", "L1C", "D1C", "S1C"]
}

export interface EpochRecord {
  epochIndex: number;
  timeSec: number; // seconds relative to session start
  timestamp: string; // e.g. "2025-06-15 10:30:00"
  satellites: string[]; // list of satIds e.g. ["G01", "G03", "R05"]
  nsats: number;
  pdop?: number;
  gdop?: number;
}

export interface RinexOccupation {
  stationId: string;
  stationName: string;
  fileName: string;
  rinexVersion: string; // e.g. "2.11" or "3.04"
  receiverType?: string;
  antennaType?: string;
  firstEpochDate: string; // e.g. "2025-06-15 08:00:00"
  lastEpochDate: string; // e.g. "2025-06-15 12:00:00"
  firstEpochSec: number; // Unix timestamp or Julian seconds
  lastEpochSec: number;
  durationSeconds: number; // session duration
  intervalSeconds: number; // e.g. 1.0 or 30.0s
  totalEpochs: number;
  constellations: GnssConstellation[];
  satellites: SatelliteTrack[];
  epochRecords: EpochRecord[];
  observationTypes: string[]; // e.g. ["L1", "L2", "C1", "P2", "S1", "S2"]
  approxPosition?: { x: number; y: number; z: number };
}
