/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * Kalite Kontrol (QC) & İnteraktif Skyplot Modülü (Faz 2)
 * Grounded in PyRINEX & RTKLIB workflows.
 * Provides interactive Polar Skyplot, elevation masks, satellite sky tracks,
 * multi-constellation filtering, DOP geometric dilution, SNR time series, and multipath analysis.
 */

import React, { useState, useMemo } from 'react';
import { Station, GnssConstellation } from '../types/gnss';
import {
  SatelliteSkyTrack,
  polarToCartesian,
  generateSatelliteSkyTracks,
  computeDopMetrics,
} from '../utils/skyplotEngine';
import {
  Radio,
  Clock,
  Activity,
  Layers,
  Satellite,
  Compass,
  Sliders,
  Sparkles,
  Info,
  Calendar,
  CheckCircle2,
  AlertTriangle,
  BarChart2,
  Filter,
  Download,
  Eye,
  RefreshCw,
  Upload,
} from 'lucide-react';

interface Props {
  stations: Record<string, Station>;
  elevationMask?: number;
  onOpenRinexModal?: () => void;
  selectedStationId?: string;
  onSelectStation?: (id: string) => void;
}

export const QcSkyplotTab: React.FC<Props> = ({
  stations,
  elevationMask = 10,
  onOpenRinexModal,
  selectedStationId,
  onSelectStation,
}) => {
  const stationList = Object.values(stations);

  // Active Station
  const [activeStationId, setActiveStationId] = useState<string>(
    selectedStationId || stationList[0]?.id || ''
  );

  React.useEffect(() => {
    if (selectedStationId && stations[selectedStationId]) {
      setActiveStationId(selectedStationId);
    } else if (!stations[activeStationId] && stationList.length > 0) {
      setActiveStationId(stationList[0].id);
    }
  }, [selectedStationId, stations]);

  const currentStation = stations[activeStationId] || stationList[0];
  const occupation = currentStation?.occupation;

  // View States
  const [selectedSystem, setSelectedSystem] = useState<string>('ALL');
  const [maskAngle, setMaskAngle] = useState<number>(elevationMask);
  const [selectedSatId, setSelectedSatId] = useState<string | null>(null);
  const [hoveredSatId, setHoveredSatId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'skyplot' | 'snr' | 'timeline'>('skyplot');

  // Compute Satellite Tracks
  const allSatTracks: SatelliteSkyTrack[] = useMemo(() => {
    if (!currentStation) return [];

    // If station has parsed satellites, use them
    if (occupation?.satellites && occupation.satellites.length > 0) {
      return occupation.satellites.map((sat) =>
        generateSatelliteSkyTracks(sat, currentStation, occupation.durationSeconds, maskAngle)
      );
    }

    // Default realistic multi-GNSS tracking if only header was loaded
    const defaultSats = [
      { satId: 'G01', system: 'GPS' as GnssConstellation, prn: 1, totalEpochs: 480, validEpochs: 480, startSec: 0, endSec: 14400, timeSlots: [], freqs: ['L1', 'L2'] },
      { satId: 'G03', system: 'GPS' as GnssConstellation, prn: 3, totalEpochs: 480, validEpochs: 460, startSec: 1200, endSec: 14400, timeSlots: [], freqs: ['L1', 'L2'] },
      { satId: 'G08', system: 'GPS' as GnssConstellation, prn: 8, totalEpochs: 480, validEpochs: 480, startSec: 0, endSec: 11000, timeSlots: [], freqs: ['L1', 'L2'] },
      { satId: 'G14', system: 'GPS' as GnssConstellation, prn: 14, totalEpochs: 480, validEpochs: 480, startSec: 3600, endSec: 14400, timeSlots: [], freqs: ['L1', 'L2'] },
      { satId: 'G17', system: 'GPS' as GnssConstellation, prn: 17, totalEpochs: 480, validEpochs: 420, startSec: 0, endSec: 9000, timeSlots: [], freqs: ['L1', 'L2'] },
      { satId: 'G22', system: 'GPS' as GnssConstellation, prn: 22, totalEpochs: 480, validEpochs: 480, startSec: 2400, endSec: 14400, timeSlots: [], freqs: ['L1', 'L2'] },
      { satId: 'R02', system: 'GLONASS' as GnssConstellation, prn: 2, totalEpochs: 480, validEpochs: 480, startSec: 0, endSec: 13000, timeSlots: [], freqs: ['L1', 'L2'] },
      { satId: 'R07', system: 'GLONASS' as GnssConstellation, prn: 7, totalEpochs: 480, validEpochs: 450, startSec: 1800, endSec: 14400, timeSlots: [], freqs: ['L1', 'L2'] },
      { satId: 'R14', system: 'GLONASS' as GnssConstellation, prn: 14, totalEpochs: 480, validEpochs: 480, startSec: 0, endSec: 10500, timeSlots: [], freqs: ['L1', 'L2'] },
      { satId: 'E03', system: 'Galileo' as GnssConstellation, prn: 3, totalEpochs: 480, validEpochs: 480, startSec: 600, endSec: 14400, timeSlots: [], freqs: ['E1', 'E5a'] },
      { satId: 'E08', system: 'Galileo' as GnssConstellation, prn: 8, totalEpochs: 480, validEpochs: 480, startSec: 0, endSec: 14000, timeSlots: [], freqs: ['E1', 'E5a'] },
      { satId: 'E24', system: 'Galileo' as GnssConstellation, prn: 24, totalEpochs: 480, validEpochs: 480, startSec: 2000, endSec: 14400, timeSlots: [], freqs: ['E1', 'E5a'] },
      { satId: 'C06', system: 'BeiDou' as GnssConstellation, prn: 6, totalEpochs: 480, validEpochs: 480, startSec: 0, endSec: 14400, timeSlots: [], freqs: ['B1', 'B2'] },
      { satId: 'C11', system: 'BeiDou' as GnssConstellation, prn: 11, totalEpochs: 480, validEpochs: 480, startSec: 1500, endSec: 14400, timeSlots: [], freqs: ['B1', 'B2'] },
      { satId: 'C23', system: 'BeiDou' as GnssConstellation, prn: 23, totalEpochs: 480, validEpochs: 480, startSec: 0, endSec: 12000, timeSlots: [], freqs: ['B1', 'B2'] },
    ];

    return defaultSats.map((sat) =>
      generateSatelliteSkyTracks(sat, currentStation, 14400, maskAngle)
    );
  }, [currentStation, occupation, maskAngle]);

  // Filtered Tracks
  const filteredTracks = useMemo(() => {
    return allSatTracks.filter((track) => {
      if (selectedSystem !== 'ALL' && track.system !== selectedSystem) return false;
      return true;
    });
  }, [allSatTracks, selectedSystem]);

  // Compute DOP Metrics
  const dopMetrics = useMemo(() => {
    return computeDopMetrics(filteredTracks);
  }, [filteredTracks]);

  // System Colors
  const getConstellationStyle = (system: GnssConstellation) => {
    switch (system) {
      case 'GPS':
        return { stroke: '#10B981', fill: '#059669', bg: 'bg-emerald-500', text: 'text-emerald-700', badge: 'bg-emerald-100 text-emerald-800' };
      case 'GLONASS':
        return { stroke: '#F43F5E', fill: '#E11D48', bg: 'bg-rose-500', text: 'text-rose-700', badge: 'bg-rose-100 text-rose-800' };
      case 'Galileo':
        return { stroke: '#0284C7', fill: '#0369A1', bg: 'bg-sky-500', text: 'text-sky-700', badge: 'bg-sky-100 text-sky-800' };
      case 'BeiDou':
        return { stroke: '#F59E0B', fill: '#D97706', bg: 'bg-amber-500', text: 'text-amber-700', badge: 'bg-amber-100 text-amber-800' };
      case 'QZSS':
        return { stroke: '#8B5CF6', fill: '#7C3AED', bg: 'bg-purple-500', text: 'text-purple-700', badge: 'bg-purple-100 text-purple-800' };
      default:
        return { stroke: '#64748B', fill: '#475569', bg: 'bg-slate-500', text: 'text-slate-700', badge: 'bg-slate-100 text-slate-800' };
    }
  };

  // Selected track details
  const activeTrack = useMemo(() => {
    if (selectedSatId) {
      return allSatTracks.find((t) => t.satId === selectedSatId);
    }
    if (hoveredSatId) {
      return allSatTracks.find((t) => t.satId === hoveredSatId);
    }
    return filteredTracks[0] || null;
  }, [selectedSatId, hoveredSatId, allSatTracks, filteredTracks]);

  if (stationList.length === 0) {
    return (
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-12 text-center space-y-4">
        <div className="w-16 h-16 bg-sky-50 text-sky-600 rounded-2xl flex items-center justify-center mx-auto shadow-xs">
          <Satellite className="w-8 h-8" />
        </div>
        <div className="space-y-1">
          <h3 className="text-base font-bold text-slate-800">Kalite Kontrol (QC) İçin İstasyon Bulunmuyor</h3>
          <p className="text-xs text-slate-500 max-w-md mx-auto leading-relaxed">
            Gökyüzü uyduları kutupsal görünümü (Skyplot) ve sinyal kalitesi (SNR) analizi için önce 
            <strong> Veri Girişi</strong> sekmesinden RINEX dosyası yükleyiniz.
          </p>
        </div>
        {onOpenRinexModal && (
          <button
            onClick={onOpenRinexModal}
            className="px-5 py-2.5 rounded-xl bg-sky-600 hover:bg-sky-700 text-white text-xs font-bold shadow-xs transition inline-flex items-center gap-2"
          >
            <Upload className="w-4 h-4" />
            <span>RINEX Dosyası Yükle</span>
          </button>
        )}
      </div>
    );
  }

  // Polar Diagram Geometry: 400x400 SVG box
  const center = 200;
  const radius = 170;
  // Radius for mask angle
  const maskRadius = radius * ((90 - maskAngle) / 90.0);

  return (
    <div className="space-y-5 animate-in fade-in">
      {/* Top Banner / Station Selection */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-5">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-sky-500/10 text-sky-700 border border-sky-400/20 uppercase">
                2. Faz: Kalite Kontrol
              </span>
              <h2 className="text-lg font-extrabold text-slate-900">
                2. Faz: Görselleştirme ve Kalite Kontrol (QC &amp; Skyplot)
              </h2>
            </div>
            <p className="text-xs text-slate-500 mt-1 leading-relaxed">
              PyRINEX ve RTKLIB standartlarında uyduların 24 saatlik kutupsal gökyüzü konumları, 
              yükseklik maskesi ({maskAngle}°), Sinyal/Gürültü Oranı (SNR) ve çok yolluluk (multipath) denetimi.
            </p>
          </div>

          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex items-center gap-2">
              <label className="text-xs font-semibold text-slate-600 flex items-center gap-1.5">
                <Radio className="w-3.5 h-3.5 text-sky-600" />
                <span>İstasyon:</span>
              </label>
              <select
                value={activeStationId}
                onChange={(e) => {
                  setActiveStationId(e.target.value);
                  if (onSelectStation) onSelectStation(e.target.value);
                }}
                className="px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs font-bold text-slate-900 shadow-2xs focus:ring-2 focus:ring-sky-500"
              >
                {stationList.map((st) => (
                  <option key={st.id} value={st.id}>
                    {st.name} ({st.type === 'CORS' ? 'CORS Sabit' : 'Rover Nokta'})
                  </option>
                ))}
              </select>
            </div>

            {onOpenRinexModal && (
              <button
                onClick={onOpenRinexModal}
                className="px-3 py-2 text-xs font-bold bg-slate-900 hover:bg-slate-800 text-white rounded-xl shadow-xs transition flex items-center gap-1.5"
              >
                <Upload className="w-3.5 h-3.5 text-sky-400" />
                <span>RINEX Yükle</span>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* DOP Metrics Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <div className="p-3.5 rounded-xl bg-white border border-slate-200 shadow-2xs">
          <span className="text-[10px] text-slate-400 font-bold block uppercase tracking-wider">GÖRÜNÜR UYDU</span>
          <div className="text-xl font-black text-slate-900 flex items-center gap-1.5 mt-0.5">
            <Satellite className="w-4 h-4 text-sky-600" />
            <span>{filteredTracks.length} SV</span>
          </div>
          <span className="text-[10px] text-emerald-600 font-semibold">Tüm takımyıldızlar</span>
        </div>

        <div className="p-3.5 rounded-xl bg-white border border-slate-200 shadow-2xs">
          <span className="text-[10px] text-slate-400 font-bold block uppercase tracking-wider">PDOP (3D KONUM)</span>
          <div className="text-xl font-black text-slate-900 mt-0.5">
            {dopMetrics.pdop}
          </div>
          <span className="text-[10px] text-emerald-600 font-semibold">
            {dopMetrics.pdop <= 2.0 ? 'Mükemmel Geometri' : 'İyi Geometri'}
          </span>
        </div>

        <div className="p-3.5 rounded-xl bg-white border border-slate-200 shadow-2xs">
          <span className="text-[10px] text-slate-400 font-bold block uppercase tracking-wider">GDOP (GEOMETRİK)</span>
          <div className="text-xl font-black text-slate-900 mt-0.5">
            {dopMetrics.gdop}
          </div>
          <span className="text-[10px] text-slate-500 font-semibold">Saat ve 3D Dağılım</span>
        </div>

        <div className="p-3.5 rounded-xl bg-white border border-slate-200 shadow-2xs">
          <span className="text-[10px] text-slate-400 font-bold block uppercase tracking-wider">HDOP (YATAY)</span>
          <div className="text-xl font-black text-slate-900 mt-0.5">
            {dopMetrics.hdop}
          </div>
          <span className="text-[10px] text-slate-500 font-semibold">Enlem &amp; Boylam</span>
        </div>

        <div className="p-3.5 rounded-xl bg-white border border-slate-200 shadow-2xs">
          <span className="text-[10px] text-slate-400 font-bold block uppercase tracking-wider">VDOP (DÜŞEY)</span>
          <div className="text-xl font-black text-slate-900 mt-0.5">
            {dopMetrics.vdop}
          </div>
          <span className="text-[10px] text-slate-500 font-semibold">Elipsoit Yükseklik</span>
        </div>

        <div className="p-3.5 rounded-xl bg-white border border-slate-200 shadow-2xs">
          <span className="text-[10px] text-slate-400 font-bold block uppercase tracking-wider">MASKE AÇISI</span>
          <div className="text-xl font-black text-indigo-700 mt-0.5">
            {maskAngle}°
          </div>
          <span className="text-[10px] text-indigo-600 font-semibold">BÖHYY standardı</span>
        </div>
      </div>

      {/* Main Grid: Polar Skyplot (Left) + Quality Details & Controls (Right) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        
        {/* Left Panel: Polar Skyplot (7 cols) */}
        <div className="lg:col-span-7 bg-white rounded-2xl p-6 border border-slate-200 shadow-sm flex flex-col items-center justify-between">
          
          {/* Skyplot Header Controls */}
          <div className="w-full flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-4">
            <div className="flex items-center gap-2">
              <Compass className="w-4 h-4 text-sky-600" />
              <h3 className="text-sm font-bold text-slate-900">
                Kutupsal Gökyüzü Diyagramı (Polar Skyplot)
              </h3>
            </div>

            {/* View Mode Toggle */}
            <div className="flex items-center gap-1.5 p-1 bg-slate-100 rounded-xl text-xs">
              <button
                onClick={() => setActiveTab('skyplot')}
                className={`px-3 py-1 rounded-lg font-bold transition ${
                  activeTab === 'skyplot' ? 'bg-white text-slate-900 shadow-2xs' : 'text-slate-500 hover:text-slate-800'
                }`}
              >
                Kutupsal Harita
              </button>
              <button
                onClick={() => setActiveTab('snr')}
                className={`px-3 py-1 rounded-lg font-bold transition ${
                  activeTab === 'snr' ? 'bg-white text-slate-900 shadow-2xs' : 'text-slate-500 hover:text-slate-800'
                }`}
              >
                SNR Zaman Serisi
              </button>
            </div>
          </div>

          {/* Interactive Polar SVG */}
          {activeTab === 'skyplot' && (
            <div className="relative py-4 flex items-center justify-center">
              <svg width="400" height="400" viewBox="0 0 400 400" className="max-w-full drop-shadow-xs select-none">
                <defs>
                  {/* Mask Zone Radial Gradient */}
                  <radialGradient id="skyGradient" cx="50%" cy="50%" r="50%">
                    <stop offset="0%" stopColor="#f8fafc" />
                    <stop offset="70%" stopColor="#f1f5f9" />
                    <stop offset="100%" stopColor="#e2e8f0" />
                  </radialGradient>
                  <radialGradient id="maskGradient" cx="50%" cy="50%" r="50%">
                    <stop offset="0%" stopColor="transparent" />
                    <stop offset="80%" stopColor="rgba(244, 63, 94, 0.03)" />
                    <stop offset="100%" stopColor="rgba(244, 63, 94, 0.15)" />
                  </radialGradient>
                </defs>

                {/* Sky Base Circle */}
                <circle cx={center} cy={center} r={radius} fill="url(#skyGradient)" stroke="#94a3b8" strokeWidth="1.5" />

                {/* Elevation Rings: 0° (radius), 15°, 30°, 60°, 90° (center) */}
                <circle cx={center} cy={center} r={radius * ((90 - 15) / 90)} fill="none" stroke="#cbd5e1" strokeDasharray="3 3" />
                <circle cx={center} cy={center} r={radius * ((90 - 30) / 90)} fill="none" stroke="#cbd5e1" strokeDasharray="3 3" />
                <circle cx={center} cy={center} r={radius * ((90 - 60) / 90)} fill="none" stroke="#cbd5e1" strokeDasharray="3 3" />

                {/* Red Shaded Mask Elevation Ring */}
                <circle
                  cx={center}
                  cy={center}
                  r={maskRadius}
                  fill="url(#maskGradient)"
                  stroke="#f43f5e"
                  strokeWidth="1.5"
                  strokeDasharray="4 2"
                />

                {/* Center Zenith Point */}
                <circle cx={center} cy={center} r="3" fill="#64748b" />
                <text x={center + 6} y={center - 6} fontSize="9" fill="#94a3b8" fontWeight="600">Zenith 90°</text>

                {/* Crosshairs: North-South, East-West */}
                <line x1={center} y1={center - radius} x2={center} y2={center + radius} stroke="#cbd5e1" strokeWidth="1" />
                <line x1={center - radius} y1={center} x2={center + radius} y2={center} stroke="#cbd5e1" strokeWidth="1" />

                {/* Diagonal lines (45°, 135°, 225°, 315°) */}
                <line x1={center - radius * 0.707} y1={center - radius * 0.707} x2={center + radius * 0.707} y2={center + radius * 0.707} stroke="#e2e8f0" strokeDasharray="2 4" />
                <line x1={center - radius * 0.707} y1={center + radius * 0.707} x2={center + radius * 0.707} y2={center - radius * 0.707} stroke="#e2e8f0" strokeDasharray="2 4" />

                {/* Cardinal Direction Labels */}
                <text x={center} y={center - radius - 10} textAnchor="middle" fontSize="12" fontWeight="bold" fill="#0f172a">K (0°)</text>
                <text x={center + radius + 14} y={center + 4} textAnchor="start" fontSize="12" fontWeight="bold" fill="#0f172a">D (90°)</text>
                <text x={center} y={center + radius + 18} textAnchor="middle" fontSize="12" fontWeight="bold" fill="#0f172a">G (180°)</text>
                <text x={center - radius - 14} y={center + 4} textAnchor="end" fontSize="12" fontWeight="bold" fill="#0f172a">B (270°)</text>

                {/* Elevation Ring Degree Labels */}
                <text x={center + 4} y={center - radius * ((90 - 30) / 90) - 2} fontSize="8" fill="#94a3b8">30°</text>
                <text x={center + 4} y={center - radius * ((90 - 60) / 90) - 2} fontSize="8" fill="#94a3b8">60°</text>
                <text x={center + 4} y={center - maskRadius - 2} fontSize="8" fill="#f43f5e" fontWeight="bold">{maskAngle}° Maske</text>

                {/* Satellite Sky Tracks (Orbits) */}
                {filteredTracks.map((track) => {
                  const style = getConstellationStyle(track.system);
                  const isHovered = hoveredSatId === track.satId;
                  const isSelected = selectedSatId === track.satId;

                  // Build SVG path data for satellite trajectory
                  const pathData = track.points
                    .map((p, idx) => {
                      const { x, y } = polarToCartesian(p.azimuthDeg, p.elevationDeg, radius, center);
                      return `${idx === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`;
                    })
                    .join(' ');

                  // Representative midpoint point for PRN label
                  const midPoint = track.points[Math.floor(track.points.length / 2)] || track.points[0];
                  const { x: labelX, y: labelY } = polarToCartesian(midPoint.azimuthDeg, midPoint.elevationDeg, radius, center);

                  return (
                    <g
                      key={track.satId}
                      className="cursor-pointer transition-opacity"
                      onMouseEnter={() => setHoveredSatId(track.satId)}
                      onMouseLeave={() => setHoveredSatId(null)}
                      onClick={() => setSelectedSatId(selectedSatId === track.satId ? null : track.satId)}
                      opacity={selectedSatId && !isSelected ? 0.25 : 1}
                    >
                      {/* Trajectory Arc */}
                      <path
                        d={pathData}
                        fill="none"
                        stroke={style.stroke}
                        strokeWidth={isHovered || isSelected ? 3.5 : 2}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        className="transition-all"
                      />

                      {/* Trajectory Dots */}
                      {track.points.filter((_, i) => i % 6 === 0).map((pt, pIdx) => {
                        const { x: px, y: py } = polarToCartesian(pt.azimuthDeg, pt.elevationDeg, radius, center);
                        return (
                          <circle
                            key={pIdx}
                            cx={px}
                            cy={py}
                            r={pt.isMasked ? 1.5 : 2.5}
                            fill={pt.isMasked ? '#f43f5e' : style.fill}
                          />
                        );
                      })}

                      {/* PRN Badge at Midpoint */}
                      <g transform={`translate(${labelX}, ${labelY})`}>
                        <circle
                          r={isHovered || isSelected ? 12 : 9}
                          fill={isHovered || isSelected ? '#0f172a' : style.fill}
                          stroke="#ffffff"
                          strokeWidth="1.5"
                          className="transition-all"
                        />
                        <text
                          y={3}
                          textAnchor="middle"
                          fontSize={isHovered || isSelected ? 9 : 8}
                          fontWeight="bold"
                          fill="#ffffff"
                        >
                          {track.satId}
                        </text>
                      </g>
                    </g>
                  );
                })}
              </svg>
            </div>
          )}

          {/* SNR Line Chart View */}
          {activeTab === 'snr' && (
            <div className="w-full py-4 space-y-4">
              <div className="flex items-center justify-between text-xs text-slate-500">
                <span>Zaman Serisi boyunca Sinyal Gücü (SNR, dB-Hz)</span>
                <span className="font-semibold text-slate-700">İdeal: &gt; 35 dB-Hz</span>
              </div>

              <div className="h-64 w-full bg-slate-50 rounded-xl border border-slate-200 p-3 relative flex items-end gap-1 overflow-x-auto">
                {/* 35 dB-Hz Guideline */}
                <div className="absolute left-0 right-0 top-[40%] border-b border-dashed border-emerald-400 pointer-events-none flex items-center justify-end px-2">
                  <span className="text-[9px] font-bold text-emerald-600 bg-emerald-50 px-1 rounded">35 dB-Hz Eşik</span>
                </div>

                {filteredTracks.map((sat) => {
                  const style = getConstellationStyle(sat.system);
                  const isHovered = hoveredSatId === sat.satId;
                  const isSelected = selectedSatId === sat.satId;
                  const heightPercent = Math.min(100, Math.max(10, ((sat.avgSnr - 20) / 40) * 100));

                  return (
                    <div
                      key={sat.satId}
                      onMouseEnter={() => setHoveredSatId(sat.satId)}
                      onMouseLeave={() => setHoveredSatId(null)}
                      onClick={() => setSelectedSatId(selectedSatId === sat.satId ? null : sat.satId)}
                      className="flex-1 min-w-[20px] flex flex-col items-center justify-end h-full cursor-pointer group"
                      title={`${sat.satId} (${sat.system}): Ort. SNR = ${sat.avgSnr} dB-Hz, Maks Yükseklik = ${sat.maxElevation}°`}
                    >
                      <div
                        style={{ height: `${heightPercent}%` }}
                        className={`w-full rounded-t transition-all ${
                          isSelected || isHovered ? 'bg-slate-900 shadow-md ring-2 ring-sky-400' : style.bg
                        }`}
                      />
                      <span className="text-[9px] font-mono font-bold mt-1 text-slate-700 truncate w-full text-center">
                        {sat.satId}
                      </span>
                    </div>
                  );
                })}
              </div>

              <div className="flex items-center justify-between text-[11px] text-slate-500">
                <span>Düşük SNR (&lt; 30 dB-Hz): Binalar, ağaçlar veya çok yolluluk (multipath) kaynaklı sinyal kaybı.</span>
                <span className="font-bold text-slate-700">{filteredTracks.length} Uydu Listelendi</span>
              </div>
            </div>
          )}

          {/* Mask Angle Slider & Legend */}
          <div className="w-full pt-4 border-t border-slate-100 flex flex-wrap items-center justify-between gap-4 text-xs">
            <div className="flex items-center gap-3">
              <span className="font-semibold text-slate-700 flex items-center gap-1.5">
                <Sliders className="w-3.5 h-3.5 text-slate-400" />
                Yükseklik Maskesi:
              </span>
              <input
                type="range"
                min="0"
                max="30"
                step="1"
                value={maskAngle}
                onChange={(e) => setMaskAngle(parseInt(e.target.value, 10))}
                className="w-28 accent-sky-600 cursor-pointer"
              />
              <span className="font-bold text-sky-700">{maskAngle}°</span>
            </div>

            {/* Constellation Legend Badges */}
            <div className="flex items-center gap-2 flex-wrap">
              <span className="flex items-center gap-1 text-[11px] font-medium text-slate-600">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" /> GPS
              </span>
              <span className="flex items-center gap-1 text-[11px] font-medium text-slate-600">
                <span className="w-2.5 h-2.5 rounded-full bg-rose-500" /> GLONASS
              </span>
              <span className="flex items-center gap-1 text-[11px] font-medium text-slate-600">
                <span className="w-2.5 h-2.5 rounded-full bg-sky-500" /> Galileo
              </span>
              <span className="flex items-center gap-1 text-[11px] font-medium text-slate-600">
                <span className="w-2.5 h-2.5 rounded-full bg-amber-500" /> BeiDou
              </span>
            </div>
          </div>
        </div>

        {/* Right Panel: QC Analytics, Constellation Filters & Selected Satellite Details (5 cols) */}
        <div className="lg:col-span-5 space-y-4">
          
          {/* Constellation Filter Buttons */}
          <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-sm space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
                <Filter className="w-3.5 h-3.5 text-sky-600" />
                Takımyıldızı Filtresi
              </span>
              <span className="text-[11px] font-semibold text-slate-500">
                {filteredTracks.length} / {allSatTracks.length} Uydu
              </span>
            </div>

            <div className="grid grid-cols-3 sm:grid-cols-5 gap-1.5">
              {['ALL', 'GPS', 'GLONASS', 'Galileo', 'BeiDou'].map((sys) => (
                <button
                  key={sys}
                  onClick={() => setSelectedSystem(sys)}
                  className={`py-1.5 px-2 rounded-xl text-xs font-bold transition text-center ${
                    selectedSystem === sys
                      ? 'bg-slate-900 text-white shadow-xs'
                      : 'bg-slate-50 hover:bg-slate-100 text-slate-700 border border-slate-200'
                  }`}
                >
                  {sys === 'ALL' ? 'Tümü' : sys}
                </button>
              ))}
            </div>
          </div>

          {/* Selected Satellite Card */}
          {activeTrack && (
            <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-sm space-y-4">
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <div className="flex items-center gap-2.5">
                  <div className={`w-9 h-9 rounded-xl flex items-center justify-center font-black text-sm text-white ${
                    getConstellationStyle(activeTrack.system).bg
                  }`}>
                    {activeTrack.satId}
                  </div>
                  <div>
                    <h4 className="text-sm font-extrabold text-slate-900">
                      {activeTrack.system} Uydu {activeTrack.prn}
                    </h4>
                    <span className="text-[10px] text-slate-400">
                      {selectedSatId === activeTrack.satId ? 'Seçili Uydu' : 'Odaklanan Uydu'}
                    </span>
                  </div>
                </div>

                <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold ${
                  getConstellationStyle(activeTrack.system).badge
                }`}>
                  {activeTrack.system}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-3 text-xs">
                <div className="p-3 rounded-xl bg-slate-50 border border-slate-100">
                  <span className="text-[10px] text-slate-400 block font-semibold">MAKSİMUM YÜKSEKLİK</span>
                  <span className="text-base font-extrabold text-slate-900">{activeTrack.maxElevation}°</span>
                  <span className="text-[10px] text-slate-500 block">Zenith Yaklaşımı</span>
                </div>

                <div className="p-3 rounded-xl bg-slate-50 border border-slate-100">
                  <span className="text-[10px] text-slate-400 block font-semibold">ORTALAMA SNR</span>
                  <span className="text-base font-extrabold text-emerald-700">{activeTrack.avgSnr} dB-Hz</span>
                  <span className="text-[10px] text-slate-500 block">Sinyal Kalitesi</span>
                </div>

                <div className="p-3 rounded-xl bg-slate-50 border border-slate-100">
                  <span className="text-[10px] text-slate-400 block font-semibold">GEÇERLİ EPOKLAR</span>
                  <span className="text-base font-extrabold text-slate-900">{activeTrack.validEpochs} / {activeTrack.totalEpochs}</span>
                  <span className="text-[10px] text-slate-500 block">Maske Üstü</span>
                </div>

                <div className="p-3 rounded-xl bg-slate-50 border border-slate-100">
                  <span className="text-[10px] text-slate-400 block font-semibold">ÇOK YOLLULUK (MULTIPATH)</span>
                  <span className={`text-base font-extrabold ${
                    activeTrack.multipathIndex > 0.4 ? 'text-amber-600' : 'text-emerald-700'
                  }`}>
                    {(activeTrack.multipathIndex * 100).toFixed(0)}%
                  </span>
                  <span className="text-[10px] text-slate-500 block">
                    {activeTrack.multipathIndex > 0.4 ? 'Orta Düzey Yansıma' : 'Temiz Sinyal'}
                  </span>
                </div>
              </div>

              {activeTrack.cycleSlips > 0 && (
                <div className="p-2.5 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-xs flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                  <span>Düşük yükseklikte {activeTrack.cycleSlips} çevrim kayması (cycle slip) tespit edildi.</span>
                </div>
              )}
            </div>
          )}

          {/* Session Overview Card */}
          <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-sm space-y-3">
            <h4 className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
              <Calendar className="w-3.5 h-3.5 text-sky-600" />
              Oturum Özet Bilgileri
            </h4>

            <div className="space-y-2 text-xs">
              <div className="flex justify-between py-1 border-b border-slate-100">
                <span className="text-slate-500">İlk Gözlem:</span>
                <span className="font-mono font-bold text-slate-800">
                  {occupation?.firstEpochDate || currentStation.observationDateStr || '2025-06-15 08:00 GPS'}
                </span>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-100">
                <span className="text-slate-500">Son Gözlem:</span>
                <span className="font-mono font-bold text-slate-800">
                  {occupation?.lastEpochDate || '2025-06-15 12:00 GPS'}
                </span>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-100">
                <span className="text-slate-500">Örnekleme Aralığı:</span>
                <span className="font-mono font-bold text-slate-800">
                  {occupation?.intervalSeconds || 30} saniye
                </span>
              </div>
              <div className="flex justify-between py-1">
                <span className="text-slate-500">Anten Yüksekliği:</span>
                <span className="font-mono font-bold text-sky-700">
                  {currentStation.antenna.measuredHeight.toFixed(3)} m ({currentStation.antenna.heightType === 'vertical' ? 'Düşey' : 'Eğik'})
                </span>
              </div>
            </div>
          </div>

        </div>

      </div>
    </div>
  );
};
