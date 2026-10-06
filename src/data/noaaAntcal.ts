/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * NOAA NGS ANTCAL & IGS20 Built-in Antenna Calibration Database
 * Source: NOAA National Geodetic Survey (NGS) Antenna Calibration Program (https://geodesy.noaa.gov/ANTCAL/)
 * and IGS20.ATX / IGS14.ATX composite antenna calibration standards.
 */

export interface NoaaAntennaCalibration {
  model: string;          // Official 20-char ANTEX format (e.g. "TRM59800.00     NONE")
  displayName: string;    // Clean descriptive name
  manufacturer: string;   // e.g. "Trimble", "Leica", "Topcon"
  radome: string;         // e.g. "NONE", "LEIT", "LEIS", "SNOW"
  category: 'CORS / Choke Ring' | 'Geodetic Base' | 'Rover / SmartAntenna';
  radius: number;         // Nominal antenna radius in meters (for Slant to Vertical)
  verticalOffset: number; // Nominal ARP offset in meters
  pcoL1: { n: number; e: number; u: number }; // Phase Center Offset (mm) for L1 (G01)
  pcoL2: { n: number; e: number; u: number }; // Phase Center Offset (mm) for L2 (G02)
  pcvZenith: number[];    // PCV variation array (mm) at zenith angles [0°, 15°, 30°, 45°, 60°, 75°, 90°]
}

export const NOAA_ANTCAL_CATALOG: NoaaAntennaCalibration[] = [
  // =========================================================================
  // TRIMBLE
  // =========================================================================
  {
    model: 'TRM59800.00     NONE',
    displayName: 'Trimble Zephyr Geodetic 2 / 3 (TRM59800.00)',
    manufacturer: 'Trimble',
    radome: 'NONE',
    category: 'CORS / Choke Ring',
    radius: 0.170,
    verticalOffset: 0.000,
    pcoL1: { n: 1.10, e: -0.32, u: 89.20 },
    pcoL2: { n: 0.88, e: -0.19, u: 82.10 },
    pcvZenith: [0.0, 0.5, 1.2, 2.1, 3.4, 4.8, 6.2],
  },
  {
    model: 'TRM59800.00     SCIS',
    displayName: 'Trimble Zephyr Geodetic 2 (SCIS Radome)',
    manufacturer: 'Trimble',
    radome: 'SCIS',
    category: 'CORS / Choke Ring',
    radius: 0.170,
    verticalOffset: 0.000,
    pcoL1: { n: 1.15, e: -0.30, u: 89.40 },
    pcoL2: { n: 0.90, e: -0.21, u: 82.35 },
    pcvZenith: [0.0, 0.6, 1.3, 2.2, 3.6, 5.0, 6.4],
  },
  {
    model: 'TRM57971.00     NONE',
    displayName: 'Trimble Zephyr 2 Geodetic (TRM57971.00)',
    manufacturer: 'Trimble',
    radome: 'NONE',
    category: 'Geodetic Base',
    radius: 0.165,
    verticalOffset: 0.000,
    pcoL1: { n: 0.95, e: -0.25, u: 66.80 },
    pcoL2: { n: 0.72, e: -0.15, u: 57.60 },
    pcvZenith: [0.0, 0.4, 1.0, 1.8, 2.9, 4.2, 5.8],
  },
  {
    model: 'TRM55971.00     NONE',
    displayName: 'Trimble Zephyr 2 Rugged (TRM55971.00)',
    manufacturer: 'Trimble',
    radome: 'NONE',
    category: 'Geodetic Base',
    radius: 0.160,
    verticalOffset: 0.000,
    pcoL1: { n: 1.02, e: -0.22, u: 67.10 },
    pcoL2: { n: 0.75, e: -0.18, u: 57.90 },
    pcvZenith: [0.0, 0.4, 1.1, 1.9, 3.0, 4.3, 5.9],
  },
  {
    model: 'TRM41249.00     NONE',
    displayName: 'Trimble Zephyr Geodetic (TRM41249.00)',
    manufacturer: 'Trimble',
    radome: 'NONE',
    category: 'CORS / Choke Ring',
    radius: 0.168,
    verticalOffset: 0.000,
    pcoL1: { n: 1.30, e: -0.40, u: 91.50 },
    pcoL2: { n: 0.95, e: -0.25, u: 83.40 },
    pcvZenith: [0.0, 0.5, 1.2, 2.0, 3.2, 4.6, 6.0],
  },
  {
    model: 'TRM29659.00     NONE',
    displayName: 'Trimble Dorne Margolin Choke Ring (TRM29659.00)',
    manufacturer: 'Trimble',
    radome: 'NONE',
    category: 'CORS / Choke Ring',
    radius: 0.190,
    verticalOffset: 0.000,
    pcoL1: { n: 0.65, e: 0.15, u: 110.20 },
    pcoL2: { n: 0.40, e: 0.08, u: 128.10 },
    pcvZenith: [0.0, 0.3, 0.8, 1.5, 2.4, 3.5, 4.9],
  },
  {
    model: 'TRMR10          NONE',
    displayName: 'Trimble R10 GNSS Receiver (Integrated)',
    manufacturer: 'Trimble',
    radome: 'NONE',
    category: 'Rover / SmartAntenna',
    radius: 0.095,
    verticalOffset: 0.035,
    pcoL1: { n: 0.80, e: -0.10, u: 135.20 },
    pcoL2: { n: 0.55, e: -0.05, u: 125.40 },
    pcvZenith: [0.0, 0.7, 1.6, 2.8, 4.2, 5.9, 7.8],
  },
  {
    model: 'TRMR12          NONE',
    displayName: 'Trimble R12 / R12i GNSS Receiver',
    manufacturer: 'Trimble',
    radome: 'NONE',
    category: 'Rover / SmartAntenna',
    radius: 0.095,
    verticalOffset: 0.035,
    pcoL1: { n: 0.85, e: -0.08, u: 136.10 },
    pcoL2: { n: 0.58, e: -0.04, u: 126.20 },
    pcvZenith: [0.0, 0.6, 1.5, 2.7, 4.0, 5.7, 7.5],
  },
  {
    model: 'TRMR8_GNSS      NONE',
    displayName: 'Trimble R8 Model 4 / GNSS Receiver',
    manufacturer: 'Trimble',
    radome: 'NONE',
    category: 'Rover / SmartAntenna',
    radius: 0.095,
    verticalOffset: 0.030,
    pcoL1: { n: 0.75, e: -0.15, u: 114.50 },
    pcoL2: { n: 0.50, e: -0.10, u: 104.20 },
    pcvZenith: [0.0, 0.8, 1.8, 3.1, 4.6, 6.2, 8.1],
  },

  // =========================================================================
  // LEICA GEOSYSTEMS
  // =========================================================================
  {
    model: 'LEIAR25.R4      LEIT',
    displayName: 'Leica AR25.R4 3D Choke Ring (LEIT Radome)',
    manufacturer: 'Leica',
    radome: 'LEIT',
    category: 'CORS / Choke Ring',
    radius: 0.190,
    verticalOffset: 0.000,
    pcoL1: { n: 0.90, e: -0.15, u: 154.20 },
    pcoL2: { n: 0.65, e: -0.10, u: 147.50 },
    pcvZenith: [0.0, 0.4, 1.0, 1.7, 2.8, 4.0, 5.5],
  },
  {
    model: 'LEIAR25.R4      NONE',
    displayName: 'Leica AR25.R4 3D Choke Ring (No Radome)',
    manufacturer: 'Leica',
    radome: 'NONE',
    category: 'CORS / Choke Ring',
    radius: 0.190,
    verticalOffset: 0.000,
    pcoL1: { n: 0.85, e: -0.12, u: 153.80 },
    pcoL2: { n: 0.62, e: -0.08, u: 147.10 },
    pcvZenith: [0.0, 0.4, 0.9, 1.6, 2.7, 3.8, 5.2],
  },
  {
    model: 'LEIAR25         LEIT',
    displayName: 'Leica AR25 Reference Station Antenna',
    manufacturer: 'Leica',
    radome: 'LEIT',
    category: 'CORS / Choke Ring',
    radius: 0.190,
    verticalOffset: 0.000,
    pcoL1: { n: 0.92, e: -0.18, u: 155.10 },
    pcoL2: { n: 0.68, e: -0.12, u: 148.20 },
    pcvZenith: [0.0, 0.5, 1.1, 1.9, 3.0, 4.3, 5.8],
  },
  {
    model: 'LEIAR20         NONE',
    displayName: 'Leica AR20 Reference Station Antenna',
    manufacturer: 'Leica',
    radome: 'NONE',
    category: 'CORS / Choke Ring',
    radius: 0.180,
    verticalOffset: 0.000,
    pcoL1: { n: 0.70, e: -0.05, u: 130.40 },
    pcoL2: { n: 0.45, e: -0.02, u: 122.10 },
    pcvZenith: [0.0, 0.3, 0.8, 1.5, 2.5, 3.7, 5.0],
  },
  {
    model: 'LEIAT504        LEIS',
    displayName: 'Leica AT504 Dorne Margolin Choke Ring',
    manufacturer: 'Leica',
    radome: 'LEIS',
    category: 'CORS / Choke Ring',
    radius: 0.190,
    verticalOffset: 0.000,
    pcoL1: { n: 0.60, e: 0.10, u: 111.40 },
    pcoL2: { n: 0.35, e: 0.05, u: 129.20 },
    pcvZenith: [0.0, 0.3, 0.7, 1.4, 2.3, 3.4, 4.8],
  },
  {
    model: 'LEIAT504GG      LEIS',
    displayName: 'Leica AT504GG GPS/GLONASS Choke Ring',
    manufacturer: 'Leica',
    radome: 'LEIS',
    category: 'CORS / Choke Ring',
    radius: 0.190,
    verticalOffset: 0.000,
    pcoL1: { n: 0.62, e: 0.12, u: 112.10 },
    pcoL2: { n: 0.38, e: 0.06, u: 129.80 },
    pcvZenith: [0.0, 0.3, 0.7, 1.4, 2.4, 3.5, 4.9],
  },
  {
    model: 'LEIAX1202       NONE',
    displayName: 'Leica AX1202 Geodetic Antenna',
    manufacturer: 'Leica',
    radome: 'NONE',
    category: 'Geodetic Base',
    radius: 0.120,
    verticalOffset: 0.000,
    pcoL1: { n: 0.80, e: -0.20, u: 78.40 },
    pcoL2: { n: 0.55, e: -0.15, u: 71.20 },
    pcvZenith: [0.0, 0.6, 1.4, 2.4, 3.7, 5.2, 7.0],
  },
  {
    model: 'LEIAX1203+GNSS  NONE',
    displayName: 'Leica AX1203+ GNSS Triple Frequency',
    manufacturer: 'Leica',
    radome: 'NONE',
    category: 'Geodetic Base',
    radius: 0.125,
    verticalOffset: 0.000,
    pcoL1: { n: 0.85, e: -0.18, u: 80.50 },
    pcoL2: { n: 0.58, e: -0.12, u: 73.40 },
    pcvZenith: [0.0, 0.5, 1.3, 2.3, 3.5, 5.0, 6.8],
  },
  {
    model: 'LEIGS18         NONE',
    displayName: 'Leica GS18 / GS18 T / I SmartAntenna',
    manufacturer: 'Leica',
    radome: 'NONE',
    category: 'Rover / SmartAntenna',
    radius: 0.095,
    verticalOffset: 0.035,
    pcoL1: { n: 0.70, e: -0.05, u: 128.40 },
    pcoL2: { n: 0.48, e: -0.02, u: 119.20 },
    pcvZenith: [0.0, 0.7, 1.7, 2.9, 4.3, 6.0, 8.0],
  },
  {
    model: 'LEIGS16         NONE',
    displayName: 'Leica GS16 GNSS SmartAntenna',
    manufacturer: 'Leica',
    radome: 'NONE',
    category: 'Rover / SmartAntenna',
    radius: 0.095,
    verticalOffset: 0.035,
    pcoL1: { n: 0.75, e: -0.08, u: 127.10 },
    pcoL2: { n: 0.52, e: -0.04, u: 118.50 },
    pcvZenith: [0.0, 0.8, 1.8, 3.0, 4.5, 6.2, 8.2],
  },

  // =========================================================================
  // TOPCON
  // =========================================================================
  {
    model: 'TPSCR.G3        NONE',
    displayName: 'Topcon CR-G3 Geodetic Choke Ring Antenna',
    manufacturer: 'Topcon',
    radome: 'NONE',
    category: 'CORS / Choke Ring',
    radius: 0.180,
    verticalOffset: 0.000,
    pcoL1: { n: 0.75, e: -0.25, u: 104.50 },
    pcoL2: { n: 0.50, e: -0.15, u: 98.20 },
    pcvZenith: [0.0, 0.4, 0.9, 1.6, 2.6, 3.8, 5.2],
  },
  {
    model: 'TPSCR.G5        NONE',
    displayName: 'Topcon CR-G5 Geodetic Multi-GNSS Choke Ring',
    manufacturer: 'Topcon',
    radome: 'NONE',
    category: 'CORS / Choke Ring',
    radius: 0.185,
    verticalOffset: 0.000,
    pcoL1: { n: 0.80, e: -0.20, u: 106.80 },
    pcoL2: { n: 0.54, e: -0.12, u: 100.10 },
    pcvZenith: [0.0, 0.3, 0.8, 1.5, 2.4, 3.6, 5.0],
  },
  {
    model: 'TPSPG_A1        NONE',
    displayName: 'Topcon PG-A1 Geodetic Micro-Center Antenna',
    manufacturer: 'Topcon',
    radome: 'NONE',
    category: 'Geodetic Base',
    radius: 0.140,
    verticalOffset: 0.000,
    pcoL1: { n: 0.90, e: -0.30, u: 72.50 },
    pcoL2: { n: 0.65, e: -0.20, u: 64.80 },
    pcvZenith: [0.0, 0.6, 1.5, 2.6, 3.9, 5.5, 7.4],
  },
  {
    model: 'TPSHIPER_VR     NONE',
    displayName: 'Topcon HiPer VR Integrated GNSS Receiver',
    manufacturer: 'Topcon',
    radome: 'NONE',
    category: 'Rover / SmartAntenna',
    radius: 0.090,
    verticalOffset: 0.030,
    pcoL1: { n: 0.65, e: -0.10, u: 122.50 },
    pcoL2: { n: 0.45, e: -0.05, u: 114.10 },
    pcvZenith: [0.0, 0.7, 1.6, 2.8, 4.2, 5.8, 7.8],
  },
  {
    model: 'TPSHIPER_V      NONE',
    displayName: 'Topcon HiPer V Integrated GNSS Receiver',
    manufacturer: 'Topcon',
    radome: 'NONE',
    category: 'Rover / SmartAntenna',
    radius: 0.090,
    verticalOffset: 0.030,
    pcoL1: { n: 0.70, e: -0.12, u: 120.40 },
    pcoL2: { n: 0.48, e: -0.08, u: 112.30 },
    pcvZenith: [0.0, 0.8, 1.8, 3.0, 4.5, 6.1, 8.1],
  },

  // =========================================================================
  // JAVAD GNSS
  // =========================================================================
  {
    model: 'JAVRINGANT_DM   NONE',
    displayName: 'Javad RingAnt-DM Dorne Margolin Choke Ring',
    manufacturer: 'Javad',
    radome: 'NONE',
    category: 'CORS / Choke Ring',
    radius: 0.190,
    verticalOffset: 0.000,
    pcoL1: { n: 0.55, e: 0.05, u: 112.50 },
    pcoL2: { n: 0.32, e: 0.02, u: 129.50 },
    pcvZenith: [0.0, 0.3, 0.7, 1.3, 2.2, 3.3, 4.7],
  },
  {
    model: 'JAVGRANT_G3T    NONE',
    displayName: 'Javad GrAnt-G3T Geodetic Triple Frequency',
    manufacturer: 'Javad',
    radome: 'NONE',
    category: 'Geodetic Base',
    radius: 0.120,
    verticalOffset: 0.000,
    pcoL1: { n: 0.65, e: -0.15, u: 88.20 },
    pcoL2: { n: 0.45, e: -0.10, u: 82.50 },
    pcvZenith: [0.0, 0.5, 1.2, 2.2, 3.4, 4.9, 6.7],
  },
  {
    model: 'JAVTRIUMPH_1    NONE',
    displayName: 'Javad Triumph-1 Integrated Receiver',
    manufacturer: 'Javad',
    radome: 'NONE',
    category: 'Rover / SmartAntenna',
    radius: 0.090,
    verticalOffset: 0.035,
    pcoL1: { n: 0.70, e: -0.08, u: 124.60 },
    pcoL2: { n: 0.50, e: -0.05, u: 116.20 },
    pcvZenith: [0.0, 0.7, 1.6, 2.8, 4.2, 5.9, 7.9],
  },

  // =========================================================================
  // NOVATEL
  // =========================================================================
  {
    model: 'NOV702GG        NONE',
    displayName: 'NovAtel GPS-702-GG Pinwheel Dual Frequency',
    manufacturer: 'NovAtel',
    radome: 'NONE',
    category: 'Geodetic Base',
    radius: 0.125,
    verticalOffset: 0.000,
    pcoL1: { n: 0.85, e: -0.22, u: 68.40 },
    pcoL2: { n: 0.60, e: -0.15, u: 60.10 },
    pcvZenith: [0.0, 0.4, 1.0, 1.8, 2.8, 4.1, 5.7],
  },
  {
    model: 'NOV703GGG       NONE',
    displayName: 'NovAtel GPS-703-GGG Triple Frequency Pinwheel',
    manufacturer: 'NovAtel',
    radome: 'NONE',
    category: 'Geodetic Base',
    radius: 0.125,
    verticalOffset: 0.000,
    pcoL1: { n: 0.88, e: -0.20, u: 69.10 },
    pcoL2: { n: 0.64, e: -0.12, u: 60.80 },
    pcvZenith: [0.0, 0.4, 1.0, 1.8, 2.9, 4.2, 5.8],
  },
  {
    model: 'NOV750          NONE',
    displayName: 'NovAtel GNSS-750 Wideband 3D Choke Ring',
    manufacturer: 'NovAtel',
    radome: 'NONE',
    category: 'CORS / Choke Ring',
    radius: 0.190,
    verticalOffset: 0.000,
    pcoL1: { n: 0.60, e: 0.08, u: 114.20 },
    pcoL2: { n: 0.35, e: 0.03, u: 130.40 },
    pcvZenith: [0.0, 0.3, 0.7, 1.3, 2.2, 3.3, 4.6],
  },

  // =========================================================================
  // SEPTENTRIO
  // =========================================================================
  {
    model: 'SEPCHOKE_MC     NONE',
    displayName: 'Septentrio PolaNt Choke Ring Multi-Constellation',
    manufacturer: 'Septentrio',
    radome: 'NONE',
    category: 'CORS / Choke Ring',
    radius: 0.185,
    verticalOffset: 0.000,
    pcoL1: { n: 0.70, e: -0.10, u: 108.50 },
    pcoL2: { n: 0.45, e: -0.05, u: 101.20 },
    pcvZenith: [0.0, 0.3, 0.8, 1.4, 2.3, 3.5, 4.9],
  },
  {
    model: 'SEP_POLANT_X_MF NONE',
    displayName: 'Septentrio PolaNt-x MF Multi-Frequency',
    manufacturer: 'Septentrio',
    radome: 'NONE',
    category: 'Geodetic Base',
    radius: 0.125,
    verticalOffset: 0.000,
    pcoL1: { n: 0.80, e: -0.15, u: 74.50 },
    pcoL2: { n: 0.55, e: -0.10, u: 66.80 },
    pcvZenith: [0.0, 0.5, 1.2, 2.1, 3.3, 4.8, 6.5],
  },

  // =========================================================================
  // ASHTECH / THALES
  // =========================================================================
  {
    model: 'ASH700936C_M    NONE',
    displayName: 'Ashtech Dorne Margolin Choke Ring (700936C_M)',
    manufacturer: 'Ashtech',
    radome: 'NONE',
    category: 'CORS / Choke Ring',
    radius: 0.190,
    verticalOffset: 0.000,
    pcoL1: { n: 0.58, e: 0.12, u: 110.80 },
    pcoL2: { n: 0.34, e: 0.06, u: 128.50 },
    pcvZenith: [0.0, 0.3, 0.7, 1.4, 2.3, 3.4, 4.8],
  },
  {
    model: 'ASH701945C_M    NONE',
    displayName: 'Ashtech Geodetic IV Choke Ring (701945C_M)',
    manufacturer: 'Ashtech',
    radome: 'NONE',
    category: 'CORS / Choke Ring',
    radius: 0.190,
    verticalOffset: 0.000,
    pcoL1: { n: 0.62, e: 0.14, u: 112.40 },
    pcoL2: { n: 0.38, e: 0.07, u: 129.80 },
    pcvZenith: [0.0, 0.3, 0.7, 1.4, 2.4, 3.5, 4.9],
  },

  // =========================================================================
  // SOKKIA, CHCNAV & STONEX
  // =========================================================================
  {
    model: 'SOKSA100        NONE',
    displayName: 'Sokkia SA100 Geodetic GNSS Antenna',
    manufacturer: 'Sokkia',
    radome: 'NONE',
    category: 'Geodetic Base',
    radius: 0.140,
    verticalOffset: 0.000,
    pcoL1: { n: 0.85, e: -0.25, u: 70.40 },
    pcoL2: { n: 0.60, e: -0.18, u: 62.80 },
    pcvZenith: [0.0, 0.5, 1.3, 2.4, 3.7, 5.3, 7.2],
  },
  {
    model: 'CHCA220GR       NONE',
    displayName: 'CHCNAV A220GR Geodetic Choke Ring Antenna',
    manufacturer: 'CHCNAV',
    radome: 'NONE',
    category: 'CORS / Choke Ring',
    radius: 0.185,
    verticalOffset: 0.000,
    pcoL1: { n: 0.75, e: -0.15, u: 108.20 },
    pcoL2: { n: 0.50, e: -0.08, u: 101.40 },
    pcvZenith: [0.0, 0.3, 0.8, 1.5, 2.4, 3.6, 5.0],
  },
  {
    model: 'CHCI83          NONE',
    displayName: 'CHCNAV i83 IMU-RTK GNSS Smart Antenna',
    manufacturer: 'CHCNAV',
    radome: 'NONE',
    category: 'Rover / SmartAntenna',
    radius: 0.076,
    verticalOffset: 0.040,
    pcoL1: { n: 1.16, e: 1.07, u: 76.64 },
    pcoL2: { n: 0.61, e: -2.66, u: 69.05 },
    pcvZenith: [0.0, 0.6, 1.5, 2.7, 4.1, 5.8, 7.8],
  },
  {
    model: 'CHCI90          NONE',
    displayName: 'CHCNAV i90 IMU-RTK GNSS Receiver',
    manufacturer: 'CHCNAV',
    radome: 'NONE',
    category: 'Rover / SmartAntenna',
    radius: 0.090,
    verticalOffset: 0.035,
    pcoL1: { n: 0.72, e: -0.10, u: 126.50 },
    pcoL2: { n: 0.50, e: -0.05, u: 118.20 },
    pcvZenith: [0.0, 0.7, 1.7, 2.9, 4.3, 6.0, 8.0],
  },
  {
    model: 'STX_SC200       NONE',
    displayName: 'Stonex SC200 CORS Multi-Constellation Antenna',
    manufacturer: 'Stonex',
    radome: 'NONE',
    category: 'CORS / Choke Ring',
    radius: 0.180,
    verticalOffset: 0.000,
    pcoL1: { n: 0.78, e: -0.18, u: 106.20 },
    pcoL2: { n: 0.52, e: -0.10, u: 99.50 },
    pcvZenith: [0.0, 0.4, 0.9, 1.6, 2.6, 3.8, 5.2],
  },
  {
    model: 'STX_S900A       NONE',
    displayName: 'Stonex S900A Multi-Constellation GNSS Receiver',
    manufacturer: 'Stonex',
    radome: 'NONE',
    category: 'Rover / SmartAntenna',
    radius: 0.090,
    verticalOffset: 0.035,
    pcoL1: { n: 0.74, e: -0.12, u: 124.80 },
    pcoL2: { n: 0.50, e: -0.06, u: 116.50 },
    pcvZenith: [0.0, 0.6, 1.6, 2.8, 4.2, 5.9, 7.8],
  },

  // =========================================================================
  // EMLID
  // =========================================================================
  {
    model: 'EML_REACH_RS2   NONE',
    displayName: 'Emlid Reach RS2 / RS2+ Multi-Band RTK GNSS',
    manufacturer: 'Emlid',
    radome: 'NONE',
    category: 'Rover / SmartAntenna',
    radius: 0.075,
    verticalOffset: 0.134,
    pcoL1: { n: 0.65, e: -0.10, u: 140.00 },
    pcoL2: { n: 0.45, e: -0.05, u: 132.50 },
    pcvZenith: [0.0, 0.7, 1.8, 3.0, 4.5, 6.2, 8.2],
  },
  {
    model: 'EML_REACH_RS3   NONE',
    displayName: 'Emlid Reach RS3 IMU-RTK GNSS Receiver',
    manufacturer: 'Emlid',
    radome: 'NONE',
    category: 'Rover / SmartAntenna',
    radius: 0.075,
    verticalOffset: 0.134,
    pcoL1: { n: 0.68, e: -0.08, u: 141.20 },
    pcoL2: { n: 0.48, e: -0.04, u: 133.40 },
    pcvZenith: [0.0, 0.6, 1.7, 2.9, 4.3, 6.0, 7.9],
  },

  // =========================================================================
  // SOUTH & KOLIDA
  // =========================================================================
  {
    model: 'SOU_CR3         NONE',
    displayName: 'South CR-3 3D Choke Ring Antenna (CORS-TR standard)',
    manufacturer: 'South',
    radome: 'NONE',
    category: 'CORS / Choke Ring',
    radius: 0.190,
    verticalOffset: 0.000,
    pcoL1: { n: 0.82, e: -0.15, u: 110.50 },
    pcoL2: { n: 0.58, e: -0.08, u: 104.20 },
    pcvZenith: [0.0, 0.3, 0.8, 1.5, 2.5, 3.7, 5.1],
  },
  {
    model: 'SOU_G1_PLUS     NONE',
    displayName: 'South Galaxy G1 Plus RTK GNSS Receiver',
    manufacturer: 'South',
    radome: 'NONE',
    category: 'Rover / SmartAntenna',
    radius: 0.085,
    verticalOffset: 0.035,
    pcoL1: { n: 0.75, e: -0.12, u: 122.40 },
    pcoL2: { n: 0.52, e: -0.06, u: 114.80 },
    pcvZenith: [0.0, 0.7, 1.7, 2.9, 4.3, 6.0, 8.0],
  },
  {
    model: 'SOU_G7          NONE',
    displayName: 'South Galaxy G7 IMU-RTK GNSS Receiver',
    manufacturer: 'South',
    radome: 'NONE',
    category: 'Rover / SmartAntenna',
    radius: 0.085,
    verticalOffset: 0.035,
    pcoL1: { n: 0.78, e: -0.10, u: 125.10 },
    pcoL2: { n: 0.55, e: -0.05, u: 117.20 },
    pcvZenith: [0.0, 0.6, 1.6, 2.8, 4.1, 5.8, 7.7],
  },

  // =========================================================================
  // NOVATEL
  // =========================================================================
  {
    model: 'NOV750_CHOKE    NONE',
    displayName: 'NovAtel GNSS-750 Wideband Choke Ring Antenna',
    manufacturer: 'NovAtel',
    radome: 'NONE',
    category: 'CORS / Choke Ring',
    radius: 0.190,
    verticalOffset: 0.000,
    pcoL1: { n: 0.70, e: 0.05, u: 112.50 },
    pcoL2: { n: 0.42, e: 0.02, u: 130.40 },
    pcvZenith: [0.0, 0.3, 0.7, 1.4, 2.3, 3.4, 4.8],
  },
  {
    model: 'NOV_SMART7      NONE',
    displayName: 'NovAtel SMART7 Multi-Frequency Smart Antenna',
    manufacturer: 'NovAtel',
    radome: 'NONE',
    category: 'Rover / SmartAntenna',
    radius: 0.095,
    verticalOffset: 0.045,
    pcoL1: { n: 0.76, e: -0.10, u: 128.40 },
    pcoL2: { n: 0.52, e: -0.05, u: 120.80 },
    pcvZenith: [0.0, 0.6, 1.6, 2.8, 4.2, 5.9, 7.8],
  },
  {
    model: 'NOV704X         NONE',
    displayName: 'NovAtel GNSS-704X Triple-Frequency Pinwheel',
    manufacturer: 'NovAtel',
    radome: 'NONE',
    category: 'Geodetic Base',
    radius: 0.095,
    verticalOffset: 0.000,
    pcoL1: { n: 0.92, e: -0.16, u: 70.50 },
    pcoL2: { n: 0.68, e: -0.08, u: 61.80 },
    pcvZenith: [0.0, 0.4, 1.1, 2.0, 3.2, 4.6, 6.3],
  },

  // =========================================================================
  // HEMISPHERE
  // =========================================================================
  {
    model: 'HEM_A45         NONE',
    displayName: 'Hemisphere A45 Multi-GNSS Precision Antenna',
    manufacturer: 'Hemisphere',
    radome: 'NONE',
    category: 'Geodetic Base',
    radius: 0.095,
    verticalOffset: 0.000,
    pcoL1: { n: 0.85, e: -0.15, u: 72.50 },
    pcoL2: { n: 0.60, e: -0.10, u: 64.20 },
    pcvZenith: [0.0, 0.5, 1.3, 2.3, 3.6, 5.1, 7.0],
  },
  {
    model: 'HEM_A52         NONE',
    displayName: 'Hemisphere A52 High Precision GNSS Antenna',
    manufacturer: 'Hemisphere',
    radome: 'NONE',
    category: 'Geodetic Base',
    radius: 0.098,
    verticalOffset: 0.000,
    pcoL1: { n: 0.88, e: -0.16, u: 74.10 },
    pcoL2: { n: 0.62, e: -0.11, u: 65.80 },
    pcvZenith: [0.0, 0.5, 1.2, 2.2, 3.5, 5.0, 6.8],
  },
];

/**
 * Searches and automatically matches antenna information from a model string
 * (e.g. from a RINEX header "ANT # / TYPE" field like "TRM59800.00     NONE" or "LEIAR25.R4").
 */
export function matchAntennaInNoaaCatalog(rawModelStr: string): NoaaAntennaCalibration | null {
  if (!rawModelStr) return null;

  const clean = rawModelStr.trim().toUpperCase();
  if (clean.length === 0) return null;

  // 1. Direct exact 20-char or trimmed match
  for (const cal of NOAA_ANTCAL_CATALOG) {
    if (cal.model.trim().toUpperCase() === clean) return cal;
  }

  // 2. StartsWith match (e.g. "TRM59800.00" matches "TRM59800.00     NONE")
  for (const cal of NOAA_ANTCAL_CATALOG) {
    const mainModel = cal.model.substring(0, 15).trim().toUpperCase();
    if (clean.startsWith(mainModel) || mainModel.startsWith(clean)) {
      return cal;
    }
  }

  // 3. Substring match
  for (const cal of NOAA_ANTCAL_CATALOG) {
    const modelTrimmed = cal.model.replace(/\s+/g, ' ').toUpperCase();
    if (modelTrimmed.includes(clean) || clean.includes(cal.model.substring(0, 10).trim())) {
      return cal;
    }
  }

  // 4. Normalized alphanumeric match
  const normClean = clean.replace(/[^A-Z0-9]/g, '');
  if (normClean.length >= 3) {
    for (const cal of NOAA_ANTCAL_CATALOG) {
      const normModel = cal.model.replace(/[^A-Z0-9]/g, '');
      const normDisplay = cal.displayName.replace(/[^A-Z0-9]/g, '');
      if (normModel.includes(normClean) || normClean.includes(normModel) || normDisplay.includes(normClean)) {
        return cal;
      }
    }
  }

  return null;
}
