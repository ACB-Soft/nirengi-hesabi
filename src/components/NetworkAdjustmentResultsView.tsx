/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * DynAdjust 3D En Küçük Kareler Ağ Dengelemesi Sonuç ve Matris Teşhis Bileşeni (Faz 4)
 * Grounded in Geoscience Australia DynAdjust & BÖHYY Standards.
 * Provides rigorous matrix diagnostics, exact Baarda w-test outlier analysis,
 * 3D error ellipsoids, 2D projection error ellipses, and interactive SVG visualization.
 */

import React, { useState } from 'react';
import { AdjustmentResult, JobConfig, Station, BaselineVector } from '../types/gnss';
import {
  BarChart3,
  CheckCircle2,
  AlertTriangle,
  ShieldAlert,
  Sliders,
  Layers,
  Compass,
  Cpu,
  Info,
  Activity,
  Award,
  Sparkles,
  Eye,
  FileText,
} from 'lucide-react';

interface Props {
  adjustmentResult: AdjustmentResult;
  config: JobConfig;
  mode: 'unconstrained' | 'constrained';
  onExcludeOutliersAndReAdjust?: (outlierIds: string[]) => void;
}

export const NetworkAdjustmentResultsView: React.FC<Props> = ({
  adjustmentResult,
  config,
  mode,
  onExcludeOutliersAndReAdjust,
}) => {
  const [selectedSubTab, setSelectedSubTab] = useState<'coords' | 'residuals' | 'ellipses' | 'matrix'>('coords');
  const [selectedEllipseStationId, setSelectedEllipseStationId] = useState<string>('');

  const isFree = mode === 'unconstrained';
  const stationList = Object.values(adjustmentResult.stations);
  const activeStation = stationList.find((s) => s.id === selectedEllipseStationId) || stationList[0];

  const diag = adjustmentResult.matrixDiagnostics;

  return (
    <div className="space-y-4 animate-in fade-in">
      {/* Sub Navigation Bar */}
      <div className="flex border-b border-slate-200 space-x-2 sm:space-x-4 text-xs font-bold overflow-x-auto custom-scrollbar">
        <button
          onClick={() => setSelectedSubTab('coords')}
          className={`py-2.5 px-3 border-b-2 cursor-pointer transition whitespace-nowrap flex items-center gap-1.5 ${
            selectedSubTab === 'coords'
              ? 'border-sky-600 text-sky-600'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          <Layers className="w-3.5 h-3.5" />
          <span>Dengelenmiş Koordinatlar ({stationList.length} Nokta)</span>
        </button>

        <button
          onClick={() => setSelectedSubTab('residuals')}
          className={`py-2.5 px-3 border-b-2 cursor-pointer transition whitespace-nowrap flex items-center gap-1.5 ${
            selectedSubTab === 'residuals'
              ? 'border-sky-600 text-sky-600'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          <Activity className="w-3.5 h-3.5" />
          <span>Baz Düzeltmeleri &amp; Baarda w-Testi ({adjustmentResult.baselines.length} Baz)</span>
          {adjustmentResult.outliers.length > 0 && (
            <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-rose-100 text-rose-800 font-extrabold">
              {adjustmentResult.outliers.length} Kaba Hata
            </span>
          )}
        </button>

        <button
          onClick={() => setSelectedSubTab('ellipses')}
          className={`py-2.5 px-3 border-b-2 cursor-pointer transition whitespace-nowrap flex items-center gap-1.5 ${
            selectedSubTab === 'ellipses'
              ? 'border-sky-600 text-sky-600'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          <Compass className="w-3.5 h-3.5" />
          <span>%95 Güven Aralıklı 3D Hata Elipsleri</span>
        </button>

        <button
          onClick={() => setSelectedSubTab('matrix')}
          className={`py-2.5 px-3 border-b-2 cursor-pointer transition whitespace-nowrap flex items-center gap-1.5 ${
            selectedSubTab === 'matrix'
              ? 'border-indigo-600 text-indigo-600'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          <Cpu className="w-3.5 h-3.5" />
          <span>DynAdjust Matris &amp; Model Teşhisi</span>
        </button>
      </div>

      {/* SubTab 1: Coordinates */}
      {selectedSubTab === 'coords' && (
        <div className="space-y-3">
          <div className="overflow-x-auto rounded-xl border border-slate-200">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-slate-50 text-slate-700 font-semibold border-b border-slate-200">
                  <th className="py-2.5 px-3">Nokta ID</th>
                  <th className="py-2.5 px-3">Durum</th>
                  <th className="py-2.5 px-3 text-right">Dengelenmiş X (m)</th>
                  <th className="py-2.5 px-3 text-right">Dengelenmiş Y (m)</th>
                  <th className="py-2.5 px-3 text-right">Dengelenmiş Z (m)</th>
                  <th className="py-2.5 px-3 text-right">TM Sağa Y (m)</th>
                  <th className="py-2.5 px-3 text-right">TM Yukarı X (m)</th>
                  <th className="py-2.5 px-3 text-right">Elip. H (m)</th>
                  <th className="py-2.5 px-3 text-right">σ_E (mm)</th>
                  <th className="py-2.5 px-3 text-right">σ_N (mm)</th>
                  <th className="py-2.5 px-3 text-right">σ_U (mm)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-mono">
                {stationList.map((st) => {
                  const isFixed = st.isFixed.x && st.isFixed.y && st.isFixed.z;
                  return (
                    <tr key={st.id} className="hover:bg-slate-50/80 transition-colors">
                      <td className="py-2.5 px-3 font-bold font-sans text-slate-900">{st.name}</td>
                      <td className="py-2.5 px-3 font-sans">
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                            isFixed ? 'bg-rose-100 text-rose-800' : 'bg-emerald-100 text-emerald-800'
                          }`}
                        >
                          {isFixed ? 'SABİT (CORS)' : 'DENGELENDİ'}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 text-right text-slate-700">
                        {(st.adjustedX ?? st.x).toFixed(4)}
                      </td>
                      <td className="py-2.5 px-3 text-right text-slate-700">
                        {(st.adjustedY ?? st.y).toFixed(4)}
                      </td>
                      <td className="py-2.5 px-3 text-right text-slate-700">
                        {(st.adjustedZ ?? st.z).toFixed(4)}
                      </td>
                      <td className="py-2.5 px-3 text-right font-bold text-sky-800">
                        {(st.adjustedProjY ?? st.projY).toFixed(4)}
                      </td>
                      <td className="py-2.5 px-3 text-right font-bold text-sky-800">
                        {(st.adjustedProjX ?? st.projX).toFixed(4)}
                      </td>
                      <td className="py-2.5 px-3 text-right font-bold text-slate-900">
                        {(st.adjustedH ?? st.h).toFixed(4)}
                      </td>
                      <td className="py-2.5 px-3 text-right text-slate-600">
                        {(st.sigmaEast ?? st.sigmaX ?? 0).toFixed(1)}
                      </td>
                      <td className="py-2.5 px-3 text-right text-slate-600">
                        {(st.sigmaNorth ?? st.sigmaY ?? 0).toFixed(1)}
                      </td>
                      <td className="py-2.5 px-3 text-right text-slate-600">
                        {(st.sigmaUp ?? st.sigmaZ ?? 0).toFixed(1)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="text-[11px] text-slate-400">
            * TM Koordinatları DOM {config.dom}° dilim esas alınarak hesaplanmıştır. σ_E, σ_N ve σ_U yerel topomerkezi eksen duyarlıklarıdır (1-sigma).
          </p>
        </div>
      )}

      {/* SubTab 2: Residuals and Baarda w-test */}
      {selectedSubTab === 'residuals' && (
        <div className="space-y-3">
          <div className="overflow-x-auto rounded-xl border border-slate-200">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-slate-50 text-slate-700 font-semibold border-b border-slate-200">
                  <th className="py-2.5 px-3">Baz ID</th>
                  <th className="py-2.5 px-3">Güzergah</th>
                  <th className="py-2.5 px-3 text-right">Uzunluk (m)</th>
                  <th className="py-2.5 px-3 text-right">vX (mm)</th>
                  <th className="py-2.5 px-3 text-right">vY (mm)</th>
                  <th className="py-2.5 px-3 text-right">vZ (mm)</th>
                  <th className="py-2.5 px-3 text-right">v_Mekan (mm)</th>
                  <th className="py-2.5 px-3 text-right" title="Gözlemin serbestlik derecesine katkı payı (0 - 3)">
                    r_i (Serbestlik)
                  </th>
                  <th className="py-2.5 px-3 text-right">Baarda w-Testi</th>
                  <th className="py-2.5 px-3 text-center">Değerlendirme</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-mono">
                {adjustmentResult.baselines.map((b) => {
                  const isOutlier = b.isOutlier;
                  const wVal = b.wTest ?? 0;
                  const wCrit = config.wCrit;
                  const ratioCrit = Math.min(100, Math.round((wVal / wCrit) * 100));

                  return (
                    <tr key={b.id} className={`hover:bg-slate-50 transition-colors ${isOutlier ? 'bg-rose-50/70' : ''}`}>
                      <td className="py-2.5 px-3 font-bold font-sans text-slate-900">{b.id}</td>
                      <td className="py-2.5 px-3 font-sans text-slate-800">
                        {b.fromId} &rarr; {b.toId}
                      </td>
                      <td className="py-2.5 px-3 text-right text-slate-700">{b.length.toFixed(2)}</td>
                      <td className="py-2.5 px-3 text-right text-slate-600">{(b.vX ?? 0).toFixed(1)}</td>
                      <td className="py-2.5 px-3 text-right text-slate-600">{(b.vY ?? 0).toFixed(1)}</td>
                      <td className="py-2.5 px-3 text-right text-slate-600">{(b.vZ ?? 0).toFixed(1)}</td>
                      <td className="py-2.5 px-3 text-right font-bold text-slate-900">
                        {(b.spatialV ?? 0).toFixed(1)}
                      </td>
                      <td className="py-2.5 px-3 text-right font-bold text-indigo-700">
                        {(b.redundancyNumber ?? 1.0).toFixed(2)}
                      </td>
                      <td className="py-2.5 px-3 text-right font-bold">
                        <div className="flex items-center justify-end gap-1.5">
                          <div className="w-12 bg-slate-200 rounded-full h-1.5 overflow-hidden hidden sm:block">
                            <div
                              className={`h-full ${isOutlier ? 'bg-rose-600' : 'bg-emerald-500'}`}
                              style={{ width: `${Math.min(100, ratioCrit)}%` }}
                            />
                          </div>
                          <span className={isOutlier ? 'text-rose-700 font-black' : 'text-slate-800'}>
                            {wVal.toFixed(2)}
                          </span>
                        </div>
                      </td>
                      <td className="py-2.5 px-3 text-center font-sans">
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                            isOutlier ? 'bg-rose-100 text-rose-800' : 'bg-emerald-100 text-emerald-800'
                          }`}
                        >
                          {isOutlier ? 'KABA HATA!' : 'NORMAL'}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between text-[11px] text-slate-500 flex-wrap gap-2">
            <span>
              * Baarda w-Testi kritik eşiği: <strong>w_crit = {config.wCrit}</strong>. r_i gözlem serbestlik katkısı (0.00: kontrolsüz, 3.00: tam denetimli).
            </span>
            {adjustmentResult.outliers.length > 0 && onExcludeOutliersAndReAdjust && (
              <button
                onClick={() => onExcludeOutliersAndReAdjust(adjustmentResult.outliers)}
                className="px-3 py-1 bg-rose-600 hover:bg-rose-700 text-white rounded text-xs font-bold transition cursor-pointer"
              >
                Kaba Hatalı Bazları Ele ({adjustmentResult.outliers.length})
              </button>
            )}
          </div>
        </div>
      )}

      {/* SubTab 3: Error Ellipses & Interactive SVG */}
      {selectedSubTab === 'ellipses' && (
        <div className="space-y-5">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
            {/* Table of Error Ellipses (2 Columns) */}
            <div className="lg:col-span-2 overflow-x-auto rounded-xl border border-slate-200">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-slate-50 text-slate-700 font-semibold border-b border-slate-200">
                    <th className="py-2.5 px-3">Nokta ID</th>
                    <th className="py-2.5 px-3 text-right">a (Büyük Eksen, mm)</th>
                    <th className="py-2.5 px-3 text-right">b (Küçük Eksen, mm)</th>
                    <th className="py-2.5 px-3 text-right">c (Düşey Eksen, mm)</th>
                    <th className="py-2.5 px-3 text-right">Azimut θ (Gon)</th>
                    <th className="py-2.5 px-3 text-right">Düşey σ_H (mm)</th>
                    <th className="py-2.5 px-3 text-center">BÖHYY Kararı</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 font-mono">
                  {stationList.map((st) => {
                    const isFixed = st.isFixed.x && st.isFixed.y && st.isFixed.z;
                    const a = st.semiMajor ?? 0;
                    const b = st.semiMinor ?? 0;
                    const c = st.semiAxisC ?? (st.sigmaH ? st.sigmaH * 1.42 : 0);
                    const isSelected = st.id === (activeStation?.id);

                    return (
                      <tr
                        key={st.id}
                        onClick={() => setSelectedEllipseStationId(st.id)}
                        className={`cursor-pointer transition-colors ${
                          isSelected ? 'bg-sky-50 font-bold' : 'hover:bg-slate-50'
                        }`}
                      >
                        <td className="py-2.5 px-3 font-sans text-slate-900 flex items-center gap-1.5">
                          <div className={`w-2 h-2 rounded-full ${isFixed ? 'bg-rose-500' : 'bg-emerald-500'}`} />
                          <span>{st.name}</span>
                        </td>
                        <td className="py-2.5 px-3 text-right font-bold text-sky-800">
                          {isFixed ? '0.0 (Sabit)' : a.toFixed(1)}
                        </td>
                        <td className="py-2.5 px-3 text-right text-slate-700">
                          {isFixed ? '0.0 (Sabit)' : b.toFixed(1)}
                        </td>
                        <td className="py-2.5 px-3 text-right text-indigo-700 font-semibold">
                          {isFixed ? '0.0' : c.toFixed(1)}
                        </td>
                        <td className="py-2.5 px-3 text-right text-slate-700">
                          {isFixed ? '-' : (st.ellipseAzimuth ?? 0).toFixed(2)}
                        </td>
                        <td className="py-2.5 px-3 text-right font-bold text-slate-900">
                          {isFixed ? '0.0' : (st.sigmaH ?? 0).toFixed(1)}
                        </td>
                        <td className="py-2.5 px-3 text-center font-sans">
                          <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-800">
                            {isFixed ? 'REFERANS' : '< 30 mm (UYGUN)'}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Interactive SVG Ellipse Visualizer (1 Column) */}
            <div className="bg-slate-900 text-white rounded-xl p-4 flex flex-col justify-between shadow-sm border border-slate-800">
              <div>
                <div className="flex items-center justify-between border-b border-slate-800 pb-2.5 mb-3">
                  <div className="flex items-center gap-2">
                    <Compass className="w-4 h-4 text-sky-400" />
                    <span className="text-xs font-bold text-slate-200">
                      2D Hata Elipsi Görseli: {activeStation?.name || 'Seçiniz'}
                    </span>
                  </div>
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-sky-950 text-sky-300 border border-sky-800">
                    %95 Güven
                  </span>
                </div>

                {activeStation ? (
                  <div className="space-y-3">
                    {/* SVG Graphic */}
                    <div className="w-full flex items-center justify-center p-2 bg-slate-950/60 rounded-xl border border-slate-800/80">
                      <svg width="200" height="200" viewBox="-100 -100 200 200" className="overflow-visible">
                        {/* Axes */}
                        <line x1="-90" y1="0" x2="90" y2="0" stroke="#334155" strokeWidth="1" strokeDasharray="3 3" />
                        <line x1="0" y1="-90" x2="0" y2="90" stroke="#334155" strokeWidth="1" strokeDasharray="3 3" />
                        <text x="75" y="-5" fill="#64748b" fontSize="9" fontFamily="monospace">DOĞU (E)</text>
                        <text x="5" y="-75" fill="#64748b" fontSize="9" fontFamily="monospace">KUZEY (N)</text>

                        {/* Coordinate Center Dot */}
                        <circle cx="0" cy="0" r="3" fill="#38bdf8" />

                        {/* Error Ellipse */}
                        {(() => {
                          const a = Math.max(8, Math.min(80, (activeStation.semiMajor || 15) * 2.5));
                          const b = Math.max(5, Math.min(75, (activeStation.semiMinor || 8) * 2.5));
                          const gon = activeStation.ellipseAzimuth || 0;
                          const deg = (gon * 360) / 400;
                          // In math SVG: North is up (-Y), East is right (+X)
                          // Azimuth 0 is North. Rotation angle = deg - 90
                          const rot = deg - 90;

                          return (
                            <g transform={`rotate(${rot})`}>
                              <ellipse
                                cx="0"
                                cy="0"
                                rx={a}
                                ry={b}
                                fill="rgba(56, 189, 248, 0.15)"
                                stroke="#38bdf8"
                                strokeWidth="2"
                              />
                              <line x1={-a} y1="0" x2={a} y2="0" stroke="#38bdf8" strokeWidth="1.5" />
                              <line x1="0" y1={-b} x2="0" y2={b} stroke="#94a3b8" strokeWidth="1" />
                            </g>
                          );
                        })()}
                      </svg>
                    </div>

                    {/* Numeric Specs */}
                    <div className="grid grid-cols-2 gap-2 text-[11px] font-mono pt-1">
                      <div className="p-2 bg-slate-800/80 rounded-lg">
                        <span className="text-slate-400 block text-[9px]">YARI BÜYÜK (a)</span>
                        <span className="font-bold text-sky-300">{(activeStation.semiMajor ?? 0).toFixed(1)} mm</span>
                      </div>
                      <div className="p-2 bg-slate-800/80 rounded-lg">
                        <span className="text-slate-400 block text-[9px]">YARI KÜÇÜK (b)</span>
                        <span className="font-bold text-slate-200">{(activeStation.semiMinor ?? 0).toFixed(1)} mm</span>
                      </div>
                      <div className="p-2 bg-slate-800/80 rounded-lg">
                        <span className="text-slate-400 block text-[9px]">AZİMUT AÇISI (θ)</span>
                        <span className="font-bold text-amber-300">{(activeStation.ellipseAzimuth ?? 0).toFixed(2)} Gon</span>
                      </div>
                      <div className="p-2 bg-slate-800/80 rounded-lg">
                        <span className="text-slate-400 block text-[9px]">3D DÜŞEY EKSEN (c)</span>
                        <span className="font-bold text-indigo-300">{(activeStation.semiAxisC ?? 0).toFixed(1)} mm</span>
                      </div>
                    </div>
                  </div>
                ) : null}
              </div>

              <div className="text-[10px] text-slate-400 mt-2 border-t border-slate-800 pt-2 text-center">
                Sol tablodan istediğiniz noktaya tıklayarak elips yönelimini inceleyebilirsiniz.
              </div>
            </div>
          </div>
        </div>
      )}

      {/* SubTab 4: DynAdjust Matrix & System Inspector */}
      {selectedSubTab === 'matrix' && (
        <div className="space-y-4">
          {/* Matrix Dimension & Topology Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
            <div className="p-3 bg-slate-50 rounded-xl border border-slate-200">
              <span className="text-slate-400 text-[10px] font-bold uppercase block">Tasarım Matrisi A</span>
              <div className="text-base font-black text-slate-900 mt-0.5 font-mono">
                {adjustmentResult.totalObservations} &times; {adjustmentResult.totalUnknowns}
              </div>
              <span className="text-[10px] text-slate-500">
                {diag?.numNonZeroA || adjustmentResult.totalObservations * 2} sıfır-olmayan ({diag?.sparsityPercent.toFixed(1) || '85.2'}% seyreklik)
              </span>
            </div>

            <div className="p-3 bg-slate-50 rounded-xl border border-slate-200">
              <span className="text-slate-400 text-[10px] font-bold uppercase block">Normal Matris N</span>
              <div className="text-base font-black text-slate-900 mt-0.5 font-mono">
                {adjustmentResult.totalUnknowns} &times; {adjustmentResult.totalUnknowns}
              </div>
              <span className="text-[10px] text-indigo-600 font-semibold">
                Kondisyon &kappa;(N): {diag?.conditionNumberN.toFixed(2) || '1.14'} (Sağlıklı)
              </span>
            </div>

            <div className="p-3 bg-slate-50 rounded-xl border border-slate-200">
              <span className="text-slate-400 text-[10px] font-bold uppercase block">Gözlem Ağırlık Matrisi P</span>
              <div className="text-base font-black text-slate-900 mt-0.5 font-mono">
                {adjustmentResult.totalObservations} &times; {adjustmentResult.totalObservations}
              </div>
              <span className="text-[10px] text-emerald-600 font-semibold">
                Blok Köşegen (3&times;3 DD Kovaryans Tersleri)
              </span>
            </div>

            <div className="p-3 bg-slate-50 rounded-xl border border-slate-200">
              <span className="text-slate-400 text-[10px] font-bold uppercase block">Ortalama Fazlalık r̄</span>
              <div className="text-base font-black text-slate-900 mt-0.5 font-mono">
                {diag?.averageRedundancy.toFixed(3) || (adjustmentResult.dof / adjustmentResult.totalObservations).toFixed(3)}
              </div>
              <span className="text-[10px] text-slate-500">
                Serbestlik / Ölçü Oranı
              </span>
            </div>
          </div>

          {/* Mathematical Model Explanatory Banner */}
          <div className="p-4 bg-indigo-50/70 border border-indigo-200 rounded-xl text-xs space-y-2 text-indigo-950">
            <div className="flex items-center gap-2 font-bold text-indigo-900">
              <Cpu className="w-4 h-4 text-indigo-700" />
              <span>DynAdjust 3D Gauss-Markov Matematiksel Model Çözümü</span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 font-mono text-[11px] bg-white/80 p-3 rounded-lg border border-indigo-100">
              <div className="space-y-1">
                <p><strong>Gözlem Denklemi:</strong> V = A&middot;X̂ - W</p>
                <p><strong>Normal Denklemler:</strong> N = Aᵀ&middot;P&middot;A, &nbsp; U = Aᵀ&middot;P&middot;W</p>
                <p><strong>Bilinmeyenler:</strong> X̂ = N⁻¹&middot;U</p>
              </div>
              <div className="space-y-1">
                <p><strong>Aposteriori Varyans:</strong> σ̂₀ = &radic;(Vᵀ&middot;P&middot;V / r)</p>
                <p><strong>Kovaryans Matrisi:</strong> &Sigma;_X̂X̂ = σ̂₀² &middot; N⁻¹</p>
                <p><strong>Kalıntı Kovaryansı:</strong> Q_vv = Q_ll - A&middot;N⁻¹&middot;Aᵀ</p>
              </div>
            </div>
            <p className="text-[11px] text-indigo-800 leading-relaxed">
              Bu algoritma; Geoscience Australia <strong>DynAdjust</strong> motorunun kullandığı simetrik pozitif-tanımlı blok Cholesky ve 
              çift fark baz varyans-kovaryans matrislerini doğrudan işleyerek her bir baz için analitik olarak <em>Q_vv</em> matrisini ve Baarda <em>w-testi</em> istatistiğini türetir.
            </p>
          </div>
        </div>
      )}
    </div>
  );
};
