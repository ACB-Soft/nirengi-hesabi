/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * TUREF / ITRF96 GNSS Post-Processing ve 3D Ağ Dengeleme Uygulaması
 * Conforming to Topcon Tools, Leica Infinity & Trimble Business Center (TBC) architecture.
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  JobConfig,
  Station,
  BaselineVector,
  LoopClosure,
  AdjustmentResult,
} from './types/gnss';
import {
  DEFAULT_CONFIG,
  calculateLoopClosures,
  perform3DNetworkAdjustment,
  generateBaselinesFromStations,
  runFullTopconWorkflow,
} from './utils/geodesy';

import { JobConfigTab } from './components/JobConfigTab';
import { StationsAntennaTab } from './components/StationsAntennaTab';
import { BaselinesTab } from './components/BaselinesTab';
import { LoopClosureTab } from './components/LoopClosureTab';
import { AdjustmentTab } from './components/AdjustmentTab';
import { FixedCoordinatesTab } from './components/FixedCoordinatesTab';
import { MapTab } from './components/MapTab';
import { ReportExportTab } from './components/ReportExportTab';
import { PWAInstallButton } from './components/PWAInstallButton';
import { OfflineIndicator } from './components/OfflineIndicator';

import {
  Settings,
  Radio,
  Activity,
  Share2,
  RotateCcw,
  BarChart3,
  Sliders,
  ShieldCheck,
  TrendingUp,
  MapPin,
  FileText,
  BookOpen,
  CheckCircle2,
  AlertTriangle,
  Play,
  Zap,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';

type TabKey =
  | 'settings'
  | 'stations'
  | 'baselines'
  | 'loops'
  | 'free_adjustment'
  | 'fixed_coords'
  | 'constrained_adjustment'
  | 'report';

const WORKFLOW_STEPS: { id: TabKey; title: string; subtitle: string }[] = [
  { id: 'settings', title: 'Proje Ayarları', subtitle: 'Referans elipsoit, projeksiyon ve tolerans tanımları' },
  { id: 'stations', title: 'Veri Girişi', subtitle: 'Rover & TUSAGA RINEX verileri, 2005 epok hızları ve IGS hassas yörünge' },
  { id: 'baselines', title: 'Bazlar & RTKLIB', subtitle: 'Çift fark baz vektörü türetme ve RTKLIB çözümü' },
  { id: 'loops', title: 'Loop Closure', subtitle: '3D kapalı üçgen döngüleri ve ağ haritası analizi' },
  { id: 'free_adjustment', title: 'Serbest Dengeleme', subtitle: 'İç tutarlılık ve kaba hata (Baarda w-testi) dengelemesi' },
  { id: 'fixed_coords', title: 'Sabit Koordinatlar', subtitle: 'TUSAGA-Aktif resmi bilinen koordinat girişi' },
  { id: 'constrained_adjustment', title: 'Dayalı Dengeleme', subtitle: 'CORS sabitli nihai 3D Gauss-Markov dengelemesi' },
  { id: 'report', title: 'Rapor & Çıktı', subtitle: 'Resmi BÖHYY dengeleme karnesi ve dışa aktarım' },
];

export default function App() {
  const [activeTab, setActiveTab] = useState<TabKey>('settings');

  // Job Configurations
  const [config, setConfig] = useState<JobConfig>(DEFAULT_CONFIG);

  // Network Elements (Empty initial state)
  const [stations, setStations] = useState<Record<string, Station>>({});
  const [baselines, setBaselines] = useState<BaselineVector[]>([]);
  const [selectedOccupationStationId, setSelectedOccupationStationId] = useState<string>('');

  // Analysis Results
  const [loopClosures, setLoopClosures] = useState<LoopClosure[]>([]);
  const [unconstrainedResult, setUnconstrainedResult] = useState<AdjustmentResult | null>(null);
  const [constrainedResult, setConstrainedResult] = useState<AdjustmentResult | null>(null);
  const [adjustmentResult, setAdjustmentResult] = useState<AdjustmentResult | null>(null);

  const [isLoading, setIsLoading] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage(null);
    }, 2800);
  };

  useEffect(() => {
    document.title = 'Nirengi Hesabı';
    try {
      if (window.top && window.top !== window) {
        window.top.document.title = 'Nirengi Hesabı';
      }
    } catch {
      // Safe iframe guard
    }
  }, []);

  // Recalculate Loops
  const handleRecalculateLoops = useCallback(() => {
    if (Object.keys(stations).length < 2 || baselines.length === 0) {
      showToast('Döngü analizi için ağda en az 2 nokta ve baz vektörleri bulunmalıdır.');
      return;
    }
    const loops = calculateLoopClosures(
      stations,
      baselines,
      config.loopToleranceBaseMm,
      config.loopTolerancePpm
    );
    setLoopClosures(loops);
    showToast(`Topoloji analiz edildi: ${loops.length} bağımsız döngü tespit edildi.`);
  }, [stations, baselines, config]);

  // Run 3D Network Adjustment (F8)
  const handleRunAdjustment = useCallback(
    (mode: 'unconstrained' | 'constrained' = 'constrained') => {
      if (Object.keys(stations).length < 2 || baselines.length === 0) {
        showToast('Dengeleme hesabı için en az 2 nokta ve baz vektörleri gereklidir.');
        return;
      }
      setIsLoading(true);
      setTimeout(() => {
        const res = perform3DNetworkAdjustment(stations, baselines, mode, config);
        if (mode === 'unconstrained') {
          setUnconstrainedResult(res);
        } else {
          setConstrainedResult(res);
        }
        setAdjustmentResult(res);
        setIsLoading(false);

        if (res) {
          showToast(
            `3D Gauss-Markov Dengelemesi (${mode === 'constrained' ? 'Dayalı' : 'Serbest'}) tamamlandı! sigma_0: ${res.sigma0Aposteriori.toFixed(4)}`
          );
        } else {
          showToast('Dengeleme başarısız oldu. Ağ geometrisini ve bazları kontrol ediniz.');
        }
      }, 500);
    },
    [stations, baselines, config]
  );

  // Exclude Outliers and Re-adjust
  const handleExcludeOutliersAndReAdjust = (outlierIds: string[]) => {
    const updated = baselines.map((b) => ({
      ...b,
      excluded: outlierIds.includes(b.id) ? true : b.excluded,
    }));
    setBaselines(updated);

    // Recompute
    const loops = calculateLoopClosures(
      stations,
      updated,
      config.loopToleranceBaseMm,
      config.loopTolerancePpm
    );
    setLoopClosures(loops);

    const activeMode = activeTab === 'free_adjustment' ? 'unconstrained' : 'constrained';
    const res = perform3DNetworkAdjustment(stations, updated, activeMode, config);
    if (activeMode === 'unconstrained') {
      setUnconstrainedResult(res);
    } else {
      setConstrainedResult(res);
    }
    setAdjustmentResult(res);
    showToast(`${outlierIds.length} adet kaba hatalı baz elendi ve ağ yeniden dengelendi.`);
  };

  // Station Handlers
  const handleUpdateStation = (st: Station) => {
    const next = { ...stations, [st.id]: st };
    setStations(next);
  };

  const handleAddStation = (st: Station) => {
    setStations((prev) => ({ ...prev, [st.id]: st }));
  };

  const handleDeleteStation = (id: string) => {
    setStations((prev) => {
      const copy = { ...prev };
      delete copy[id];
      return copy;
    });
    // Remove connected baselines
    setBaselines((prev) => prev.filter((b) => b.fromId !== id && b.toId !== id));
  };

  const handleClearAllStations = () => {
    setStations({});
    setBaselines([]);
    setLoopClosures([]);
    setAdjustmentResult(null);
    showToast('Tüm noktalar ve bazlar temizlendi.');
  };

  const handleGenerateBaselinesFromPoints = () => {
    if (Object.keys(stations).length < 2) {
      showToast('Baz ağı türetmek için en az 2 nokta bulunmalıdır.');
      return;
    }
    const generated = generateBaselinesFromStations(stations);
    setBaselines(generated);
    const loops = calculateLoopClosures(
      stations,
      generated,
      config.loopToleranceBaseMm,
      config.loopTolerancePpm
    );
    setLoopClosures(loops);
    showToast(`${generated.length} adet çift fark baz vektörü türetildi.`);
  };

  const handleDetectedSurveyEpoch = (epoch: number, dateStr?: string) => {
    setConfig((prev) => ({
      ...prev,
      surveyEpoch: epoch,
    }));
    showToast(`Ölçü Epoğu RINEX verisinden tespit edildi: t = ${epoch.toFixed(2)}${dateStr ? ` (${dateStr})` : ''}`);
  };

  // Baseline Handlers
  const handleUpdateBaseline = (b: BaselineVector) => {
    setBaselines((prev) => prev.map((x) => (x.id === b.id ? b : x)));
  };

  const handleAddBaseline = (b: BaselineVector) => {
    setBaselines((prev) => [...prev, b]);
  };

  const handleDeleteBaseline = (id: string) => {
    setBaselines((prev) => prev.filter((b) => b.id !== id));
  };

  const handleRunRtklibSimulation = () => {
    showToast('RTKLIB Çift Fark çözümü yenilendi (-p 3 -m 10 -f 3).');
    handleRecalculateLoops();
  };

  const stationCount = Object.keys(stations).length;
  const activeBaselineCount = baselines.filter((b) => !b.excluded).length;

  return (
    <div className="bg-slate-50 text-slate-800 font-sans min-h-screen flex flex-col antialiased">
      {/* Offline Connectivity Indicator */}
      <OfflineIndicator />

      {/* Top Header */}
      <header className="bg-slate-900 text-white shadow-md border-b border-slate-800 no-print sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center space-x-3.5">
              <img
                src="./icon.svg"
                alt="Nirengi Hesabı Logo"
                className="w-11 h-11 sm:w-12 sm:h-12 object-contain shrink-0 drop-shadow-md hover:scale-105 transition-transform"
              />
              <div>
                <h1 className="text-base sm:text-lg font-bold tracking-tight text-white">
                  Nirengi Hesabı
                </h1>
                <p className="text-xs text-slate-400 hidden sm:block">
                  Dayalı GNSS Nirengi Dengeleme Uygulaması
                </p>
              </div>
            </div>

            {/* Header Right Actions */}
            <div className="flex items-center gap-2">
              <PWAInstallButton />
            </div>
          </div>
        </div>
      </header>

      {/* Main Container */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-5">
        {/* Navigation Tabs */}
        <div className="flex border-b border-slate-200 mb-6 space-x-1 sm:space-x-2 no-print overflow-x-auto custom-scrollbar">
          <button
            onClick={() => setActiveTab('settings')}
            className={`px-3.5 py-2.5 text-xs sm:text-sm font-semibold border-b-2 flex items-center gap-2 whitespace-nowrap transition cursor-pointer ${
              activeTab === 'settings'
                ? 'border-sky-600 text-sky-600'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            <Settings className="w-4 h-4 text-slate-500" />
            <span>Proje Ayarları</span>
          </button>

          <button
            onClick={() => setActiveTab('stations')}
            className={`px-3.5 py-2.5 text-xs sm:text-sm font-semibold border-b-2 flex items-center gap-2 whitespace-nowrap transition cursor-pointer ${
              activeTab === 'stations'
                ? 'border-sky-600 text-sky-600'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            <Radio className="w-4 h-4 text-sky-600" />
            <span>Veri Girişi</span>
            <span className="bg-sky-100 text-sky-700 px-2 py-0.5 rounded-full text-[10px] font-bold">
              {stationCount}
            </span>
          </button>

          <button
            onClick={() => setActiveTab('baselines')}
            className={`px-3.5 py-2.5 text-xs sm:text-sm font-semibold border-b-2 flex items-center gap-2 whitespace-nowrap transition cursor-pointer ${
              activeTab === 'baselines'
                ? 'border-sky-600 text-sky-600'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            <Share2 className="w-4 h-4 text-emerald-600" />
            <span>Bazlar & RTKLIB</span>
            <span className="bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded-full text-[10px] font-bold">
              {activeBaselineCount}
            </span>
          </button>

          <button
            onClick={() => setActiveTab('loops')}
            className={`px-3.5 py-2.5 text-xs sm:text-sm font-semibold border-b-2 flex items-center gap-2 whitespace-nowrap transition cursor-pointer ${
              activeTab === 'loops'
                ? 'border-sky-600 text-sky-600'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            <RotateCcw className="w-4 h-4 text-amber-600" />
            <span>Loop Closure</span>
            <span className="bg-amber-100 text-amber-800 px-2 py-0.5 rounded-full text-[10px] font-bold">
              {loopClosures.length}
            </span>
          </button>

          <button
            onClick={() => setActiveTab('free_adjustment')}
            className={`px-3.5 py-2.5 text-xs sm:text-sm font-semibold border-b-2 flex items-center gap-2 whitespace-nowrap transition cursor-pointer ${
              activeTab === 'free_adjustment'
                ? 'border-purple-600 text-purple-600'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            <Sliders className="w-4 h-4 text-purple-600" />
            <span>Serbest Dengeleme</span>
            {unconstrainedResult && (
              <span
                className={`w-2 h-2 rounded-full ${
                  unconstrainedResult.chiSquareTest.passed ? 'bg-emerald-500' : 'bg-rose-500'
                }`}
              />
            )}
          </button>

          <button
            onClick={() => setActiveTab('fixed_coords')}
            className={`px-3.5 py-2.5 text-xs sm:text-sm font-semibold border-b-2 flex items-center gap-2 whitespace-nowrap transition cursor-pointer ${
              activeTab === 'fixed_coords'
                ? 'border-purple-600 text-purple-600'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            <ShieldCheck className="w-4 h-4 text-purple-600" />
            <span>Sabit Koordinatlar</span>
          </button>

          <button
            onClick={() => setActiveTab('constrained_adjustment')}
            className={`px-3.5 py-2.5 text-xs sm:text-sm font-semibold border-b-2 flex items-center gap-2 whitespace-nowrap transition cursor-pointer ${
              activeTab === 'constrained_adjustment'
                ? 'border-sky-600 text-sky-600'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            <BarChart3 className="w-4 h-4 text-indigo-600" />
            <span>Dayalı Dengeleme</span>
            {constrainedResult && (
              <span
                className={`w-2 h-2 rounded-full ${
                  constrainedResult.chiSquareTest.passed ? 'bg-emerald-500' : 'bg-rose-500'
                }`}
              />
            )}
          </button>

          <button
            onClick={() => setActiveTab('report')}
            className={`px-3.5 py-2.5 text-xs sm:text-sm font-semibold border-b-2 flex items-center gap-2 whitespace-nowrap transition cursor-pointer ${
              activeTab === 'report'
                ? 'border-sky-600 text-sky-600'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            <FileText className="w-4 h-4 text-orange-600" />
            <span>Rapor & Çıktı</span>
          </button>
        </div>

        {/* Tab Views */}
        {activeTab === 'settings' && (
          <JobConfigTab
            config={config}
            onChange={setConfig}
            onResetDefaults={() => setConfig(DEFAULT_CONFIG)}
          />
        )}

        {activeTab === 'stations' && (
          <StationsAntennaTab
            stations={stations}
            dom={config.dom}
            timeZone={config.timeZone}
            surveyEpoch={config.surveyEpoch}
            onUpdateStation={handleUpdateStation}
            onAddStation={handleAddStation}
            onDeleteStation={handleDeleteStation}
            onClearAllStations={handleClearAllStations}
            onDetectedSurveyEpoch={handleDetectedSurveyEpoch}
          />
        )}

        {activeTab === 'baselines' && (
          <BaselinesTab
            baselines={baselines}
            stations={stations}
            onUpdateBaseline={handleUpdateBaseline}
            onAddBaseline={handleAddBaseline}
            onDeleteBaseline={handleDeleteBaseline}
            onRunRtklibSimulation={handleRunRtklibSimulation}
            onGenerateBaselines={handleGenerateBaselinesFromPoints}
          />
        )}

        {activeTab === 'loops' && (
          <LoopClosureTab
            loopClosures={loopClosures}
            stations={stations}
            baselines={baselines}
            adjustmentResult={adjustmentResult}
            onRecalculateLoops={handleRecalculateLoops}
          />
        )}

        {activeTab === 'free_adjustment' && (
          <AdjustmentTab
            mode="unconstrained"
            adjustmentResult={unconstrainedResult || (adjustmentResult?.mode === 'unconstrained' ? adjustmentResult : null)}
            config={config}
            onRunAdjustment={handleRunAdjustment}
            onExcludeOutliersAndReAdjust={handleExcludeOutliersAndReAdjust}
            isLoading={isLoading}
          />
        )}

        {activeTab === 'fixed_coords' && (
          <FixedCoordinatesTab
            stations={stations}
            config={config}
            onUpdateStation={handleUpdateStation}
            onNavigateToConstrainedAdjustment={() => {
              setActiveTab('constrained_adjustment');
            }}
          />
        )}

        {activeTab === 'constrained_adjustment' && (
          <AdjustmentTab
            mode="constrained"
            adjustmentResult={constrainedResult || (adjustmentResult?.mode === 'constrained' ? adjustmentResult : null)}
            config={config}
            onRunAdjustment={handleRunAdjustment}
            onExcludeOutliersAndReAdjust={handleExcludeOutliersAndReAdjust}
            isLoading={isLoading}
          />
        )}

        {activeTab === 'report' && (
          <ReportExportTab
            config={config}
            adjustmentResult={adjustmentResult}
            loopClosures={loopClosures}
            stations={stations}
          />
        )}

        {/* Step Transition Navigation Bar */}
        {(() => {
          const currentStepIndex = WORKFLOW_STEPS.findIndex((s) => s.id === activeTab);
          const prevStep = currentStepIndex > 0 ? WORKFLOW_STEPS[currentStepIndex - 1] : null;
          const nextStep = currentStepIndex < WORKFLOW_STEPS.length - 1 ? WORKFLOW_STEPS[currentStepIndex + 1] : null;

          return (
            <div className="mt-8 pt-5 border-t border-slate-200 flex flex-col sm:flex-row items-center justify-between gap-4 no-print bg-white p-4 rounded-xl shadow-xs border border-slate-200">
              <div>
                {prevStep ? (
                  <button
                    type="button"
                    onClick={() => setActiveTab(prevStep.id)}
                    className="inline-flex items-center gap-2 px-4 py-2.5 text-xs font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 border border-slate-300 rounded-lg shadow-2xs transition cursor-pointer active:scale-95"
                  >
                    <ChevronLeft className="w-4 h-4 text-slate-600" />
                    <span>Önceki Adım: {prevStep.title}</span>
                  </button>
                ) : (
                  <div className="text-xs text-slate-400 font-semibold px-2">
                    1. Adım / Başlangıç
                  </div>
                )}
              </div>

              <div className="text-xs text-slate-500 font-medium text-center">
                Adım {currentStepIndex + 1} / {WORKFLOW_STEPS.length}:{' '}
                <span className="font-bold text-slate-800">{WORKFLOW_STEPS[currentStepIndex]?.title}</span>
              </div>

              <div>
                {nextStep ? (
                  <button
                    type="button"
                    onClick={() => setActiveTab(nextStep.id)}
                    className="inline-flex items-center gap-2 px-5 py-2.5 text-xs sm:text-sm font-bold text-white bg-sky-600 hover:bg-sky-700 rounded-lg shadow-sm hover:shadow transition cursor-pointer active:scale-95"
                  >
                    <span>Sonraki Adıma Geç ({nextStep.title})</span>
                    <ChevronRight className="w-4 h-4 text-white" />
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => window.print()}
                    className="inline-flex items-center gap-2 px-5 py-2.5 text-xs sm:text-sm font-bold text-white bg-slate-900 hover:bg-slate-800 rounded-lg shadow-sm transition cursor-pointer active:scale-95"
                  >
                    <FileText className="w-4 h-4 text-sky-400" />
                    <span>Raporu Yazdır / PDF</span>
                  </button>
                )}
              </div>
            </div>
          );
        })()}
      </main>

      {/* Toast Notification Popup */}
      {toastMessage && (
        <div className="fixed bottom-6 right-6 z-50 bg-slate-900 text-white text-xs px-4 py-3 rounded-xl shadow-xl border border-slate-700 flex items-center gap-2.5 animate-fade-in no-print">
          <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
          <span className="font-medium">{toastMessage}</span>
        </div>
      )}

      {/* Footer */}
      <footer className="bg-slate-900 border-t border-slate-800 py-4 mt-auto no-print text-center text-xs text-slate-400 font-medium tracking-wide">
        <div className="max-w-7xl mx-auto px-4 flex items-center justify-center">
          <div>
            ACB Maps - Nirengi Hesabı v1.0
          </div>
        </div>
      </footer>
    </div>
  );
}
