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
export type AdjustmentMode = 'unconstrained';

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
  loopToleranceBaseMm: number; // e.g. 10 mm
  loopTolerancePpm: number; // e.g. 1.0 ppm
  baardaAlpha: number; // e.g. 0.001
  wCrit: number; // 3.29
  autoExcludeOutliers?: boolean; // Default true: automatically exclude gross errors
  maxOutlierIterations?: number; // Default 5
}

export interface AntennaData {
  model: string;
  heightType: AntennaHeightType;
  measuredHeight: number; // meters
  radius: number; // meters (for slant calculation)
  verticalOffset: number; // meters
  correctedHeight: number; // ARP vertical height (m)
  heightSource?: 'USER' | 'RINEX'; // Source of antenna height
  isUserEdited?: boolean; // True if user manually specified or edited in UI
  deltaE?: number; // East eccentricity from marker to ARP (m)
  deltaN?: number; // North eccentricity from marker to ARP (m)
  pcoL1: { n: number; e: number; u: number }; // Phase Center Offset (mm)
  pcoL2: { n: number; e: number; u: number }; // Phase Center Offset (mm)
  pcvZenith: number[]; // PCV variations (mm)
  isCalibrated?: boolean; // True if calibrated via NOAA/IGS or user-uploaded ATX
  calibrationSource?: 'BUILTIN' | 'CUSTOM_ATX' | 'MANUAL';
  rawRinexModel?: string; // Original unparsed model string from RINEX ANT # / TYPE
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
  // ECEF Coordinates (m)
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
  observationDateStr?: string; // e.g. "2025-06-15 10:30:00 GPS"
  opfsFileName?: string; // Raw RINEX file name key in OPFS storage
  hasRealObsData?: boolean; // True when actual numeric observation epochs exist
  sppApplied?: boolean; // True when SPP pseudorange refinement has updated initial coords
  sppRms?: number; // SPP pseudorange post-fit RMS (m)
  sppEpochsUsed?: number;
  // Detailed RINEX Occupation & Satellite tracking data for Topcon Tools Occupation View
  occupation?: RinexOccupation;
  // Adjusted values (after 3D adjustment)
  adjustedX?: number;
  adjustedY?: number;
  adjustedZ?: number;
  adjustedLat?: number;
  adjustedLon?: number;
  adjustedH?: number; // Ground marker ellipsoidal height (m) - alet yüksekliği düşülmüş
  groundH?: number; // Zemin noktası elipsoidal kotu (m)
  arpH?: number; // Anten Referans Noktası (ARP) kotu (m)
  apcH?: number; // Anten Faz Merkezi (APC L3) kotu (m)
  adjustedProjY?: number;
  adjustedProjX?: number;
  sigmaX?: number; // mm
  sigmaY?: number; // mm
  sigmaZ?: number; // mm
  semiMajor?: number; // mm (2D error ellipse 'a' at 95% confidence)
  semiMinor?: number; // mm (2D error ellipse 'b' at 95% confidence)
  semiAxisC?: number; // mm (3D error ellipsoid vertical semi-axis 'c' at 95% confidence)
  ellipseAzimuth?: number; // Gon or Deg
  sigmaH?: number; // mm (height standard deviation at 95% confidence)
  sigmaEast?: number; // mm (1-sigma East)
  sigmaNorth?: number; // mm (1-sigma North)
  sigmaUp?: number; // mm (1-sigma Up)
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
  // Real solver telemetry
  orbitSource?: 'SP3' | 'NAV';
  frequencyMode?: string;
  commonEpochs?: number;
  cycleSlips?: number;
  pivotSatellite?: string;
  constellationsUsed?: GnssConstellation[];
  diagnostics?: string;
  // Adjustment results
  vX?: number; // residual in mm
  vY?: number; // residual in mm
  vZ?: number; // residual in mm
  spatialV?: number; // mm
  wTest?: number; // Baarda w-test statistic
  redundancyNumber?: number; // r_i redundancy number (0 to 1)
  isOutlier?: boolean;
  excluded?: boolean;
  exclusionReason?: string;
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

export interface MatrixDiagnostics {
  numRowsA: number;
  numColsA: number;
  numNonZeroA: number;
  sparsityPercent: number;
  conditionNumberN: number;
  averageRedundancy: number;
  maxCorrelation: number;
}

export interface ExcludedBaselineRecord {
  baselineId: string;
  fromId: string;
  toId: string;
  reason: string;
  wScore: number;
  spatialV?: number;
  loopError?: number;
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
  matrixDiagnostics?: MatrixDiagnostics;
  stations: Record<string, Station>;
  baselines: BaselineVector[];
  outliers: string[]; // baseline IDs flagged by Baarda snooping
  excludedBaselines?: ExcludedBaselineRecord[]; // Baselines excluded due to gross error (Baarda/Loop)
  iterations: number;
  outlierIterations?: number;
  maxDisplacementMm: number;
  adjustedAt: string;
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
  multipathMp1?: number; // Code multipath MP1 RMS (m)
  multipathMp2?: number; // Code multipath MP2 RMS (m)
  cycleSlips?: number; // Detected cycle slips across track
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
  firstEpochSec: number; // Continuous GPS seconds
  lastEpochSec: number;
  durationSeconds: number; // session duration
  intervalSeconds: number; // e.g. 1.0 or 30.0s
  totalEpochs: number;
  constellations: GnssConstellation[];
  satellites: SatelliteTrack[];
  epochRecords: EpochRecord[];
  observationTypes: string[]; // e.g. ["L1", "L2", "C1", "P2", "S1", "S2"]
  glonassSlotFreq?: Record<number, number>; // slot number -> frequency channel k (-7..6)
  hasRealObsData?: boolean;
  approxPosition?: { x: number; y: number; z: number };
}

export interface IgsOrbitInfo {
  gpsWeek: number;
  dayOfWeek: number;
  dateStr: string;
  year: number;
  doy: number;
  productType: 'FINAL' | 'RAPID' | 'ULTRA_RAPID';
  productName: string;
  legacyName: string;
  clkName: string;
  cddisUrl: string;
  cddisFolderUrl: string;
  ignUrl: string;
  ignFolderUrl?: string;
  bkgUrl: string;
  bkgFolderUrl?: string;
  latencyDays: number;
  accuracyEstimate: string;
  recommendationText: string;
  isLoaded?: boolean;
  loadedFileName?: string;
}

export interface IgsSp3File {
  fileName: string;
  gpsWeek: number;
  dayOfWeek: number;
  epochCount: number;
  satelliteCount: number;
  satellites: string[];
  productType: 'FINAL' | 'RAPID' | 'ULTRA_RAPID';
  firstEpochIso?: string;
  lastEpochIso?: string;
  intervalSec?: number;
}

export interface RinexHeaderMetadata {
  fileName: string;
  fileSizeBytes: number;
  rinexVersion: string;
  fileType: 'OBSERVATION' | 'NAVIGATION' | 'METEOROLOGICAL' | 'UNKNOWN';
  satelliteSystem: 'GPS' | 'GLONASS' | 'Galileo' | 'BeiDou' | 'Mixed' | string;
  markerName: string;
  markerNumber?: string;
  observer?: string;
  agency?: string;
  receiverNumber?: string;
  receiverType?: string;
  receiverVersion?: string;
  antennaNumber?: string;
  antennaType?: string;
  antennaRadome?: string;
  approxX: number;
  approxY: number;
  approxZ: number;
  deltaH: number;
  deltaE: number;
  deltaN: number;
  firstObsTime?: string;
  lastObsTime?: string;
  intervalSec?: number;
  leapSeconds?: number;
  obsTypesBySystem: Record<string, string[]>;
  glonassSlotFreq?: Record<number, number>;
  warnings: string[];
}

export interface RinexParsedSummary {
  metadata: RinexHeaderMetadata;
  occupation?: RinexOccupation;
  storedOpfsKey?: string;
  detectedPointType: StationType;
  geodeticApprox: {
    lat: number;
    lon: number;
    h: number;
    projY: number;
    projX: number;
  };
}
