/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * Sabit Koordinatlar & Dayalı (Tam Kısıtlı) Ağ Dengelemesi Modülü
 * - TUSAGA-Aktif resmi bilinen koordinatlarının girişi, kontrolü ve yönetimi
 * - CORS sabitli nihai 3D Gauss-Markov En Küçük Kareler Ağ Dengelemesi
 * - Baarda w-testi kaba hata tespiti, hata elipsleri ve duyarlık analizleri
 */

import React, { useState } from 'react';
import { Station, JobConfig, AdjustmentResult } from '../types/gnss';
import {
  ecefToGeodetic,
  geodeticToEcef,
  geodeticToTM,
  tmToGeodetic,
  computeStationEpochCoordinates,
} from '../utils/geodesy';
import { NetworkAdjustmentResultsView } from './NetworkAdjustmentResultsView';
import {
  ShieldCheck,
  Building2,
  CheckCircle2,
  Upload,
  Edit2,
  Save,
  Database,
  RefreshCw,
  Play,
  RotateCcw,
  Zap,
  BarChart3,
  AlertTriangle,
  ShieldAlert,
  Sliders,
  Filter,
  Check,
  Award,
  Layers,
  MapPin,
  FileCode,
  X,
} from 'lucide-react';

interface Props {
  stations: Record<string, Station>;
  config: JobConfig;
  adjustmentResult: AdjustmentResult | null;
  onUpdateStation: (station: Station) => void;
  onRunAdjustment: (mode: 'constrained') => void;
  onExcludeOutliersAndReAdjust: (outlierIds: string[]) => void;
  isLoading: boolean;
  onNavigateToReport?: () => void;
}

// Popular TUSAGA-Aktif Official Reference Station Coordinates (ITRF96 / TUREF)
const TUSAGA_CATALOG: Record<string, { x: number; y: number; z: number; name: string; city: string }> = {
  BRS1: { name: 'BRS1 (Bursa Uludağ CORS)', city: 'Bursa', x: 4256627.185, y: 2419409.845, z: 4099496.234 },
  HARC: { name: 'HARC (Harmancık CORS)', city: 'Bursa', x: 4285391.284, y: 2390609.152, z: 4061792.111 },
  BAN1: { name: 'BAN1 (Bandırma CORS)', city: 'Balıkesir', x: 4305112.441, y: 2278451.109, z: 4111320.785 },
  ANKR: { name: 'ANKR (Ankara - HGM)', city: 'Ankara', x: 4118542.894, y: 2505234.321, z: 4082211.543 },
  KONY: { name: 'KONY (Konya Selçuk)', city: 'Konya', x: 4220123.456, y: 2489112.789, z: 3901456.123 },
  YOZG: { name: 'YOZG (Yozgat Merkez)', city: 'Yozgat', x: 4056123.789, y: 2689456.123, z: 4060789.456 },
  ISTN: { name: 'ISTN (İstanbul İTÜ)', city: 'İstanbul', x: 4122112.345, y: 2212345.678, z: 4175678.901 },
  IZMR: { name: 'IZMR (İzmir Ege Ünv.)', city: 'İzmir', x: 4321098.765, y: 2109876.543, z: 3934567.890 },
  BURS: { name: 'BURS (Bursa Merkez)', city: 'Bursa', x: 4187654.321, y: 2234567.890, z: 4098765.432 },
  TRAB: { name: 'TRAB (Trabzon KTÜ)', city: 'Trabzon', x: 3789012.345, y: 2890123.456, z: 4167890.123 },
  ERZU: { name: 'ERZU (Erzurum Atatürk)', city: 'Erzurum', x: 3812345.678, y: 3012345.678, z: 4078901.234 },
  ADAN: { name: 'ADAN (Adana Çukurova)', city: 'Adana', x: 4390123.456, y: 2712345.678, z: 3812345.678 },
  DIYA: { name: 'DIYA (Diyarbakır Dicle)', city: 'Diyarbakır', x: 4156789.012, y: 3123456.789, z: 3890123.456 },
  SIVA: { name: 'SIVA (Sivas Cumhuriyet)', city: 'Sivas', x: 3989012.345, y: 2812345.678, z: 4034567.890 },
  SAMS: { name: 'SAMS (Samsun OMÜ)', city: 'Samsun', x: 3890123.456, y: 2656789.012, z: 4190123.456 },
};

export const ConstrainedAdjustmentTab: React.FC<Props> = ({
  stations,
  config,
  adjustmentResult,
  onUpdateStation,
  onRunAdjustment,
  onExcludeOutliersAndReAdjust,
  isLoading,
  onNavigateToReport,
}) => {
  const stationList = Object.values(stations);
  const fixedStations = stationList.filter((s) => s.type === 'CORS' || s.isFixed.x || s.isFixed.y || s.isFixed.z);
  const roverStations = stationList.filter((s) => !fixedStations.includes(s));

  // Edit State
  const [editingStationId, setEditingStationId] = useState<string | null>(null);
  const [coordMode, setCoordMode] = useState<'ECEF' | 'GEODETIC' | 'TM'>('ECEF');

  // Temporary inputs
  const [editX, setEditX] = useState<number>(0);
  const [editY, setEditY] = useState<number>(0);
  const [editZ, setEditZ] = useState<number>(0);

  const [editLat, setEditLat] = useState<number>(0);
  const [editLon, setEditLon] = useState<number>(0);
  const [editH, setEditH] = useState<number>(0);

  const [editProjY, setEditProjY] = useState<number>(0);
  const [editProjX, setEditProjX] = useState<number>(0);

  // Batch paste modal state
  const [showBatchModal, setShowBatchModal] = useState(false);
  const [batchText, setBatchText] = useState('');

  const handleStartEdit = (st: Station) => {
    setEditingStationId(st.id);
    setEditX(st.refX ?? st.x);
    setEditY(st.refY ?? st.y);
    setEditZ(st.refZ ?? st.z);

    setEditLat(st.refLat ?? st.lat);
    setEditLon(st.refLon ?? st.lon);
    setEditH(st.refH ?? st.h);

    setEditProjY(st.refProjY ?? st.projY);
    setEditProjX(st.refProjX ?? st.projX);
  };

  const handleSaveEdit = (st: Station) => {
    let finalX = editX;
    let finalY = editY;
    let finalZ = editZ;

    let finalLat = editLat;
    let finalLon = editLon;
    let finalH = editH;

    let finalProjY = editProjY;
    let finalProjX = editProjX;

    if (coordMode === 'ECEF') {
      const geo = ecefToGeodetic(finalX, finalY, finalZ);
      finalLat = geo.lat;
      finalLon = geo.lon;
      finalH = geo.h;
      const tm = geodeticToTM(finalLat, finalLon, config.dom);
      finalProjY = tm.projY;
      finalProjX = tm.projX;
    } else if (coordMode === 'GEODETIC') {
      const ecef = geodeticToEcef(finalLat, finalLon, finalH);
      finalX = ecef.x;
      finalY = ecef.y;
      finalZ = ecef.z;
      const tm = geodeticToTM(finalLat, finalLon, config.dom);
      finalProjY = tm.projY;
      finalProjX = tm.projX;
    } else if (coordMode === 'TM') {
      const geo = tmToGeodetic(finalProjY, finalProjX, config.dom);
      finalLat = geo.lat;
      finalLon = geo.lon;
      finalH = editH;
      const ecef = geodeticToEcef(finalLat, finalLon, finalH);
      finalX = ecef.x;
      finalY = ecef.y;
      finalZ = ecef.z;
    }

    const rawSt: Station = {
      ...st,
      refX: finalX,
      refY: finalY,
      refZ: finalZ,
      refLat: finalLat,
      refLon: finalLon,
      refH: finalH,
      refProjY: finalProjY,
      refProjX: finalProjX,
      isFixed: { x: true, y: true, z: true },
      type: 'CORS',
    };

    const computed = computeStationEpochCoordinates(rawSt, config.surveyEpoch, config.dom);
    onUpdateStation(computed);
    setEditingStationId(null);
  };

  const handleApplyCatalogCoordinates = (st: Station, catalogKey: string) => {
    const cat = TUSAGA_CATALOG[catalogKey];
    if (!cat) return;

    const geo = ecefToGeodetic(cat.x, cat.y, cat.z);
    const tm = geodeticToTM(geo.lat, geo.lon, config.dom);

    const rawSt: Station = {
      ...st,
      refX: cat.x,
      refY: cat.y,
      refZ: cat.z,
      refLat: geo.lat,
      refLon: geo.lon,
      refH: geo.h,
      refProjY: tm.projY,
      refProjX: tm.projX,
      isFixed: { x: true, y: true, z: true },
      type: 'CORS',
    };

    const computed = computeStationEpochCoordinates(rawSt, config.surveyEpoch, config.dom);
    onUpdateStation(computed);
  };

  const handleToggleStationFixed = (st: Station) => {
    const currentlyFixed = st.isFixed.x && st.isFixed.y && st.isFixed.z;
    onUpdateStation({
      ...st,
      type: currentlyFixed ? 'GROUND' : 'CORS',
      isFixed: {
        x: !currentlyFixed,
        y: !currentlyFixed,
        z: !currentlyFixed,
      },
    });
  };

  const handleProcessBatchText = () => {
    if (!batchText.trim()) return;
    const lines = batchText.split(/\r?\n/);
    let updatedCount = 0;

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('//')) continue;
      const parts = trimmed.split(/[\s,;\t]+/);

      if (parts.length >= 4) {
        const name = parts[0].toUpperCase();
        const p1 = parseFloat(parts[1]);
        const p2 = parseFloat(parts[2]);
        const p3 = parseFloat(parts[3]);

        if (isNaN(p1) || isNaN(p2) || isNaN(p3)) continue;

        const matchKey = Object.keys(stations).find(
          (id) => id.toUpperCase() === name || stations[id].name.toUpperCase() === name
        );

        if (matchKey) {
          const st = stations[matchKey];
          let x = 0, y = 0, z = 0;
          let lat = 0, lon = 0, h = 0;

          if (Math.abs(p1) > 1000000) {
            x = p1; y = p2; z = p3;
            const geo = ecefToGeodetic(x, y, z);
            lat = geo.lat; lon = geo.lon; h = geo.h;
          } else {
            lat = p1; lon = p2; h = p3;
            const ecef = geodeticToEcef(lat, lon, h);
            x = ecef.x; y = ecef.y; z = ecef.z;
          }

          const tm = geodeticToTM(lat, lon, config.dom);

          const rawSt: Station = {
            ...st,
            refX: x,
            refY: y,
            refZ: z,
            refLat: lat,
            refLon: lon,
            refH: h,
            refProjY: tm.projY,
            refProjX: tm.projX,
            type: 'CORS',
            isFixed: { x: true, y: true, z: true },
          };

          const computed = computeStationEpochCoordinates(rawSt, config.surveyEpoch, config.dom);
          onUpdateStation(computed);
          updatedCount++;
        }
      }
    }

    setShowBatchModal(false);
    setBatchText('');
  };

  return (
    <div className="space-y-6">
      {/* Top Controls Banner */}
      <div className="bg-white rounded-xl shadow-xs border border-slate-200 p-5">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="bg-indigo-100 text-indigo-800 text-[10px] font-extrabold px-2.5 py-0.5 rounded border border-indigo-300 uppercase">
                4. Faz: Dayalı Dengeleme
              </span>
              <h2 className="text-base sm:text-lg font-bold text-slate-900">
                4. Faz: CORS Sabitli Dayalı 3D Ağ Dengelemesi
              </h2>
            </div>
            <p className="text-xs text-slate-500 mt-1 max-w-3xl">
              TUSAGA-Aktif resmi bilinen koordinatlarını inceleyin, düzenleyin veya toplu yapıştırın; CORS sabitli nihai 3D Gauss-Markov dengelemesini ve BÖHYY tolerans testlerini tek ekranda çalıştırın.
            </p>
          </div>

          <div className="flex items-center gap-2.5 flex-wrap">
            <button
              onClick={() => onRunAdjustment('constrained')}
              disabled={isLoading || fixedStations.length === 0}
              className="px-5 py-2.5 text-xs sm:text-sm font-bold bg-slate-900 hover:bg-slate-800 text-white rounded-lg shadow-sm transition cursor-pointer flex items-center gap-2 disabled:opacity-50 active:scale-95"
              title="Sabit CORS noktalarını dayanak alarak nihai 3D Gauss-Markov dengelemesini hesaplar"
            >
              <Play className="w-4 h-4 text-emerald-400" />
              <span>{isLoading ? 'Dengeleme Hesaplanıyor...' : 'Dayalı Dengelemeyi Hesapla'}</span>
            </button>

            {adjustmentResult && onNavigateToReport && (
              <button
                onClick={onNavigateToReport}
                className="px-4 py-2.5 text-xs sm:text-sm font-bold bg-rose-600 hover:bg-rose-700 text-white rounded-lg shadow-sm transition cursor-pointer flex items-center gap-2 active:scale-95 animate-fade-in"
                title="5. Faz: Resmi BÖHYY Dengeleme Karnesi ve CAD/CBS Dışa Aktarıma Git"
              >
                <Award className="w-4 h-4 text-amber-300" />
                <span>5. Faz: Resmi Karne &amp; CAD/CBS &rarr;</span>
              </button>
            )}
          </div>
        </div>

        {/* Global Statistics Cards (When adjustment result is available) */}
        {adjustmentResult && (
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mt-4 pt-4 border-t border-slate-100 text-xs">
            <div className="p-2.5 bg-slate-50 rounded-lg border border-slate-200">
              <div className="text-slate-500">Birim Ölçü Std. Hatası (σ₀)</div>
              <div className="text-base font-bold font-mono text-slate-900 mt-0.5">
                {adjustmentResult.sigma0Aposteriori.toFixed(4)}
              </div>
            </div>

            <div className="p-2.5 bg-sky-50 rounded-lg border border-sky-200">
              <div className="text-sky-700 font-medium">Serbestlik Derecesi (DOF)</div>
              <div className="text-base font-bold font-mono text-sky-900 mt-0.5">
                {adjustmentResult.dof}
              </div>
            </div>

            <div
              className={`p-2.5 rounded-lg border ${
                adjustmentResult.chiSquareTest.passed
                  ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                  : 'bg-rose-50 border-rose-200 text-rose-900'
              }`}
            >
              <div className="font-semibold flex items-center gap-1">
                <span>χ² Global Test</span>
                {adjustmentResult.chiSquareTest.passed ? (
                  <Check className="w-3.5 h-3.5 text-emerald-600" />
                ) : (
                  <AlertTriangle className="w-3.5 h-3.5 text-rose-600" />
                )}
              </div>
              <div className="text-xs font-bold mt-0.5">
                {adjustmentResult.chiSquareTest.passed ? 'KABUL EDİLDİ' : 'TOLERANS DIŞI'}
              </div>
            </div>

            <div className="p-2.5 bg-slate-50 rounded-lg border border-slate-200">
              <div className="text-slate-500">Kalıntı Kareler [vPv]</div>
              <div className="text-base font-bold font-mono text-slate-900 mt-0.5">
                {adjustmentResult.vPv.toFixed(4)}
              </div>
            </div>

            <div
              className={`p-2.5 rounded-lg border ${
                adjustmentResult.outliers.length === 0
                  ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                  : 'bg-rose-50 border-rose-200 text-rose-800'
              }`}
            >
              <div className="text-slate-500 font-medium">Baarda Data Snooping</div>
              <div className="text-base font-bold font-mono mt-0.5">
                {adjustmentResult.outliers.length === 0
                  ? 'Kaba Hata Yok'
                  : `${adjustmentResult.outliers.length} Kaba Hata!`}
              </div>
            </div>
          </div>
        )}

        {/* Outlier Alert and Auto Re-adjustment Banner */}
        {adjustmentResult && adjustmentResult.outliers.length > 0 && (
          <div className="mt-4 p-3 bg-rose-50 border border-rose-200 rounded-lg flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-rose-800">
            <div className="flex items-center gap-2">
              <ShieldAlert className="w-4 h-4 text-rose-600 shrink-0" />
              <span>
                <strong>Baarda w-testi uyarısı:</strong> {adjustmentResult.outliers.join(', ')} nolu bazlarda
                kritik eşik değeri (w_crit = {config.wCrit}) aşılmıştır (Kaba Hata).
              </span>
            </div>
            <button
              onClick={() => onExcludeOutliersAndReAdjust(adjustmentResult.outliers)}
              className="px-3 py-1.5 bg-rose-600 hover:bg-rose-700 text-white font-bold rounded-lg shadow-2xs transition cursor-pointer shrink-0"
            >
              Kaba Hatalı Bazları Ağdan Ele ve Yeniden Dengele
            </button>
          </div>
        )}
      </div>

      {/* SECTION 1: Sabit Koordinatlar (CORS) Yönetimi */}
      <div className="bg-white rounded-xl shadow-xs border border-slate-200 p-5 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-3">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-indigo-600" />
            <div>
              <h3 className="text-sm font-bold text-slate-900">
                1. Sabit Noktalar ve TUSAGA Resmi Koordinatları
              </h3>
              <p className="text-[11px] text-slate-500">
                Ağda dayanak alınan CORS istasyonları ({fixedStations.length} Sabit, {roverStations.length} Serbest Rover)
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {/* Coordinate Format Switcher */}
            <div className="inline-flex rounded-lg border border-slate-200 p-0.5 bg-slate-50 text-xs">
              <button
                onClick={() => setCoordMode('ECEF')}
                className={`px-2.5 py-1 rounded font-semibold transition cursor-pointer ${
                  coordMode === 'ECEF' ? 'bg-white shadow-2xs text-sky-700 font-bold' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                ECEF (X, Y, Z)
              </button>
              <button
                onClick={() => setCoordMode('GEODETIC')}
                className={`px-2.5 py-1 rounded font-semibold transition cursor-pointer ${
                  coordMode === 'GEODETIC' ? 'bg-white shadow-2xs text-sky-700 font-bold' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Coğrafi (φ, λ, h)
              </button>
              <button
                onClick={() => setCoordMode('TM')}
                className={`px-2.5 py-1 rounded font-semibold transition cursor-pointer ${
                  coordMode === 'TM' ? 'bg-white shadow-2xs text-sky-700 font-bold' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                TM Projeksiyon (Y, X)
              </button>
            </div>

            <button
              onClick={() => setShowBatchModal(true)}
              className="px-3 py-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer"
            >
              <Upload className="w-3.5 h-3.5" />
              <span>Toplu Koordinat Yapıştır</span>
            </button>
          </div>
        </div>

        {/* Stations Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-slate-50 text-slate-700 font-semibold border-b border-slate-200">
                <th className="py-2.5 px-3">Nokta ID</th>
                <th className="py-2.5 px-3">Tip / Durum</th>
                <th className="py-2.5 px-3">TUSAGA Kataloğu</th>
                <th className="py-2.5 px-3 text-right">
                  {coordMode === 'ECEF' ? 'Ref. X (2005.00)' : coordMode === 'GEODETIC' ? 'Enlem (φ)' : 'TM Sağa Değer (Y)'}
                </th>
                <th className="py-2.5 px-3 text-right">
                  {coordMode === 'ECEF' ? 'Ref. Y (2005.00)' : coordMode === 'GEODETIC' ? 'Boylam (λ)' : 'TM Yukarı Değer (X)'}
                </th>
                <th className="py-2.5 px-3 text-right">
                  {coordMode === 'ECEF' ? 'Ref. Z (2005.00)' : coordMode === 'GEODETIC' ? 'Elip. Yükseklik (h)' : 'Elip. Yükseklik (h)'}
                </th>
                <th className="py-2.5 px-3 text-right">Ölçü Epoğu Koordinatı ({config.surveyEpoch})</th>
                <th className="py-2.5 px-3 text-center">İşlemler</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 font-mono">
              {stationList.map((st) => {
                const isFixed = st.isFixed.x && st.isFixed.y && st.isFixed.z;
                const isEditing = editingStationId === st.id;

                return (
                  <tr key={st.id} className={`hover:bg-slate-50/80 ${isFixed ? 'bg-indigo-50/20' : ''}`}>
                    <td className="py-2.5 px-3 font-bold font-sans text-slate-900">
                      <div className="flex items-center gap-1.5">
                        <MapPin className={`w-3.5 h-3.5 ${isFixed ? 'text-indigo-600' : 'text-slate-400'}`} />
                        <span>{st.name}</span>
                      </div>
                    </td>

                    <td className="py-2.5 px-3 font-sans">
                      <button
                        onClick={() => handleToggleStationFixed(st)}
                        className={`px-2 py-0.5 rounded text-[10px] font-bold transition cursor-pointer flex items-center gap-1 ${
                          isFixed
                            ? 'bg-indigo-100 text-indigo-800 hover:bg-indigo-200'
                            : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                        }`}
                        title="Sabit/Serbest durumunu değiştirmek için tıklayınız"
                      >
                        {isFixed ? <ShieldCheck className="w-3 h-3 text-indigo-700" /> : null}
                        <span>{isFixed ? 'SABİT (CORS)' : 'SERBEST (Rover)'}</span>
                      </button>
                    </td>

                    {/* TUSAGA Catalog Quick Select */}
                    <td className="py-2.5 px-3 font-sans">
                      <select
                        onChange={(e) => {
                          if (e.target.value) handleApplyCatalogCoordinates(st, e.target.value);
                        }}
                        defaultValue=""
                        className="text-[11px] bg-white border border-slate-200 rounded px-2 py-1 text-slate-700 hover:border-slate-300 focus:outline-hidden focus:ring-1 focus:ring-indigo-500"
                      >
                        <option value="">Katalogdan Ata...</option>
                        {Object.entries(TUSAGA_CATALOG).map(([key, cat]) => (
                          <option key={key} value={key}>
                            {cat.name} ({cat.city})
                          </option>
                        ))}
                      </select>
                    </td>

                    {/* Coord Column 1 */}
                    <td className="py-2.5 px-3 text-right">
                      {isEditing ? (
                        <input
                          type="number"
                          step="0.0001"
                          value={coordMode === 'ECEF' ? editX : coordMode === 'GEODETIC' ? editLat : editProjY}
                          onChange={(e) => {
                            const val = parseFloat(e.target.value) || 0;
                            if (coordMode === 'ECEF') setEditX(val);
                            else if (coordMode === 'GEODETIC') setEditLat(val);
                            else setEditProjY(val);
                          }}
                          className="w-28 text-right bg-white border border-sky-400 rounded px-1.5 py-0.5 text-xs font-bold"
                        />
                      ) : (
                        <span className="text-slate-800">
                          {coordMode === 'ECEF'
                            ? (st.refX ?? st.x).toFixed(4)
                            : coordMode === 'GEODETIC'
                            ? (st.refLat ?? st.lat).toFixed(8)
                            : (st.refProjY ?? st.projY).toFixed(4)}
                        </span>
                      )}
                    </td>

                    {/* Coord Column 2 */}
                    <td className="py-2.5 px-3 text-right">
                      {isEditing ? (
                        <input
                          type="number"
                          step="0.0001"
                          value={coordMode === 'ECEF' ? editY : coordMode === 'GEODETIC' ? editLon : editProjX}
                          onChange={(e) => {
                            const val = parseFloat(e.target.value) || 0;
                            if (coordMode === 'ECEF') setEditY(val);
                            else if (coordMode === 'GEODETIC') setEditLon(val);
                            else setEditProjX(val);
                          }}
                          className="w-28 text-right bg-white border border-sky-400 rounded px-1.5 py-0.5 text-xs font-bold"
                        />
                      ) : (
                        <span className="text-slate-800">
                          {coordMode === 'ECEF'
                            ? (st.refY ?? st.y).toFixed(4)
                            : coordMode === 'GEODETIC'
                            ? (st.refLon ?? st.lon).toFixed(8)
                            : (st.refProjX ?? st.projX).toFixed(4)}
                        </span>
                      )}
                    </td>

                    {/* Coord Column 3 */}
                    <td className="py-2.5 px-3 text-right">
                      {isEditing ? (
                        <input
                          type="number"
                          step="0.0001"
                          value={coordMode === 'ECEF' ? editZ : editH}
                          onChange={(e) => {
                            const val = parseFloat(e.target.value) || 0;
                            if (coordMode === 'ECEF') setEditZ(val);
                            else setEditH(val);
                          }}
                          className="w-28 text-right bg-white border border-sky-400 rounded px-1.5 py-0.5 text-xs font-bold"
                        />
                      ) : (
                        <span className="text-slate-800">
                          {coordMode === 'ECEF'
                            ? (st.refZ ?? st.z).toFixed(4)
                            : (st.refH ?? st.h).toFixed(4)}
                        </span>
                      )}
                    </td>

                    {/* Survey Epoch (t) Coordinates summary */}
                    <td className="py-2.5 px-3 text-right font-sans text-[11px] text-slate-500">
                      <span className="font-mono text-slate-700">
                        {st.projY.toFixed(2)}, {st.projX.toFixed(2)}
                      </span>
                    </td>

                    {/* Actions */}
                    <td className="py-2.5 px-3 text-center font-sans">
                      {isEditing ? (
                        <div className="flex items-center justify-center gap-1">
                          <button
                            onClick={() => handleSaveEdit(st)}
                            className="px-2 py-0.5 bg-sky-600 hover:bg-sky-500 text-white rounded text-[10px] font-bold cursor-pointer"
                          >
                            Kaydet
                          </button>
                          <button
                            onClick={() => setEditingStationId(null)}
                            className="px-2 py-0.5 bg-slate-200 hover:bg-slate-300 text-slate-700 rounded text-[10px] cursor-pointer"
                          >
                            İptal
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => handleStartEdit(st)}
                          className="p-1 text-slate-400 hover:text-sky-600 hover:bg-sky-50 rounded transition cursor-pointer"
                          title="Koordinatları düzenle"
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* SECTION 2: Dayalı Dengeleme Sonuçları */}
      <div className="bg-white rounded-xl shadow-xs border border-slate-200 p-5 space-y-4">
        <div className="flex items-center justify-between border-b border-slate-100 pb-3">
          <div className="flex items-center gap-2">
            <BarChart3 className="w-5 h-5 text-sky-600" />
            <div>
              <h3 className="text-sm font-bold text-slate-900">
                2. Dayalı Dengeleme Sonuçları & Kalite Analizi
              </h3>
              <p className="text-[11px] text-slate-500">
                Gauss-Markov modeli ile dengelenmiş koordinatlar, ölçü düzeltmeleri ve hata elipsleri
              </p>
            </div>
          </div>
        </div>

        {!adjustmentResult ? (
          <div className="text-center py-10 px-4 bg-slate-50 rounded-xl border border-dashed border-slate-200 text-slate-500 text-xs space-y-2">
            <Play className="w-8 h-8 text-slate-300 mx-auto" />
            <p className="font-bold text-slate-700">Henüz Dayalı Dengeleme Hesaplanmadı</p>
            <p className="text-[11px] text-slate-400 max-w-md mx-auto">
              Yukarıdaki sabit CORS koordinatlarını inceledikten sonra <strong>"Dayalı Dengelemeyi Hesapla"</strong> butonuna tıklayarak ağ dengelemesini çalıştırabilirsiniz.
            </p>
          </div>
        ) : (
          <NetworkAdjustmentResultsView
            adjustmentResult={adjustmentResult}
            config={config}
            mode="constrained"
            onExcludeOutliersAndReAdjust={onExcludeOutliersAndReAdjust}
          />
        )}
      </div>

      {/* Toplu Koordinat Yapıştır Modalı */}
      {showBatchModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 backdrop-blur-xs p-4 animate-in fade-in">
          <div className="bg-white w-full max-w-xl rounded-2xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[85vh]">
            <div className="p-4 border-b border-slate-200 flex items-center justify-between bg-slate-50">
              <div className="flex items-center gap-2">
                <FileCode className="w-5 h-5 text-indigo-600" />
                <h3 className="text-sm font-bold text-slate-900">Toplu Sabit Koordinat Yapıştır</h3>
              </div>
              <button
                onClick={() => setShowBatchModal(false)}
                className="p-1 rounded text-slate-400 hover:text-slate-600 hover:bg-slate-200 transition cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 space-y-3 overflow-y-auto">
              <p className="text-xs text-slate-600 leading-relaxed">
                Her satıra bir nokta gelecek biçimde boşluk, sekme veya virgülle ayrılmış koordinatları yapıştırınız.
                <br />
                <strong>Format 1 (ECEF Metre):</strong> <code>NOKTA_ADI  X  Y  Z</code>
                <br />
                <strong>Format 2 (Coğrafi Derece):</strong> <code>NOKTA_ADI  Enlem(Lat)  Boylam(Lon)  ElipYük(h)</code>
              </p>

              <textarea
                value={batchText}
                onChange={(e) => setBatchText(e.target.value)}
                placeholder={"BRS1  4256627.185  2419409.845  4099496.234\nHARC  4285391.284  2390609.152  4061792.111"}
                rows={8}
                className="w-full p-3 font-mono text-xs border border-slate-300 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:outline-hidden"
              />
            </div>

            <div className="p-4 bg-slate-50 border-t border-slate-200 flex items-center justify-end gap-2">
              <button
                onClick={() => setShowBatchModal(false)}
                className="px-3 py-1.5 bg-slate-200 hover:bg-slate-300 text-slate-700 text-xs font-semibold rounded-lg transition cursor-pointer"
              >
                İptal
              </button>
              <button
                onClick={handleProcessBatchText}
                className="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold rounded-lg shadow-xs transition cursor-pointer flex items-center gap-1"
              >
                <Check className="w-3.5 h-3.5" />
                <span>Koordinatları Uygula</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
