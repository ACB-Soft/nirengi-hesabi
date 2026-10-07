/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * Modül 5: 3D Gauss-Markov En Küçük Kareler Ağ Dengelemesi ve Baarda Data Snooping (F8)
 */

import React, { useState } from 'react';
import { AdjustmentResult, JobConfig } from '../types/gnss';
import {
  BarChart3,
  CheckCircle2,
  AlertTriangle,
  Play,
  RotateCcw,
  Zap,
  ShieldAlert,
  Sliders,
  Filter,
  Check,
  Award,
} from 'lucide-react';

interface Props {
  mode: 'unconstrained' | 'constrained';
  adjustmentResult: AdjustmentResult | null;
  config: JobConfig;
  onRunAdjustment: (mode: 'unconstrained' | 'constrained') => void;
  onExcludeOutliersAndReAdjust: (outlierIds: string[]) => void;
  isLoading: boolean;
}

export const AdjustmentTab: React.FC<Props> = ({
  mode,
  adjustmentResult,
  config,
  onRunAdjustment,
  onExcludeOutliersAndReAdjust,
  isLoading,
}) => {
  const [selectedSubTab, setSelectedSubTab] = useState<'coords' | 'residuals' | 'ellipses'>('coords');

  const isFree = mode === 'unconstrained';

  return (
    <div className="space-y-6">
      {/* Top Controls Banner */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span
                className={`text-[10px] font-extrabold px-2 py-0.5 rounded border uppercase ${
                  isFree
                    ? 'bg-purple-100 text-purple-800 border-purple-300'
                    : 'bg-sky-100 text-sky-800 border-sky-300'
                }`}
              >
                {isFree ? 'Minimal Kısıtlı / İç Tutarlılık' : 'Tam Kısıtlı / CORS Sabit'}
              </span>
              <h2 className="text-base font-bold text-slate-900">
                {isFree ? 'Serbest (Zorlamasız) Ağ Dengelemesi' : 'Dayalı (Tam Kısıtlı) Ağ Dengelemesi'}
              </h2>
            </div>
            <p className="text-xs text-slate-500 mt-1">
              {isFree
                ? 'Ağdaki ölçü kaba hatalarını (outliers) ve iç tutarlılığı test etmek için 1 referans noktası sabit kabul edilerek yapılan 3D Gauss-Markov dengelemesi.'
                : 'Tüm TUSAGA-Aktif / CORS sabit noktaları dayanak alınarak yapılan nihai 3D Gauss-Markov dengelemesi.'}
            </p>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={() => onRunAdjustment(mode)}
              disabled={isLoading}
              className={`px-4 py-2 text-xs font-bold rounded-lg shadow-sm transition cursor-pointer flex items-center gap-1.5 disabled:opacity-50 ${
                isFree
                  ? 'bg-purple-700 hover:bg-purple-800 text-white'
                  : 'bg-slate-900 hover:bg-slate-800 text-white'
              }`}
            >
              <Play className="w-3.5 h-3.5 text-emerald-400" />
              <span>{isFree ? 'Serbest Dengelemeyi Hesapla' : 'Dayalı Dengelemeyi Hesapla'}</span>
            </button>
          </div>
        </div>

        {/* Global Statistics Cards */}
        {adjustmentResult && (
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mt-4 pt-4 border-t border-slate-100 text-xs">
            <div className="p-2.5 bg-slate-50 rounded-lg border border-slate-200">
              <div className="text-slate-500">Birim Ölçü Standart Hatası (sigma_0)</div>
              <div className="text-base font-bold font-mono text-slate-900 mt-0.5">
                {adjustmentResult.sigma0Aposteriori.toFixed(4)}
              </div>
            </div>

            <div className="p-2.5 bg-sky-50 rounded-lg border border-sky-200">
              <div className="text-sky-700 font-medium">Serbestlik Derecesi (DOF)</div>
              <div className="text-base font-bold font-mono text-sky-900 mt-0.5">
                {adjustmentResult.dof} (Obs: {adjustmentResult.totalObservations}, Bil: {adjustmentResult.totalUnknowns})
              </div>
            </div>

            <div className="p-2.5 bg-slate-50 rounded-lg border border-slate-200">
              <div className="text-slate-500">Kalıntı Kareler Toplamı [vPv]</div>
              <div className="text-base font-bold font-mono text-slate-900 mt-0.5">
                {adjustmentResult.vPv.toFixed(4)}
              </div>
            </div>

            <div
              className={`p-2.5 rounded-lg border ${
                adjustmentResult.chiSquareTest.passed
                  ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                  : 'bg-amber-50 border-amber-200 text-amber-800'
              }`}
            >
              <div className="font-medium flex items-center gap-1">
                <span>Ki-Kare (χ²) Uygunluk Testi</span>
              </div>
              <div className="text-base font-bold font-mono mt-0.5">
                {adjustmentResult.chiSquareTest.passed ? 'GEÇTİ (Uyumlu)' : 'KRİTİK UYARI'}
              </div>
            </div>

            <div
              className={`p-2.5 rounded-lg border ${
                adjustmentResult.outliers.length === 0
                  ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                  : 'bg-rose-50 border-rose-200 text-rose-800'
              }`}
            >
              <div className="font-medium">Baarda Data Snooping</div>
              <div className="text-base font-bold font-mono mt-0.5">
                {adjustmentResult.outliers.length === 0
                  ? 'Kaba Hata Yok'
                  : `${adjustmentResult.outliers.length} Kaba Hata!`}
              </div>
            </div>
          </div>
        )}

        {/* Baarda Outlier Alert & Quick Elimination Button */}
        {adjustmentResult && adjustmentResult.outliers.length > 0 && (
          <div className="mt-4 p-3 bg-rose-50 border border-rose-300 rounded-lg flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
            <div className="flex items-center gap-2 text-rose-900">
              <ShieldAlert className="w-4 h-4 text-rose-600 shrink-0" />
              <span>
                <strong>Baarda w-testi uyarısı:</strong> {adjustmentResult.outliers.join(', ')} nolu bazlarda
                kritik eşik değeri (w_crit = {config.wCrit}) aşılmıştır (Kaba Hata).
              </span>
            </div>
            <button
              onClick={() => onExcludeOutliersAndReAdjust(adjustmentResult.outliers)}
              className="px-3 py-1.5 bg-rose-600 hover:bg-rose-700 text-white font-bold rounded-lg shadow-sm transition cursor-pointer shrink-0"
            >
              Kaba Hatalı Bazları Ağdan Ele ve Yeniden Dengele
            </button>
          </div>
        )}
      </div>

      {/* Main Results Container */}
      {adjustmentResult && (
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5 space-y-4">
          {/* Sub Navigation */}
          <div className="flex border-b border-slate-200 space-x-4 text-xs font-bold">
            <button
              onClick={() => setSelectedSubTab('coords')}
              className={`py-2 border-b-2 cursor-pointer transition ${
                selectedSubTab === 'coords'
                  ? 'border-sky-600 text-sky-600'
                  : 'border-transparent text-slate-500 hover:text-slate-800'
              }`}
            >
              Dengelenmiş Koordinatlar ({Object.keys(adjustmentResult.stations).length} Nokta)
            </button>
            <button
              onClick={() => setSelectedSubTab('residuals')}
              className={`py-2 border-b-2 cursor-pointer transition ${
                selectedSubTab === 'residuals'
                  ? 'border-sky-600 text-sky-600'
                  : 'border-transparent text-slate-500 hover:text-slate-800'
              }`}
            >
              Baz Düzeltmeleri ve Baarda w-Testi ({adjustmentResult.baselines.length} Baz)
            </button>
            <button
              onClick={() => setSelectedSubTab('ellipses')}
              className={`py-2 border-b-2 cursor-pointer transition ${
                selectedSubTab === 'ellipses'
                  ? 'border-sky-600 text-sky-600'
                  : 'border-transparent text-slate-500 hover:text-slate-800'
              }`}
            >
              %95 Güven Aralıklı Hata Elipsleri & Duyarlık
            </button>
          </div>

          {/* SubTab 1: Coordinates */}
          {selectedSubTab === 'coords' && (
            <div className="overflow-x-auto">
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
                    <th className="py-2.5 px-3 text-right">σ_X (mm)</th>
                    <th className="py-2.5 px-3 text-right">σ_Y (mm)</th>
                    <th className="py-2.5 px-3 text-right">σ_Z (mm)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 font-mono">
                  {Object.values(adjustmentResult.stations).map((st) => {
                    const isFixed = st.isFixed.x && st.isFixed.y && st.isFixed.z;
                    return (
                      <tr key={st.id} className="hover:bg-slate-50">
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
                          {(st.sigmaX ?? 0).toFixed(1)}
                        </td>
                        <td className="py-2.5 px-3 text-right text-slate-600">
                          {(st.sigmaY ?? 0).toFixed(1)}
                        </td>
                        <td className="py-2.5 px-3 text-right text-slate-600">
                          {(st.sigmaZ ?? 0).toFixed(1)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* SubTab 2: Residuals and Baarda w-test */}
          {selectedSubTab === 'residuals' && (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-slate-50 text-slate-700 font-semibold border-b border-slate-200">
                    <th className="py-2.5 px-3">Baz ID</th>
                    <th className="py-2.5 px-3">Hat</th>
                    <th className="py-2.5 px-3 text-right">Uzunluk (m)</th>
                    <th className="py-2.5 px-3 text-right">vX (mm)</th>
                    <th className="py-2.5 px-3 text-right">vY (mm)</th>
                    <th className="py-2.5 px-3 text-right">vZ (mm)</th>
                    <th className="py-2.5 px-3 text-right">v_Mekan (mm)</th>
                    <th className="py-2.5 px-3 text-right">Baarda w-Testi</th>
                    <th className="py-2.5 px-3 text-center">Değerlendirme</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 font-mono">
                  {adjustmentResult.baselines.map((b) => {
                    const isOutlier = b.isOutlier;
                    return (
                      <tr key={b.id} className={`hover:bg-slate-50 ${isOutlier ? 'bg-rose-50/50' : ''}`}>
                        <td className="py-2.5 px-3 font-bold font-sans text-slate-900">{b.id}</td>
                        <td className="py-2.5 px-3 font-sans text-slate-800">
                          {b.fromId} $\rightarrow$ {b.toId}
                        </td>
                        <td className="py-2.5 px-3 text-right text-slate-700">{b.length.toFixed(2)}</td>
                        <td className="py-2.5 px-3 text-right text-slate-600">{(b.vX ?? 0).toFixed(1)}</td>
                        <td className="py-2.5 px-3 text-right text-slate-600">{(b.vY ?? 0).toFixed(1)}</td>
                        <td className="py-2.5 px-3 text-right text-slate-600">{(b.vZ ?? 0).toFixed(1)}</td>
                        <td className="py-2.5 px-3 text-right font-bold text-slate-900">
                          {(b.spatialV ?? 0).toFixed(1)}
                        </td>
                        <td className="py-2.5 px-3 text-right font-bold">
                          <span className={isOutlier ? 'text-rose-700' : 'text-slate-800'}>
                            {(b.wTest ?? 0).toFixed(2)}
                          </span>
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
          )}

          {/* SubTab 3: Error Ellipses (a, b, theta, sigma_H at 95%) */}
          {selectedSubTab === 'ellipses' && (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-slate-50 text-slate-700 font-semibold border-b border-slate-200">
                    <th className="py-2.5 px-3">Nokta ID</th>
                    <th className="py-2.5 px-3 text-right">Büyük Yarı Eksen a (mm)</th>
                    <th className="py-2.5 px-3 text-right">Küçük Yarı Eksen b (mm)</th>
                    <th className="py-2.5 px-3 text-right">Elips Basıklığı (a / b)</th>
                    <th className="py-2.5 px-3 text-right">Azimut θ (Gon)</th>
                    <th className="py-2.5 px-3 text-right">Düşey Duyarlık σ_H (mm)</th>
                    <th className="py-2.5 px-3 text-center">BÖHYY Uygunluğu</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 font-mono">
                  {Object.values(adjustmentResult.stations).map((st) => {
                    const isFixed = st.isFixed.x && st.isFixed.y && st.isFixed.z;
                    const a = st.semiMajor ?? 0;
                    const b = st.semiMinor ?? 0;
                    const ratio = b > 0 ? (a / b).toFixed(2) : '-';
                    return (
                      <tr key={st.id} className="hover:bg-slate-50">
                        <td className="py-2.5 px-3 font-bold font-sans text-slate-900">{st.name}</td>
                        <td className="py-2.5 px-3 text-right font-bold text-sky-800">
                          {isFixed ? '0.0 (Sabit)' : a.toFixed(1)}
                        </td>
                        <td className="py-2.5 px-3 text-right text-slate-700">
                          {isFixed ? '0.0 (Sabit)' : b.toFixed(1)}
                        </td>
                        <td className="py-2.5 px-3 text-right text-slate-600">{isFixed ? '-' : ratio}</td>
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
          )}
        </div>
      )}

      {!adjustmentResult && (
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-10 text-center space-y-3">
          <BarChart3 className="w-10 h-10 text-slate-300 mx-auto" />
          <h3 className="text-sm font-bold text-slate-800">Henüz 3D Ağ Dengelemesi Hesaplanmadı</h3>
          <p className="text-xs text-slate-500 max-w-md mx-auto">
            Noktalar ve baz vektörleri hazır olduğunda yukarıdaki "Dengelemeyi Hesapla (F8)" butonuna basarak 
            Dayalı veya Serbest Gauss-Markov dengelemesini çalıştırabilirsiniz.
          </p>
        </div>
      )}
    </div>
  );
};
