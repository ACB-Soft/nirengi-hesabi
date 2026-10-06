/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * Modül 6: Epok Kaydırma ve Hız Kestirim Motoru (GeoCalculator / Epok Transformatörü)
 * Topcon Tools & GeoCalculator entegre mimarisi:
 * 1) Ölçü Epoğu (t) ve Referans Epok (2005.00) Yönetimi
 * 2) Dayanak Nokta Koordinatlarını Ölçü Epoğuna Öteleme (2005.00 -> t)
 * 3) TUTGA Hız Kestirim Motoru (IDW Enterpolasyonu)
 * 4) Yeni Noktaları Arşiv Epoğuna Öteleme (t -> 2005.00) & Excel/TXT Çıktısı
 */

import React, { useState } from 'react';
import { Station, JobConfig, GeoCalcPoint, StationVelocities } from '../types/gnss';
import {
  propagateEpoch,
  ecefToGeodetic,
  geodeticToEcef,
  geodeticToTM,
  tmToGeodetic,
  estimateVelocitiesByTUTGA,
  shiftReferenceStationsToSurveyEpoch,
} from '../utils/geodesy';
import * as XLSX from 'xlsx';
import {
  Clock,
  ArrowRightLeft,
  Compass,
  Layers,
  Calculator,
  RotateCw,
  Check,
  TrendingUp,
  Sliders,
  CheckCircle2,
  Calendar,
  Info,
  ShieldCheck,
  Download,
  Zap,
  Activity,
  FileSpreadsheet,
  FileText,
} from 'lucide-react';

interface Props {
  stations: Record<string, Station>;
  config: JobConfig;
  onUpdateConfig?: (newConfig: JobConfig) => void;
  onUpdateAllStations?: (stations: Record<string, Station>) => void;
}

export const EpochGeoCalcTab: React.FC<Props> = ({
  stations,
  config,
  onUpdateConfig,
  onUpdateAllStations,
}) => {
  const stationList = Object.values(stations);
  const stationWithEpoch = stationList.find((s) => s.observationEpoch);

  const [activeSubTab, setActiveSubTab] = useState<'project' | 'velocity' | 'geocalc'>('project');
  const [feedbackMsg, setFeedbackMsg] = useState<string | null>(null);

  // GeoCalculator Interactive Single Point State
  const [calcMode, setCalcMode] = useState<'forward' | 'backward'>('forward'); // forward: t -> 2005.00, backward: 2005.00 -> t
  const [srcEpoch, setSrcEpoch] = useState<number>(config.surveyEpoch);
  const [targetEpoch, setTargetEpoch] = useState<number>(config.refEpoch);
  const [inputFormat, setInputFormat] = useState<'TM' | 'ECEF' | 'GEO'>('TM');

  // Input coordinate fields
  const [inputTM_Y, setInputTM_Y] = useState<number>(500000.0);
  const [inputTM_X, setInputTM_X] = useState<number>(4415000.0);
  const [inputH, setInputH] = useState<number>(950.0);

  const [inputECEF_X, setInputECEF_X] = useState<number>(4118542.124);
  const [inputECEF_Y, setInputECEF_Y] = useState<number>(2668412.512);
  const [inputECEF_Z, setInputECEF_Z] = useState<number>(4070241.621);

  // Velocity vectors (m/year)
  const [velVx, setVelVx] = useState<number>(-0.0161);
  const [velVy, setVelVy] = useState<number>(0.0235);
  const [velVz, setVelVz] = useState<number>(0.0089);

  // Synchronize when config changes externally (e.g. from RINEX header detection)
  React.useEffect(() => {
    setSrcEpoch(config.surveyEpoch);
    setTargetEpoch(config.refEpoch);
  }, [config.surveyEpoch, config.refEpoch]);

  const showFeedback = (msg: string) => {
    setFeedbackMsg(msg);
    setTimeout(() => setFeedbackMsg(null), 3500);
  };

  const handleUpdateSurveyEpoch = (val: number) => {
    if (onUpdateConfig) {
      onUpdateConfig({
        ...config,
        surveyEpoch: val,
      });
    }
    setSrcEpoch(val);
  };

  const handleUpdateRefEpoch = (val: number) => {
    if (onUpdateConfig) {
      onUpdateConfig({
        ...config,
        refEpoch: val,
      });
    }
    setTargetEpoch(val);
  };

  /**
   * Topcon Tools & GeoCalculator Adım 7:
   * Dayanak TUSAGA koordinatlarını 2005.00 referans epoğundan ölçü epoğuna (t) öteleme
   * Bu sayede Dayalı Dengeleme ölçü anındaki gerçek TUSAGA konumlarına oturur.
   */
  const handleShiftReferenceStations = () => {
    if (stationList.length === 0) {
      showFeedback('Ağda henüz nokta bulunmuyor.');
      return;
    }
    const updated = shiftReferenceStationsToSurveyEpoch(stations, config.surveyEpoch, config.refEpoch);
    if (onUpdateAllStations) {
      onUpdateAllStations(updated);
    }
    showFeedback(`TUSAGA sabit noktaları ölçü epoğuna (${config.surveyEpoch.toFixed(2)}) başarıyla ötelendi.`);
  };

  /**
   * GeoCalculator Adım 9:
   * TUTGA Hız Kestirim Motoru (IDW Enterpolasyonu)
   * Referans TUTGA/TUSAGA hızlarını kullanarak yeni noktaların tektonik hızlarını kestirir.
   */
  const handleEstimateVelocities = () => {
    if (stationList.length === 0) {
      showFeedback('Hız kestirimi için ağda nokta bulunmalıdır.');
      return;
    }
    const estimated = estimateVelocitiesByTUTGA(stations);
    const updated: Record<string, Station> = {};

    let estimatedCount = 0;
    for (const id in stations) {
      const st = stations[id];
      const v = estimated[id] || st.velocities;
      if (!st.isFixed.x) estimatedCount++;
      updated[id] = {
        ...st,
        velocities: v,
      };
    }

    if (onUpdateAllStations) {
      onUpdateAllStations(updated);
    }
    showFeedback(`${estimatedCount} adet yeni proje noktasının tektonik hızları TUTGA enterpolasyonuyla başarıyla kestirildi.`);
  };

  // Export Epoch Shifted Coordinates to Excel (.xlsx)
  const handleExportEpochExcel = () => {
    if (stationList.length === 0) return;

    const rows = stationList.map((st) => {
      const shifted = propagateEpoch(st, config.surveyEpoch, config.refEpoch, config.dom);
      return {
        'Nokta No': st.name,
        'Nokta Tipi': st.type === 'CORS' ? 'TUSAGA/CORS' : 'Arazi/Proje',
        'Ölçü Epoğu (t)': config.surveyEpoch.toFixed(3),
        'Referans Epok': config.refEpoch.toFixed(2),
        'Ölçü TM Y (m)': Number(st.projY.toFixed(3)),
        'Ölçü TM X (m)': Number(st.projX.toFixed(3)),
        'Ölçü Elip. H (m)': Number(st.h.toFixed(3)),
        'Ölçü ECEF X (m)': Number(st.x.toFixed(3)),
        'Ölçü ECEF Y (m)': Number(st.y.toFixed(3)),
        'Ölçü ECEF Z (m)': Number(st.z.toFixed(3)),
        'Vx (m/yıl)': Number(st.velocities.vx.toFixed(4)),
        'Vy (m/yıl)': Number(st.velocities.vy.toFixed(4)),
        'Vz (m/yıl)': Number(st.velocities.vz.toFixed(4)),
        '2005.00 TM Y (m)': Number(shifted.dstProjY.toFixed(3)),
        '2005.00 TM X (m)': Number(shifted.dstProjX.toFixed(3)),
        '2005.00 Elip. H (m)': Number(shifted.dstH.toFixed(3)),
        '2005.00 ECEF X (m)': Number(shifted.dstX.toFixed(3)),
        '2005.00 ECEF Y (m)': Number(shifted.dstY.toFixed(3)),
        '2005.00 ECEF Z (m)': Number(shifted.dstZ.toFixed(3)),
        '3D Kayma (mm)': Number(shifted.dSpatial.toFixed(1)),
      };
    });

    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Epok_Kaydirma_2005');
    XLSX.writeFile(wb, `${config.projectName}_Epok_Kaydirma_2005.xlsx`);
  };

  // Export TXT
  const handleExportEpochTxt = () => {
    if (stationList.length === 0) return;

    let content = `# T.C. HGM & BÖHYY STANDARTLARINDA EPOK KAYDIRMA KOORDİNAT LİSTESİ\n`;
    content += `# Proje: ${config.projectName}\n`;
    content += `# Ölçü Epoğu: ${config.surveyEpoch.toFixed(3)} | Referans Epoğu: ${config.refEpoch.toFixed(2)}\n`;
    content += `# Projeksiyon: ${config.crsSystem} (DOM: ${config.dom}°) | Elipsoit: GRS80\n`;
    content += `# Nokta_No        Ölçü_Y(m)        Ölçü_X(m)       2005_Y(m)        2005_X(m)       2005_H(m)    3D_Fark(mm)\n`;
    content += `# ----------------------------------------------------------------------------------------------------------\n`;

    stationList.forEach((st) => {
      const shifted = propagateEpoch(st, config.surveyEpoch, config.refEpoch, config.dom);
      content += `${st.name.padEnd(14)} ${st.projY.toFixed(3).padStart(12)} ${st.projX.toFixed(3).padStart(12)} ${shifted.dstProjY.toFixed(3).padStart(12)} ${shifted.dstProjX.toFixed(3).padStart(12)} ${shifted.dstH.toFixed(3).padStart(10)} ${shifted.dSpatial.toFixed(1).padStart(10)}\n`;
    });

    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${config.projectName}_Epok_2005.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Compute GeoCalculator transformation
  let curECEF = { x: inputECEF_X, y: inputECEF_Y, z: inputECEF_Z };
  if (inputFormat === 'TM') {
    const geo = tmToGeodetic(inputTM_Y, inputTM_X, config.dom);
    const ec = geodeticToEcef(geo.lat, geo.lon, inputH);
    curECEF = ec;
  }

  const dt = targetEpoch - srcEpoch;
  const dstECEF_X = curECEF.x + velVx * dt;
  const dstECEF_Y = curECEF.y + velVy * dt;
  const dstECEF_Z = curECEF.z + velVz * dt;

  const srcGeo = ecefToGeodetic(curECEF.x, curECEF.y, curECEF.z);
  const srcTM = geodeticToTM(srcGeo.lat, srcGeo.lon, config.dom);

  const dstGeo = ecefToGeodetic(dstECEF_X, dstECEF_Y, dstECEF_Z);
  const dstTM = geodeticToTM(dstGeo.lat, dstGeo.lon, config.dom);

  const dX_mm = (dstECEF_X - curECEF.x) * 1000.0;
  const dY_mm = (dstECEF_Y - curECEF.y) * 1000.0;
  const dZ_mm = (dstECEF_Z - curECEF.z) * 1000.0;
  const dSpatial_mm = Math.sqrt(dX_mm * dX_mm + dY_mm * dY_mm + dZ_mm * dZ_mm);

  const applyVelocityPreset = (region: string) => {
    if (region === 'ankara') {
      setVelVx(-0.0162);
      setVelVy(0.0234);
      setVelVz(0.0089);
    } else if (region === 'aegean') {
      setVelVx(-0.0225);
      setVelVy(0.0298);
      setVelVz(0.0065);
    } else if (region === 'marmara') {
      setVelVx(-0.0195);
      setVelVy(0.0182);
      setVelVz(0.0092);
    } else if (region === 'eastern') {
      setVelVx(-0.0085);
      setVelVy(0.0112);
      setVelVz(0.0125);
    }
  };

  const projectDeltaYears = config.refEpoch - config.surveyEpoch;

  return (
    <div className="space-y-6">
      {/* Overview Banner */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base font-bold text-slate-900">
                Topcon Tools & GeoCalculator Entegre Epok & Hız Kestirim Motoru
              </h2>
            </div>
            <p className="text-xs text-slate-500 mt-1 leading-relaxed">
              Topcon Tools ve GeoCalculator iş akışına tam uyumlu: Dayanak noktalarının ölçü epoğuna ötelemesi, 
              TUTGA tabanlı otomatik hız kestirimi (Adım 9) ve yeni noktaların 2005.00 Arşiv Epoğuna taşınması (Adım 10).
            </p>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <span className="px-3.5 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs font-mono font-bold text-slate-800">
              Ref Epok: {config.refEpoch.toFixed(2)} ↔ Ölçü: {config.surveyEpoch.toFixed(2)} (Δt: {projectDeltaYears.toFixed(2)} yıl)
            </span>
          </div>
        </div>

        {feedbackMsg && (
          <div className="mt-3 p-2.5 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-lg text-xs flex items-center justify-between">
            <div className="flex items-center gap-1.5 font-medium">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
              <span>{feedbackMsg}</span>
            </div>
            <button
              onClick={() => setFeedbackMsg(null)}
              className="text-emerald-700 hover:text-emerald-950 font-bold ml-2 cursor-pointer"
            >
              ×
            </button>
          </div>
        )}
      </div>

      {/* Navigation Sub-Tabs */}
      <div className="flex gap-2 border-b border-slate-200 pb-2 text-xs font-semibold">
        <button
          onClick={() => setActiveSubTab('project')}
          className={`px-3.5 py-2 rounded-lg cursor-pointer transition flex items-center gap-1.5 ${
            activeSubTab === 'project'
              ? 'bg-sky-600 text-white shadow-xs'
              : 'bg-white text-slate-600 hover:bg-slate-100 border border-slate-200'
          }`}
        >
          <Clock className="w-3.5 h-3.5" />
          <span>1. Proje Epok Yönetimi & 2005.00 Arşiv Ötelemesi</span>
        </button>

        <button
          onClick={() => setActiveSubTab('velocity')}
          className={`px-3.5 py-2 rounded-lg cursor-pointer transition flex items-center gap-1.5 ${
            activeSubTab === 'velocity'
              ? 'bg-sky-600 text-white shadow-xs'
              : 'bg-white text-slate-600 hover:bg-slate-100 border border-slate-200'
          }`}
        >
          <Activity className="w-3.5 h-3.5 text-emerald-500" />
          <span>2. TUTGA Hız Kestirim Motoru (Adım 9)</span>
        </button>

        <button
          onClick={() => setActiveSubTab('geocalc')}
          className={`px-3.5 py-2 rounded-lg cursor-pointer transition flex items-center gap-1.5 ${
            activeSubTab === 'geocalc'
              ? 'bg-sky-600 text-white shadow-xs'
              : 'bg-white text-slate-600 hover:bg-slate-100 border border-slate-200'
          }`}
        >
          <Calculator className="w-3.5 h-3.5 text-indigo-500" />
          <span>3. Tekil GeoCalculator Transformatörü</span>
        </button>
      </div>

      {/* ========================================================================= */}
      {/* 1. PROJE EPOK YÖNETİMİ & AĞ KOORDİNATLARI (Adım 7 & Adım 10) */}
      {/* ========================================================================= */}
      {activeSubTab === 'project' && (
        <div className="space-y-5">
          {/* Top Control Panel */}
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2">
                <Clock className="w-4 h-4 text-sky-600" />
                <h3 className="text-sm font-bold text-slate-900">
                  Proje Epok Parametreleri (HGM & Kadastro Standartları)
                </h3>
              </div>
              {stationWithEpoch && (
                <span className="bg-emerald-50 text-emerald-800 border border-emerald-200 text-[11px] font-semibold px-2.5 py-1 rounded-full flex items-center gap-1.5">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                  <span>RINEX'ten Otomatik Tespit Edildi: {stationWithEpoch.observationDateStr || `t = ${stationWithEpoch.observationEpoch}`}</span>
                </span>
              )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
              {/* Ölçü Epoğu (t) */}
              <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-xl space-y-2">
                <div className="flex items-center justify-between">
                  <label className="font-bold text-slate-800 flex items-center gap-1.5">
                    <Calendar className="w-3.5 h-3.5 text-sky-600" />
                    <span>Ölçü Epoğu (t)</span>
                  </label>
                  <span className="text-[10px] text-slate-500 font-mono">Arazi Ölçüm Anı</span>
                </div>
                <input
                  type="number"
                  step="0.001"
                  value={config.surveyEpoch}
                  onChange={(e) => handleUpdateSurveyEpoch(parseFloat(e.target.value) || 2024.45)}
                  className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg font-mono font-bold text-slate-900 text-sm shadow-2xs"
                />
                <p className="text-[11px] text-slate-500 leading-relaxed">
                  Yüklenen RINEX başlığından tespit edilen anlık ölçü zamanı.
                </p>
              </div>

              {/* Referans Epoğu (2005.00) */}
              <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-xl space-y-2">
                <div className="flex items-center justify-between">
                  <label className="font-bold text-slate-800 flex items-center gap-1.5">
                    <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
                    <span>Referans Epoğu (t_ref)</span>
                  </label>
                  <span className="text-[10px] text-emerald-700 font-bold bg-emerald-100/60 px-1.5 py-0.5 rounded">
                    2005.00 HGM
                  </span>
                </div>
                <input
                  type="number"
                  step="0.01"
                  value={config.refEpoch}
                  onChange={(e) => handleUpdateRefEpoch(parseFloat(e.target.value) || 2005.0)}
                  className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg font-mono font-bold text-emerald-900 text-sm shadow-2xs"
                />
                <p className="text-[11px] text-slate-500 leading-relaxed">
                  BÖHYY mevzuatında kadastro tesciline esas resmi koordinatlar.
                </p>
              </div>

              {/* GeoCalculator Adım 7: Dayanak Öteleme Butonu */}
              <div className="p-3.5 bg-sky-50/70 border border-sky-200 rounded-xl space-y-2 flex flex-col justify-between">
                <div>
                  <div className="font-bold text-sky-900 flex items-center gap-1.5">
                    <Zap className="w-3.5 h-3.5 text-amber-500" />
                    <span>Dayanak Noktalarını Ötele (Adım 7)</span>
                  </div>
                  <p className="text-[11px] text-sky-800 mt-1 leading-relaxed">
                    TUSAGA 2005.00 koordinatlarını ölçü epoğuna ($t$) öteleyerek Dayalı Dengeleme öncesi hazır hale getirir.
                  </p>
                </div>
                <button
                  onClick={handleShiftReferenceStations}
                  className="w-full py-2 bg-sky-600 hover:bg-sky-700 text-white font-bold rounded-lg shadow-2xs transition cursor-pointer text-xs flex items-center justify-center gap-1.5"
                >
                  <ArrowRightLeft className="w-3.5 h-3.5" />
                  <span>TUSAGA'yı Ölçü Epoğuna ({config.surveyEpoch.toFixed(2)}) Ötele</span>
                </button>
              </div>
            </div>
          </div>

          {/* Project Stations Epoch Shift Table */}
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-3">
              <div>
                <h3 className="text-sm font-bold text-slate-900">
                  Tüm Ağ Noktaları 2005.00 Referans Epoğu Dönüşüm Tablosu (Adım 10)
                </h3>
                <p className="text-xs text-slate-500">
                  Ölçü epoğu ($t = {config.surveyEpoch.toFixed(2)}$) koordinatları ve 2005.00 Arşiv Epoğu karşılıkları
                </p>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={handleExportEpochExcel}
                  disabled={stationList.length === 0}
                  className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-lg shadow-2xs transition cursor-pointer flex items-center gap-1.5 text-xs disabled:opacity-50"
                  title="Excel Formatında İndir (.xlsx)"
                >
                  <FileSpreadsheet className="w-3.5 h-3.5" />
                  <span>Excel (.xlsx)</span>
                </button>
                <button
                  onClick={handleExportEpochTxt}
                  disabled={stationList.length === 0}
                  className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-white font-bold rounded-lg shadow-2xs transition cursor-pointer flex items-center gap-1.5 text-xs disabled:opacity-50"
                  title="TXT Formatında İndir (.txt)"
                >
                  <FileText className="w-3.5 h-3.5" />
                  <span>TXT</span>
                </button>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-slate-50 text-slate-700 font-semibold border-b border-slate-200">
                    <th className="py-2.5 px-3">Nokta</th>
                    <th className="py-2.5 px-3">Tip</th>
                    <th className="py-2.5 px-3 text-right">Ölçü TM Y (m)</th>
                    <th className="py-2.5 px-3 text-right">Ölçü TM X (m)</th>
                    <th className="py-2.5 px-3 text-right">Hız (Vx / Vy) mm/yıl</th>
                    <th className="py-2.5 px-3 text-right">2005.00 TM Y (m)</th>
                    <th className="py-2.5 px-3 text-right">2005.00 TM X (m)</th>
                    <th className="py-2.5 px-3 text-right">2005.00 Elip H (m)</th>
                    <th className="py-2.5 px-3 text-right">3D Fark (mm)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 font-mono">
                  {stationList.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="py-8 text-center text-slate-400 font-sans">
                        Ağda henüz nokta bulunmuyor. "2. Noktalar & ANTEX" sekmesinden RINEX verisi yükleyiniz.
                      </td>
                    </tr>
                  ) : (
                    stationList.map((st) => {
                      const shifted = propagateEpoch(st, config.surveyEpoch, config.refEpoch, config.dom);
                      const isFixed = st.isFixed.x;

                      return (
                        <tr key={st.id} className="hover:bg-slate-50">
                          <td className="py-2 px-3 font-sans font-bold text-slate-900">
                            <div>{st.name}</div>
                            {st.observationDateStr && (
                              <div className="text-[10px] text-slate-400 font-mono font-normal">
                                {st.observationDateStr}
                              </div>
                            )}
                          </td>
                          <td className="py-2 px-3 font-sans">
                            <span
                              className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                                isFixed ? 'bg-rose-100 text-rose-800' : 'bg-sky-100 text-sky-800'
                              }`}
                            >
                              {isFixed ? 'TUSAGA' : 'PROJE'}
                            </span>
                          </td>
                          <td className="py-2 px-3 text-right text-slate-600">{st.projY.toFixed(3)}</td>
                          <td className="py-2 px-3 text-right text-slate-600">{st.projX.toFixed(3)}</td>
                          <td className="py-2 px-3 text-right text-slate-500 text-[11px]">
                            {(st.velocities.vx * 1000).toFixed(1)} / {(st.velocities.vy * 1000).toFixed(1)}
                          </td>
                          <td className="py-2 px-3 text-right font-bold text-emerald-800">
                            {shifted.dstProjY.toFixed(3)}
                          </td>
                          <td className="py-2 px-3 text-right font-bold text-emerald-800">
                            {shifted.dstProjX.toFixed(3)}
                          </td>
                          <td className="py-2 px-3 text-right text-slate-700">
                            {shifted.dstH.toFixed(3)}
                          </td>
                          <td className="py-2 px-3 text-right font-bold text-slate-900">
                            {shifted.dSpatial.toFixed(1)}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* 2. TUTGA HIZ KESTİRİM MOTORU (GeoCalculator Adım 9) */}
      {/* ========================================================================= */}
      {activeSubTab === 'velocity' && (
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-3">
            <div>
              <div className="flex items-center gap-2">
                <Activity className="w-4 h-4 text-emerald-600" />
                <h3 className="text-sm font-bold text-slate-900">
                  GeoCalculator TUTGA Hız Kestirim Motoru (Enterpolasyon Analizi)
                </h3>
              </div>
              <p className="text-xs text-slate-500 mt-0.5">
                Ağdaki referans TUSAGA/TUTGA istasyonlarının hızlarını kullanarak yeni proje noktalarının tektonik hızlarını kestirir.
              </p>
            </div>

            <button
              onClick={handleEstimateVelocities}
              disabled={stationList.length === 0}
              className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-lg shadow-sm transition cursor-pointer flex items-center gap-1.5 text-xs disabled:opacity-50"
            >
              <Zap className="w-3.5 h-3.5" />
              <span>İşaretli Noktaların Hızlarını Kestir (Adım 9)</span>
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
            <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg space-y-1">
              <span className="font-bold text-slate-800">Referans TUTGA Noktaları:</span>
              <p className="text-slate-600">
                Ağda tanımlı sabit TUSAGA/TUTGA istasyonlarının hız vektörleri enterpolasyon düğüm noktası olarak alınır.
              </p>
            </div>
            <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg space-y-1">
              <span className="font-bold text-slate-800">Enterpolasyon Algoritması:</span>
              <p className="text-slate-600">
                Ters Mesafe Ağırlıklı (IDW, $w_i = 1/d_i^2$) afin plaka tektoniği hız kestirim formülü.
              </p>
            </div>
            <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-lg space-y-1">
              <span className="font-bold text-emerald-900">Sonuç Entegrasyonu:</span>
              <p className="text-emerald-800">
                Kestirilen hızlar otomatik olarak istasyon özniteliklerine yazılır ve 2005.00 arşiv ötelemesine aktarılır.
              </p>
            </div>
          </div>

          {/* Table of Stations and their Velocity status */}
          <div className="overflow-x-auto pt-2">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-slate-50 text-slate-700 font-semibold border-b border-slate-200">
                  <th className="py-2.5 px-3">Nokta</th>
                  <th className="py-2.5 px-3">Nokta Durumu</th>
                  <th className="py-2.5 px-3 text-right">Vx (mm/yıl)</th>
                  <th className="py-2.5 px-3 text-right">Vy (mm/yıl)</th>
                  <th className="py-2.5 px-3 text-right">Vz (mm/yıl)</th>
                  <th className="py-2.5 px-3 text-right">Yıllık Yatay Hız (mm/yıl)</th>
                  <th className="py-2.5 px-3 text-center">Hız Kaynağı</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-mono">
                {stationList.map((st) => {
                  const isRef = st.isFixed.x || st.type === 'CORS';
                  const horizontalV = Math.sqrt(st.velocities.vx ** 2 + st.velocities.vy ** 2) * 1000;

                  return (
                    <tr key={st.id} className="hover:bg-slate-50">
                      <td className="py-2 px-3 font-sans font-bold text-slate-900">{st.name}</td>
                      <td className="py-2 px-3 font-sans">
                        <span
                          className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                            isRef ? 'bg-rose-100 text-rose-800' : 'bg-sky-100 text-sky-800'
                          }`}
                        >
                          {isRef ? 'Sabit TUTGA/TUSAGA' : 'Proje Noktası'}
                        </span>
                      </td>
                      <td className="py-2 px-3 text-right">{(st.velocities.vx * 1000).toFixed(2)}</td>
                      <td className="py-2 px-3 text-right">{(st.velocities.vy * 1000).toFixed(2)}</td>
                      <td className="py-2 px-3 text-right">{(st.velocities.vz * 1000).toFixed(2)}</td>
                      <td className="py-2 px-3 text-right font-bold text-sky-800">
                        {horizontalV.toFixed(2)} mm/yıl
                      </td>
                      <td className="py-2 px-3 text-center font-sans">
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                            isRef ? 'bg-slate-100 text-slate-700' : 'bg-emerald-100 text-emerald-800'
                          }`}
                        >
                          {isRef ? 'TUSAGA Tescilli' : 'TUTGA Enterpolasyonu'}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* 3. TEKİL GEOCALCULATOR TRANSFORMATÖRÜ */}
      {/* ========================================================================= */}
      {activeSubTab === 'geocalc' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Left Column: Interactive GeoCalculator */}
          <div className="lg:col-span-6 bg-white rounded-xl shadow-sm border border-slate-200 p-5 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2">
                <Calculator className="w-4 h-4 text-sky-600" />
                <h3 className="text-sm font-bold text-slate-900">Tekil Koordinat Transformatörü</h3>
              </div>
              <div className="flex gap-1 text-xs">
                <button
                  onClick={() => setInputFormat('TM')}
                  className={`px-2 py-1 rounded font-bold cursor-pointer transition ${
                    inputFormat === 'TM' ? 'bg-sky-600 text-white' : 'bg-slate-100 text-slate-600'
                  }`}
                >
                  TUREF TM
                </button>
                <button
                  onClick={() => setInputFormat('ECEF')}
                  className={`px-2 py-1 rounded font-bold cursor-pointer transition ${
                    inputFormat === 'ECEF' ? 'bg-sky-600 text-white' : 'bg-slate-100 text-slate-600'
                  }`}
                >
                  ECEF XYZ
                </button>
              </div>
            </div>

            {/* Direction Toggle */}
            <div className="flex items-center justify-between bg-slate-50 p-2.5 rounded-lg border border-slate-200 text-xs">
              <div className="font-semibold text-slate-700">Dönüşüm Yönü:</div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    setCalcMode('forward');
                    setSrcEpoch(config.surveyEpoch);
                    setTargetEpoch(config.refEpoch);
                  }}
                  className={`px-2.5 py-1 rounded font-semibold cursor-pointer transition ${
                    calcMode === 'forward'
                      ? 'bg-sky-600 text-white shadow-xs'
                      : 'bg-white text-slate-700 border border-slate-200'
                  }`}
                >
                  Ölçü Epoğu (t) → 2005.00
                </button>
                <button
                  onClick={() => {
                    setCalcMode('backward');
                    setSrcEpoch(config.refEpoch);
                    setTargetEpoch(config.surveyEpoch);
                  }}
                  className={`px-2.5 py-1 rounded font-semibold cursor-pointer transition ${
                    calcMode === 'backward'
                      ? 'bg-sky-600 text-white shadow-xs'
                      : 'bg-white text-slate-700 border border-slate-200'
                  }`}
                >
                  2005.00 → Ölçü Epoğu (t)
                </button>
              </div>
            </div>

            {/* Epoch Inputs in Calculator */}
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div>
                <label className="block text-slate-600 font-medium mb-1">Kaynak Epok (t_src)</label>
                <input
                  type="number"
                  step="0.01"
                  value={srcEpoch}
                  onChange={(e) => setSrcEpoch(parseFloat(e.target.value) || 0)}
                  className="w-full px-2 py-1.5 border border-slate-300 rounded font-mono font-bold text-slate-900"
                />
              </div>
              <div>
                <label className="block text-slate-600 font-medium mb-1">Hedef Epok (t_dst)</label>
                <input
                  type="number"
                  step="0.01"
                  value={targetEpoch}
                  onChange={(e) => setTargetEpoch(parseFloat(e.target.value) || 0)}
                  className="w-full px-2 py-1.5 border border-slate-300 rounded font-mono font-bold text-slate-900"
                />
              </div>
            </div>

            {/* Coordinate Inputs */}
            {inputFormat === 'TM' ? (
              <div className="grid grid-cols-3 gap-2 text-xs">
                <div>
                  <label className="block text-slate-600 font-medium mb-1">TM Sağa Y (m)</label>
                  <input
                    type="number"
                    step="0.001"
                    value={inputTM_Y}
                    onChange={(e) => setInputTM_Y(parseFloat(e.target.value) || 0)}
                    className="w-full px-2 py-1.5 border border-slate-300 rounded font-mono font-bold text-slate-900"
                  />
                </div>
                <div>
                  <label className="block text-slate-600 font-medium mb-1">TM Yukarı X (m)</label>
                  <input
                    type="number"
                    step="0.001"
                    value={inputTM_X}
                    onChange={(e) => setInputTM_X(parseFloat(e.target.value) || 0)}
                    className="w-full px-2 py-1.5 border border-slate-300 rounded font-mono font-bold text-slate-900"
                  />
                </div>
                <div>
                  <label className="block text-slate-600 font-medium mb-1">Elipsoit H (m)</label>
                  <input
                    type="number"
                    step="0.001"
                    value={inputH}
                    onChange={(e) => setInputH(parseFloat(e.target.value) || 0)}
                    className="w-full px-2 py-1.5 border border-slate-300 rounded font-mono font-bold text-slate-900"
                  />
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-3 gap-2 text-xs">
                <div>
                  <label className="block text-slate-600 font-medium mb-1">ECEF X (m)</label>
                  <input
                    type="number"
                    step="0.001"
                    value={inputECEF_X}
                    onChange={(e) => setInputECEF_X(parseFloat(e.target.value) || 0)}
                    className="w-full px-2 py-1.5 border border-slate-300 rounded font-mono text-slate-900"
                  />
                </div>
                <div>
                  <label className="block text-slate-600 font-medium mb-1">ECEF Y (m)</label>
                  <input
                    type="number"
                    step="0.001"
                    value={inputECEF_Y}
                    onChange={(e) => setInputECEF_Y(parseFloat(e.target.value) || 0)}
                    className="w-full px-2 py-1.5 border border-slate-300 rounded font-mono text-slate-900"
                  />
                </div>
                <div>
                  <label className="block text-slate-600 font-medium mb-1">ECEF Z (m)</label>
                  <input
                    type="number"
                    step="0.001"
                    value={inputECEF_Z}
                    onChange={(e) => setInputECEF_Z(parseFloat(e.target.value) || 0)}
                    className="w-full px-2 py-1.5 border border-slate-300 rounded font-mono text-slate-900"
                  />
                </div>
              </div>
            )}

            {/* Regional Velocity Presets */}
            <div className="space-y-1.5 text-xs">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-slate-700">TUTGA Bölgesel Tektonik Hız Ön-ayarları:</span>
              </div>
              <div className="grid grid-cols-4 gap-1.5 text-[11px]">
                <button
                  onClick={() => applyVelocityPreset('ankara')}
                  className="p-1.5 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded text-slate-700 font-semibold cursor-pointer text-center"
                >
                  İç Anadolu
                </button>
                <button
                  onClick={() => applyVelocityPreset('marmara')}
                  className="p-1.5 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded text-slate-700 font-semibold cursor-pointer text-center"
                >
                  Marmara
                </button>
                <button
                  onClick={() => applyVelocityPreset('aegean')}
                  className="p-1.5 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded text-slate-700 font-semibold cursor-pointer text-center"
                >
                  Ege
                </button>
                <button
                  onClick={() => applyVelocityPreset('eastern')}
                  className="p-1.5 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded text-slate-700 font-semibold cursor-pointer text-center"
                >
                  Doğu Anadolu
                </button>
              </div>
            </div>

            {/* Velocity Vectors (m/year) */}
            <div className="grid grid-cols-3 gap-2 text-xs">
              <div>
                <label className="block text-slate-600 font-medium mb-1">Vx (m/yıl)</label>
                <input
                  type="number"
                  step="0.0001"
                  value={velVx}
                  onChange={(e) => setVelVx(parseFloat(e.target.value) || 0)}
                  className="w-full px-2 py-1.5 border border-slate-300 rounded font-mono text-slate-800"
                />
              </div>
              <div>
                <label className="block text-slate-600 font-medium mb-1">Vy (m/yıl)</label>
                <input
                  type="number"
                  step="0.0001"
                  value={velVy}
                  onChange={(e) => setVelVy(parseFloat(e.target.value) || 0)}
                  className="w-full px-2 py-1.5 border border-slate-300 rounded font-mono text-slate-800"
                />
              </div>
              <div>
                <label className="block text-slate-600 font-medium mb-1">Vz (m/yıl)</label>
                <input
                  type="number"
                  step="0.0001"
                  value={velVz}
                  onChange={(e) => setVelVz(parseFloat(e.target.value) || 0)}
                  className="w-full px-2 py-1.5 border border-slate-300 rounded font-mono text-slate-800"
                />
              </div>
            </div>

            {/* Calculated Output Card */}
            <div className="bg-slate-900 text-white rounded-xl p-4 space-y-3 font-mono text-xs shadow-inner">
              <div className="flex justify-between items-center border-b border-slate-800 pb-2">
                <span className="font-bold text-sky-400">Hedef Epok ({targetEpoch.toFixed(2)}) Sonucu:</span>
                <span className="text-slate-400 font-sans text-[11px]">
                  3D Kayma: <strong className="text-white">{dSpatial_mm.toFixed(1)} mm</strong>
                </span>
              </div>
              <div className="grid grid-cols-2 gap-2 text-[11px]">
                <div>
                  <span className="text-slate-400">TM Y: </span>
                  <span className="text-white font-bold">{dstTM.projY.toFixed(3)} m</span>
                </div>
                <div>
                  <span className="text-slate-400">TM X: </span>
                  <span className="text-white font-bold">{dstTM.projX.toFixed(3)} m</span>
                </div>
                <div>
                  <span className="text-slate-400">Enlem: </span>
                  <span className="text-white">{dstGeo.lat.toFixed(7)}°</span>
                </div>
                <div>
                  <span className="text-slate-400">Boylam: </span>
                  <span className="text-white">{dstGeo.lon.toFixed(7)}°</span>
                </div>
              </div>
              <div className="pt-2 border-t border-slate-800 text-[10px] text-slate-400 flex justify-between">
                <span>dX: {dX_mm.toFixed(1)} mm</span>
                <span>dY: {dY_mm.toFixed(1)} mm</span>
                <span>dZ: {dZ_mm.toFixed(1)} mm</span>
              </div>
            </div>
          </div>

          {/* Right Column: Theory & Guidance */}
          <div className="lg:col-span-6 bg-white rounded-xl shadow-sm border border-slate-200 p-5 space-y-4 text-xs">
            <div className="flex items-center gap-2 border-b border-slate-100 pb-3">
              <Info className="w-4 h-4 text-sky-600" />
              <h3 className="text-sm font-bold text-slate-900">GeoCalculator Epok Kaydırma İlkeleri</h3>
            </div>
            <div className="space-y-3 text-slate-600 leading-relaxed">
              <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg">
                <span className="font-bold text-slate-800 block mb-1">1. TUSAGA Koordinatlarının Ölçü Epoğuna Ötelenmesi:</span>
                TUSAGA-Aktif koordinatları 2005.00 epoğundadır. Ancak arazideki ölçüm farklı bir tarihte yapıldığından 
                dayalı dengelemede yerel sabitler ölçü epoğuna ötelenerek dayanak koordinatları ölçü anındaki gerçek yerine getirilir.
              </div>
              <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg">
                <span className="font-bold text-slate-800 block mb-1">2. Yeni Noktaların 2005.00 Epoğuna Dönüşümü:</span>
                Dengeleme tamamlandıktan sonra proje noktalarının ölçü epoğu koordinatları, kestirilen hızlarla 2005.00 Arşiv Epoğuna taşınarak 
                resmi onaylı koordinat özet çizelgesi (Kadastro/BÖHYY) hazırlanır.
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
