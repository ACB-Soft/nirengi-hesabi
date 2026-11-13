/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * Kalite Kontrol (QC) & GNSS Görüntüleme Pencereleri (Topcon Tools Suite)
 * Provides professional geodetic viewing windows matching Topcon Tools / TBC:
 * 1. Oturum Görünümü (Occupation View): Multi-station tree with PRNs and timeline tracking
 * 2. Ağ Haritası (CAD Map View): CAD coordinate grid with Northing/Easting metric rulers & baselines
 * 3. Bölünmüş Görünüm (Split View): Simultaneous CAD Map and Occupation timeline display
 * 4. Kutupsal Gökyüzü (Polar Skyplot): Satellite sky tracks & elevation mask
 * 5. SNR & Sinyal Analizi: Signal-to-noise ratio time series
 */

import React, { useState, useMemo } from 'react';
import { Station, GnssConstellation, BaselineVector } from '../types/gnss';
import {
  SatelliteSkyTrack,
  polarToCartesian,
  generateSatelliteSkyTracks,
  computeDopMetrics,
} from '../utils/skyplotEngine';
import { TopconOccupationViewer } from './TopconOccupationViewer';
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
  Maximize2,
} from 'lucide-react';

export type ViewWindowMode = 'occupation' | 'skyplot' | 'snr';

interface Props {
  stations: Record<string, Station>;
  baselines?: BaselineVector[];
  timeZone?: string;
  elevationMask?: number;
  onOpenRinexModal?: () => void;
  selectedStationId?: string;
  onSelectStation?: (id: string) => void;
  isModal?: boolean;
}

export const QcSkyplotTab: React.FC<Props> = ({
  stations,
  baselines = [],
  timeZone = 'GMT+3:00',
  elevationMask = 10,
  onOpenRinexModal,
  selectedStationId,
  onSelectStation,
  isModal = false,
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

  // Viewing Window Mode: default to 'occupation'
  const [windowMode, setWindowMode] = useState<ViewWindowMode>('occupation');

  // View States for Skyplot
  const [selectedSystem, setSelectedSystem] = useState<string>('ALL');
  const [maskAngle, setMaskAngle] = useState<number>(elevationMask);
  const [selectedSatId, setSelectedSatId] = useState<string | null>(null);
  const [hoveredSatId, setHoveredSatId] = useState<string | null>(null);

  // Compute Satellite Tracks
  const allSatTracks: SatelliteSkyTrack[] = useMemo(() => {
    if (!currentStation) return [];

    if (occupation?.satellites && occupation.satellites.length > 0) {
      return occupation.satellites.map((sat) =>
        generateSatelliteSkyTracks(sat, currentStation, occupation.durationSeconds, maskAngle)
      );
    }

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
      { satId: 'C06', system: 'BeiDou' as GnssConstellation, prn: 6, totalEpochs: 480, validEpochs: 480, startSec: 0, endSec: 14400, timeSlots: [], freqs: ['B1', 'B2'] },
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
      default:
        return { stroke: '#64748B', fill: '#475569', bg: 'bg-slate-500', text: 'text-slate-700', badge: 'bg-slate-100 text-slate-800' };
    }
  };

  const activeTrack = useMemo(() => {
    if (selectedSatId) return allSatTracks.find((t) => t.satId === selectedSatId);
    if (hoveredSatId) return allSatTracks.find((t) => t.satId === hoveredSatId);
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
            Oturum çizelgesi (Occupation View), CAD ağ haritası ve uydu gökyüzü analizleri için 
            lütfen <strong>İstasyonlar & RINEX</strong> sekmesinden veri ekleyiniz.
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
  const maskRadius = radius * ((90 - maskAngle) / 90.0);

  const handleSelectStationInternal = (stnId: string) => {
    setActiveStationId(stnId);
    if (onSelectStation) onSelectStation(stnId);
  };

  return (
    <div className="space-y-4 animate-in fade-in">
      
      {/* Top Banner & Window View Switcher Toolbar */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          {!isModal && (
            <div>
              <h2 className="text-lg font-extrabold text-slate-900 flex items-center gap-2">
                <span>Kalite Kontrol & GNSS Görüntüleme Pencereleri</span>
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 font-bold border border-emerald-300">
                  Topcon Tools Standart
                </span>
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Oturum zaman çizelgeleri (Occupation View), kutupsal gökyüzü görünürlüğü ve SNR analizleri.
              </p>
            </div>
          )}

          {/* Window Mode Switcher Buttons */}
          <div className={`flex items-center gap-1.5 p-1 bg-slate-100 rounded-xl text-xs overflow-x-auto ${isModal ? 'w-full lg:w-auto' : ''}`}>
            <button
              onClick={() => setWindowMode('occupation')}
              className={`px-3 py-1.5 rounded-lg font-bold flex items-center gap-1.5 transition whitespace-nowrap cursor-pointer ${
                windowMode === 'occupation'
                  ? 'bg-white text-slate-900 shadow-2xs border border-slate-200'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Clock className="w-3.5 h-3.5 text-emerald-600" />
              <span>Oturum Görünümü (Occupation View)</span>
            </button>

            <button
              onClick={() => setWindowMode('skyplot')}
              className={`px-3 py-1.5 rounded-lg font-bold flex items-center gap-1.5 transition whitespace-nowrap cursor-pointer ${
                windowMode === 'skyplot'
                  ? 'bg-white text-slate-900 shadow-2xs border border-slate-200'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Satellite className="w-3.5 h-3.5 text-indigo-600" />
              <span>Kutup (Skyplot)</span>
            </button>

            <button
              onClick={() => setWindowMode('snr')}
              className={`px-3 py-1.5 rounded-lg font-bold flex items-center gap-1.5 transition whitespace-nowrap cursor-pointer ${
                windowMode === 'snr'
                  ? 'bg-white text-slate-900 shadow-2xs border border-slate-200'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <BarChart2 className="w-3.5 h-3.5 text-amber-600" />
              <span>SNR Serisi</span>
            </button>
          </div>

          {isModal && (
            <div className="flex items-center gap-2">
              <span className="font-semibold text-slate-600 text-xs flex items-center gap-1">
                <Radio className="w-3.5 h-3.5 text-sky-600" />
                <span>Aktif İstasyon:</span>
              </span>
              <select
                value={activeStationId}
                onChange={(e) => handleSelectStationInternal(e.target.value)}
                className="px-2.5 py-1.5 bg-slate-50 border border-slate-300 rounded-lg text-xs font-bold text-slate-900 shadow-2xs focus:ring-1 focus:ring-sky-500"
              >
                {stationList.map((st) => (
                  <option key={st.id} value={st.id}>
                    {st.name} ({st.type === 'CORS' ? 'CORS Sabit' : 'Rover Nokta'})
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        {/* Quick Station Selector Bar */}
        {!isModal && (
          <div className="mt-3 pt-3 border-t border-slate-100 flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-slate-600 flex items-center gap-1">
              <Radio className="w-3.5 h-3.5 text-sky-600" />
              <span>Aktif İstasyon:</span>
            </span>
            <select
              value={activeStationId}
              onChange={(e) => handleSelectStationInternal(e.target.value)}
              className="px-2.5 py-1 bg-slate-50 border border-slate-300 rounded-lg text-xs font-bold text-slate-900 shadow-2xs focus:ring-1 focus:ring-sky-500"
            >
              {stationList.map((st) => (
                <option key={st.id} value={st.id}>
                  {st.name} ({st.type === 'CORS' ? 'CORS Sabit' : 'Rover Nokta'})
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-4 text-[11px] text-slate-500">
            <span>Toplam {stationList.length} Nokta</span>
            <span>•</span>
            <span>{baselines.length} Baz Vektörü</span>
            <span>•</span>
            <span>Yerel Saat: {timeZone}</span>
          </div>
        </div>
        )}
      </div>

      {/* WINDOW VIEW MODE 1: OCCUPATION VIEW FULL WINDOW */}
      {windowMode === 'occupation' && (
        <div className="space-y-3 animate-in fade-in">
          <TopconOccupationViewer
            stations={stations}
            timeZone={timeZone}
            selectedStationId={activeStationId}
            onSelectStation={handleSelectStationInternal}
            className="w-full shadow-md"
          />
        </div>
      )}

      {/* WINDOW VIEW MODE 4 & 5: SKYPLOT & SNR ANALYSIS */}
      {(windowMode === 'skyplot' || windowMode === 'snr') && (
        <div className="space-y-4 animate-in fade-in">
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

          {/* Main Grid: Skyplot or SNR on left (7 cols), Analytics on right (5 cols) */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
            
            {/* Left Panel */}
            <div className="lg:col-span-7 bg-white rounded-2xl p-6 border border-slate-200 shadow-sm flex flex-col items-center justify-between">
              
              <div className="w-full flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-4">
                <div className="flex items-center gap-2">
                  <Compass className="w-4 h-4 text-sky-600" />
                  <h3 className="text-sm font-bold text-slate-900">
                    {windowMode === 'skyplot' ? 'Kutupsal Gökyüzü Diyagramı (Polar Skyplot)' : 'Sinyal / SNR Zaman Serisi'}
                  </h3>
                </div>

                <div className="flex items-center gap-1.5 p-1 bg-slate-100 rounded-xl text-xs">
                  <button
                    onClick={() => setWindowMode('skyplot')}
                    className={`px-3 py-1 rounded-lg font-bold transition ${
                      windowMode === 'skyplot' ? 'bg-white text-slate-900 shadow-2xs' : 'text-slate-500 hover:text-slate-800'
                    }`}
                  >
                    Kutupsal Harita
                  </button>
                  <button
                    onClick={() => setWindowMode('snr')}
                    className={`px-3 py-1 rounded-lg font-bold transition ${
                      windowMode === 'snr' ? 'bg-white text-slate-900 shadow-2xs' : 'text-slate-500 hover:text-slate-800'
                    }`}
                  >
                    SNR Zaman Serisi
                  </button>
                </div>
              </div>

              {/* Polar SVG */}
              {windowMode === 'skyplot' && (
                <div className="relative py-4 flex items-center justify-center">
                  <svg width="400" height="400" viewBox="0 0 400 400" className="max-w-full drop-shadow-xs select-none">
                    <defs>
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

                    <circle cx={center} cy={center} r={radius} fill="url(#skyGradient)" stroke="#94a3b8" strokeWidth="1.5" />
                    <circle cx={center} cy={center} r={radius * ((90 - 15) / 90)} fill="none" stroke="#cbd5e1" strokeDasharray="3 3" />
                    <circle cx={center} cy={center} r={radius * ((90 - 30) / 90)} fill="none" stroke="#cbd5e1" strokeDasharray="3 3" />
                    <circle cx={center} cy={center} r={radius * ((90 - 60) / 90)} fill="none" stroke="#cbd5e1" strokeDasharray="3 3" />

                    <circle
                      cx={center}
                      cy={center}
                      r={maskRadius}
                      fill="url(#maskGradient)"
                      stroke="#f43f5e"
                      strokeWidth="1.5"
                      strokeDasharray="4 2"
                    />

                    <circle cx={center} cy={center} r="3" fill="#64748b" />
                    <text x={center + 6} y={center - 6} fontSize="9" fill="#94a3b8" fontWeight="600">Zenith 90°</text>

                    <line x1={center} y1={center - radius} x2={center} y2={center + radius} stroke="#cbd5e1" strokeWidth="1" />
                    <line x1={center - radius} y1={center} x2={center + radius} y2={center} stroke="#cbd5e1" strokeWidth="1" />

                    <text x={center} y={center - radius - 10} textAnchor="middle" fontSize="12" fontWeight="bold" fill="#0f172a">K (0°)</text>
                    <text x={center + radius + 14} y={center + 4} textAnchor="start" fontSize="12" fontWeight="bold" fill="#0f172a">D (90°)</text>
                    <text x={center} y={center + radius + 18} textAnchor="middle" fontSize="12" fontWeight="bold" fill="#0f172a">G (180°)</text>
                    <text x={center - radius - 14} y={center + 4} textAnchor="end" fontSize="12" fontWeight="bold" fill="#0f172a">B (270°)</text>

                    <text x={center + 4} y={center - radius * ((90 - 30) / 90) - 2} fontSize="8" fill="#94a3b8">30°</text>
                    <text x={center + 4} y={center - radius * ((90 - 60) / 90) - 2} fontSize="8" fill="#94a3b8">60°</text>
                    <text x={center + 4} y={center - maskRadius - 2} fontSize="8" fill="#f43f5e" fontWeight="bold">{maskAngle}° Maske</text>

                    {filteredTracks.map((track) => {
                      const style = getConstellationStyle(track.system);
                      const isHovered = hoveredSatId === track.satId;
                      const isSelected = selectedSatId === track.satId;

                      const pathData = track.points
                        .map((p, idx) => {
                          const { x, y } = polarToCartesian(p.azimuthDeg, p.elevationDeg, radius, center);
                          return `${idx === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`;
                        })
                        .join(' ');

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
                          <path
                            d={pathData}
                            fill="none"
                            stroke={style.stroke}
                            strokeWidth={isHovered || isSelected ? 3.5 : 2}
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            className="transition-all"
                          />

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
                              fontSize="8"
                              fontWeight="bold"
                              fill="#ffffff"
                              fontFamily="monospace"
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

              {/* SNR View */}
              {windowMode === 'snr' && (
                <div className="w-full py-4 space-y-4">
                  <div className="text-xs text-slate-600 bg-slate-50 p-3 rounded-xl border border-slate-200">
                    <span className="font-bold text-slate-800">Sinyal-Gürültü Oranı (SNR) Dağılımı:</span>
                    <p className="mt-0.5 text-slate-500">
                      RTKLIB ve BÖHYY standartlarında 35 dB-Hz altındaki sinyaller çok yolluluk (multipath) ve faz kayması riskini artırır.
                    </p>
                  </div>

                  <div className="grid grid-cols-4 sm:grid-cols-6 gap-2">
                    {filteredTracks.map((sat) => {
                      const snr = sat.avgSnr;
                      const isGood = snr >= 40;
                      const isFair = snr >= 34 && snr < 40;
                      return (
                        <div
                          key={sat.satId}
                          onClick={() => setSelectedSatId(sat.satId)}
                          className={`p-2 rounded-xl border text-center cursor-pointer transition ${
                            selectedSatId === sat.satId
                              ? 'border-sky-500 bg-sky-50 shadow-xs'
                              : 'border-slate-200 bg-white hover:bg-slate-50'
                          }`}
                        >
                          <span className="text-[11px] font-bold font-mono text-slate-800 block">{sat.satId}</span>
                          <span className={`text-xs font-black block mt-0.5 ${
                            isGood ? 'text-emerald-600' : isFair ? 'text-amber-600' : 'text-rose-600'
                          }`}>
                            {snr} dB
                          </span>
                          <div className="w-full bg-slate-100 h-1.5 rounded-full overflow-hidden mt-1.5">
                            <div
                              className={`h-full ${
                                isGood ? 'bg-emerald-500' : isFair ? 'bg-amber-500' : 'bg-rose-500'
                              }`}
                              style={{ width: `${Math.min(100, (snr / 55) * 100)}%` }}
                            />
                          </div>
                        </div>
                      );
                    })}
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

            {/* Right Panel: Analytics & Selected Satellite */}
            <div className="lg:col-span-5 space-y-4">
              
              {/* Constellation Filter */}
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
                </div>
              )}

              {/* Station Overview Card */}
              <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-sm space-y-3">
                <h4 className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
                  <Calendar className="w-3.5 h-3.5 text-sky-600" />
                  İstasyon Bilgileri ({currentStation.name})
                </h4>

                <div className="space-y-2 text-xs">
                  <div className="flex justify-between py-1 border-b border-slate-100">
                    <span className="text-slate-500">Nokta Türü:</span>
                    <span className="font-semibold text-slate-800">
                      {currentStation.type === 'CORS' ? 'CORS Sabit Dayanak' : 'Ara / Poligon Noktası'}
                    </span>
                  </div>
                  <div className="flex justify-between py-1 border-b border-slate-100">
                    <span className="text-slate-500">Koordinat (Y / Sağa):</span>
                    <span className="font-mono font-bold text-slate-800">
                      {(currentStation.projY ?? 0).toFixed(3)} m
                    </span>
                  </div>
                  <div className="flex justify-between py-1 border-b border-slate-100">
                    <span className="text-slate-500">Koordinat (X / Yukarı):</span>
                    <span className="font-mono font-bold text-slate-800">
                      {(currentStation.projX ?? 0).toFixed(3)} m
                    </span>
                  </div>
                  <div className="flex justify-between py-1">
                    <span className="text-slate-500">Anten:</span>
                    <span className="font-mono font-bold text-sky-700 truncate max-w-[180px]">
                      {currentStation.antenna?.model || 'TRM59800.00 NONE'} ({currentStation.antenna.measuredHeight.toFixed(3)} m)
                    </span>
                  </div>
                </div>
              </div>

            </div>

          </div>
        </div>
      )}

    </div>
  );
};
