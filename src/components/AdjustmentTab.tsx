/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * Modül 5: 3D Gauss-Markov En Küçük Kareler Ağ Dengelemesi ve Baarda Data Snooping (F8)
 */

import React from 'react';
import { AdjustmentResult, JobConfig } from '../types/gnss';
import { NetworkAdjustmentResultsView } from './NetworkAdjustmentResultsView';
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
  const isFree = mode === 'unconstrained';

  return (
    <div className="space-y-6">
      {/* Top Controls Banner */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h2 className="text-base font-bold text-slate-900">
              {isFree ? 'Serbest Ağ Dengelemesi (İç Tutarlılık)' : 'Dayalı Ağ Dengelemesi'}
            </h2>
            <p className="text-xs text-slate-500 mt-1">
              {isFree
                ? 'Minimal kısıtla iç tutarlılık analizi ve Baarda w-testi ile kaba hata denetimi.'
                : 'CORS sabitleri dayanak alınarak yapılan nihai 3D dengeleme.'}
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
              <div className="text-slate-500">Birim Ölçü St. Hatası (σ₀)</div>
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

      {/* Main Results View */}
      {adjustmentResult && (
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5">
          <NetworkAdjustmentResultsView
            adjustmentResult={adjustmentResult}
            config={config}
            mode={mode}
            onExcludeOutliersAndReAdjust={onExcludeOutliersAndReAdjust}
          />
        </div>
      )}

      {!adjustmentResult && (
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-10 text-center space-y-3">
          <BarChart3 className="w-10 h-10 text-slate-300 mx-auto" />
          <h3 className="text-sm font-bold text-slate-800">Henüz 3D Ağ Dengelemesi Hesaplanmadı</h3>
          <p className="text-xs text-slate-500 max-w-md mx-auto">
            Noktalar ve baz vektörleri hazır olduğunda yukarıdaki &quot;{isFree ? 'Serbest Dengelemeyi Hesapla' : 'Dayalı Dengelemeyi Hesapla'}&quot; butonuna basarak 
            3D Gauss-Markov dengelemesini çalıştırabilirsiniz.
          </p>
        </div>
      )}
    </div>
  );
};
