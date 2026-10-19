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
import { batchProcessNetworkBaselines } from './utils/rtklibEngine';

import { JobConfigTab } from './components/JobConfigTab';
import { StationsAntennaTab } from './components/StationsAntennaTab';
import { BaselinesTab } from './components/BaselinesTab';
import { LoopClosureTab } from './components/LoopClosureTab';
import { AdjustmentTab } from './components/AdjustmentTab';
import { ConstrainedAdjustmentTab } from './components/ConstrainedAdjustmentTab';
import { QcSkyplotTab } from './components/QcSkyplotTab';
import { MapTab } from './components/MapTab';
import { ReportExportTab } from './components/ReportExportTab';
import { HomeTab } from './components/HomeTab';
import { PWAInstallButton } from './components/PWAInstallButton';
import { OfflineIndicator } from './components/OfflineIndicator';
import {
  SavedProject,
  getSavedProjects,
  saveProjectToStorage,
  updateProjectNameInStorage,
  deleteProjectFromStorage,
} from './utils/projectStorage';

import {
  Home,
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
  Save,
  FolderOpen,
  ChevronLeft,
  ChevronRight,
  Compass,
} from 'lucide-react';

type TabKey =
  | 'home'
  | 'stations'
  | 'qc'
  | 'baselines'
  | 'loops'
  | 'free_adjustment'
  | 'constrained_adjustment'
  | 'report';

const WORKFLOW_STEPS: { id: TabKey; title: string; subtitle: string }[] = [
  { id: 'home', title: 'Anasayfa', subtitle: 'Proje oluşturma, açma ve genel durum' },
  { id: 'stations', title: 'İstasyonlar & RINEX', subtitle: 'GNSS istasyonları, RINEX gözlemleri ve anten parametreleri' },
  { id: 'qc', title: 'Kalite Kontrol (QC)', subtitle: 'Uydu görünürlüğü, maske açısı ve sinyal kalitesi (Skyplot)' },
  { id: 'baselines', title: 'Baz Çözümleri', subtitle: 'Statik çift fark bağıl baz çözümleri ve kovaryanslar' },
  { id: 'loops', title: 'Döngü Kapanmaları', subtitle: 'Bağımsız üçgen kapanışları ve BÖHYY tolerans kontrolü' },
  { id: 'free_adjustment', title: 'Serbest Dengeleme', subtitle: 'İç tutarlılık analizi ve Baarda kaba hata denetimi' },
  { id: 'constrained_adjustment', title: 'Dayalı Dengeleme', subtitle: 'CORS dayanaklı nihai 3D ağ dengelemesi' },
  { id: 'report', title: 'Raporlama & Dışa Aktar', subtitle: 'Resmi BÖHYY karnesi, DXF, KML, GeoJSON ve Excel' },
];

export default function App() {
  const [activeTab, setActiveTab] = useState<TabKey>('home');

  // Saved Projects & Persistence
  const [savedProjects, setSavedProjects] = useState<SavedProject[]>(() => getSavedProjects());
  const [currentProjectId, setCurrentProjectId] = useState<string>('project-' + Date.now());

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
    let currentBaselines = baselines;
    if (currentBaselines.length === 0 && Object.keys(stations).length >= 2) {
      currentBaselines = generateBaselinesFromStations(stations);
      setBaselines(currentBaselines);
    }

    if (Object.keys(stations).length < 2 || currentBaselines.length === 0) {
      showToast('Döngü analizi için ağda en az 2 nokta bulunmalıdır.');
      return;
    }
    const loops = calculateLoopClosures(
      stations,
      currentBaselines,
      config.loopToleranceBaseMm,
      config.loopTolerancePpm
    );
    setLoopClosures(loops);
    showToast(`Topoloji analiz edildi: ${loops.length} bağımsız üçgen döngüsü tespit edildi.`);
  }, [stations, baselines, config]);

  // Run 3D Network Adjustment
  const handleRunAdjustment = useCallback(
    (mode: 'unconstrained' | 'constrained' = 'constrained') => {
      let currentBaselines = baselines;
      if (currentBaselines.length === 0 && Object.keys(stations).length >= 2) {
        currentBaselines = generateBaselinesFromStations(stations);
        setBaselines(currentBaselines);
        const loops = calculateLoopClosures(
          stations,
          currentBaselines,
          config.loopToleranceBaseMm,
          config.loopTolerancePpm
        );
        setLoopClosures(loops);
      }

      if (Object.keys(stations).length < 2 || currentBaselines.length === 0) {
        showToast('Dengeleme hesabı için en az 2 nokta gereklidir. Lütfen Veri Girişi adımından RINEX yükleyiniz.');
        return;
      }
      setIsLoading(true);
      setTimeout(() => {
        try {
          const res = perform3DNetworkAdjustment(stations, currentBaselines, mode, config);
          if (mode === 'unconstrained') {
            setUnconstrainedResult(res);
          } else {
            setConstrainedResult(res);
          }
          setAdjustmentResult(res);

          if (res) {
            // If constrained adjustment, also update stations with adjusted coordinates for reports and downstream tabs
            if (mode === 'constrained') {
              setStations((prev) => ({
                ...prev,
                ...res.stations,
              }));
            }
            showToast(
              `3D Gauss-Markov Dengelemesi (${mode === 'constrained' ? 'Dayalı' : 'Serbest'}) tamamlandı! sigma_0: ${res.sigma0Aposteriori.toFixed(4)}`
            );
          } else {
            showToast('Dengeleme için ağ geometrisini kontrol ediniz.');
          }
        } catch (err) {
          console.error('Adjustment execution error:', err);
          showToast('Dengeleme hesabı sırasında bir hata oluştu.');
        } finally {
          setIsLoading(false);
        }
      }, 350);
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
    const generated = batchProcessNetworkBaselines(stations, {
      elevationMaskDeg: config.elevationMask,
    });
    setBaselines(generated);
    const loops = calculateLoopClosures(
      stations,
      generated,
      config.loopToleranceBaseMm,
      config.loopTolerancePpm
    );
    setLoopClosures(loops);
    showToast(`${generated.length} adet çift fark baz vektörü RTKLIB motoru ile çözüldü.`);
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
    if (Object.keys(stations).length < 2) {
      showToast('RTKLIB çözümü için en az 2 nokta gereklidir.');
      return;
    }
    const solved = batchProcessNetworkBaselines(stations, {
      elevationMaskDeg: config.elevationMask,
    });
    setBaselines(solved);
    const loops = calculateLoopClosures(
      stations,
      solved,
      config.loopToleranceBaseMm,
      config.loopTolerancePpm
    );
    setLoopClosures(loops);
    showToast(`RTKLIB Çift Fark çözümü tamamlandı: ${solved.length} baz başarıyla hesaplandı.`);
  };

  // Project Management Handlers
  const handleNewProject = () => {
    const newId = 'project-' + Date.now();
    setCurrentProjectId(newId);
    setConfig({
      ...DEFAULT_CONFIG,
      projectName: 'Yeni GNSS Nirengi Projesi',
    });
    setStations({});
    setBaselines([]);
    setLoopClosures([]);
    setUnconstrainedResult(null);
    setConstrainedResult(null);
    setAdjustmentResult(null);
    setActiveTab('stations');
    showToast('Yeni proje başlatıldı. Lütfen nokta ve baz verilerini giriniz.');
  };

  const handleOpenProject = (project: SavedProject) => {
    setCurrentProjectId(project.id);
    if (project.data) {
      if (project.data.config) {
        setConfig({
          ...DEFAULT_CONFIG,
          ...project.data.config,
          projectName: project.name || project.data.config.projectName || 'GNSS Projesi',
        });
      }
      if (project.data.stations) setStations(project.data.stations);
      if (project.data.baselines) setBaselines(project.data.baselines);
      if (project.data.loopClosures) setLoopClosures(project.data.loopClosures);
      if (project.data.unconstrainedResult) setUnconstrainedResult(project.data.unconstrainedResult);
      if (project.data.constrainedResult) setConstrainedResult(project.data.constrainedResult);
      if (project.data.adjustmentResult) setAdjustmentResult(project.data.adjustmentResult);
    }
    if (project.data?.constrainedResult || project.data?.adjustmentResult) {
      setActiveTab('constrained_adjustment');
    } else {
      setActiveTab('stations');
    }
    showToast(`"${project.name}" projesi başarıyla açıldı.`);
  };

  const handleRestoreBackup = (data: any) => {
    try {
      const backupData = data.data || data;
      const projName = data.name || data.projectName || backupData.config?.projectName || 'Yüklenen Proje';
      const newProj: SavedProject = {
        id: data.id || 'project-' + Date.now(),
        name: projName,
        calculatedAt: data.calculatedAt,
        updatedAt: new Date().toLocaleDateString('tr-TR') + ' ' + new Date().toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }),
        stationCount: Object.keys(backupData.stations || {}).length,
        baselineCount: (backupData.baselines || []).length,
        pointCount: Object.keys(backupData.stations || {}).length,
        sigma0: backupData.adjustmentResult?.sigma0Aposteriori || backupData.constrainedResult?.sigma0Aposteriori,
        isAccepted: backupData.adjustmentResult?.chiSquareTest?.passed ?? backupData.constrainedResult?.chiSquareTest?.passed,
        data: {
          config: backupData.config || DEFAULT_CONFIG,
          stations: backupData.stations || {},
          baselines: backupData.baselines || [],
          loopClosures: backupData.loopClosures || [],
          unconstrainedResult: backupData.unconstrainedResult || null,
          constrainedResult: backupData.constrainedResult || null,
          adjustmentResult: backupData.adjustmentResult || null,
        },
      };
      saveProjectToStorage(newProj);
      setSavedProjects(getSavedProjects());
      handleOpenProject(newProj);
    } catch (err) {
      console.error('Backup restore error:', err);
      showToast('Proje dosyası açılırken hata oluştu.');
    }
  };

  const handleDeleteProject = (id: string) => {
    deleteProjectFromStorage(id);
    setSavedProjects(getSavedProjects());
    showToast('Proje silindi.');
  };

  const handleRenameProject = (id: string, newName: string) => {
    updateProjectNameInStorage(id, newName);
    setSavedProjects(getSavedProjects());
    if (currentProjectId === id) {
      setConfig((prev) => ({ ...prev, projectName: newName }));
    }
    showToast('Proje ismi güncellendi.');
  };

  const handleSaveCurrentProject = () => {
    const stCount = Object.keys(stations).length;
    const bsCount = baselines.length;
    const effectiveResult = constrainedResult || adjustmentResult || unconstrainedResult;
    const project: SavedProject = {
      id: currentProjectId,
      name: config.projectName || 'GNSS Nirengi Projesi',
      calculatedAt: effectiveResult ? (new Date().toLocaleDateString('tr-TR') + ' ' + new Date().toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })) : undefined,
      updatedAt: new Date().toLocaleDateString('tr-TR') + ' ' + new Date().toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }),
      stationCount: stCount,
      baselineCount: bsCount,
      pointCount: stCount,
      sigma0: effectiveResult?.sigma0Aposteriori,
      isAccepted: effectiveResult?.chiSquareTest?.passed,
      data: {
        config,
        stations,
        baselines,
        loopClosures,
        unconstrainedResult,
        constrainedResult,
        adjustmentResult,
      },
    };
    saveProjectToStorage(project);
    setSavedProjects(getSavedProjects());
    showToast(`"${project.name}" projesi kaydedildi.`);
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
                className="w-11 h-11 sm:w-12 sm:h-12 object-contain shrink-0 drop-shadow-md hover:scale-105 transition-transform cursor-pointer"
                onClick={() => setActiveTab('home')}
              />
              <div>
                <div className="flex items-center gap-2">
                  <h1
                    className="text-base sm:text-lg font-bold tracking-tight text-white cursor-pointer hover:text-sky-300 transition-colors"
                    onClick={() => setActiveTab('home')}
                  >
                    Nirengi Hesabı
                  </h1>
                  {config.projectName && (
                    <span className="hidden md:inline-block text-[11px] font-semibold bg-slate-800 text-slate-300 border border-slate-700 px-2 py-0.5 rounded-full max-w-[200px] truncate" title={config.projectName}>
                      {config.projectName}
                    </span>
                  )}
                </div>
                <p className="text-xs text-slate-400 hidden sm:block">
                  Dayalı GNSS Nirengi Dengeleme Uygulaması
                </p>
              </div>
            </div>

            {/* Header Right Actions */}
            <div className="flex items-center gap-2">
              <button
                onClick={handleSaveCurrentProject}
                className="px-3 py-1.5 bg-sky-700/80 hover:bg-sky-600 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 border border-sky-500/30 transition cursor-pointer shadow-xs active:scale-95"
                title="Mevcut Projeyi Kaydet"
              >
                <Save className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Projeyi Kaydet</span>
              </button>
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
            onClick={() => setActiveTab('home')}
            className={`px-3.5 py-2.5 text-xs sm:text-sm font-semibold border-b-2 flex items-center gap-2 whitespace-nowrap transition cursor-pointer ${
              activeTab === 'home'
                ? 'border-sky-600 text-sky-600'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            <Home className="w-4 h-4 text-sky-600" />
            <span>Anasayfa</span>
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
            <span>İstasyonlar &amp; RINEX</span>
            <span className="bg-sky-100 text-sky-700 px-2 py-0.5 rounded-full text-[10px] font-bold">
              {stationCount}
            </span>
          </button>

          <button
            onClick={() => setActiveTab('qc')}
            className={`px-3.5 py-2.5 text-xs sm:text-sm font-semibold border-b-2 flex items-center gap-2 whitespace-nowrap transition cursor-pointer ${
              activeTab === 'qc'
                ? 'border-indigo-600 text-indigo-600'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            <Compass className="w-4 h-4 text-indigo-600" />
            <span>Kalite Kontrol (QC)</span>
          </button>

          <button
            onClick={() => setActiveTab('baselines')}
            className={`px-3.5 py-2.5 text-xs sm:text-sm font-semibold border-b-2 flex items-center gap-2 whitespace-nowrap transition cursor-pointer ${
              activeTab === 'baselines'
                ? 'border-emerald-600 text-emerald-600'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            <Share2 className="w-4 h-4 text-emerald-600" />
            <span>Baz Çözümleri</span>
            <span className="bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded-full text-[10px] font-bold">
              {activeBaselineCount}
            </span>
          </button>

          <button
            onClick={() => setActiveTab('loops')}
            className={`px-3.5 py-2.5 text-xs sm:text-sm font-semibold border-b-2 flex items-center gap-2 whitespace-nowrap transition cursor-pointer ${
              activeTab === 'loops'
                ? 'border-amber-600 text-amber-600'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            <RotateCcw className="w-4 h-4 text-amber-600" />
            <span>Döngü Kapanmaları</span>
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
            onClick={() => setActiveTab('constrained_adjustment')}
            className={`px-3.5 py-2.5 text-xs sm:text-sm font-semibold border-b-2 flex items-center gap-2 whitespace-nowrap transition cursor-pointer ${
              activeTab === 'constrained_adjustment'
                ? 'border-indigo-600 text-indigo-600'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            <ShieldCheck className="w-4 h-4 text-indigo-600" />
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
                ? 'border-rose-600 text-rose-600'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            <FileText className="w-4 h-4 text-rose-600" />
            <span>Rapor &amp; CAD/CBS</span>
          </button>
        </div>

        {/* Tab Views */}
        {activeTab === 'home' && (
          <HomeTab
            onNewProject={handleNewProject}
            onRestoreBackup={handleRestoreBackup}
            onOpenProject={handleOpenProject}
            savedProjects={savedProjects}
            onDeleteProject={handleDeleteProject}
            onRenameProject={handleRenameProject}
            onNavigateTab={(tab) => setActiveTab(tab as TabKey)}
          />
        )}

        {activeTab === 'stations' && (
          <StationsAntennaTab
            stations={stations}
            dom={config.dom}
            timeZone={config.timeZone}
            surveyEpoch={config.surveyEpoch}
            config={config}
            onChangeConfig={setConfig}
            onResetConfigDefaults={() => setConfig(DEFAULT_CONFIG)}
            onUpdateStation={handleUpdateStation}
            onAddStation={handleAddStation}
            onDeleteStation={handleDeleteStation}
            onClearAllStations={handleClearAllStations}
            onDetectedSurveyEpoch={handleDetectedSurveyEpoch}
            onNavigateToQcTab={(stnId) => {
              if (stnId) setSelectedOccupationStationId(stnId);
              setActiveTab('qc');
            }}
          />
        )}

        {activeTab === 'qc' && (
          <QcSkyplotTab
            stations={stations}
            elevationMask={config.elevationMask}
            selectedStationId={selectedOccupationStationId}
            onSelectStation={(id) => setSelectedOccupationStationId(id)}
            onOpenRinexModal={() => setActiveTab('stations')}
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

        {activeTab === 'constrained_adjustment' && (
          <ConstrainedAdjustmentTab
            stations={stations}
            config={config}
            adjustmentResult={constrainedResult || (adjustmentResult?.mode === 'constrained' ? adjustmentResult : null)}
            onUpdateStation={handleUpdateStation}
            onRunAdjustment={handleRunAdjustment}
            onExcludeOutliersAndReAdjust={handleExcludeOutliersAndReAdjust}
            isLoading={isLoading}
            onNavigateToReport={() => setActiveTab('report')}
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
        {activeTab !== 'home' && (() => {
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
                    <span>Önceki: {prevStep.title}</span>
                  </button>
                ) : (
                  <div className="text-xs text-slate-400 font-semibold px-2">
                    Başlangıç
                  </div>
                )}
              </div>

              <div className="text-xs text-slate-500 font-medium text-center">
                Aşama {currentStepIndex + 1} / {WORKFLOW_STEPS.length}:{' '}
                <span className="font-bold text-slate-800">{WORKFLOW_STEPS[currentStepIndex]?.title}</span>
              </div>

              <div>
                {nextStep ? (
                  <button
                    type="button"
                    onClick={() => setActiveTab(nextStep.id)}
                    className="inline-flex items-center gap-2 px-5 py-2.5 text-xs sm:text-sm font-bold text-white bg-sky-600 hover:bg-sky-700 rounded-lg shadow-sm hover:shadow transition cursor-pointer active:scale-95"
                  >
                    <span>Sonraki: {nextStep.title}</span>
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
