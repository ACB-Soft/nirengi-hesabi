/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * Modül 4: Topoloji ve Döngü Kapanış Analizörü (Loop Closure Engine - Ctrl+L)
 */

import React, { useState } from 'react';
import { LoopClosure, Station, BaselineVector } from '../types/gnss';
import {
  RotateCcw,
  CheckCircle2,
  AlertTriangle,
  Play,
  Layers,
  ChevronRight,
  ShieldCheck,
  Zap,
} from 'lucide-react';

interface Props {
  loopClosures: LoopClosure[];
  stations: Record<string, Station>;
  baselines: BaselineVector[];
  onRecalculateLoops: () => void;
}

export const LoopClosureTab: React.FC<Props> = ({
  loopClosures,
  stations,
  baselines,
  onRecalculateLoops,
}) => {
  const [selectedLoopId, setSelectedLoopId] = useState<string>(loopClosures[0]?.id || '');

  const selectedLoop = loopClosures.find((l) => l.id === selectedLoopId) || loopClosures[0];

  const totalLoops = loopClosures.length;
  const passedLoops = loopClosures.filter((l) => l.isAccepted).length;
  const failedLoops = totalLoops - passedLoops;

  return (
    <div className="space-y-6">
      {/* Overview Banner */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="bg-sky-100 text-sky-800 text-xs font-semibold px-2 py-0.5 rounded">
                MODÜL 4
              </span>
              <h2 className="text-base font-bold text-slate-900">
                Topoloji ve Döngü Kapanış Analizörü (Loop Closure - Ctrl+L)
              </h2>
            </div>
            <p className="text-xs text-slate-500 mt-1">
              Çizge Teorisi (Graph Theory - Cycle Basis) tabanlı kapalı üçgen ve poligon döngüleri.
              Vektörel kapanış hatası w = sqrt(wX² + wY² + wZ²) ve 10 mm + 1.0 ppm × S tolerans denetimi.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={onRecalculateLoops}
              className="px-4 py-2 text-xs font-bold bg-sky-600 hover:bg-sky-700 text-white rounded-lg shadow-sm transition cursor-pointer flex items-center gap-1.5"
            >
              <Zap className="w-3.5 h-3.5 text-amber-300" />
              <span>Döngüleri Yeniden Hesapla (Ctrl+L)</span>
            </button>
          </div>
        </div>

        {/* Metric Badges */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4 pt-4 border-t border-slate-100 text-xs">
          <div className="p-2.5 bg-slate-50 rounded-lg border border-slate-200">
            <div className="text-slate-500">Tespit Edilen Bağımsız Döngüler</div>
            <div className="text-base font-bold font-mono text-slate-900 mt-0.5">{totalLoops} Döngü</div>
          </div>
          <div className="p-2.5 bg-emerald-50 rounded-lg border border-emerald-200">
            <div className="text-emerald-700 font-medium">Toleransı Sağlayanlar</div>
            <div className="text-base font-bold font-mono text-emerald-800 mt-0.5">
              {passedLoops} / {totalLoops} (%{totalLoops > 0 ? ((passedLoops / totalLoops) * 100).toFixed(0) : 0})
            </div>
          </div>
          <div
            className={`p-2.5 rounded-lg border ${
              failedLoops === 0
                ? 'bg-slate-50 border-slate-200 text-slate-500'
                : 'bg-rose-50 border-rose-200 text-rose-800'
            }`}
          >
            <div className="font-medium">Toleransı Aşanlar</div>
            <div className="text-base font-bold font-mono mt-0.5">{failedLoops} Döngü</div>
          </div>
          <div className="p-2.5 bg-sky-50 rounded-lg border border-sky-200">
            <div className="text-sky-700 font-medium">Ortalama Bağıl Hassasiyet</div>
            <div className="text-base font-bold font-mono text-sky-900 mt-0.5">1 : 240,000</div>
          </div>
        </div>
      </div>

      {/* Main Grid: Loops Table & Selected Loop Details */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column: Loop Closures Table */}
        <div className="lg:col-span-8 bg-white rounded-xl shadow-sm border border-slate-200 p-5 space-y-4">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <div className="flex items-center gap-2">
              <RotateCcw className="w-4 h-4 text-emerald-600" />
              <h3 className="text-sm font-bold text-slate-900">Döngü Kapanış Tablosu</h3>
            </div>
            <span className="text-xs text-slate-400">
              Kısayol: <kbd className="px-1.5 py-0.5 bg-slate-100 border border-slate-300 rounded font-mono font-bold text-slate-700">Ctrl+L</kbd>
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-slate-50 text-slate-700 font-semibold border-b border-slate-200">
                  <th className="py-2.5 px-3">Durum</th>
                  <th className="py-2.5 px-3">Döngü Adı & Güzergah</th>
                  <th className="py-2.5 px-3 text-right">Çevre (km)</th>
                  <th className="py-2.5 px-3 text-right">w (mm)</th>
                  <th className="py-2.5 px-3 text-right">Tolerans (mm)</th>
                  <th className="py-2.5 px-3 text-right">Bağıl Kapanış</th>
                  <th className="py-2.5 px-3 text-center">Sonuç</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {loopClosures.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-8 text-center text-slate-400 font-sans">
                      Ağda henüz kapalı döngü (üçgen/poligon) bulunmuyor. Noktalar ve bazlar eklendikten sonra döngüler otomatik hesaplanacaktır.
                    </td>
                  </tr>
                ) : (
                  loopClosures.map((loop) => {
                    const isSelected = loop.id === selectedLoopId;
                    return (
                    <tr
                      key={loop.id}
                      onClick={() => setSelectedLoopId(loop.id)}
                      className={`hover:bg-slate-50 transition cursor-pointer ${
                        isSelected ? 'bg-sky-50/70' : ''
                      }`}
                    >
                      <td className="py-2.5 px-3">
                        {loop.isAccepted ? (
                          <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                        ) : (
                          <AlertTriangle className="w-4 h-4 text-rose-600" />
                        )}
                      </td>
                      <td className="py-2.5 px-3">
                        <div className="font-bold text-slate-900">{loop.name}</div>
                        <div className="text-[11px] text-slate-500 font-mono">
                          {loop.stationIds.join(' → ')} → {loop.stationIds[0]}
                        </div>
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono text-slate-700">
                        {loop.totalLengthKm.toFixed(2)} km
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono font-bold text-slate-900">
                        {loop.totalMisclosure.toFixed(1)} mm
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono text-slate-600">
                        {loop.toleranceMm.toFixed(1)} mm
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono text-sky-700 font-medium">
                        {loop.relativePrecision}
                      </td>
                      <td className="py-2.5 px-3 text-center">
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                            loop.isAccepted
                              ? 'bg-emerald-100 text-emerald-800'
                              : 'bg-rose-100 text-rose-800'
                          }`}
                        >
                          {loop.isAccepted ? 'UYGUN' : 'AŞILDI'}
                        </span>
                      </td>
                    </tr>
                  );
                })
              )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Right Column: Loop Breakdown Details */}
        <div className="lg:col-span-4 space-y-5">
          {selectedLoop && (
            <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5 space-y-4">
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <div>
                  <h3 className="text-sm font-bold text-slate-900">{selectedLoop.name}</h3>
                  <div className="text-xs text-slate-500">
                    Çevre: {selectedLoop.totalLengthKm.toFixed(3)} km
                  </div>
                </div>
                <span
                  className={`px-2.5 py-1 rounded text-xs font-bold ${
                    selectedLoop.isAccepted
                      ? 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                      : 'bg-rose-100 text-rose-800 border border-rose-300'
                  }`}
                >
                  {selectedLoop.isAccepted ? 'Tolerans İçi' : 'Tolerans Dışı'}
                </span>
              </div>

              {/* Misclosure Components */}
              <div className="bg-slate-50 rounded-lg p-3.5 border border-slate-200 space-y-2 text-xs">
                <div className="font-bold text-slate-800 mb-1">Vektörel Kapanış Bileşenleri:</div>
                <div className="grid grid-cols-3 gap-2 text-center font-mono">
                  <div className="p-2 bg-white rounded border border-slate-200">
                    <div className="text-slate-400 text-[10px]">wX</div>
                    <div className="font-bold text-slate-900">{selectedLoop.sumDX.toFixed(1)} mm</div>
                  </div>
                  <div className="p-2 bg-white rounded border border-slate-200">
                    <div className="text-slate-400 text-[10px]">wY</div>
                    <div className="font-bold text-slate-900">{selectedLoop.sumDY.toFixed(1)} mm</div>
                  </div>
                  <div className="p-2 bg-white rounded border border-slate-200">
                    <div className="text-slate-400 text-[10px]">wZ</div>
                    <div className="font-bold text-slate-900">{selectedLoop.sumDZ.toFixed(1)} mm</div>
                  </div>
                </div>

                <div className="pt-2 border-t border-slate-200 flex justify-between items-center text-slate-900">
                  <span className="font-bold">Toplam 3D Vektörel Hata (w):</span>
                  <span className="font-mono text-sm font-extrabold text-sky-700">
                    {selectedLoop.totalMisclosure.toFixed(1)} mm
                  </span>
                </div>
                <div className="flex justify-between items-center text-slate-600">
                  <span>Hesaplanan Tolerans:</span>
                  <span className="font-mono font-bold text-slate-800">
                    {selectedLoop.toleranceMm.toFixed(1)} mm
                  </span>
                </div>
              </div>

              {/* Cycle Segments Breakdown */}
              <div>
                <h4 className="text-xs font-bold text-slate-800 mb-2">Döngüyü Oluşturan Baz Vektörleri</h4>
                <div className="space-y-1.5 text-xs">
                  {selectedLoop.baselineIds.map((bId, idx) => {
                    const dir = selectedLoop.directions[idx];
                    const b = baselines.find((x) => x.id === bId);
                    return (
                      <div
                        key={bId}
                        className="p-2 bg-slate-50 rounded border border-slate-200 flex items-center justify-between font-mono"
                      >
                        <div className="flex items-center gap-1.5">
                          <span
                            className={`w-4 h-4 rounded-full text-[10px] font-bold flex items-center justify-center ${
                              dir > 0 ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'
                            }`}
                          >
                            {dir > 0 ? '+' : '-'}
                          </span>
                          <span className="font-bold text-slate-800">{bId}</span>
                        </div>
                        <div className="text-[11px] text-slate-600">
                          {b ? `${b.fromId} → ${b.toId} (${(b.length / 1000).toFixed(2)} km)` : ''}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
