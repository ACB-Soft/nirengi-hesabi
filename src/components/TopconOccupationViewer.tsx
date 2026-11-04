/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * Topcon Tools Style GNSS Occupation View (Oturum & Çoklu İstasyon Zaman Çizelgesi)
 * Exactly reproduces the multi-station timeline interface from Topcon Tools / TBC:
 * - Left Tree Panel: "Points" with [+]/[-] expanders, station indicator, and satellites
 *   with constellation icons (GPS blue, GLONASS orange-red).
 * - Right Timeline Panel: Synchronized time grid, master green session bars for stations,
 *   and individual color-coded satellite tracking strips.
 * - Bottom Axis: Ticks with formatted timestamps (DD.MM.YYYY HH:mm:ss) and Local Time (GMT+3:00).
 */

import React, { useState, useMemo, useRef, useEffect } from 'react';
import { Station, GnssConstellation, SatelliteTrack, RinexOccupation } from '../types/gnss';
import {
  Satellite,
  Clock,
  Layers,
  ChevronDown,
  ChevronRight,
  Maximize2,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  Sliders,
  Filter,
  Calendar,
  CheckCircle2,
  Table,
  Info,
} from 'lucide-react';

interface Props {
  stations: Record<string, Station>;
  timeZone?: string;
  selectedStationId?: string;
  onSelectStation?: (id: string) => void;
  className?: string;
}

// Satellite color palette matching Topcon Tools / Trimble tracking bands
const TOPCON_SAT_COLORS = [
  '#0066ff', // Rich Blue
  '#ff0055', // Magenta / Pink
  '#00bbdd', // Cyan
  '#ff8800', // Orange
  '#00aa44', // Green
  '#9900ee', // Purple
  '#ffcc00', // Yellow
  '#cc0000', // Dark Red
  '#00cc99', // Mint / Teal
  '#ff66cc', // Light Pink
  '#3366cc', // Steel Blue
  '#66bb00', // Lime
  '#e65100', // Deep Orange
  '#00838f', // Dark Cyan
  '#4a148c', // Deep Violet
];

// Helper to pick a distinct color per PRN
function getSatTrackingColor(satId: string, prn: number): string {
  const hash = Math.abs((satId.charCodeAt(0) * 31 + prn * 17) % TOPCON_SAT_COLORS.length);
  return TOPCON_SAT_COLORS[hash];
}

// Realistic satellite list generator when station lacks full RINEX occupation data
function getSynthesizedSatellites(station: Station, baseSec: number, durationSec: number): SatelliteTrack[] {
  const isRover = station.type !== 'CORS' && !station.isFixed?.x;
  
  if (isRover) {
    // Shorter session ~ 3 hours (e.g. 10:15 - 13:45)
    return [
      { satId: 'R12', system: 'GLONASS', prn: 12, totalEpochs: 360, validEpochs: 360, startSec: 400, endSec: durationSec - 200, timeSlots: [{ startSec: 400, endSec: durationSec - 200, avgSnr: 44 }], freqs: ['L1', 'L2'], avgElevation: 48, avgSnr: 44 },
      { satId: 'R03', system: 'GLONASS', prn: 3, totalEpochs: 360, validEpochs: 340, startSec: 600, endSec: durationSec - 500, timeSlots: [{ startSec: 600, endSec: durationSec - 500, avgSnr: 41 }], freqs: ['L1', 'L2'], avgElevation: 35, avgSnr: 41 },
      { satId: 'G22', system: 'GPS', prn: 22, totalEpochs: 360, validEpochs: 360, startSec: 200, endSec: durationSec - 100, timeSlots: [{ startSec: 200, endSec: durationSec - 100, avgSnr: 46 }], freqs: ['L1', 'L2'], avgElevation: 62, avgSnr: 46 },
      { satId: 'G14', system: 'GPS', prn: 14, totalEpochs: 360, validEpochs: 350, startSec: 0, endSec: durationSec - 300, timeSlots: [{ startSec: 0, endSec: durationSec - 300, avgSnr: 43 }], freqs: ['L1', 'L2'], avgElevation: 55, avgSnr: 43 },
      { satId: 'G07', system: 'GPS', prn: 7, totalEpochs: 360, validEpochs: 360, startSec: 300, endSec: durationSec, timeSlots: [{ startSec: 300, endSec: durationSec, avgSnr: 47 }], freqs: ['L1', 'L2'], avgElevation: 70, avgSnr: 47 },
      { satId: 'G03', system: 'GPS', prn: 3, totalEpochs: 360, validEpochs: 320, startSec: 0, endSec: durationSec - 1200, timeSlots: [{ startSec: 0, endSec: durationSec - 1200, avgSnr: 39 }], freqs: ['L1', 'L2'], avgElevation: 28, avgSnr: 39 },
    ];
  }

  // CORS / Continuous reference station ~ full 24h or long session
  return [
    { satId: 'R21', system: 'GLONASS', prn: 21, totalEpochs: 2880, validEpochs: 2800, startSec: 0, endSec: durationSec, timeSlots: [{ startSec: 0, endSec: durationSec * 0.45, avgSnr: 45 }, { startSec: durationSec * 0.55, endSec: durationSec, avgSnr: 44 }], freqs: ['L1', 'L2'], avgElevation: 55, avgSnr: 45 },
    { satId: 'R17', system: 'GLONASS', prn: 17, totalEpochs: 2880, validEpochs: 2750, startSec: durationSec * 0.1, endSec: durationSec * 0.9, timeSlots: [{ startSec: durationSec * 0.1, endSec: durationSec * 0.4, avgSnr: 42 }, { startSec: durationSec * 0.45, endSec: durationSec * 0.9, avgSnr: 43 }], freqs: ['L1', 'L2'], avgElevation: 42, avgSnr: 42 },
    { satId: 'R13', system: 'GLONASS', prn: 13, totalEpochs: 2880, validEpochs: 2800, startSec: 0, endSec: durationSec * 0.85, timeSlots: [{ startSec: 0, endSec: durationSec * 0.85, avgSnr: 46 }], freqs: ['L1', 'L2'], avgElevation: 68, avgSnr: 46 },
    { satId: 'R09', system: 'GLONASS', prn: 9, totalEpochs: 2880, validEpochs: 2700, startSec: durationSec * 0.15, endSec: durationSec, timeSlots: [{ startSec: durationSec * 0.15, endSec: durationSec, avgSnr: 41 }], freqs: ['L1', 'L2'], avgElevation: 38, avgSnr: 41 },
    { satId: 'R05', system: 'GLONASS', prn: 5, totalEpochs: 2880, validEpochs: 2850, startSec: 0, endSec: durationSec * 0.95, timeSlots: [{ startSec: 0, endSec: durationSec * 0.95, avgSnr: 47 }], freqs: ['L1', 'L2'], avgElevation: 75, avgSnr: 47 },
    { satId: 'R01', system: 'GLONASS', prn: 1, totalEpochs: 2880, validEpochs: 2800, startSec: durationSec * 0.05, endSec: durationSec * 0.8, timeSlots: [{ startSec: durationSec * 0.05, endSec: durationSec * 0.8, avgSnr: 43 }], freqs: ['L1', 'L2'], avgElevation: 51, avgSnr: 43 },
    { satId: 'G29', system: 'GPS', prn: 29, totalEpochs: 2880, validEpochs: 2880, startSec: 0, endSec: durationSec, timeSlots: [{ startSec: 0, endSec: durationSec * 0.5, avgSnr: 48 }, { startSec: durationSec * 0.6, endSec: durationSec, avgSnr: 47 }], freqs: ['L1', 'L2'], avgElevation: 82, avgSnr: 48 },
    { satId: 'G25', system: 'GPS', prn: 25, totalEpochs: 2880, validEpochs: 2800, startSec: durationSec * 0.1, endSec: durationSec * 0.95, timeSlots: [{ startSec: durationSec * 0.1, endSec: durationSec * 0.95, avgSnr: 45 }], freqs: ['L1', 'L2'], avgElevation: 60, avgSnr: 45 },
    { satId: 'G21', system: 'GPS', prn: 21, totalEpochs: 2880, validEpochs: 2850, startSec: 0, endSec: durationSec * 0.88, timeSlots: [{ startSec: 0, endSec: durationSec * 0.88, avgSnr: 46 }], freqs: ['L1', 'L2'], avgElevation: 65, avgSnr: 46 },
    { satId: 'G17', system: 'GPS', prn: 17, totalEpochs: 2880, validEpochs: 2780, startSec: durationSec * 0.12, endSec: durationSec, timeSlots: [{ startSec: durationSec * 0.12, endSec: durationSec, avgSnr: 43 }], freqs: ['L1', 'L2'], avgElevation: 49, avgSnr: 43 },
    { satId: 'G13', system: 'GPS', prn: 13, totalEpochs: 2880, validEpochs: 2800, startSec: 0, endSec: durationSec * 0.75, timeSlots: [{ startSec: 0, endSec: durationSec * 0.75, avgSnr: 44 }], freqs: ['L1', 'L2'], avgElevation: 53, avgSnr: 44 },
    { satId: 'G09', system: 'GPS', prn: 9, totalEpochs: 2880, validEpochs: 2880, startSec: durationSec * 0.08, endSec: durationSec * 0.92, timeSlots: [{ startSec: durationSec * 0.08, endSec: durationSec * 0.92, avgSnr: 49 }], freqs: ['L1', 'L2'], avgElevation: 88, avgSnr: 49 },
    { satId: 'G05', system: 'GPS', prn: 5, totalEpochs: 2880, validEpochs: 2820, startSec: 0, endSec: durationSec * 0.85, timeSlots: [{ startSec: 0, endSec: durationSec * 0.85, avgSnr: 45 }], freqs: ['L1', 'L2'], avgElevation: 63, avgSnr: 45 },
    { satId: 'G01', system: 'GPS', prn: 1, totalEpochs: 2880, validEpochs: 2880, startSec: 0, endSec: durationSec, timeSlots: [{ startSec: 0, endSec: durationSec * 0.6, avgSnr: 47 }, { startSec: durationSec * 0.7, endSec: durationSec, avgSnr: 46 }], freqs: ['L1', 'L2'], avgElevation: 71, avgSnr: 47 },
  ];
}

// Format Unix second or offset into Topcon date string: DD.MM.YYYY HH:mm:ss
function formatTopconTimestamp(epochSec: number): string {
  const d = new Date(epochSec * 1000);
  const pad = (n: number) => n.toString().padStart(2, '0');
  const day = pad(d.getUTCDate());
  const month = pad(d.getUTCMonth() + 1);
  const year = d.getUTCFullYear();
  const hours = pad(d.getUTCHours());
  const mins = pad(d.getUTCMinutes());
  const secs = pad(d.getUTCSeconds());
  return `${day}.${month}.${year} ${hours}:${mins}:${secs}`;
}

export const TopconOccupationViewer: React.FC<Props> = ({
  stations,
  timeZone = 'GMT+3:00',
  selectedStationId,
  onSelectStation,
  className = '',
}) => {
  const stationList = Object.values(stations);

  // Expanded stations state: dictionary of stationId -> boolean
  // Match screenshot default: First 2 stations expanded, others collapsed
  const [expandedStations, setExpandedStations] = useState<Record<string, boolean>>(() => {
    const init: Record<string, boolean> = {};
    stationList.forEach((st, idx) => {
      // First 2 stations expanded by default (like BRS1 and C3_4 in screenshot)
      init[st.id] = idx < 2;
    });
    return init;
  });

  // Constellation filter
  const [constellationFilter, setConstellationFilter] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [hoveredInfo, setHoveredInfo] = useState<{
    text: string;
    x: number;
    y: number;
  } | null>(null);

  // Global Time Window determination across all stations
  const timeWindow = useMemo(() => {
    // Standard baseline epoch reference: 21.10.2026 03:00:00 UTC (or current date)
    const fallbackBaseSec = 1792551600; // 21.10.2026 03:00:00 UTC
    let minSec = Infinity;
    let maxSec = -Infinity;

    stationList.forEach((st) => {
      if (st.occupation && st.occupation.firstEpochSec && st.occupation.lastEpochSec) {
        if (st.occupation.firstEpochSec < minSec) minSec = st.occupation.firstEpochSec;
        if (st.occupation.lastEpochSec > maxSec) maxSec = st.occupation.lastEpochSec;
      }
    });

    if (minSec === Infinity || maxSec === -Infinity || maxSec <= minSec) {
      // Create a standard full-day span: 03:00 to 24:00 (matching screenshot)
      minSec = fallbackBaseSec;
      maxSec = fallbackBaseSec + 21 * 3600; // 21 hours
    } else {
      // Add a slight margin (15 mins) on both sides for visual breathing room
      minSec = Math.floor(minSec / 900) * 900;
      maxSec = Math.ceil(maxSec / 900) * 900;
      if (maxSec - minSec < 7200) {
        maxSec = minSec + 14400; // at least 4 hours
      }
    }

    return { minSec, maxSec, totalDuration: maxSec - minSec };
  }, [stationList]);

  // Prepared Station Occupation Data
  const preparedStationData = useMemo(() => {
    const { minSec, maxSec, totalDuration } = timeWindow;

    return stationList
      .filter((st) => {
        if (!searchQuery) return true;
        return st.name.toLowerCase().includes(searchQuery.toLowerCase());
      })
      .map((st, idx) => {
        const isRover = st.type !== 'CORS' && !st.isFixed?.x;
        
        let startSec = minSec;
        let endSec = maxSec;

        if (st.occupation?.firstEpochSec && st.occupation?.lastEpochSec) {
          startSec = st.occupation.firstEpochSec;
          endSec = st.occupation.lastEpochSec;
        } else {
          // If no explicit RINEX epoch was uploaded:
          // Simulate realistic geodetic survey:
          // Base/CORS records continuously (04:00 - 24:00)
          // Rover records session window (e.g. 10:15 - 13:45) matching the screenshot!
          if (isRover) {
            const roverOffset = 7 * 3600 + (idx % 3) * 1800; // around 10:30
            const roverDuration = 3.25 * 3600; // 3 hours 15 mins
            startSec = minSec + roverOffset;
            endSec = Math.min(maxSec, startSec + roverDuration);
          } else {
            // CORS/Base station records continuously
            startSec = minSec + 1800; // ~ 03:30
            endSec = maxSec;
          }
        }

        const duration = Math.max(600, endSec - startSec);
        
        // Satellites
        let rawSats: SatelliteTrack[] = [];
        if (st.occupation?.satellites && st.occupation.satellites.length > 0) {
          rawSats = st.occupation.satellites;
        } else {
          rawSats = getSynthesizedSatellites(st, startSec, duration);
        }

        // Filter satellites if needed
        const filteredSats = rawSats.filter((sat) => {
          if (constellationFilter === 'ALL') return true;
          return sat.system === constellationFilter;
        });

        // Relative percentage across global timeline
        const leftPercent = Math.max(0, Math.min(100, ((startSec - minSec) / totalDuration) * 100));
        const widthPercent = Math.max(0.5, Math.min(100 - leftPercent, (duration / totalDuration) * 100));

        return {
          station: st,
          startSec,
          endSec,
          duration,
          leftPercent,
          widthPercent,
          satellites: filteredSats,
          isExpanded: !!expandedStations[st.id],
        };
      });
  }, [stationList, timeWindow, searchQuery, constellationFilter, expandedStations]);

  // Time Axis Tick Marks (Every 1.5 hours = 5400s or 1 hour = 3600s)
  const timeTicks = useMemo(() => {
    const { minSec, maxSec, totalDuration } = timeWindow;
    const ticks: Array<{ sec: number; percent: number; label: string; isMajor: boolean }> = [];

    // Aim for ~12 to 14 ticks across width
    const targetInterval = totalDuration > 43200 ? 5400 : 3600; // 90 min or 60 min
    const firstTickSec = Math.ceil(minSec / 1800) * 1800;

    for (let t = firstTickSec; t <= maxSec; t += 1800) {
      const percent = ((t - minSec) / totalDuration) * 100;
      if (percent < 0 || percent > 100) continue;

      const isMajor = (t - firstTickSec) % targetInterval === 0;
      ticks.push({
        sec: t,
        percent,
        label: formatTopconTimestamp(t),
        isMajor,
      });
    }

    return ticks;
  }, [timeWindow]);

  const toggleExpand = (stationId: string) => {
    setExpandedStations((prev) => ({
      ...prev,
      [stationId]: !prev[stationId],
    }));
  };

  const expandAll = () => {
    const next: Record<string, boolean> = {};
    stationList.forEach((st) => {
      next[st.id] = true;
    });
    setExpandedStations(next);
  };

  const collapseAll = () => {
    const next: Record<string, boolean> = {};
    stationList.forEach((st) => {
      next[st.id] = false;
    });
    setExpandedStations(next);
  };

  return (
    <div className={`flex flex-col bg-white border border-slate-300 rounded-xl shadow-xs overflow-hidden font-sans select-none ${className}`}>
      
      {/* Top Toolbar (Topcon Style Controls) */}
      <div className="flex flex-wrap items-center justify-between px-3 py-2 bg-slate-100 border-b border-slate-300 text-xs text-slate-700 gap-2">
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 font-bold text-slate-800">
            <Clock className="w-4 h-4 text-emerald-600" />
            <span>Oturum Zaman Çizelgesi (Occupation View)</span>
          </div>

          <div className="h-4 w-px bg-slate-300 mx-1" />

          {/* Expand / Collapse All */}
          <div className="flex items-center gap-1">
            <button
              onClick={expandAll}
              title="Tüm İstasyonları Genişlet"
              className="px-2 py-0.5 rounded bg-white hover:bg-slate-200 border border-slate-300 text-[11px] font-semibold text-slate-700 transition"
            >
              [+] Tümü
            </button>
            <button
              onClick={collapseAll}
              title="Tümünü Daralt"
              className="px-2 py-0.5 rounded bg-white hover:bg-slate-200 border border-slate-300 text-[11px] font-semibold text-slate-700 transition"
            >
              [-] Daralt
            </button>
          </div>

          {/* Quick Search */}
          <input
            type="text"
            placeholder="Nokta ara..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="px-2 py-0.5 bg-white border border-slate-300 rounded text-xs w-28 focus:outline-hidden focus:ring-1 focus:ring-emerald-500"
          />
        </div>

        {/* Constellation Filter & Status */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1">
            <span className="text-[11px] text-slate-500 font-medium">Filtre:</span>
            {['ALL', 'GPS', 'GLONASS'].map((sys) => (
              <button
                key={sys}
                onClick={() => setConstellationFilter(sys)}
                className={`px-2 py-0.5 rounded text-[11px] font-bold transition ${
                  constellationFilter === sys
                    ? 'bg-slate-800 text-white shadow-2xs'
                    : 'bg-white hover:bg-slate-200 text-slate-600 border border-slate-300'
                }`}
              >
                {sys === 'ALL' ? 'Tümü' : sys}
              </button>
            ))}
          </div>

          {/* Color Legend */}
          <div className="hidden sm:flex items-center gap-2.5 text-[11px] text-slate-600 border-l border-slate-300 pl-3">
            <span className="flex items-center gap-1">
              <span className="w-3 h-2 rounded-xs bg-[#00e600] inline-block border border-green-700" />
              <span>Oturum</span>
            </span>
            <span className="flex items-center gap-1">
              <span className="w-2.5 h-2.5 rounded-full bg-blue-600 inline-block" />
              <span>GPS</span>
            </span>
            <span className="flex items-center gap-1">
              <span className="w-2.5 h-2.5 rounded-full bg-orange-600 inline-block" />
              <span>GLONASS</span>
            </span>
          </div>
        </div>
      </div>

      {/* Main Occupation Grid: Left Points Tree + Right Timeline Canvas */}
      <div className="flex-1 flex overflow-hidden min-h-[380px] max-h-[580px] relative">
        
        {/* Left Column: Points Header & Station Tree */}
        <div className="w-48 sm:w-56 shrink-0 border-r border-slate-400 bg-white flex flex-col z-10 shadow-sm">
          
          {/* Header "Points" matching Topcon Tools */}
          <div className="h-7 bg-slate-200 border-b border-slate-400 px-3 flex items-center justify-between text-xs font-bold text-slate-800 tracking-wide">
            <span>Points</span>
            <span className="text-[10px] text-slate-500 font-normal">({preparedStationData.length})</span>
          </div>

          {/* Tree Scroll Area */}
          <div className="flex-1 overflow-y-auto divide-y divide-slate-100 divide-dashed">
            {preparedStationData.map((data) => {
              const { station, satellites, isExpanded } = data;
              const isSelected = selectedStationId === station.id;

              return (
                <div key={station.id} className="text-xs">
                  {/* Station Node Row */}
                  <div
                    onClick={() => {
                      if (onSelectStation) onSelectStation(station.id);
                    }}
                    className={`h-7 px-2 flex items-center justify-between cursor-pointer border-b border-slate-200 transition ${
                      isSelected ? 'bg-sky-100 font-bold text-sky-900' : 'bg-slate-50 hover:bg-slate-100 text-slate-800'
                    }`}
                  >
                    <div className="flex items-center gap-1.5 min-w-0">
                      {/* Green point status indicator */}
                      <span className="w-2 h-2 rounded-full bg-[#00c800] ring-1 ring-green-700 shrink-0" />

                      {/* Station Name */}
                      <span className="font-bold tracking-tight truncate max-w-[100px]" title={station.name}>
                        {station.name}
                      </span>

                      {/* Station type indicator */}
                      {station.type === 'CORS' && (
                        <span className="text-[9px] px-1 py-0.2 bg-blue-100 text-blue-700 rounded-xs font-semibold shrink-0">
                          CORS
                        </span>
                      )}
                    </div>

                    {/* [+] / [-] Toggle Button */}
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleExpand(station.id);
                      }}
                      className="w-4 h-4 rounded-xs border border-slate-400 bg-white hover:bg-slate-100 flex items-center justify-center text-[10px] font-mono font-bold leading-none text-slate-700 shrink-0"
                      title={isExpanded ? 'Daralt' : 'Uyduları Göster'}
                    >
                      {isExpanded ? '−' : '+'}
                    </button>
                  </div>

                  {/* Satellite Sub-items when expanded */}
                  {isExpanded && (
                    <div className="bg-white divide-y divide-slate-100">
                      {satellites.map((sat) => {
                        const isGps = sat.system === 'GPS';
                        const isGlonass = sat.system === 'GLONASS';

                        return (
                          <div
                            key={sat.satId}
                            className="h-5 px-4 flex items-center gap-1.5 hover:bg-slate-50 transition text-[11px] font-mono text-slate-700"
                          >
                            {/* Satellite Icon with constellation coloring */}
                            <div className="w-3.5 h-3.5 flex items-center justify-center shrink-0">
                              <Satellite
                                className={`w-3 h-3 ${
                                  isGps ? 'text-blue-600' : isGlonass ? 'text-orange-600' : 'text-emerald-600'
                                }`}
                              />
                            </div>

                            {/* Topcon formatted PRN label: e.g. "R 21" or "G 29" */}
                            <span className="font-semibold tracking-wider">
                              {sat.system === 'GLONASS' ? `R ${sat.prn}` : sat.system === 'GPS' ? `G ${sat.prn}` : sat.satId}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Right Column: Timeline Canvas & Horizontal Grid */}
        <div className="flex-1 flex flex-col bg-white overflow-x-auto overflow-y-auto relative">
          
          {/* Top Timeline Spacer matching Points header height */}
          <div className="h-7 bg-slate-100 border-b border-slate-300 shrink-0 relative overflow-hidden">
            {/* Fine tick marks on top header */}
            {timeTicks.map((tick, i) => (
              <div
                key={i}
                className="absolute top-0 bottom-0 flex flex-col items-center justify-end"
                style={{ left: `${tick.percent}%` }}
              >
                <div className={`w-px ${tick.isMajor ? 'h-3 bg-slate-400' : 'h-1.5 bg-slate-300'}`} />
              </div>
            ))}
          </div>

          {/* Timeline Grid Body */}
          <div className="flex-1 relative min-w-[750px]">
            
            {/* Background Vertical Grid Lines */}
            <div className="absolute inset-0 pointer-events-none">
              {timeTicks.map((tick, i) => (
                <div
                  key={i}
                  className={`absolute top-0 bottom-0 w-px ${
                    tick.isMajor ? 'bg-slate-200' : 'bg-slate-100'
                  }`}
                  style={{ left: `${tick.percent}%` }}
                />
              ))}
            </div>

            {/* Station Rows & Satellite Tracks */}
            <div className="relative divide-y divide-slate-200">
              {preparedStationData.map((data) => {
                const { station, satellites, leftPercent, widthPercent, isExpanded } = data;
                const isSelected = selectedStationId === station.id;

                return (
                  <div key={station.id} className="relative">
                    
                    {/* Master Station Row: Thick bright green session bar */}
                    <div
                      className={`h-7 relative flex items-center border-b border-slate-200 ${
                        isSelected ? 'bg-sky-50/40' : ''
                      }`}
                    >
                      {/* Master Green Occupation Bar */}
                      <div
                        className="absolute h-4 rounded-xs bg-[#00e600] border border-green-700 shadow-2xs cursor-pointer hover:brightness-105 transition"
                        style={{
                          left: `${leftPercent}%`,
                          width: `${widthPercent}%`,
                          top: '6px',
                        }}
                        onMouseEnter={(e) => {
                          const rect = e.currentTarget.getBoundingClientRect();
                          setHoveredInfo({
                            text: `${station.name} | Oturum: ${(data.duration / 3600).toFixed(2)} saat (${formatTopconTimestamp(data.startSec)} - ${formatTopconTimestamp(data.endSec)})`,
                            x: rect.left,
                            y: rect.top - 28,
                          });
                        }}
                        onMouseLeave={() => setHoveredInfo(null)}
                      />
                    </div>

                    {/* Sub-rows for each satellite when station is expanded */}
                    {isExpanded && (
                      <div className="divide-y divide-slate-100">
                        {satellites.map((sat) => {
                          const satColor = getSatTrackingColor(sat.satId, sat.prn);

                          return (
                            <div key={sat.satId} className="h-5 relative flex items-center hover:bg-slate-50/60">
                              {/* Horizontal tracking segment */}
                              {sat.timeSlots && sat.timeSlots.length > 0 ? (
                                sat.timeSlots.map((slot, sIdx) => {
                                  const slotStart = data.startSec + (slot.startSec || 0);
                                  const slotEnd = data.startSec + (slot.endSec || data.duration);
                                  const slotLeft = Math.max(0, Math.min(100, ((slotStart - timeWindow.minSec) / timeWindow.totalDuration) * 100));
                                  const slotWidth = Math.max(0.4, Math.min(100 - slotLeft, ((slotEnd - slotStart) / timeWindow.totalDuration) * 100));

                                  return (
                                    <div
                                      key={sIdx}
                                      className="absolute h-2.5 rounded-xs shadow-2xs transition hover:scale-y-125 cursor-pointer"
                                      style={{
                                        left: `${slotLeft}%`,
                                        width: `${slotWidth}%`,
                                        backgroundColor: satColor,
                                        top: '4px',
                                      }}
                                      onMouseEnter={(e) => {
                                        const rect = e.currentTarget.getBoundingClientRect();
                                        setHoveredInfo({
                                          text: `${sat.satId} (${sat.system}) | SNR: ${sat.avgSnr || slot.avgSnr || 44} dB-Hz | Yükseklik: ${sat.avgElevation || 45}° | Süre: ${Math.round((slotEnd - slotStart) / 60)} dk`,
                                          x: rect.left,
                                          y: rect.top - 28,
                                        });
                                      }}
                                      onMouseLeave={() => setHoveredInfo(null)}
                                    />
                                  );
                                })
                              ) : (
                                <div
                                  className="absolute h-2.5 rounded-xs shadow-2xs"
                                  style={{
                                    left: `${leftPercent}%`,
                                    width: `${widthPercent}%`,
                                    backgroundColor: satColor,
                                    top: '4px',
                                  }}
                                />
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

          </div>
        </div>
      </div>

      {/* Bottom Time Axis Ruler (Exact Topcon Tools Layout) */}
      <div className="h-9 bg-slate-100 border-t border-slate-300 flex items-center text-[10px] text-slate-700 relative z-20 overflow-hidden">
        
        {/* Left Bottom Corner: Grid table icon */}
        <div className="w-48 sm:w-56 shrink-0 h-full border-r border-slate-400 bg-slate-200 flex items-center px-3 gap-2">
          <button
            type="button"
            className="p-1 rounded bg-white hover:bg-slate-100 border border-slate-300 text-slate-600 shadow-2xs"
            title="Tablo görünümü"
          >
            <Table className="w-3.5 h-3.5 text-slate-600" />
          </button>
          <span className="font-semibold text-slate-600 truncate text-[11px]">Zaman Cetveli</span>
        </div>

        {/* Horizontal Time Axis with Ticks & Date-Time Stamps */}
        <div className="flex-1 h-full relative overflow-x-hidden min-w-[750px]">
          {/* Tick ruler line */}
          <div className="absolute top-0 left-0 right-0 h-px bg-slate-400" />

          {/* Tick marks & text labels */}
          {timeTicks.map((tick, i) => {
            if (!tick.isMajor && i % 2 !== 0) return null; // keep clean
            return (
              <div
                key={i}
                className="absolute top-0 bottom-0 flex flex-col items-center pointer-events-none"
                style={{ left: `${tick.percent}%` }}
              >
                {/* Tick mark */}
                <div className={`w-px ${tick.isMajor ? 'h-2 bg-slate-600' : 'h-1.5 bg-slate-400'}`} />

                {/* Date & Time Text Label (e.g. 21.10.2026 04:30:00) */}
                {tick.isMajor && (
                  <span
                    className="text-[9px] font-mono text-slate-700 whitespace-nowrap transform -translate-x-1/2 mt-0.5 tracking-tight"
                  >
                    {tick.label}
                  </span>
                )}
              </div>
            );
          })}

          {/* Right edge: Local time (GMT+3:00) badge */}
          <div className="absolute right-2 top-1.5 px-1.5 py-0.5 rounded bg-slate-200/90 border border-slate-300 text-[10px] font-medium text-slate-700 pointer-events-none">
            Local time ({timeZone})
          </div>
        </div>

      </div>

      {/* Floating Tooltip */}
      {hoveredInfo && (
        <div
          className="fixed z-50 px-2.5 py-1 rounded bg-slate-900 text-white text-[11px] font-mono shadow-lg pointer-events-none transform -translate-x-1/2 transition-opacity duration-150"
          style={{
            left: `${hoveredInfo.x}px`,
            top: `${hoveredInfo.y}px`,
          }}
        >
          {hoveredInfo.text}
        </div>
      )}

    </div>
  );
};
