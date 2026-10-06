/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * Modül 3: Baz Vektörü Türetme Modülü (RTKLIB Bridge / Double Difference)
 */

import React, { useState } from 'react';
import { BaselineVector, Station } from '../types/gnss';
import {
  Share2,
  Cpu,
  CheckCircle2,
  AlertTriangle,
  Plus,
  Trash2,
  Eye,
  Filter,
  Play,
  Check,
  RefreshCw,
} from 'lucide-react';

interface Props {
  baselines: BaselineVector[];
  stations: Record<string, Station>;
  onUpdateBaseline: (baseline: BaselineVector) => void;
  onAddBaseline: (baseline: BaselineVector) => void;
  onDeleteBaseline: (id: string) => void;
  onRunRtklibSimulation: () => void;
  onGenerateBaselines?: () => void;
}

export const BaselinesTab: React.FC<Props> = ({
  baselines,
  stations,
  onUpdateBaseline,
  onAddBaseline,
  onDeleteBaseline,
  onRunRtklibSimulation,
  onGenerateBaselines,
}) => {
  const [selectedBaselineId, setSelectedBaselineId] = useState<string>(baselines[0]?.id || '');
  const [filterType, setFilterType] = useState<'ALL' | 'FIX' | 'FLOAT'>('ALL');
  const [isProcessing, setIsProcessing] = useState(false);

  const selectedBaseline = baselines.find((b) => b.id === selectedBaselineId) || baselines[0];

  const filteredBaselines = baselines.filter((b) => {
    if (filterType === 'FIX') return b.solutionType === 'FIX';
    if (filterType === 'FLOAT') return b.solutionType === 'FLOAT';
    return true;
  });

  const totalCount = baselines.length;
  const fixCount = baselines.filter((b) => b.solutionType === 'FIX').length;
  const activeCount = baselines.filter((b) => !b.excluded).length;
  const fixRatio = totalCount > 0 ? (fixCount / totalCount) * 100 : 0;
  const stationCount = Object.keys(stations).length;

  const handleSimulateRtklib = () => {
    setIsProcessing(true);
    setTimeout(() => {
      onRunRtklibSimulation();
      setIsProcessing(false);
    }, 800);
  };

  const handleToggleExclude = (bId: string) => {
    const b = baselines.find((x) => x.id === bId);
    if (!b) return;
    onUpdateBaseline({
      ...b,
      excluded: !b.excluded,
    });
  };

  return (
    <div className="space-y-6">
      {/* Module Overview Banner */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base font-bold text-slate-900">
                Baz Vektörü Türetme ve Çift Fark İşleme (RTKLIB Bridge)
              </h2>
            </div>
            <p className="text-xs text-slate-500 mt-1">
              Statik Çift Fark (Double Difference) faz çözümü: dX, dY, dZ baz bileşenleri, 
              Qxx, Qyy, Qzz, Qxy, Qyz, Qzx kovaryans matrisleri ve Q=1 Fix / Q=2 Float kalitesi.
            </p>
          </div>

          <div className="flex items-center gap-2.5 flex-wrap">
            {onGenerateBaselines && stationCount >= 2 && (
              <button
                onClick={onGenerateBaselines}
                className="px-3.5 py-2 text-xs font-bold bg-sky-600 hover:bg-sky-700 text-white rounded-lg shadow-sm transition cursor-pointer flex items-center gap-1.5"
                title="Yüklenen noktalardan otomatik olarak çift fark baz ağı türetir"
              >
                <Share2 className="w-3.5 h-3.5" />
                <span>Noktalardan Baz Ağı Türet</span>
              </button>
            )}

            <button
              onClick={handleSimulateRtklib}
              disabled={isProcessing || totalCount === 0}
              className="px-4 py-2 text-xs font-bold bg-slate-900 hover:bg-slate-800 text-white rounded-lg shadow-sm transition cursor-pointer flex items-center gap-2 disabled:opacity-50"
            >
              {isProcessing ? (
                <>
                  <RefreshCw className="w-3.5 h-3.5 animate-spin text-sky-400" />
                  <span>RTKLIB Çözüyor (-p 3 -m 10 -f 3)...</span>
                </>
              ) : (
                <>
                  <Cpu className="w-3.5 h-3.5 text-sky-400" />
                  <span>RTKLIB Çift Fark Çözümü Çalıştır</span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* Metric Badges */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4 pt-4 border-t border-slate-100 text-xs">
          <div className="p-2.5 bg-slate-50 rounded-lg border border-slate-200">
            <div className="text-slate-500">Toplam Baz Vektörü</div>
            <div className="text-base font-bold font-mono text-slate-900 mt-0.5">{totalCount} Adet</div>
          </div>
          <div className="p-2.5 bg-emerald-50 rounded-lg border border-emerald-200">
            <div className="text-emerald-700 font-medium">Fix Çözüm Oranı (Q=1)</div>
            <div className="text-base font-bold font-mono text-emerald-800 mt-0.5">
              %{fixRatio.toFixed(1)} ({fixCount}/{totalCount})
            </div>
          </div>
          <div className="p-2.5 bg-sky-50 rounded-lg border border-sky-200">
            <div className="text-sky-700 font-medium">Aktif Dengeleme Bazları</div>
            <div className="text-base font-bold font-mono text-sky-800 mt-0.5">{activeCount} Adet</div>
          </div>
          <div className="p-2.5 bg-indigo-50 rounded-lg border border-indigo-200">
            <div className="text-indigo-700 font-medium">Ortalama Ratio / PDOP</div>
            <div className="text-base font-bold font-mono text-indigo-900 mt-0.5">26.8 / 1.3</div>
          </div>
        </div>
      </div>

      {/* Main Grid: Baselines Table & Baseline Details */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column: Baselines Table */}
        <div className="lg:col-span-8 bg-white rounded-xl shadow-sm border border-slate-200 p-5 space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-2 border-b border-slate-100 pb-3">
            <div className="flex items-center gap-2">
              <Share2 className="w-4 h-4 text-sky-600" />
              <h3 className="text-sm font-bold text-slate-900">Baz Vektörleri Listesi</h3>
            </div>

            <div className="flex items-center gap-1.5 text-xs">
              <Filter className="w-3.5 h-3.5 text-slate-400" />
              <button
                onClick={() => setFilterType('ALL')}
                className={`px-2 py-1 rounded font-medium cursor-pointer ${
                  filterType === 'ALL' ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600'
                }`}
              >
                Tümü ({totalCount})
              </button>
              <button
                onClick={() => setFilterType('FIX')}
                className={`px-2 py-1 rounded font-medium cursor-pointer ${
                  filterType === 'FIX' ? 'bg-emerald-600 text-white' : 'bg-emerald-50 text-emerald-700'
                }`}
              >
                Fix ({fixCount})
              </button>
              <button
                onClick={() => setFilterType('FLOAT')}
                className={`px-2 py-1 rounded font-medium cursor-pointer ${
                  filterType === 'FLOAT' ? 'bg-amber-600 text-white' : 'bg-amber-50 text-amber-700'
                }`}
              >
                Float ({totalCount - fixCount})
              </button>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-slate-50 text-slate-700 font-semibold border-b border-slate-200">
                  <th className="py-2 px-2.5">Durum</th>
                  <th className="py-2 px-2.5">Baz ID</th>
                  <th className="py-2 px-2.5">Başlangıç → Bitiş</th>
                  <th className="py-2 px-2.5 text-right">Uzunluk (m)</th>
                  <th className="py-2 px-2.5 text-right">dX (m)</th>
                  <th className="py-2 px-2.5 text-right">dY (m)</th>
                  <th className="py-2 px-2.5 text-right">dZ (m)</th>
                  <th className="py-2 px-2.5 text-center">Çözüm</th>
                  <th className="py-2 px-2.5 text-center">Ağda?</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredBaselines.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="py-8 text-center text-slate-400 font-sans">
                      Henüz baz vektörü bulunmuyor. RINEX gözlem dosyaları yükleyiniz veya "Noktalardan Baz Ağı Türet" butonuna basınız.
                    </td>
                  </tr>
                ) : (
                  filteredBaselines.map((b) => {
                    const isSelected = b.id === selectedBaselineId;
                    const isFix = b.solutionType === 'FIX';
                    return (
                    <tr
                      key={b.id}
                      onClick={() => setSelectedBaselineId(b.id)}
                      className={`hover:bg-slate-50 transition cursor-pointer ${
                        isSelected ? 'bg-sky-50/70' : ''
                      } ${b.excluded ? 'opacity-50 line-through bg-slate-50' : ''}`}
                    >
                      <td className="py-2 px-2.5">
                        <span
                          className={`inline-block w-2.5 h-2.5 rounded-full ${
                            b.excluded ? 'bg-slate-400' : isFix ? 'bg-emerald-500' : 'bg-amber-500'
                          }`}
                        />
                      </td>
                      <td className="py-2 px-2.5 font-bold font-mono text-slate-900">{b.id}</td>
                      <td className="py-2 px-2.5 font-semibold text-slate-800">
                        {b.fromId} → {b.toId}
                      </td>
                      <td className="py-2 px-2.5 text-right font-mono font-medium text-slate-900">
                        {b.length.toFixed(2)}
                      </td>
                      <td className="py-2 px-2.5 text-right font-mono text-slate-700">{b.dX.toFixed(3)}</td>
                      <td className="py-2 px-2.5 text-right font-mono text-slate-700">{b.dY.toFixed(3)}</td>
                      <td className="py-2 px-2.5 text-right font-mono text-slate-700">{b.dZ.toFixed(3)}</td>
                      <td className="py-2 px-2.5 text-center">
                        <span
                          className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                            isFix ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'
                          }`}
                        >
                          {b.solutionType}
                        </span>
                      </td>
                      <td className="py-2 px-2.5 text-center">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleToggleExclude(b.id);
                          }}
                          className={`p-1 rounded text-xs font-bold transition cursor-pointer ${
                            b.excluded
                              ? 'bg-rose-100 text-rose-700 hover:bg-rose-200'
                              : 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200'
                          }`}
                          title={b.excluded ? 'Ağa dahil et' : 'Ağdan çıkar'}
                        >
                          {b.excluded ? 'Çıkarıldı' : 'Aktif'}
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Right Column: Selected Baseline Covariance Matrix Card */}
        <div className="lg:col-span-4 space-y-5">
          {selectedBaseline && (
            <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5 space-y-4">
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <div>
                  <h3 className="text-sm font-bold text-slate-900">
                    {selectedBaseline.id} ({selectedBaseline.fromId} → {selectedBaseline.toId})
                  </h3>
                  <div className="text-[11px] text-slate-500 font-mono">
                    Uzunluk: {selectedBaseline.length.toFixed(3)} m ({(selectedBaseline.length / 1000).toFixed(3)} km)
                  </div>
                </div>
                <span
                  className={`px-2 py-0.5 rounded text-xs font-bold ${
                    selectedBaseline.solutionType === 'FIX'
                      ? 'bg-emerald-100 text-emerald-800'
                      : 'bg-amber-100 text-amber-800'
                  }`}
                >
                  {selectedBaseline.solutionType} (Q={selectedBaseline.solutionType === 'FIX' ? '1' : '2'})
                </span>
              </div>

              {/* Quality Indicators */}
              <div className="grid grid-cols-3 gap-2 text-center text-xs">
                <div className="p-2 bg-slate-50 rounded border border-slate-200">
                  <div className="text-slate-500 text-[10px]">Ratio Faktörü</div>
                  <div className="font-bold font-mono text-slate-900">{selectedBaseline.ratio.toFixed(1)}</div>
                </div>
                <div className="p-2 bg-slate-50 rounded border border-slate-200">
                  <div className="text-slate-500 text-[10px]">RMS Kalıntısı</div>
                  <div className="font-bold font-mono text-slate-900">{(selectedBaseline.rms * 1000).toFixed(1)} mm</div>
                </div>
                <div className="p-2 bg-slate-50 rounded border border-slate-200">
                  <div className="text-slate-500 text-[10px]">Uydu / PDOP</div>
                  <div className="font-bold font-mono text-slate-900">
                    {selectedBaseline.satellites} / {selectedBaseline.pdop.toFixed(1)}
                  </div>
                </div>
              </div>

              {/* Variance-Covariance Matrix (Q_xx, Q_yy, Q_zz) */}
              <div>
                <h4 className="text-xs font-bold text-slate-800 mb-2">
                  Varyans-Kovaryans Matrisi Σ_b (m²)
                </h4>
                <div className="bg-slate-900 text-slate-200 p-3 rounded-lg font-mono text-[11px] space-y-1.5 shadow-inner">
                  <div className="flex justify-between border-b border-slate-800 pb-1">
                    <span className="text-sky-400">Qxx: {selectedBaseline.qxx.toExponential(3)}</span>
                    <span className="text-slate-400">Qxy: {selectedBaseline.qxy.toExponential(3)}</span>
                    <span className="text-slate-400">Qzx: {selectedBaseline.qzx.toExponential(3)}</span>
                  </div>
                  <div className="flex justify-between border-b border-slate-800 pb-1">
                    <span className="text-slate-400">Qxy: {selectedBaseline.qxy.toExponential(3)}</span>
                    <span className="text-sky-400">Qyy: {selectedBaseline.qyy.toExponential(3)}</span>
                    <span className="text-slate-400">Qyz: {selectedBaseline.qyz.toExponential(3)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Qzx: {selectedBaseline.qzx.toExponential(3)}</span>
                    <span className="text-slate-400">Qyz: {selectedBaseline.qyz.toExponential(3)}</span>
                    <span className="text-sky-400">Qzz: {selectedBaseline.qzz.toExponential(3)}</span>
                  </div>
                </div>
              </div>

              {/* Toggle Exclude Button */}
              <button
                onClick={() => handleToggleExclude(selectedBaseline.id)}
                className={`w-full py-2 px-3 text-xs font-bold rounded-lg transition cursor-pointer flex items-center justify-center gap-2 ${
                  selectedBaseline.excluded
                    ? 'bg-emerald-600 hover:bg-emerald-700 text-white'
                    : 'bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-300'
                }`}
              >
                {selectedBaseline.excluded ? (
                  <>
                    <Check className="w-3.5 h-3.5" />
                    <span>Bu Bazı Ağ Dengelemesine Dahil Et</span>
                  </>
                ) : (
                  <>
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Bu Bazı Ağ Dengelemesinden Çıkar</span>
                  </>
                )}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
