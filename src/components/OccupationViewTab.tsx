/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * Topcon Tools Style GNSS Occupation View (Oturum & Uydu Görünümü)
 * Provides detailed satellite tracking bar-chart vs. time, sky visibility,
 * SV count over time, DOP values, and constellation filters.
 */

import React, { useState, useMemo } from 'react';
import { Station, GnssConstellation, SatelliteTrack, RinexOccupation } from '../types/gnss';
import {
  Radio,
  Clock,
  Layers,
  Calendar,
  Cpu,
  Eye,
  Activity,
  Filter,
  Info,
  Sliders,
  ChevronRight,
  Sparkles,
  BarChart2,
  Compass,
} from 'lucide-react';

interface Props {
  stations: Record<string, Station>;
  selectedStationId?: string;
  onSelectStation?: (id: string) => void;
}

export const OccupationViewTab: React.FC<Props> = ({
  stations,
  selectedStationId,
  onSelectStation,
}) => {
  const stationList = Object.values(stations);

  // Selected station for detailed occupation inspection
  const [activeStationId, setActiveStationId] = useState<string>(
    selectedStationId || stationList[0]?.id || ''
  );

  // Keep activeStationId synced if prop changes
  React.useEffect(() => {
    if (selectedStationId && stations[selectedStationId]) {
      setActiveStationId(selectedStationId);
    } else if (!stations[activeStationId] && stationList.length > 0) {
      setActiveStationId(stationList[0].id);
    }
  }, [selectedStationId, stations]);

  const currentStation = stations[activeStationId] || stationList[0];
  const occupation = currentStation?.occupation;

  // Filter constellations
  const [selectedSystem, setSelectedSystem] = useState<string>('ALL');
  const [minElevation, setMinElevation] = useState<number>(10);
  const [hoveredSat, setHoveredSat] = useState<SatelliteTrack | null>(null);
  const [viewMode, setViewMode] = useState<'timeline' | 'svcount' | 'stats'>('timeline');

  // Filtered Satellites
  const filteredSatellites = useMemo(() => {
    if (!occupation || !occupation.satellites) return [];
    return occupation.satellites.filter((sat) => {
      if (selectedSystem !== 'ALL' && sat.system !== selectedSystem) return false;
      if (sat.avgElevation && sat.avgElevation < minElevation) return false;
      return true;
    });
  }, [occupation, selectedSystem, minElevation]);

  // Constellation stats
  const constellationStats = useMemo(() => {
    if (!occupation || !occupation.satellites) return {};
    const stats: Record<string, number> = {};
    occupation.satellites.forEach((sat) => {
      stats[sat.system] = (stats[sat.system] || 0) + 1;
    });
    return stats;
  }, [occupation]);

  // System Badge & Colors
  const getSystemColor = (system: GnssConstellation) => {
    switch (system) {
      case 'GPS':
        return {
          bg: 'bg-emerald-500',
          border: 'border-emerald-600',
          lightBg: 'bg-emerald-50',
          text: 'text-emerald-700',
          badge: 'bg-emerald-100 text-emerald-800 border-emerald-300',
        };
      case 'GLONASS':
        return {
          bg: 'bg-rose-500',
          border: 'border-rose-600',
          lightBg: 'bg-rose-50',
          text: 'text-rose-700',
          badge: 'bg-rose-100 text-rose-800 border-rose-300',
        };
      case 'Galileo':
        return {
          bg: 'bg-sky-500',
          border: 'border-sky-600',
          lightBg: 'bg-sky-50',
          text: 'text-sky-700',
          badge: 'bg-sky-100 text-sky-800 border-sky-300',
        };
      case 'BeiDou':
        return {
          bg: 'bg-amber-500',
          border: 'border-amber-600',
          lightBg: 'bg-amber-50',
          text: 'text-amber-700',
          badge: 'bg-amber-100 text-amber-800 border-amber-300',
        };
      case 'QZSS':
        return {
          bg: 'bg-purple-500',
          border: 'border-purple-600',
          lightBg: 'bg-purple-50',
          text: 'text-purple-700',
          badge: 'bg-purple-100 text-purple-800 border-purple-300',
        };
      default:
        return {
          bg: 'bg-slate-500',
          border: 'border-slate-600',
          lightBg: 'bg-slate-50',
          text: 'text-slate-700',
          badge: 'bg-slate-100 text-slate-800 border-slate-300',
        };
    }
  };

  // Session duration helper
  const formatDuration = (totalSec: number) => {
    const hrs = Math.floor(totalSec / 3600);
    const mins = Math.floor((totalSec % 3600) / 60);
    const secs = Math.floor(totalSec % 60);
    if (hrs > 0) return `${hrs}sa ${mins}dk ${secs > 0 ? `${secs}sn` : ''}`;
    return `${mins}dk ${secs}sn`;
  };

  if (stationList.length === 0) {
    return (
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-12 text-center space-y-4">
        <div className="w-14 h-14 bg-sky-50 text-sky-600 rounded-full flex items-center justify-center mx-auto">
          <Activity className="w-7 h-7" />
        </div>
        <div className="space-y-1">
          <h3 className="text-base font-bold text-slate-800">Oturum Görünümü İçin Yüklü Nokta Bulunmuyor</h3>
          <p className="text-xs text-slate-500 max-w-lg mx-auto leading-relaxed">
            Topcon Tools standardında uydu takip grafiği (Occupation View) oluşturabilmek için lütfen
            <strong> 2. Noktalar &amp; ANTEX</strong> sekmesinden RINEX (<code>.24o, .25o, .26o, .rnx</code>) gözlem dosyalarını yükleyiniz.
          </p>
        </div>
      </div>
    );
  }

  const durationSec = occupation?.durationSeconds || 7200;
  const totalEpochs = occupation?.totalEpochs || 240;

  // Time grid marks (4 intervals across session)
  const timeSteps = [0, 0.25, 0.5, 0.75, 1.0].map((frac) => {
    const sec = frac * durationSec;
    const mins = Math.floor(sec / 60);
    const hrs = Math.floor(mins / 60);
    const remMins = mins % 60;
    return {
      frac,
      label: `+${hrs > 0 ? `${hrs}h ` : ''}${remMins}m`,
    };
  });

  return (
    <div className="space-y-5">
      {/* Top Banner */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="bg-sky-100 text-sky-800 text-xs font-semibold px-2 py-0.5 rounded border border-sky-200">
                TOPCON TOOLS OCCUPATION VIEW
              </span>
              <h2 className="text-base font-bold text-slate-900">
                GNSS Oturum ve Uydu Takip Grafiği (Occupation View)
              </h2>
            </div>
            <p className="text-xs text-slate-500 mt-1 leading-relaxed">
              Topcon Tools iş akışı Adım 2.4: Yüklenen RINEX gözlem oturumlarına ait çoklu takımyıldız 
              (GPS, GLONASS, Galileo, BeiDou) uydu geçiş çubukları, sinyal kalitesi (SNR) ve zaman serisi görünümü.
            </p>
          </div>

          {/* Station Selector Dropdown */}
          <div className="flex items-center gap-2 flex-wrap">
            <label className="text-xs font-semibold text-slate-600 flex items-center gap-1.5">
              <Radio className="w-3.5 h-3.5 text-sky-600" />
              <span>Gözlem Noktası:</span>
            </label>
            <select
              value={activeStationId}
              onChange={(e) => {
                setActiveStationId(e.target.value);
                if (onSelectStation) onSelectStation(e.target.value);
              }}
              className="px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg text-xs font-bold text-slate-900 shadow-2xs focus:ring-2 focus:ring-sky-500"
            >
              {stationList.map((st) => (
                <option key={st.id} value={st.id}>
                  {st.name} ({st.type === 'CORS' ? 'CORS' : 'Arazi'} - {st.antenna.model ? st.antenna.model.substring(0, 15) : 'Anten'})
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Main Grid: Station Summary + Occupation Timeline */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        {/* Left Panel: Station Occupation Metadata & Filters */}
        <div className="lg:col-span-4 space-y-4">
          {/* Metadata Card */}
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2">
                <Radio className="w-4 h-4 text-sky-600" />
                <h3 className="text-sm font-bold text-slate-900">
                  {currentStation.name} Oturum Detayları
                </h3>
              </div>
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800">
                {currentStation.isFixed.x ? 'SABİT CORS' : 'SERBEST PROJE'}
              </span>
            </div>

            <div className="space-y-2.5 text-xs">
              <div className="flex justify-between py-1 border-b border-slate-50">
                <span className="text-slate-500 flex items-center gap-1">
                  <Calendar className="w-3 h-3 text-slate-400" />
                  Başlangıç Epoğu:
                </span>
                <span className="font-mono font-bold text-slate-800">
                  {occupation?.firstEpochDate || currentStation.observationDateStr || 'Bilinmiyor'}
                </span>
              </div>

              <div className="flex justify-between py-1 border-b border-slate-50">
                <span className="text-slate-500 flex items-center gap-1">
                  <Clock className="w-3 h-3 text-slate-400" />
                  Oturum Süresi:
                </span>
                <span className="font-mono font-bold text-sky-700">
                  {formatDuration(durationSec)} ({totalEpochs} epok)
                </span>
              </div>

              <div className="flex justify-between py-1 border-b border-slate-50">
                <span className="text-slate-500">Örnekleme Aralığı:</span>
                <span className="font-mono font-bold text-slate-800">
                  {occupation?.intervalSeconds || 30} saniye
                </span>
              </div>

              <div className="flex justify-between py-1 border-b border-slate-50">
                <span className="text-slate-500">Alıcı Tipi:</span>
                <span className="font-mono text-slate-800 truncate max-w-[160px]" title={occupation?.receiverType}>
                  {occupation?.receiverType || 'GNSS Post-Process Receiver'}
                </span>
              </div>

              <div className="flex justify-between py-1 border-b border-slate-50">
                <span className="text-slate-500">Anten &amp; Ölçüm:</span>
                <span className="font-mono text-slate-800 text-right">
                  {currentStation.antenna.measuredHeight.toFixed(3)} m ({currentStation.antenna.heightType === 'vertical' ? 'Düşey' : 'Eğik'})
                </span>
              </div>

              <div className="flex justify-between py-1">
                <span className="text-slate-500">Gözlem Frekansları:</span>
                <span className="font-mono font-bold text-slate-800">
                  {occupation?.observationTypes?.slice(0, 5).join(', ') || 'L1, L2, C1, P2'}
                </span>
              </div>
            </div>

            {/* Constellation Badges */}
            <div className="pt-2 border-t border-slate-100">
              <label className="block text-[11px] font-bold text-slate-700 mb-2">
                İzlenen Takımyıldızlar ({occupation?.satellites.length || 0} Uydu):
              </label>
              <div className="flex flex-wrap gap-1.5">
                {Object.entries(constellationStats).map(([sys, count]) => {
                  const colors = getSystemColor(sys as GnssConstellation);
                  return (
                    <span
                      key={sys}
                      className={`text-[11px] font-bold px-2 py-0.5 rounded-md border flex items-center gap-1 ${colors.badge}`}
                    >
                      <span className={`w-2 h-2 rounded-full ${colors.bg}`} />
                      <span>{sys}: {count} SV</span>
                    </span>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Filters & Display Controls */}
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5 space-y-4">
            <div className="flex items-center gap-2 font-bold text-slate-800 border-b border-slate-100 pb-2 text-xs">
              <Filter className="w-3.5 h-3.5 text-sky-600" />
              <span>Görünüm Filtreleri</span>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label className="block text-slate-600 font-semibold mb-1">Takımyıldız Filtresi</label>
                <div className="grid grid-cols-3 gap-1.5">
                  {['ALL', 'GPS', 'GLONASS', 'Galileo', 'BeiDou'].map((sys) => (
                    <button
                      key={sys}
                      onClick={() => setSelectedSystem(sys)}
                      className={`py-1.5 px-2 rounded-lg text-xs font-semibold cursor-pointer transition border ${
                        selectedSystem === sys
                          ? 'bg-sky-600 text-white border-sky-600 shadow-2xs'
                          : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                      }`}
                    >
                      {sys === 'ALL' ? 'Tümü' : sys}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <div className="flex justify-between text-slate-600 font-semibold mb-1">
                  <span>Yükseklik Açısı Maskesi:</span>
                  <span className="font-mono font-bold text-sky-700">{minElevation}°</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="30"
                  step="5"
                  value={minElevation}
                  onChange={(e) => setMinElevation(parseInt(e.target.value, 10))}
                  className="w-full accent-sky-600 cursor-pointer"
                />
                <div className="flex justify-between text-[10px] text-slate-400 mt-0.5">
                  <span>0° (Ufuk)</span>
                  <span>10° (Standart)</span>
                  <span>30° (Yüksek)</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Right Panel: Topcon Tools Satellite Timeline Chart */}
        <div className="lg:col-span-8 space-y-4">
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5 space-y-4">
            {/* Header & Sub-tab switcher */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2">
                <Activity className="w-4 h-4 text-emerald-600" />
                <h3 className="text-sm font-bold text-slate-900">
                  {currentStation.name} &bull; Uydu &bull; Zaman Grafiği ({filteredSatellites.length} Uydu)
                </h3>
              </div>

              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => setViewMode('timeline')}
                  className={`px-3 py-1 rounded-lg text-xs font-semibold cursor-pointer transition flex items-center gap-1 ${
                    viewMode === 'timeline'
                      ? 'bg-sky-600 text-white shadow-2xs'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  <BarChart2 className="w-3.5 h-3.5" />
                  <span>Zaman Çizelgesi</span>
                </button>
                <button
                  onClick={() => setViewMode('svcount')}
                  className={`px-3 py-1 rounded-lg text-xs font-semibold cursor-pointer transition flex items-center gap-1 ${
                    viewMode === 'svcount'
                      ? 'bg-sky-600 text-white shadow-2xs'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  <Activity className="w-3.5 h-3.5" />
                  <span>Uydu Sayısı / PDOP</span>
                </button>
              </div>
            </div>

            {/* Timeline View */}
            {viewMode === 'timeline' && (
              <div className="space-y-4">
                {/* Time Axis Bar */}
                <div className="bg-slate-900 text-white rounded-lg p-2.5 flex items-center justify-between text-xs font-mono">
                  <div className="flex items-center gap-2">
                    <Clock className="w-3.5 h-3.5 text-sky-400" />
                    <span className="font-semibold text-slate-300">Zaman Ekseni:</span>
                    <span className="text-sky-300 font-bold">{occupation?.firstEpochDate || '00:00:00'}</span>
                  </div>
                  <div className="flex items-center gap-6">
                    {timeSteps.map((st, idx) => (
                      <span key={idx} className="text-[11px] text-slate-300">
                        {st.label}
                      </span>
                    ))}
                  </div>
                  <span className="text-slate-400 font-mono text-[11px]">
                    {formatDuration(durationSec)}
                  </span>
                </div>

                {/* Satellite Tracks Gantt Chart Container */}
                <div className="border border-slate-200 rounded-lg overflow-hidden bg-slate-50/50">
                  <div className="max-h-[480px] overflow-y-auto divide-y divide-slate-200/80 custom-scrollbar">
                    {filteredSatellites.map((sat) => {
                      const colors = getSystemColor(sat.system);
                      const isHovered = hoveredSat?.satId === sat.satId;

                      return (
                        <div
                          key={sat.satId}
                          onMouseEnter={() => setHoveredSat(sat)}
                          onMouseLeave={() => setHoveredSat(null)}
                          className={`flex items-center p-2 text-xs transition ${
                            isHovered ? 'bg-sky-100/60' : 'hover:bg-slate-100/80'
                          }`}
                        >
                          {/* Satellite Identifier column */}
                          <div className="w-20 shrink-0 flex items-center gap-1.5 font-mono font-bold">
                            <span
                              className={`w-2 h-2 rounded-full ${colors.bg}`}
                              title={sat.system}
                            />
                            <span className="text-slate-900">{sat.satId}</span>
                            <span className="text-[10px] text-slate-400 font-normal">
                              {sat.avgElevation ? `${Math.round(sat.avgElevation)}°` : ''}
                            </span>
                          </div>

                          {/* Timeline bar area (width proportional to session) */}
                          <div className="flex-1 h-6 relative bg-slate-200/50 rounded-sm mx-2 overflow-hidden">
                            {/* Grid vertical guidelines */}
                            <div className="absolute inset-0 flex justify-between pointer-events-none">
                              <div className="w-px h-full bg-slate-300/40" />
                              <div className="w-px h-full bg-slate-300/40" />
                              <div className="w-px h-full bg-slate-300/40" />
                              <div className="w-px h-full bg-slate-300/40" />
                              <div className="w-px h-full bg-slate-300/40" />
                            </div>

                            {/* Tracking Segments */}
                            {sat.timeSlots.map((slot, sIdx) => {
                              const leftPercent = Math.max(0, Math.min(100, (slot.startSec / durationSec) * 100));
                              const widthPercent = Math.max(
                                1.5,
                                Math.min(100 - leftPercent, ((slot.endSec - slot.startSec) / durationSec) * 100)
                              );

                              return (
                                <div
                                  key={sIdx}
                                  style={{
                                    left: `${leftPercent}%`,
                                    width: `${widthPercent}%`,
                                  }}
                                  className={`absolute top-0.5 bottom-0.5 rounded-xs transition shadow-2xs ${colors.bg} hover:brightness-110 flex items-center justify-center`}
                                  title={`${sat.satId} (${sat.system}) - ${Math.round(slot.startSec / 60)}dk'dan ${Math.round(slot.endSec / 60)}dk'ya izlendi`}
                                >
                                  {widthPercent > 12 && (
                                    <span className="text-[9px] font-mono font-bold text-white tracking-tight drop-shadow-xs">
                                      {sat.satId}
                                    </span>
                                  )}
                                </div>
                              );
                            })}
                          </div>

                          {/* Stats on the right */}
                          <div className="w-24 shrink-0 text-right font-mono text-[11px] text-slate-600 flex items-center justify-end gap-2">
                            <span title="Ortalama Sinyal Gücü (SNR)">{sat.avgSnr || 44} dB</span>
                            <span className="text-slate-400">|</span>
                            <span className="text-slate-700 font-semibold" title="İzlenen Epok Sayısı">
                              {sat.validEpochs} ep
                            </span>
                          </div>
                        </div>
                      );
                    })}

                    {filteredSatellites.length === 0 && (
                      <div className="p-8 text-center text-slate-400 text-xs">
                        Seçilen filtre kriterlerine uygun uydu gözlemi bulunamadı.
                      </div>
                    )}
                  </div>
                </div>

                {/* Satellite Inspector Card (when hovered) */}
                {hoveredSat && (
                  <div className="p-3 bg-sky-50 border border-sky-200 rounded-lg text-xs flex items-center justify-between text-sky-950 animate-in fade-in duration-100">
                    <div className="flex items-center gap-3">
                      <span className="font-mono font-bold text-sm bg-sky-600 text-white px-2 py-0.5 rounded">
                        {hoveredSat.satId}
                      </span>
                      <div>
                        <span className="font-bold">{hoveredSat.system} Takımyıldızı</span> &bull; PRN {hoveredSat.prn}
                        <span className="text-slate-500 ml-2">
                          (Yükseklik: ~{Math.round(hoveredSat.avgElevation || 45)}° &bull; SNR: {hoveredSat.avgSnr || 44} dB-Hz)
                        </span>
                      </div>
                    </div>
                    <span className="text-xs font-mono font-semibold text-sky-800">
                      Gözlem Oranı: %{Math.round((hoveredSat.validEpochs / totalEpochs) * 100)} ({hoveredSat.validEpochs} / {totalEpochs} epok)
                    </span>
                  </div>
                )}
              </div>
            )}

            {/* SV Count & PDOP View */}
            {viewMode === 'svcount' && (
              <div className="space-y-4">
                <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-700 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Activity className="w-4 h-4 text-emerald-600" />
                    <span className="font-bold">Oturum Boyunca Gözlenen Uydu Sayısı (SV) &amp; PDOP Dağılımı</span>
                  </div>
                  <span className="text-slate-500">
                    Ortalama SV: <strong>{Math.round(filteredSatellites.length * 0.85)}</strong> &bull; Ortalama PDOP: <strong>1.4</strong>
                  </span>
                </div>

                {/* Simplified SVG Bar Graph */}
                <div className="h-64 border border-slate-200 rounded-lg p-4 bg-white flex flex-col justify-between">
                  <div className="flex-1 flex items-end gap-1 overflow-x-auto pb-2 custom-scrollbar">
                    {occupation?.epochRecords.slice(0, 80).map((ep, idx) => {
                      const heightPercent = Math.min(100, (ep.nsats / 24) * 100);
                      return (
                        <div
                          key={idx}
                          className="flex-1 min-w-[6px] bg-slate-100 hover:bg-sky-100 rounded-t flex flex-col justify-end items-center group relative cursor-pointer"
                        >
                          <div
                            style={{ height: `${heightPercent}%` }}
                            className="w-full bg-sky-500 group-hover:bg-sky-600 rounded-t transition"
                          />
                          <div className="hidden group-hover:block absolute bottom-full mb-1 z-20 bg-slate-900 text-white text-[10px] p-1 rounded font-mono whitespace-nowrap shadow-md">
                            {ep.timestamp}<br />
                            SV: {ep.nsats} | PDOP: {ep.pdop || 1.3}
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  <div className="border-t border-slate-200 pt-2 flex justify-between text-[11px] text-slate-500 font-mono">
                    <span>{occupation?.firstEpochDate} (Oturum Başı)</span>
                    <span>Uydu Sayısı Çubuğu (Maks 24 SV)</span>
                    <span>{occupation?.lastEpochDate} (Oturum Sonu)</span>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
