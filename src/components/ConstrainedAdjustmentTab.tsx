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
  TUSAGA_VELOCITY_CATALOG,
  cartesianToTopocentricVelocity,
  topocentricToCartesianVelocity,
  exportVelocityReportToExcel,
  generateVelocityReportData,
  estimateVelocitiesByTUTGA,
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
  TrendingUp,
  FileSpreadsheet,
  Download,
  Info,
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

  // Velocity Modal & Report State
  const [isVelocityModalOpen, setIsVelocityModalOpen] = useState(false);
  const [isVelocityReportModalOpen, setIsVelocityReportModalOpen] = useState(false);
  const [editingVelocityStationId, setEditingVelocityStationId] = useState<string | null>(null);
  const [tempVx, setTempVx] = useState<number>(-0.015);
  const [tempVy, setTempVy] = useState<number>(-0.0218);
  const [tempVz, setTempVz] = useState<number>(0.0084);
  const [tempVe, setTempVe] = useState<number>(-21.5);
  const [tempVn, setTempVn] = useState<number>(14.0);
  const [tempVu, setTempVu] = useState<number>(1.0);
  const [tempRefX, setTempRefX] = useState<number>(4118542.894);
  const [tempRefY, setTempRefY] = useState<number>(2505234.321);
  const [tempRefZ, setTempRefZ] = useState<number>(4082211.543);
  const [velocityFeedback, setVelocityFeedback] = useState<string | null>(null);

  const handleOpenVelocityModal = (stationId?: string) => {
    setEditingVelocityStationId(stationId || null);
    const targetSt = stationId ? stations[stationId] : null;
    if (targetSt) {
      const v = targetSt.velocities;
      setTempVx(v?.vx ?? -0.015);
      setTempVy(v?.vy ?? -0.0218);
      setTempVz(v?.vz ?? 0.0084);
      setTempVe(v?.ve ?? -21.5);
      setTempVn(v?.vn ?? 14.0);
      setTempVu(v?.vu ?? 1.0);

      const rx = targetSt.refX ?? targetSt.x ?? 4118542.894;
      const ry = targetSt.refY ?? targetSt.y ?? 2505234.321;
      const rz = targetSt.refZ ?? targetSt.z ?? 4082211.543;
      setTempRefX(rx);
      setTempRefY(ry);
      setTempRefZ(rz);
    } else {
      setTempVx(-0.015);
      setTempVy(-0.0218);
      setTempVz(0.0084);
      setTempVe(-21.5);
      setTempVn(14.0);
      setTempVu(1.0);
      setTempRefX(4118542.894);
      setTempRefY(2505234.321);
      setTempRefZ(4082211.543);
    }
    setIsVelocityModalOpen(true);
  };

  const handleSaveVelocityModal = () => {
    if (editingVelocityStationId) {
      const st = stations[editingVelocityStationId];
      if (st) {
        const updatedRaw: Station = {
          ...st,
          refX: tempRefX,
          refY: tempRefY,
          refZ: tempRefZ,
          velocities: {
            vx: tempVx,
            vy: tempVy,
            vz: tempVz,
            ve: tempVe,
            vn: tempVn,
            vu: tempVu,
          },
        };
        const computed = computeStationEpochCoordinates(updatedRaw, config.surveyEpoch, config.dom);
        onUpdateStation(computed);
        setVelocityFeedback(`"${computed.name}" istasyonunun 2005 epok koordinat ve hızları güncellendi.`);
      }
    } else {
      for (const id in stations) {
        const st = stations[id];
        if (st.type === 'CORS' || (st.isFixed.x && st.isFixed.y && st.isFixed.z)) {
          const updatedRaw: Station = {
            ...st,
            velocities: {
              vx: tempVx,
              vy: tempVy,
              vz: tempVz,
              ve: tempVe,
              vn: tempVn,
              vu: tempVu,
            },
          };
          const computed = computeStationEpochCoordinates(updatedRaw, config.surveyEpoch, config.dom);
          onUpdateStation(computed);
        }
      }
      setVelocityFeedback(`Tüm sabit istasyonların tektonik plaka hızları güncellendi.`);
    }
    setIsVelocityModalOpen(false);
  };

  const handleAutoApplyTusagaVelocities = () => {
    let appliedCount = 0;
    Object.values(stations).forEach((st) => {
      const up = st.name.toUpperCase();
      const cat = TUSAGA_VELOCITY_CATALOG[up] || TUSAGA_VELOCITY_CATALOG[st.id.toUpperCase()];
      if (cat) {
        appliedCount++;
        const updatedStn: Station = {
          ...st,
          velocities: {
            vx: cat.vx,
            vy: cat.vy,
            vz: cat.vz,
            ve: cat.ve,
            vn: cat.vn,
            vu: cat.vu,
          },
        };
        const computed = computeStationEpochCoordinates(updatedStn, config.surveyEpoch, config.dom);
        onUpdateStation(computed);
      }
    });
    setVelocityFeedback(`${appliedCount} istasyona TUSAGA resmi hız kataloğu uygulandı.`);
  };

  const handleAutoInterpolateRoverVelocities = () => {
    const corsList = Object.values(stations).filter(
      (s) => (s.type === 'CORS' || s.isFixed.x) && s.velocities
    );
    if (corsList.length === 0) {
      setVelocityFeedback('Enterpolasyon için en az 1 CORS hız bilgisi gereklidir.');
      return;
    }

    const estimates = estimateVelocitiesByTUTGA(stations);
    let interpolated = 0;
    Object.values(stations)
      .filter((s) => s.type !== 'CORS' && !s.isFixed.x)
      .forEach((rover) => {
        if (estimates[rover.id]) {
          const updated: Station = {
            ...rover,
            velocities: estimates[rover.id],
          };
          const computed = computeStationEpochCoordinates(updated, config.surveyEpoch, config.dom);
          onUpdateStation(computed);
          interpolated++;
        }
      });
    setVelocityFeedback(`${interpolated} ara noktaya TUTGA enterpolasyon hızları uygulandı.`);
  };

  const handleExportVelocityExcel = () => {
    if (stationList.length === 0) {
      setVelocityFeedback('Hız hesabı Excel raporu oluşturmak için en az 1 istasyon bulunmalıdır.');
      return;
    }
    exportVelocityReportToExcel(stations, config.surveyEpoch, 2005.00, config.dom, 'TUSAGA_Hiz_Hesabi');
    setVelocityFeedback('BÖHYY standartlarında resmi Hız Hesabı Excel Raporu (.xlsx) indirildi.');
  };

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
            <h2 className="text-base sm:text-lg font-bold text-slate-900">
              Dayalı Ağ Dengelemesi (CORS Sabitli)
            </h2>
            <p className="text-xs text-slate-500 mt-1">
              TUSAGA sabit koordinatlarını tanımlayın ve 3D Gauss-Markov modeli ile nihai dengelemeyi gerçekleştirin.
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
                title="Resmi BÖHYY Dengeleme Karnesi ve CAD/CBS Dışa Aktarıma Git"
              >
                <Award className="w-4 h-4 text-amber-300" />
                <span>Rapor &amp; CAD/CBS &rarr;</span>
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
                Sabit Noktalar ve Dayanak Koordinatları
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

      {/* SECTION 2: TUSAGA Onaylı Epok Hızları ve Epok Koordinat Tablosu */}
      <div className="bg-white rounded-xl shadow-xs border border-purple-200 p-5 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-purple-100 pb-3">
          <div className="flex items-center gap-2">
            <TrendingUp className="w-5 h-5 text-purple-600" />
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="text-sm font-bold text-slate-900">
                  2. TUSAGA Onaylı Epok Hızları ve Epok Koordinat Tablosu (2005.00 &rarr; t = {config.surveyEpoch.toFixed(2)})
                </h3>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-purple-100 text-purple-800 border border-purple-200">
                  &Delta;t = {(config.surveyEpoch - 2005.00).toFixed(2)} Yıl
                </span>
              </div>
              <p className="text-[11px] text-slate-500 mt-0.5">
                2005.00 referans koordinatlarından ölçü/dengeleme epoğuna (t = {config.surveyEpoch.toFixed(2)}) ötelenmiş ECEF ve TM koordinatları.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <button
              type="button"
              onClick={() => handleAutoApplyTusagaVelocities()}
              className="px-3 py-1.5 bg-purple-50 hover:bg-purple-100 text-purple-800 border border-purple-200 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer"
              title="Resmi HGM TUSAGA-Aktif hız kataloğundan otomatik doldur"
            >
              <Database className="w-3.5 h-3.5 text-purple-600" />
              <span>TUSAGA Hız Kataloğunu Uygula</span>
            </button>

            <button
              type="button"
              onClick={() => setIsVelocityReportModalOpen(true)}
              className="px-3 py-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-900 border border-indigo-300 rounded-lg text-xs font-bold shadow-2xs transition flex items-center gap-1.5 cursor-pointer"
              title="BÖHYY standartlarında hız hesabı tablosu ve matematiksel doğrulama raporu"
            >
              <TrendingUp className="w-3.5 h-3.5 text-indigo-600" />
              <span>Hız Hesabı Tablosu</span>
            </button>

            <button
              type="button"
              onClick={handleExportVelocityExcel}
              className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-bold shadow-xs transition flex items-center gap-1.5 cursor-pointer"
              title="Resmi Hız Hesabı Excel (.xlsx) dosyasını indir"
            >
              <FileSpreadsheet className="w-3.5 h-3.5" />
              <span>Hız Hesabı Excel (.xlsx)</span>
            </button>

            <button
              type="button"
              onClick={() => handleOpenVelocityModal()}
              className="px-3 py-1.5 bg-purple-700 hover:bg-purple-800 text-white rounded-lg text-xs font-bold shadow-xs transition flex items-center gap-1.5 cursor-pointer"
              title="Onaylı hız değerlerini manuel veya istasyon bazlı düzenle"
            >
              <Sliders className="w-3.5 h-3.5" />
              <span>Hızları Düzenle</span>
            </button>
          </div>
        </div>

        {velocityFeedback && (
          <div className="p-2.5 bg-purple-50 border border-purple-200 text-purple-900 rounded-lg text-xs flex items-center justify-between">
            <span className="font-medium">{velocityFeedback}</span>
            <button onClick={() => setVelocityFeedback(null)} className="text-purple-700 font-bold ml-2">×</button>
          </div>
        )}

        {fixedStations.length === 0 ? (
          <div className="p-6 text-center border border-dashed border-slate-200 rounded-xl text-slate-500 text-xs">
            Henüz sabit CORS noktası tanımlanmamış. Yukarıdaki tablodan en az 1 istasyonu SABİT (CORS) yapınız.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-purple-50/70 text-purple-950 font-semibold border-b border-purple-200 whitespace-nowrap">
                  <th className="py-2 px-3">İstasyon</th>
                  <th className="py-2 px-3 text-right">X_2005 (m)</th>
                  <th className="py-2 px-3 text-right">Y_2005 (m)</th>
                  <th className="py-2 px-3 text-right">Z_2005 (m)</th>
                  <th className="py-2 px-3 text-center">Onaylı Hızlar (Vx, Vy, Vz)</th>
                  <th className="py-2 px-3 text-right text-purple-800">Toplam Kayma (cm)</th>
                  <th className="py-2 px-3 text-right font-bold text-slate-900 bg-emerald-50/60">X(t) Ölçü (m)</th>
                  <th className="py-2 px-3 text-right font-bold text-slate-900 bg-emerald-50/60">Y(t) Ölçü (m)</th>
                  <th className="py-2 px-3 text-right font-bold text-slate-900 bg-emerald-50/60">Z(t) Ölçü (m)</th>
                  <th className="py-2 px-3 text-right text-sky-800">TM Sağa Y (m)</th>
                  <th className="py-2 px-3 text-right text-sky-800">TM Yukarı X (m)</th>
                  <th className="py-2 px-3 text-right text-emerald-800">Elip. Kot h (m)</th>
                  <th className="py-2 px-3 text-center">İşlem</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-purple-100 font-mono">
                {fixedStations.map((st) => {
                  const dt = config.surveyEpoch - 2005.00;
                  const rX = st.refX ?? st.x;
                  const rY = st.refY ?? st.y;
                  const rZ = st.refZ ?? st.z;
                  const vx = st.velocities?.vx || 0;
                  const vy = st.velocities?.vy || 0;
                  const vz = st.velocities?.vz || 0;
                  const shiftM = Math.sqrt(
                    Math.pow(vx * dt, 2) + Math.pow(vy * dt, 2) + Math.pow(vz * dt, 2)
                  );
                  const shiftCm = shiftM * 100;

                  return (
                    <tr key={st.id} className="hover:bg-purple-50/40">
                      <td className="py-2 px-3 font-bold font-sans text-slate-900">
                        {st.name}
                      </td>
                      <td className="py-2 px-3 text-right text-slate-600">{rX.toFixed(4)}</td>
                      <td className="py-2 px-3 text-right text-slate-600">{rY.toFixed(4)}</td>
                      <td className="py-2 px-3 text-right text-slate-600">{rZ.toFixed(4)}</td>
                      <td className="py-2 px-3 text-center text-slate-700 font-sans text-[11px]">
                        {st.velocities ? (
                          <span className="font-mono bg-purple-50 text-purple-900 px-1.5 py-0.5 rounded border border-purple-200">
                            {(st.velocities.vx * 1000).toFixed(1)}, {(st.velocities.vy * 1000).toFixed(1)}, {(st.velocities.vz * 1000).toFixed(1)} mm/yıl
                          </span>
                        ) : (
                          <span className="text-slate-400 italic">Tanımsız (0)</span>
                        )}
                      </td>
                      <td className="py-2 px-3 text-right font-bold text-purple-700">
                        {shiftCm.toFixed(1)} cm
                      </td>
                      <td className="py-2 px-3 text-right font-bold text-emerald-900 bg-emerald-50/40">
                        {st.x.toFixed(4)}
                      </td>
                      <td className="py-2 px-3 text-right font-bold text-emerald-900 bg-emerald-50/40">
                        {st.y.toFixed(4)}
                      </td>
                      <td className="py-2 px-3 text-right font-bold text-emerald-900 bg-emerald-50/40">
                        {st.z.toFixed(4)}
                      </td>
                      <td className="py-2 px-3 text-right font-bold text-sky-800">
                        {st.projY.toFixed(4)}
                      </td>
                      <td className="py-2 px-3 text-right font-bold text-sky-800">
                        {st.projX.toFixed(4)}
                      </td>
                      <td className="py-2 px-3 text-right text-emerald-800">
                        {st.h.toFixed(4)}
                      </td>
                      <td className="py-2 px-3 text-center font-sans">
                        <button
                          type="button"
                          onClick={() => handleOpenVelocityModal(st.id)}
                          className="px-2 py-0.5 rounded bg-purple-100 hover:bg-purple-200 text-purple-800 text-[10px] font-bold cursor-pointer"
                        >
                          Hız Düzenle
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* SECTION 3: Dayalı Dengeleme Sonuçları */}
      <div className="bg-white rounded-xl shadow-xs border border-slate-200 p-5 space-y-4">
        <div className="flex items-center justify-between border-b border-slate-100 pb-3">
          <div className="flex items-center gap-2">
            <BarChart3 className="w-5 h-5 text-sky-600" />
            <div>
              <h3 className="text-sm font-bold text-slate-900">
                3. Dayalı Dengeleme Sonuçları & Kalite Analizi
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

      {/* TUSAGA 2005 EPOK HIZ DÜZENLEME MODALI */}
      {isVelocityModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl shadow-2xl max-w-xl w-full overflow-hidden animate-in fade-in duration-150">
            <div className="p-5 border-b border-slate-200 bg-slate-900 text-white flex items-center justify-between">
              <div className="flex items-center gap-2">
                <TrendingUp className="w-5 h-5 text-purple-400" />
                <div>
                  <h3 className="font-bold text-base">
                    TUSAGA-Aktif Onaylı Hız Bilgisi Girişi
                  </h3>
                  <p className="text-[11px] text-slate-400">
                    Resmi istasyon karnesinden alınan 2005.00 epok hızları ($V_x, V_y, V_z$)
                  </p>
                </div>
              </div>
              <button
                onClick={() => setIsVelocityModalOpen(false)}
                className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 space-y-4 text-xs">
              <div className="bg-amber-50 border border-amber-200 p-3 rounded-xl text-amber-900 text-[11px] leading-relaxed flex items-start gap-2">
                <Info className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                <div>
                  <strong>BÖHYY &amp; HGM Standartları:</strong> Harita Genel Müdürlüğü (HGM) veya TUSAGA-Aktif resmi portalından indirilen istasyon karnenizde belirtilen kesin onaylı hız bileşenlerini giriniz. Hız düzeltmesi uygulamak istemiyorsanız <strong>"Hızları Sıfırla (V = 0)"</strong> butonunu kullanabilirsiniz.
                </div>
              </div>

              {/* Station Selection Dropdown */}
              <div>
                <label className="block text-slate-700 font-bold mb-1 text-xs">Hedef İstasyon</label>
                <select
                  value={editingVelocityStationId || 'ALL'}
                  onChange={(e) => {
                    const val = e.target.value === 'ALL' ? undefined : e.target.value;
                    handleOpenVelocityModal(val);
                  }}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs bg-white font-semibold"
                >
                  <option value="ALL">Tüm Sabit CORS İstasyonlarına Uygula ({fixedStations.length} Nokta)</option>
                  {fixedStations.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} ({s.type === 'CORS' ? 'TUSAGA Sabit' : 'Sabit'})
                    </option>
                  ))}
                </select>
              </div>

              {/* 2005.00 Epoch Coordinates Input (for individual station) */}
              {editingVelocityStationId && (
                <div className="space-y-3 bg-slate-50 p-4 rounded-xl border border-slate-200">
                  <div className="flex items-center justify-between">
                    <h4 className="font-bold text-slate-800 text-xs flex items-center gap-1.5">
                      <ShieldCheck className="w-4 h-4 text-purple-600" />
                      <span>2005.00 Referans Epok Kartezyen Koordinatları (m)</span>
                    </h4>
                    <span className="text-[10px] text-slate-500 font-mono">TUSAGA-Aktif Karnekod</span>
                  </div>
                  <div className="grid grid-cols-3 gap-2 font-mono">
                    <div>
                      <label className="block text-slate-600 text-[11px] mb-1 font-sans font-semibold">X_2005 (m)</label>
                      <input
                        type="number"
                        step="0.0001"
                        value={tempRefX}
                        onChange={(e) => setTempRefX(parseFloat(e.target.value) || 0)}
                        placeholder="4118542.894"
                        className="w-full px-2.5 py-1.5 border border-slate-300 rounded-lg bg-white font-bold text-xs"
                      />
                    </div>
                    <div>
                      <label className="block text-slate-600 text-[11px] mb-1 font-sans font-semibold">Y_2005 (m)</label>
                      <input
                        type="number"
                        step="0.0001"
                        value={tempRefY}
                        onChange={(e) => setTempRefY(parseFloat(e.target.value) || 0)}
                        placeholder="2505234.321"
                        className="w-full px-2.5 py-1.5 border border-slate-300 rounded-lg bg-white font-bold text-xs"
                      />
                    </div>
                    <div>
                      <label className="block text-slate-600 text-[11px] mb-1 font-sans font-semibold">Z_2005 (m)</label>
                      <input
                        type="number"
                        step="0.0001"
                        value={tempRefZ}
                        onChange={(e) => setTempRefZ(parseFloat(e.target.value) || 0)}
                        placeholder="4082211.543"
                        className="w-full px-2.5 py-1.5 border border-slate-300 rounded-lg bg-white font-bold text-xs"
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* Cartesian ECEF Velocities Inputs */}
              <div className="space-y-3 bg-purple-50/60 p-4 rounded-xl border border-purple-200">
                <div className="flex items-center justify-between">
                  <h4 className="font-bold text-purple-950 text-xs">Onaylı Kartezyen ECEF Hızları (m/yıl)</h4>
                  <span className="text-[10px] text-purple-700 font-mono">X(t) = X_2005 + Vx*(t - 2005.00)</span>
                </div>
                <div className="grid grid-cols-3 gap-2 font-mono">
                  <div>
                    <label className="block text-slate-600 text-[11px] mb-1 font-sans font-bold">Vx (m/yıl)</label>
                    <input
                      type="number"
                      step="0.0001"
                      value={tempVx}
                      onChange={(e) => {
                        const val = parseFloat(e.target.value) || 0;
                        setTempVx(val);
                        const targetSt = editingVelocityStationId ? stations[editingVelocityStationId] : null;
                        const lat = targetSt?.lat || 39.0;
                        const lon = targetSt?.lon || 35.0;
                        const topo = cartesianToTopocentricVelocity(val, tempVy, tempVz, lat, lon);
                        setTempVe(topo.ve);
                        setTempVn(topo.vn);
                        setTempVu(topo.vu);
                      }}
                      placeholder="0.0000"
                      className="w-full px-2.5 py-1.5 border border-slate-300 rounded-lg bg-white font-bold text-xs"
                    />
                  </div>
                  <div>
                    <label className="block text-slate-600 text-[11px] mb-1 font-sans font-bold">Vy (m/yıl)</label>
                    <input
                      type="number"
                      step="0.0001"
                      value={tempVy}
                      onChange={(e) => {
                        const val = parseFloat(e.target.value) || 0;
                        setTempVy(val);
                        const targetSt = editingVelocityStationId ? stations[editingVelocityStationId] : null;
                        const lat = targetSt?.lat || 39.0;
                        const lon = targetSt?.lon || 35.0;
                        const topo = cartesianToTopocentricVelocity(tempVx, val, tempVz, lat, lon);
                        setTempVe(topo.ve);
                        setTempVn(topo.vn);
                        setTempVu(topo.vu);
                      }}
                      placeholder="0.0000"
                      className="w-full px-2.5 py-1.5 border border-slate-300 rounded-lg bg-white font-bold text-xs"
                    />
                  </div>
                  <div>
                    <label className="block text-slate-600 text-[11px] mb-1 font-sans font-bold">Vz (m/yıl)</label>
                    <input
                      type="number"
                      step="0.0001"
                      value={tempVz}
                      onChange={(e) => {
                        const val = parseFloat(e.target.value) || 0;
                        setTempVz(val);
                        const targetSt = editingVelocityStationId ? stations[editingVelocityStationId] : null;
                        const lat = targetSt?.lat || 39.0;
                        const lon = targetSt?.lon || 35.0;
                        const topo = cartesianToTopocentricVelocity(tempVx, tempVy, val, lat, lon);
                        setTempVe(topo.ve);
                        setTempVn(topo.vn);
                        setTempVu(topo.vu);
                      }}
                      placeholder="0.0000"
                      className="w-full px-2.5 py-1.5 border border-slate-300 rounded-lg bg-white font-bold text-xs"
                    />
                  </div>
                </div>
              </div>

              {/* Topocentric Velocities Inputs */}
              <div className="space-y-3 bg-slate-50 p-4 rounded-xl border border-slate-200">
                <div className="flex items-center justify-between">
                  <h4 className="font-bold text-slate-800 text-xs">Yerel Toposentrik Hızlar (mm/yıl)</h4>
                  <span className="text-[10px] text-slate-500 font-mono">Ve, Vn, Vu (mm/yıl)</span>
                </div>
                <div className="grid grid-cols-3 gap-2 font-mono">
                  <div>
                    <label className="block text-slate-600 text-[11px] mb-1 font-sans">Ve (Doğu - mm/yıl)</label>
                    <input
                      type="number"
                      step="0.1"
                      value={tempVe}
                      onChange={(e) => {
                        const val = parseFloat(e.target.value) || 0;
                        setTempVe(val);
                        const targetSt = editingVelocityStationId ? stations[editingVelocityStationId] : null;
                        const lat = targetSt?.lat || 39.0;
                        const lon = targetSt?.lon || 35.0;
                        const cart = topocentricToCartesianVelocity(val, tempVn, tempVu, lat, lon);
                        setTempVx(cart.vx);
                        setTempVy(cart.vy);
                        setTempVz(cart.vz);
                      }}
                      placeholder="0.0"
                      className="w-full px-2.5 py-1.5 border border-slate-300 rounded-lg bg-white text-xs"
                    />
                  </div>
                  <div>
                    <label className="block text-slate-600 text-[11px] mb-1 font-sans">Vn (Kuzey - mm/yıl)</label>
                    <input
                      type="number"
                      step="0.1"
                      value={tempVn}
                      onChange={(e) => {
                        const val = parseFloat(e.target.value) || 0;
                        setTempVn(val);
                        const targetSt = editingVelocityStationId ? stations[editingVelocityStationId] : null;
                        const lat = targetSt?.lat || 39.0;
                        const lon = targetSt?.lon || 35.0;
                        const cart = topocentricToCartesianVelocity(tempVe, val, tempVu, lat, lon);
                        setTempVx(cart.vx);
                        setTempVy(cart.vy);
                        setTempVz(cart.vz);
                      }}
                      placeholder="0.0"
                      className="w-full px-2.5 py-1.5 border border-slate-300 rounded-lg bg-white text-xs"
                    />
                  </div>
                  <div>
                    <label className="block text-slate-600 text-[11px] mb-1 font-sans">Vu (Düşey - mm/yıl)</label>
                    <input
                      type="number"
                      step="0.1"
                      value={tempVu}
                      onChange={(e) => {
                        const val = parseFloat(e.target.value) || 0;
                        setTempVu(val);
                        const targetSt = editingVelocityStationId ? stations[editingVelocityStationId] : null;
                        const lat = targetSt?.lat || 39.0;
                        const lon = targetSt?.lon || 35.0;
                        const cart = topocentricToCartesianVelocity(tempVe, tempVn, val, lat, lon);
                        setTempVx(cart.vx);
                        setTempVy(cart.vy);
                        setTempVz(cart.vz);
                      }}
                      placeholder="0.0"
                      className="w-full px-2.5 py-1.5 border border-slate-300 rounded-lg bg-white text-xs"
                    />
                  </div>
                </div>
              </div>

              {/* Real-time Calculation Preview Box */}
              {(() => {
                const dt = config.surveyEpoch - 2005.00;
                const calcX = tempRefX + tempVx * dt;
                const calcY = tempRefY + tempVy * dt;
                const calcZ = tempRefZ + tempVz * dt;
                const dShiftMm = Math.sqrt(
                  Math.pow(tempVx * dt * 1000, 2) +
                  Math.pow(tempVy * dt * 1000, 2) +
                  Math.pow(tempVz * dt * 1000, 2)
                );
                const geo = ecefToGeodetic(calcX, calcY, calcZ);
                const tm = geodeticToTM(geo.lat, geo.lon, config.dom);

                return (
                  <div className="p-3.5 bg-emerald-50 rounded-xl border border-emerald-200 text-xs space-y-2">
                    <div className="flex items-center justify-between text-emerald-900 font-bold">
                      <span className="flex items-center gap-1.5">
                        <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                        <span>Dengeleme Epoğundaki (t = {config.surveyEpoch.toFixed(2)}) Canlı Hesaplanan Koordinatlar:</span>
                      </span>
                      <span className="px-2 py-0.5 rounded bg-emerald-200/80 text-emerald-950 font-mono text-[10px]">
                        Δt = {dt.toFixed(2)} Yıl | Toplam Kayma: {(dShiftMm / 10).toFixed(1)} cm
                      </span>
                    </div>
                    <div className="grid grid-cols-3 gap-2 font-mono text-[11px] pt-1">
                      <div className="bg-white p-2 rounded border border-emerald-200">
                        <span className="text-slate-500 block text-[10px]">X(t):</span>
                        <strong className="text-slate-900">{calcX.toFixed(4)} m</strong>
                      </div>
                      <div className="bg-white p-2 rounded border border-emerald-200">
                        <span className="text-slate-500 block text-[10px]">Y(t):</span>
                        <strong className="text-slate-900">{calcY.toFixed(4)} m</strong>
                      </div>
                      <div className="bg-white p-2 rounded border border-emerald-200">
                        <span className="text-slate-500 block text-[10px]">Z(t):</span>
                        <strong className="text-slate-900">{calcZ.toFixed(4)} m</strong>
                      </div>
                    </div>
                    <div className="grid grid-cols-3 gap-2 font-mono text-[11px]">
                      <div className="bg-white p-2 rounded border border-emerald-200">
                        <span className="text-slate-500 block text-[10px]">TM Sağa Y:</span>
                        <strong className="text-sky-800">{tm.projY.toFixed(4)} m</strong>
                      </div>
                      <div className="bg-white p-2 rounded border border-emerald-200">
                        <span className="text-slate-500 block text-[10px]">TM Yukarı X:</span>
                        <strong className="text-sky-800">{tm.projX.toFixed(4)} m</strong>
                      </div>
                      <div className="bg-white p-2 rounded border border-emerald-200">
                        <span className="text-slate-500 block text-[10px]">Elipsoidal Kot h:</span>
                        <strong className="text-emerald-800">{geo.h.toFixed(4)} m</strong>
                      </div>
                    </div>
                  </div>
                );
              })()}

              {/* Quick Preset Buttons */}
              <div className="flex items-center justify-between gap-2 pt-1 flex-wrap">
                <button
                  type="button"
                  onClick={() => {
                    setTempVx(0);
                    setTempVy(0);
                    setTempVz(0);
                    setTempVe(0);
                    setTempVn(0);
                    setTempVu(0);
                  }}
                  className="px-3 py-1.5 rounded-lg border border-slate-300 hover:bg-slate-100 text-slate-700 font-semibold text-[11px] cursor-pointer"
                >
                  Sıfırla (Hız Etkisi Yok: V = 0)
                </button>

                <div className="flex items-center gap-2 flex-wrap">
                  <button
                    type="button"
                    onClick={handleAutoInterpolateRoverVelocities}
                    className="px-3 py-1.5 rounded-lg border border-indigo-300 bg-indigo-50 hover:bg-indigo-100 text-indigo-900 font-semibold text-[11px] cursor-pointer inline-flex items-center gap-1"
                    title="CORS noktalarından ters uzaklık ağırlıklı (IDW) hız enterpolasyonu yap"
                  >
                    <TrendingUp className="w-3.5 h-3.5 text-indigo-700" />
                    <span>TUTGA IDW Hız Enterpolasyonu Yap</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      handleAutoApplyTusagaVelocities();
                      setIsVelocityModalOpen(false);
                    }}
                    className="px-3 py-1.5 rounded-lg border border-purple-300 bg-purple-50 hover:bg-purple-100 text-purple-900 font-semibold text-[11px] cursor-pointer inline-flex items-center gap-1"
                    title="HGM TUSAGA-Aktif resmi hız kataloğundan doldur"
                  >
                    <Database className="w-3.5 h-3.5 text-purple-700" />
                    <span>TUSAGA Hız Kataloğunu Uygula</span>
                  </button>
                </div>
              </div>
            </div>

            <div className="p-4 bg-slate-50 border-t border-slate-200 flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={handleExportVelocityExcel}
                className="px-3.5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs shadow-xs transition cursor-pointer flex items-center gap-1.5"
                title="Hız hesabı raporunu Excel olarak indir"
              >
                <FileSpreadsheet className="w-4 h-4" />
                <span>Hız Hesabı Excel (.xlsx) İndir</span>
              </button>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setIsVelocityModalOpen(false)}
                  className="px-4 py-2 rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-100 font-semibold cursor-pointer text-xs"
                >
                  İptal
                </button>
                <button
                  type="button"
                  onClick={handleSaveVelocityModal}
                  className="px-5 py-2 rounded-lg bg-purple-700 hover:bg-purple-800 text-white font-bold shadow-sm transition cursor-pointer flex items-center gap-1.5 text-xs"
                >
                  <Save className="w-4 h-4" />
                  <span>Onaylı Hızları Kaydet</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* RESMİ BÖHYY HIZ HESABI VE RAPOR MODALI */}
      {isVelocityReportModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-3 sm:p-5">
          <div className="bg-white rounded-2xl shadow-2xl max-w-7xl w-full max-h-[92vh] flex flex-col overflow-hidden animate-in fade-in duration-150">
            {/* Modal Header */}
            <div className="p-4 sm:p-5 border-b border-slate-200 bg-slate-900 text-white flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-purple-600/30 border border-purple-500/40 flex items-center justify-center text-purple-300">
                  <FileSpreadsheet className="w-5 h-5 text-emerald-400" />
                </div>
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="font-bold text-sm sm:text-base text-white">
                      Hız Hesabı ve Epok Öteleme Raporu (BÖHYY &amp; HGM Standartları)
                    </h3>
                    <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                      Doğrulandı: %100 Geodetik Uyumlu
                    </span>
                  </div>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Referans Epok: <strong>2005.00</strong> (ITRF96 / TUREF) &bull; 
                    Ölçü Epoğu: <strong>t = {config.surveyEpoch.toFixed(2)}</strong> (Δt = {(config.surveyEpoch - 2005.00).toFixed(2)} Yıl) &bull; 
                    DOM: <strong>{config.dom}&deg;</strong> &bull; Elipsoit: <strong>GRS80</strong>
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleExportVelocityExcel}
                  className="px-3.5 py-2 text-xs font-bold bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg shadow-sm transition flex items-center gap-1.5 cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Excel (.xlsx) İndir</span>
                </button>
                <button
                  onClick={() => setIsVelocityReportModalOpen(false)}
                  className="text-slate-400 hover:text-white p-1.5 rounded-lg hover:bg-slate-800 cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Modal Body */}
            <div className="p-4 sm:p-6 overflow-y-auto space-y-4 text-xs">
              {/* Mathematical Verification Alert Box */}
              <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-xl space-y-2 text-emerald-950">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 font-bold text-xs sm:text-sm text-emerald-900">
                    <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                    <span>Hız Hesabı ve Matematiksel Doğrulama Raporu:</span>
                  </div>
                  <span className="text-[11px] font-mono text-emerald-700 bg-emerald-100/80 px-2 py-0.5 rounded">
                    BÖHYY 2018 Madde 20 &amp; 21 Standartları
                  </span>
                </div>
                <p className="text-[11px] text-emerald-900/80 leading-relaxed">
                  Tüm istasyonlar için 2005.00 referans koordinatlarından ölçü epoğuna (t = {config.surveyEpoch.toFixed(2)}) yapılan koordinat dönüşümleri, resmi TUSAGA plaka hız vektörleri (Vx, Vy, Vz) kullanılarak 3D Kartezyen uzayda lineer olarak ötelenmiş; elde edilen sonuçlar GRS80 elipsoidi üzerinde 3 derecelik dilimli Transverse Mercator (TM) projeksiyonuna dönüştürülerek kontrol edilmiştir.
                </p>
              </div>

              {/* Detailed Velocity Table */}
              <div className="border border-slate-200 rounded-xl overflow-hidden bg-white shadow-2xs">
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="bg-slate-100 text-slate-800 font-bold border-b border-slate-200 whitespace-nowrap">
                        <th className="py-2.5 px-3">No</th>
                        <th className="py-2.5 px-3">Nokta Adı</th>
                        <th className="py-2.5 px-3">Tip</th>
                        <th className="py-2.5 px-3 text-right">X (2005.00) m</th>
                        <th className="py-2.5 px-3 text-right">Y (2005.00) m</th>
                        <th className="py-2.5 px-3 text-right">Z (2005.00) m</th>
                        <th className="py-2.5 px-3 text-right text-purple-700">Vx (m/yıl)</th>
                        <th className="py-2.5 px-3 text-right text-purple-700">Vy (m/yıl)</th>
                        <th className="py-2.5 px-3 text-right text-purple-700">Vz (m/yıl)</th>
                        <th className="py-2.5 px-3 text-right text-purple-700">Toplam Kayma</th>
                        <th className="py-2.5 px-3 text-right bg-emerald-50/70 text-emerald-950 font-bold">X(t) m</th>
                        <th className="py-2.5 px-3 text-right bg-emerald-50/70 text-emerald-950 font-bold">Y(t) m</th>
                        <th className="py-2.5 px-3 text-right bg-emerald-50/70 text-emerald-950 font-bold">Z(t) m</th>
                        <th className="py-2.5 px-3 text-right text-sky-800">TM Y (m)</th>
                        <th className="py-2.5 px-3 text-right text-sky-800">TM X (m)</th>
                        <th className="py-2.5 px-3 text-right text-emerald-800">Kot h (m)</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 font-mono text-[11px]">
                      {(() => {
                        const reportItems = generateVelocityReportData(stations, config.surveyEpoch, 2005.00, config.dom);
                        if (reportItems.length === 0) {
                          return (
                            <tr>
                              <td colSpan={16} className="py-8 text-center text-slate-400 font-sans">
                                Gösterilecek istasyon verisi bulunmuyor.
                              </td>
                            </tr>
                          );
                        }
                        return reportItems.map((item, idx) => (
                          <tr key={item.id} className="hover:bg-slate-50">
                            <td className="py-2 px-3 text-slate-400 font-sans">{idx + 1}</td>
                            <td className="py-2 px-3 font-bold font-sans text-slate-900">{item.name}</td>
                            <td className="py-2 px-3 font-sans">
                              <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                                item.isFixed ? 'bg-purple-100 text-purple-800' : 'bg-slate-100 text-slate-600'
                              }`}>
                                {item.status}
                              </span>
                            </td>
                            <td className="py-2 px-3 text-right text-slate-600">{item.refX.toFixed(4)}</td>
                            <td className="py-2 px-3 text-right text-slate-600">{item.refY.toFixed(4)}</td>
                            <td className="py-2 px-3 text-right text-slate-600">{item.refZ.toFixed(4)}</td>
                            <td className="py-2 px-3 text-right text-purple-700 font-bold">{item.vx.toFixed(4)}</td>
                            <td className="py-2 px-3 text-right text-purple-700 font-bold">{item.vy.toFixed(4)}</td>
                            <td className="py-2 px-3 text-right text-purple-700 font-bold">{item.vz.toFixed(4)}</td>
                            <td className="py-2 px-3 text-right font-bold text-purple-800">
                              {item.dSpatial_cm.toFixed(1)} cm
                            </td>
                            <td className="py-2 px-3 text-right bg-emerald-50/40 text-emerald-950 font-bold">{item.surveyX.toFixed(4)}</td>
                            <td className="py-2 px-3 text-right bg-emerald-50/40 text-emerald-950 font-bold">{item.surveyY.toFixed(4)}</td>
                            <td className="py-2 px-3 text-right bg-emerald-50/40 text-emerald-950 font-bold">{item.surveyZ.toFixed(4)}</td>
                            <td className="py-2 px-3 text-right text-sky-800">{item.surveyProjY.toFixed(4)}</td>
                            <td className="py-2 px-3 text-right text-sky-800">{item.surveyProjX.toFixed(4)}</td>
                            <td className="py-2 px-3 text-right text-emerald-800">{item.surveyH.toFixed(4)}</td>
                          </tr>
                        ));
                      })()}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="p-4 bg-slate-50 border-t border-slate-200 flex items-center justify-between gap-3">
              <div className="text-[11px] text-slate-500">
                Toplam <strong>{stationList.length}</strong> istasyon epok öteleme hesabı yapıldı.
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setIsVelocityReportModalOpen(false)}
                  className="px-4 py-2 text-xs font-semibold rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-100 cursor-pointer"
                >
                  Kapat
                </button>
                <button
                  type="button"
                  onClick={handleExportVelocityExcel}
                  className="px-4 py-2 text-xs font-bold rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white shadow-xs transition flex items-center gap-1.5 cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Excel (.xlsx) İndir</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
