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
  IgsSp3File,
} from './types/gnss';
import {
  DEFAULT_CONFIG,
  calculateLoopClosures,
  perform3DNetworkAdjustment,
  calculateCorrectedAntennaHeight,
  calculateAntennaPhaseCenterHeight,
} from './utils/geodesy';
import { batchProcessNetworkBaselinesAsync } from './utils/rtklibEngine';
import { WorkerProgressMessage } from './workers/gnssBaselineWorker';
import {
  BroadcastEphemeris,
  IonoParameters,
  Sp3OrbitData,
  parseRinexNavDetailed,
  mergeEphemerisMaps,
} from './utils/rinexNavParser';
import {
  getUncalibratedStations,
  parseAntexContent,
  saveMultipleCustomAntennas,
  findAntennaInCatalog,
} from './utils/antennaCatalogManager';

import { JobConfigTab } from './components/JobConfigTab';
import { StationsAntennaTab } from './components/StationsAntennaTab';
import { BaselinesTab } from './components/BaselinesTab';
import { LoopClosureTab } from './components/LoopClosureTab';
import { AdjustmentTab } from './components/AdjustmentTab';
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
  FileText,
  CheckCircle2,
  Save,
  FolderOpen,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';

type TabKey =
  | 'home'
  | 'stations'
  | 'baselines'
  | 'loops'
  | 'free_adjustment'
  | 'report';

const WORKFLOW_STEPS: { id: TabKey; title: string; subtitle: string }[] = [
  { id: 'home', title: 'Anasayfa', subtitle: 'Proje oluşturma, açma ve genel durum' },
  { id: 'stations', title: 'İstasyonlar & RINEX', subtitle: 'GNSS istasyonları, RINEX gözlemleri, anten parametreleri ve kalite kontrol (QC)' },
  { id: 'baselines', title: 'Baz Çözümleri', subtitle: 'Statik çift fark bağıl baz çözümleri ve kovaryanslar' },
  { id: 'loops', title: 'Döngü Kapanmaları', subtitle: 'Bağımsız üçgen kapanışları ve BÖHYY tolerans kontrolü' },
  { id: 'free_adjustment', title: 'Serbest Dengeleme', subtitle: '3D Gauss-Markov serbest ağ dengelemesi ve Baarda kaba hata denetimi' },
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

  // Analysis Results
  const [loopClosures, setLoopClosures] = useState<LoopClosure[]>([]);
  const [adjustmentResult, setAdjustmentResult] = useState<AdjustmentResult | null>(null);

  // Native GNSS Worker Engine, SP3 & Broadcast Ephemeris
  const [ephemerisMap, setEphemerisMap] = useState<Record<string, BroadcastEphemeris[]>>({});
  const [sp3Orbit, setSp3Orbit] = useState<Sp3OrbitData | null>(null);
  const [loadedSp3File, setLoadedSp3File] = useState<IgsSp3File | null>(null);
  const [ionoParams, setIonoParams] = useState<IonoParameters | undefined>(undefined);
  const [isWorkerProcessing, setIsWorkerProcessing] = useState<boolean>(false);
  const [workerProgress, setWorkerProgress] = useState<WorkerProgressMessage | null>(null);

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
      showToast('Döngü analizi için önce Baz Çözümleri adımında gerçek RINEX baz vektörlerini hesaplayınız.');
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

  // Run 3D Network Adjustment (Inner-Constraint Free Network Adjustment / Trace Minimization)
  const handleRunAdjustment = useCallback(() => {
    if (Object.keys(stations).length < 2 || baselines.length === 0) {
      showToast('Dengeleme hesabı için önce Baz Çözümleri adımında gerçek RINEX baz vektörlerini hesaplayınız.');
      return;
    }
    setIsLoading(true);
    setTimeout(() => {
      try {
        const res = perform3DNetworkAdjustment(stations, baselines, 'unconstrained', config);
        setAdjustmentResult(res);

        if (res) {
          setStations((prev) => ({
            ...prev,
            ...res.stations,
          }));
          showToast(
            `İz Minimizasyonlu 3D Serbest Ağ Dengelemesi tamamlandı! σ₀: ${res.sigma0Aposteriori.toFixed(4)}`
          );
        } else {
          showToast('Dengeleme için ağ bağlantısını ve aktif bazları kontrol ediniz.');
        }
      } catch (err) {
        console.error('Adjustment execution error:', err);
        showToast('Dengeleme hesabı sırasında bir hata oluştu.');
      } finally {
        setIsLoading(false);
      }
    }, 150);
  }, [stations, baselines, config]);

  // Exclude Outliers and Re-adjust
  const handleExcludeOutliersAndReAdjust = (outlierIds: string[]) => {
    const updated = baselines.map((b) => ({
      ...b,
      excluded: outlierIds.includes(b.id) ? true : b.excluded,
    }));
    setBaselines(updated);

    // Recompute loops & adjustment
    const loops = calculateLoopClosures(
      stations,
      updated,
      config.loopToleranceBaseMm,
      config.loopTolerancePpm
    );
    setLoopClosures(loops);

    const res = perform3DNetworkAdjustment(stations, updated, 'unconstrained', config);
    setAdjustmentResult(res);
    if (res) {
      setStations((prev) => ({
        ...prev,
        ...res.stations,
      }));
    }
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

  const executeRealNetworkBaselines = async () => {
    const stationList = Object.values(stations);
    if (stationList.length < 2) {
      showToast('Baz çözümü için ağda en az 2 istasyon bulunmalıdır.');
      return;
    }
    const uncalibrated = getUncalibratedStations(stations);
    if (uncalibrated.length > 0) {
      showToast(`Baz çözümü engellendi: ${uncalibrated.map((s) => s.name).join(', ')} anten kalibrasyonu eksik.`);
      return;
    }
    const hasOrbit = !!sp3Orbit || Object.keys(ephemerisMap).length > 0;
    if (!hasOrbit) {
      showToast('Gerçek uydu yörüngesi için önce IGS .SP3 veya RINEX Navigasyon (.nav/.n/.g) dosyası yükleyiniz.');
      return;
    }

    setIsWorkerProcessing(true);
    setWorkerProgress(null);
    try {
      const solved = await batchProcessNetworkBaselinesAsync(
        stations,
        {
          ephemerisMap,
          sp3Orbit,
          iono: ionoParams,
          elevationMaskDeg: config.elevationMask,
          frequencies: config.satelliteSystems === 'GPS Only' ? 'L1' : 'L1+L2',
        },
        (prog) => setWorkerProgress(prog)
      );
      setBaselines(solved);
      const loops = calculateLoopClosures(
        stations,
        solved,
        config.loopToleranceBaseMm,
        config.loopTolerancePpm
      );
      setLoopClosures(loops);
      const fixCount = solved.filter((b) => b.solutionType === 'FIX').length;
      showToast(
        `${solved.length} baz vektörü gerçek RINEX gözlemlerinden hesaplandı (${fixCount} FIX, ${solved.length - fixCount} FLOAT).`
      );
    } catch (err: any) {
      console.error('Baseline solver error:', err);
      showToast(`Baz çözümü hatası: ${err?.message || err}`);
    } finally {
      setIsWorkerProcessing(false);
      setWorkerProgress(null);
    }
  };

  const handleGenerateBaselinesFromPoints = () => {
    void executeRealNetworkBaselines();
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
    void executeRealNetworkBaselines();
  };

  const handleUploadNavFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    try {
      let merged = ephemerisMap;
      let latestIono = ionoParams;
      let totalLoadedFiles = 0;

      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const text = await file.text();
        const detailed = parseRinexNavDetailed(text);
        if (Object.keys(detailed.satellites).length > 0) {
          merged = mergeEphemerisMaps(merged, detailed.satellites);
          totalLoadedFiles++;
        }
        if (detailed.iono?.alpha && detailed.iono?.beta) {
          latestIono = detailed.iono;
        }
      }

      const satCount = Object.keys(merged).length;
      if (totalLoadedFiles > 0 && satCount > 0) {
        setEphemerisMap(merged);
        if (latestIono) setIonoParams(latestIono);
        showToast(
          `${totalLoadedFiles} RINEX Navigasyon dosyası birleştirildi: Toplam ${satCount} GNSS uydusu aktif (GPS/GLONASS/Galileo).`
        );
      } else {
        showToast('Geçerli bir GPS, GLONASS veya Galileo navigasyon efemerisi bulunamadı.');
      }
    } catch (err: any) {
      showToast(`Nav dosyası okuma hatası: ${err?.message || err}`);
    }
    e.target.value = '';
  };

  const handleSp3Loaded = (sp3Data: Sp3OrbitData) => {
    setSp3Orbit(sp3Data);
    setLoadedSp3File(sp3Data.summary);
    showToast(
      `IGS Hassas Yörünge (.SP3) yüklendi: ${sp3Data.summary.fileName} (${sp3Data.summary.satelliteCount} uydu, ${sp3Data.summary.epochCount} epok)`
    );
  };

  const handleUpdateStationsBatch = (updatedMap: Record<string, Station>) => {
    setStations((prev) => ({ ...prev, ...updatedMap }));
  };

  const handleGlobalAtxUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      let text = '';
      if (file.name.toLowerCase().endsWith('.gz') || file.type.includes('gzip')) {
        const ds = new DecompressionStream('gzip');
        const stream = file.stream().pipeThrough(ds);
        text = await new Response(stream).text();
      } else {
        text = await file.text();
      }

      if (text) {
        const parsed = parseAntexContent(text);
        if (parsed.length === 0) {
          showToast('Geçerli bir ANTEX anten kalibrasyonu bulunamadı.');
          return;
        }

        saveMultipleCustomAntennas(parsed);

        // Update current stations with new calibrations
        const updatedStations = { ...stations };
        let count = 0;
        for (const id in updatedStations) {
          const st = updatedStations[id];
          const match = findAntennaInCatalog(st.antenna?.model || st.antenna?.rawRinexModel || st.name);
          if (match) {
            const cal = match.calibration;
            const isSlant = st.antenna?.heightType === 'slant';
            const effectiveOffset = isSlant ? (cal.verticalOffset || 0) : 0;
            const corrected = calculateCorrectedAntennaHeight(
              st.antenna?.heightType || 'vertical',
              st.antenna?.measuredHeight || 0,
              cal.radius,
              effectiveOffset
            );
            const apcCalc = calculateAntennaPhaseCenterHeight(
              st.antenna?.heightType || 'vertical',
              st.antenna?.measuredHeight || 0,
              cal.radius,
              effectiveOffset,
              cal.pcoL1?.u ?? 89.35,
              cal.pcoL2?.u ?? 117.76,
              'L3'
            );
            const baseGroundH = st.groundH ?? st.h;

            updatedStations[id] = {
              ...st,
              groundH: baseGroundH,
              arpH: Number((baseGroundH + apcCalc.hArp).toFixed(4)),
              apcH: Number((baseGroundH + apcCalc.hApcL3).toFixed(4)),
              antenna: {
                ...st.antenna,
                model: cal.model,
                radius: cal.radius,
                verticalOffset: effectiveOffset,
                correctedHeight: corrected,
                pcoL1: cal.pcoL1,
                pcoL2: cal.pcoL2,
                pcvZenith: cal.pcvZenith,
                isCalibrated: true,
                calibrationSource: match.source,
              },
            };
            count++;
          }
        }

        if (count > 0) {
          setStations(updatedStations);
        }
        showToast(`${parsed.length} anten kalibrasyonu kataloga kalıcı olarak kaydedildi. ${count > 0 ? `${count} istasyon kalibre edildi!` : ''}`);
      }
    } catch (err: any) {
      console.error('ATX okuma hatası:', err);
      showToast(`ATX yüklenirken hata: ${err?.message || err}`);
    }
    e.target.value = '';
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
      if (project.data.adjustmentResult) {
        setAdjustmentResult(project.data.adjustmentResult);
      } else if (project.data.unconstrainedResult) {
        setAdjustmentResult(project.data.unconstrainedResult);
      }
    }
    if (project.data?.adjustmentResult || project.data?.unconstrainedResult) {
      setActiveTab('free_adjustment');
    } else {
      setActiveTab('stations');
    }
    showToast(`"${project.name}" projesi başarıyla açıldı.`);
  };

  const handleRestoreBackup = (data: any) => {
    try {
      const backupData = data.data || data;
      const projName = data.name || data.projectName || backupData.config?.projectName || 'Yüklenen Proje';
      const restoredAdj = backupData.adjustmentResult || backupData.unconstrainedResult || null;
      const newProj: SavedProject = {
        id: data.id || 'project-' + Date.now(),
        name: projName,
        calculatedAt: data.calculatedAt,
        updatedAt: new Date().toLocaleDateString('tr-TR') + ' ' + new Date().toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }),
        stationCount: Object.keys(backupData.stations || {}).length,
        baselineCount: (backupData.baselines || []).length,
        pointCount: Object.keys(backupData.stations || {}).length,
        sigma0: restoredAdj?.sigma0Aposteriori,
        isAccepted: restoredAdj?.chiSquareTest?.passed,
        data: {
          config: backupData.config || DEFAULT_CONFIG,
          stations: backupData.stations || {},
          baselines: backupData.baselines || [],
          loopClosures: backupData.loopClosures || [],
          adjustmentResult: restoredAdj,
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
    const project: SavedProject = {
      id: currentProjectId,
      name: config.projectName || 'GNSS Nirengi Projesi',
      calculatedAt: adjustmentResult ? (new Date().toLocaleDateString('tr-TR') + ' ' + new Date().toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })) : undefined,
      updatedAt: new Date().toLocaleDateString('tr-TR') + ' ' + new Date().toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }),
      stationCount: stCount,
      baselineCount: bsCount,
      pointCount: stCount,
      sigma0: adjustmentResult?.sigma0Aposteriori,
      isAccepted: adjustmentResult?.chiSquareTest?.passed,
      data: {
        config,
        stations,
        baselines,
        loopClosures,
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
                  GNSS Nirengi Dengeleme Uygulaması
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
            {adjustmentResult && (
              <span
                className={`w-2 h-2 rounded-full ${
                  adjustmentResult.chiSquareTest.passed ? 'bg-emerald-500' : 'bg-rose-500'
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
            onShowToast={showToast}
          />
        )}

        {activeTab === 'stations' && (
          <StationsAntennaTab
            stations={stations}
            baselines={baselines}
            dom={config.dom}
            timeZone={config.timeZone}
            elevationMask={config.elevationMask}
            config={config}
            onChangeConfig={setConfig}
            onResetConfigDefaults={() => setConfig(DEFAULT_CONFIG)}
            onUpdateStation={handleUpdateStation}
            onUpdateStationsBatch={handleUpdateStationsBatch}
            onAddStation={handleAddStation}
            onDeleteStation={handleDeleteStation}
            onClearAllStations={handleClearAllStations}
            onNavigateTab={(tab) => setActiveTab(tab as TabKey)}
            ephemerisMap={ephemerisMap}
            sp3Orbit={sp3Orbit}
            loadedSp3File={loadedSp3File}
            ionoParams={ionoParams}
            onSp3Loaded={handleSp3Loaded}
            onUploadNavFile={handleUploadNavFile}
          />
        )}

        {activeTab === 'baselines' && (
          <BaselinesTab
            baselines={baselines}
            stations={stations}
            ephemerisMap={ephemerisMap}
            sp3Orbit={sp3Orbit}
            loadedSp3File={loadedSp3File}
            ionoParams={ionoParams}
            elevationMask={config.elevationMask}
            frequencies={config.satelliteSystems === 'GPS Only' ? 'L1' : 'L1+L2'}
            onUpdateBaseline={handleUpdateBaseline}
            onAddBaseline={handleAddBaseline}
            onDeleteBaseline={handleDeleteBaseline}
            onRunRtklibSimulation={handleRunRtklibSimulation}
            onGenerateBaselines={handleGenerateBaselinesFromPoints}
            onUploadNavFile={handleUploadNavFile}
            onUploadAtxFile={handleGlobalAtxUpload}
            onNavigateTab={(tab) => setActiveTab(tab as TabKey)}
            isWorkerProcessing={isWorkerProcessing}
            workerProgress={workerProgress}
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
            adjustmentResult={adjustmentResult}
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
            BSR Maps - Nirengi Hesabı v1.0
          </div>
        </div>
      </footer>
    </div>
  );
}
