import React, { useState, useRef } from 'react';
import { SavedProject } from '../utils/projectStorage';
import { signBackupData } from '../utils/backupIntegrity';
import {
  exportSecureProjectZipArchive,
  importSecureProjectZipArchive,
  triggerBlobDownload,
  ExportArchiveProgress,
  ImportArchiveProgress,
} from '../utils/projectArchiveManager';
import {
  FilePlus2,
  FolderOpen,
  Upload,
  Clock,
  MapPin,
  CheckCircle2,
  AlertTriangle,
  FileCode,
  Trash2,
  Download,
  X,
  ArrowRight,
  Pencil,
  Check,
  Share2,
  Radio,
  Sliders,
  ShieldCheck,
  ShieldAlert,
  BarChart3,
  FileText,
  Archive,
  FileArchive,
  Loader2,
  Lock,
} from 'lucide-react';

interface HomeTabProps {
  onNewProject: () => void;
  onRestoreBackup: (data: any) => void;
  onOpenProject: (project: SavedProject) => void;
  savedProjects: SavedProject[];
  onDeleteProject: (id: string) => void;
  onRenameProject: (id: string, newName: string) => void;
  onNavigateTab?: (tab: string) => void;
  onShowToast?: (msg: string) => void;
}

export const HomeTab: React.FC<HomeTabProps> = ({
  onNewProject,
  onRestoreBackup,
  onOpenProject,
  savedProjects,
  onDeleteProject,
  onRenameProject,
  onNavigateTab,
  onShowToast,
}) => {
  const [isLoadModalOpen, setIsLoadModalOpen] = useState(false);
  const zipFileInputRef = useRef<HTMLInputElement | null>(null);

  const [archiveProgress, setArchiveProgress] = useState<{
    type: 'export' | 'import';
    percent: number;
    stage: string;
    message: string;
    currentFile?: string;
  } | null>(null);

  const [tamperError, setTamperError] = useState<{
    title: string;
    message: string;
  } | null>(null);

  const [editingProjectId, setEditingProjectId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState<string>('');
  const [deletingProjectId, setDeletingProjectId] = useState<string | null>(null);

  const handleStartRename = (p: SavedProject, e?: React.MouseEvent) => {
    e?.stopPropagation();
    setEditingProjectId(p.id);
    setEditingName(p.name);
    setDeletingProjectId(null);
  };

  const handleSaveRename = (id: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (editingName.trim()) {
      onRenameProject(id, editingName.trim());
    }
    setEditingProjectId(null);
  };

  const handleCancelRename = (e?: React.MouseEvent) => {
    e?.stopPropagation();
    setEditingProjectId(null);
  };

  const handleStartDelete = (id: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    setDeletingProjectId(id);
    setEditingProjectId(null);
  };

  const handleConfirmDelete = (id: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    onDeleteProject(id);
    setDeletingProjectId(null);
  };

  const handleCancelDelete = (e?: React.MouseEvent) => {
    e?.stopPropagation();
    setDeletingProjectId(null);
  };

  const handleDownloadProjectJSON = (p: SavedProject) => {
    const exportPayload = {
      app: 'ACB Maps - Nirengi Hesabı',
      version: '1.0',
      exportedAt: new Date().toISOString(),
      id: p.id,
      name: p.name,
      projectName: p.name,
      calculatedAt: p.calculatedAt || p.updatedAt,
      updatedAt: p.updatedAt,
      stationCount: p.stationCount ?? (p.data?.stations ? Object.keys(p.data.stations).length : p.pointCount ?? 0),
      baselineCount: p.baselineCount ?? (p.data?.baselines ? p.data.baselines.length : 0),
      pointCount: p.pointCount ?? p.stationCount,
      sigma0: p.sigma0,
      isAccepted: p.isAccepted,
      data: {
        config: p.data?.config,
        stations: p.data?.stations,
        baselines: p.data?.baselines,
        loopClosures: p.data?.loopClosures,
        unconstrainedResult: p.data?.unconstrainedResult,
        constrainedResult: p.data?.constrainedResult,
        adjustmentResult: p.data?.adjustmentResult,
      },
    };
    const signedPayload = signBackupData(exportPayload);
    const blob = new Blob([JSON.stringify(signedPayload, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${p.name.replace(/\s+/g, '_')}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleZipFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setTamperError(null);

    try {
      setArchiveProgress({
        type: 'import',
        percent: 5,
        stage: 'READING',
        message: 'ZIP arşivi okunuyor ve HMAC-SHA256 kontrolü yapılıyor...',
      });

      const result = await importSecureProjectZipArchive(file, (prog) => {
        setArchiveProgress({
          type: 'import',
          percent: prog.percent,
          stage: prog.stage,
          message: prog.message,
          currentFile: prog.currentFile,
        });
      });

      onRestoreBackup(result.project);
      setIsLoadModalOpen(false);
      onShowToast?.(`"${result.project.name}" arşivi başarıyla doğrulandı ve açıldı! (${result.restoredRinexFiles.length} ham RINEX dosyası kurtarıldı)`);
    } catch (err: any) {
      console.error('ZIP Archive import error:', err);
      setTamperError({
        title: 'Kriptografik Doğrulama / Tahrifat Uyarısı',
        message: err?.message || 'Arşiv dosyası doğrulanırken hata oluştu.',
      });
    } finally {
      if (zipFileInputRef.current) {
        zipFileInputRef.current.value = '';
      }
      setTimeout(() => {
        setArchiveProgress(null);
      }, 1000);
    }
  };

  const handleDownloadProjectZip = async (p: SavedProject, e?: React.MouseEvent) => {
    e?.stopPropagation();

    try {
      setArchiveProgress({
        type: 'export',
        percent: 5,
        stage: 'SCANNING',
        message: 'Arşiv paketleme başlatılıyor...',
      });

      const blob = await exportSecureProjectZipArchive(p, (prog) => {
        setArchiveProgress({
          type: 'export',
          percent: prog.percent,
          stage: prog.stage,
          message: prog.message,
          currentFile: prog.currentFile,
        });
      });

      const safeName = (p.name || 'GNSS_Projesi').replace(/[^a-zA-Z0-9_\u00C0-\u017F-]/g, '_');
      triggerBlobDownload(blob, `${safeName}_GNSS_Arsivi.zip`);
      onShowToast?.(`"${p.name}" tam proje arşivi (.zip) HMAC korumalı olarak indirildi.`);
    } catch (err: any) {
      console.error('Archive export error:', err);
      alert(`Arşiv dışa aktarılırken hata oluştu: ${err?.message || err}`);
    } finally {
      setTimeout(() => {
        setArchiveProgress(null);
      }, 1200);
    }
  };

  return (
    <div className="space-y-8 max-w-5xl mx-auto py-2">
      {/* Hidden File Input for Tam Proje Arşivi Seç (.zip) */}
      <input
        type="file"
        ref={zipFileInputRef}
        onChange={handleZipFileChange}
        accept=".zip,application/zip"
        className="hidden"
      />

      {/* Hero Welcome Banner */}
      {/* Hero Banner */}
      <div className="bg-gradient-to-br from-slate-900 via-slate-800 to-sky-950 text-white rounded-3xl p-6 sm:p-8 shadow-xl border border-slate-700/60 relative overflow-hidden">
        <div className="relative z-10 max-w-2xl space-y-3">
          <h2 className="text-xl sm:text-2xl font-extrabold tracking-tight text-white">
            GNSS Nirengi Ağı Dengeleme ve Raporlama
          </h2>
          <p className="text-xs sm:text-sm text-slate-300 leading-relaxed">
            TUSAGA-Aktif ve Rover ölçüleriyle 3D Gauss-Markov ağ dengelemesi, kalite kontrolü ve BÖHYY standartlarında onaylanabilir hesap karnesi.
          </p>
        </div>

        {/* Decorative Grid Pattern Background */}
        <div className="absolute right-0 top-0 bottom-0 w-1/3 opacity-10 pointer-events-none hidden md:block">
          <svg className="w-full h-full" xmlns="http://www.w3.org/2000/svg">
            <defs>
              <pattern id="home-grid" width="32" height="32" patternUnits="userSpaceOnUse">
                <path d="M 32 0 L 0 0 0 32" fill="none" stroke="white" strokeWidth="1" />
              </pattern>
            </defs>
            <rect width="100%" height="100%" fill="url(#home-grid)" />
          </svg>
        </div>
      </div>

      {/* Main Action Cards (Yeni Proje Başlat & Proje Yükle) */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Card 1: Yeni Proje Başlat */}
        <div
          onClick={onNewProject}
          className="group bg-white hover:bg-sky-50/40 p-5 sm:p-6 rounded-2xl border-2 border-slate-200 hover:border-sky-500 shadow-xs hover:shadow-md transition-all cursor-pointer flex flex-col justify-between"
        >
          <div className="space-y-3">
            <div className="w-12 h-12 rounded-xl bg-sky-100 text-sky-700 flex items-center justify-center group-hover:scale-105 transition-transform">
              <FilePlus2 className="w-6 h-6" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900 group-hover:text-sky-700 transition-colors">
                Yeni Proje Başlat
              </h3>
              <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                Yeni bir GNSS nirengi projesi oluşturun ve istasyon ölçülerinizi tanımlayın.
              </p>
            </div>
          </div>

          <div className="pt-4 flex items-center text-xs font-bold text-sky-600 group-hover:text-sky-700">
            <span>Veri Girişine Başla</span>
            <ArrowRight className="w-4 h-4 ml-1.5 group-hover:translate-x-1 transition-transform" />
          </div>
        </div>

        {/* Card 2: Proje Yükle (.json) */}
        <div
          onClick={() => setIsLoadModalOpen(true)}
          className="group bg-white hover:bg-indigo-50/40 p-5 sm:p-6 rounded-2xl border-2 border-slate-200 hover:border-indigo-500 shadow-xs hover:shadow-md transition-all cursor-pointer flex flex-col justify-between"
        >
          <div className="space-y-3">
            <div className="w-12 h-12 rounded-xl bg-indigo-100 text-indigo-700 flex items-center justify-center group-hover:scale-105 transition-transform">
              <FolderOpen className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center justify-between">
                <h3 className="text-base font-bold text-slate-900 group-hover:text-indigo-700 transition-colors">
                  Proje Yükle (.zip)
                </h3>
                {savedProjects.length > 0 && (
                  <span className="text-[11px] font-semibold bg-indigo-100 text-indigo-800 px-2 py-0.5 rounded-full">
                    {savedProjects.length} Kayıtlı
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                Tam Proje Arşivi (.zip) paketini açın veya kayıtlı projelerinizi yönetin.
              </p>
            </div>
          </div>

          <div className="pt-4 flex items-center text-xs font-bold text-indigo-600 group-hover:text-indigo-700">
            <span>Projeleri İncele ve Aç</span>
            <ArrowRight className="w-4 h-4 ml-1.5 group-hover:translate-x-1 transition-transform" />
          </div>
        </div>
      </div>


      {/* Recent Projects Section (Direct Access on Home Screen) */}
      {savedProjects.length > 0 && (
        <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-xs space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-slate-800 flex items-center gap-2">
              <Clock className="w-4 h-4 text-sky-600" />
              <span>Son Kaydedilen Projeler</span>
            </h3>
            <button
              onClick={() => setIsLoadModalOpen(true)}
              className="text-xs font-semibold text-sky-600 hover:text-sky-700 cursor-pointer"
            >
              Tümünü Yönet ({savedProjects.length})
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {savedProjects.slice(0, 3).map((p) => {
              const stationCnt = p.stationCount ?? (p.data?.stations ? Object.keys(p.data.stations).length : p.pointCount ?? 0);
              const baselineCnt = p.baselineCount ?? (p.data?.baselines ? p.data.baselines.length : 0);

              if (deletingProjectId === p.id) {
                return (
                  <div
                    key={p.id}
                    className="p-4 rounded-xl border border-rose-300 bg-rose-50 shadow-xs flex flex-col justify-between space-y-2.5"
                  >
                    <p className="text-xs font-semibold text-rose-800">
                      "{p.name}" projesini silmek istiyor musunuz?
                    </p>
                    <div className="flex items-center gap-1.5 justify-end">
                      <button
                        onClick={handleCancelDelete}
                        className="px-2.5 py-1 bg-white hover:bg-slate-100 text-slate-700 text-[11px] font-medium rounded-md border border-slate-200 transition cursor-pointer"
                      >
                        Vazgeç
                      </button>
                      <button
                        onClick={(e) => handleConfirmDelete(p.id, e)}
                        className="px-2.5 py-1 bg-rose-600 hover:bg-rose-700 text-white text-[11px] font-bold rounded-md shadow-xs transition cursor-pointer"
                      >
                        Evet, Sil
                      </button>
                    </div>
                  </div>
                );
              }

              if (editingProjectId === p.id) {
                return (
                  <div
                    key={p.id}
                    className="p-4 rounded-xl border border-sky-400 bg-sky-50/50 shadow-xs flex flex-col justify-between space-y-2.5"
                  >
                    <div>
                      <label className="text-[10px] font-bold text-sky-800 block mb-1">
                        Proje İsmini Düzenle
                      </label>
                      <input
                        type="text"
                        value={editingName}
                        onChange={(e) => setEditingName(e.target.value)}
                        autoFocus
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleSaveRename(p.id);
                          if (e.key === 'Escape') handleCancelRename();
                        }}
                        className="w-full bg-white border border-sky-400 rounded-lg px-2.5 py-1.5 text-xs text-slate-800 font-bold focus:outline-hidden focus:ring-2 focus:ring-sky-500"
                      />
                    </div>
                    <div className="flex items-center gap-1.5 justify-end">
                      <button
                        onClick={handleCancelRename}
                        className="px-2 py-1 text-slate-500 hover:bg-slate-200 text-[11px] font-medium rounded transition cursor-pointer"
                      >
                        İptal
                      </button>
                      <button
                        onClick={(e) => handleSaveRename(p.id, e)}
                        className="px-3 py-1 bg-sky-600 hover:bg-sky-500 text-white text-[11px] font-bold rounded-md shadow-xs transition cursor-pointer flex items-center gap-1"
                      >
                        <Check className="w-3.5 h-3.5" />
                        <span>Kaydet</span>
                      </button>
                    </div>
                  </div>
                );
              }

              return (
                <div
                  key={p.id}
                  className="p-4 rounded-xl border border-slate-200 hover:border-sky-300 bg-slate-50/60 hover:bg-white transition-all shadow-xs flex flex-col justify-between space-y-3"
                >
                  <div>
                    <div className="flex items-start justify-between gap-1.5">
                      <div className="flex items-center gap-1 min-w-0 flex-1">
                        <h4 className="text-xs font-bold text-slate-900 truncate" title={p.name}>
                          {p.name}
                        </h4>
                        <button
                          onClick={(e) => handleStartRename(p, e)}
                          className="p-1 text-slate-400 hover:text-sky-600 hover:bg-sky-50 rounded transition shrink-0 cursor-pointer"
                          title="Proje ismini düzenle"
                        >
                          <Pencil className="w-3 h-3" />
                        </button>
                      </div>
                      {p.isAccepted !== undefined ? (
                        <span
                          className={`text-[10px] font-semibold px-1.5 py-0.5 rounded shrink-0 flex items-center gap-1 ${
                            p.isAccepted
                              ? 'bg-emerald-100 text-emerald-800'
                              : 'bg-rose-100 text-rose-800'
                          }`}
                        >
                          {p.isAccepted ? (
                            <>
                              <CheckCircle2 className="w-2.5 h-2.5 text-emerald-600" />
                              <span>Kabul</span>
                            </>
                          ) : (
                            <>
                              <AlertTriangle className="w-2.5 h-2.5 text-rose-600" />
                              <span>Ret</span>
                            </>
                          )}
                        </span>
                      ) : (
                        <span className="text-[10px] font-semibold bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded shrink-0">
                          Taslak
                        </span>
                      )}
                    </div>
                    <span className="text-[10px] text-slate-500 block mt-1">
                      Dengeleme: <strong className="text-slate-700">{p.calculatedAt || p.updatedAt}</strong>
                    </span>
                  </div>

                  <div className="flex items-center justify-between text-[11px] text-slate-600 pt-2 border-t border-slate-200">
                    <div className="flex items-center gap-2 text-[10px]">
                      <span className="flex items-center gap-0.5 font-mono">
                        <MapPin className="w-3 h-3 text-sky-600" />
                        <span>{stationCnt} Nokta</span>
                      </span>
                      <span>•</span>
                      <span className="flex items-center gap-0.5 font-mono">
                        <Share2 className="w-3 h-3 text-emerald-600" />
                        <span>{baselineCnt} Baz</span>
                      </span>
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={(e) => handleDownloadProjectZip(p, e)}
                        className="p-1 text-slate-400 hover:text-emerald-700 hover:bg-emerald-50 rounded transition cursor-pointer"
                        title="Tam Proje Arşivi İndir (.zip: JSON + Ham RINEX + Rapor - HMAC Korumalı)"
                      >
                        <Archive className="w-3.5 h-3.5 text-emerald-600" />
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDownloadProjectJSON(p);
                        }}
                        className="p-1 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded transition cursor-pointer"
                        title="Yalnızca .json olarak indir"
                      >
                        <Download className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={(e) => handleStartDelete(p.id, e)}
                        className="p-1 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded transition cursor-pointer"
                        title="Projeyi sil"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => onOpenProject(p)}
                        className="px-2.5 py-1 bg-sky-600 hover:bg-sky-500 text-white text-[11px] font-semibold rounded-md transition cursor-pointer"
                      >
                        Aç
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Proje Yükle Modal */}
      {isLoadModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 backdrop-blur-xs p-4 animate-in fade-in">
          <div className="bg-white w-full max-w-2xl rounded-2xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[85vh]">
            {/* Modal Header */}
            <div className="p-4 sm:p-5 border-b border-slate-200 flex items-center justify-between bg-slate-50">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-indigo-100 text-indigo-700 flex items-center justify-center font-bold">
                  <FolderOpen className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-900">Proje Yükle (.json)</h3>
                  <p className="text-[11px] text-slate-500">
                    Kayıtlı projelerden seçin veya bilgisayarınızdan dosya yükleyin
                  </p>
                </div>
              </div>
              <button
                onClick={() => setIsLoadModalOpen(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-200 transition cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-5 overflow-y-auto custom-scrollbar space-y-6">
              {/* Tam Proje Arşivi Yükle (.zip) - HMAC Korumalı */}
              <div className="bg-emerald-50/70 p-5 rounded-2xl border-2 border-emerald-300 hover:border-emerald-500 transition shadow-xs flex flex-col sm:flex-row items-center justify-between gap-4">
                <div className="flex items-start gap-3.5 min-w-0">
                  <div className="w-12 h-12 rounded-xl bg-emerald-600 text-white flex items-center justify-center shrink-0 shadow-sm">
                    <Archive className="w-6 h-6" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <h4 className="text-sm font-bold text-emerald-950">
                        Tam Proje Arşivi Yükle (.zip)
                      </h4>
                      <span className="text-[10px] font-extrabold uppercase bg-emerald-200 text-emerald-900 px-2 py-0.5 rounded-sm flex items-center gap-1">
                        <Lock className="w-3 h-3" />
                        <span>HMAC-SHA256 Korumalı</span>
                      </span>
                    </div>
                    <p className="text-xs text-emerald-800/80 mt-1 leading-relaxed">
                      Proje ayarları, koordinatlar, baz vektörleri, ham RINEX (.obs/.nav) ölçüleri ve dengeleme raporunu sıfır veri kaybı ve kriptografik tahrifat korumasıyla tek tıkla yükleyin.
                    </p>
                  </div>
                </div>

                <button
                  onClick={() => zipFileInputRef.current?.click()}
                  className="w-full sm:w-auto px-5 py-2.5 bg-emerald-700 hover:bg-emerald-600 text-white text-xs font-bold rounded-xl shadow-xs transition flex items-center justify-center gap-2 shrink-0 cursor-pointer whitespace-nowrap"
                >
                  <Upload className="w-4 h-4" />
                  <span>Arşiv Dosyası Seç (.zip)</span>
                </button>
              </div>

              {/* Divider */}
              <div className="relative text-center">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-slate-200" />
                </div>
                <span className="relative bg-white px-3 text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                  Kayıtlı Projeler ({savedProjects.length})
                </span>
              </div>

              {/* Option 2: Kayıtlı Projeler Listesi */}
              <div className="space-y-2.5">
                {savedProjects.length === 0 ? (
                  <div className="text-center py-10 px-4 bg-slate-50 rounded-xl border border-dashed border-slate-200 text-slate-400 text-xs">
                    <FolderOpen className="w-8 h-8 mx-auto mb-2 text-slate-300" />
                    <p className="font-semibold text-slate-600">Henüz Kayıtlı Proje Yok</p>
                    <p className="text-[11px] text-slate-400 mt-1 max-w-sm mx-auto">
                      Yeni bir proje başlatıp dengeleme hesabı tamamlandığında, projeleriniz otomatik olarak bu alanda listelenecektir.
                    </p>
                  </div>
                ) : (
                  savedProjects.map((p) => {
                    const stationCnt = p.stationCount ?? (p.data?.stations ? Object.keys(p.data.stations).length : p.pointCount ?? 0);
                    const baselineCnt = p.baselineCount ?? (p.data?.baselines ? p.data.baselines.length : 0);

                    if (deletingProjectId === p.id) {
                      return (
                        <div
                          key={p.id}
                          className="p-3.5 rounded-xl border border-rose-300 bg-rose-50 flex items-center justify-between gap-3 shadow-xs"
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <Trash2 className="w-4 h-4 text-rose-600 shrink-0" />
                            <span className="text-xs font-semibold text-rose-800 truncate">
                              "{p.name}" projesini kalıcı olarak silmek istiyor musunuz?
                            </span>
                          </div>
                          <div className="flex items-center gap-1.5 shrink-0">
                            <button
                              onClick={handleCancelDelete}
                              className="px-2.5 py-1 bg-white hover:bg-slate-100 text-slate-700 text-xs font-medium rounded-lg border border-slate-200 transition cursor-pointer"
                            >
                              Vazgeç
                            </button>
                            <button
                              onClick={(e) => handleConfirmDelete(p.id, e)}
                              className="px-3 py-1 bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold rounded-lg shadow-xs transition cursor-pointer"
                            >
                              Evet, Sil
                            </button>
                          </div>
                        </div>
                      );
                    }

                    if (editingProjectId === p.id) {
                      return (
                        <div
                          key={p.id}
                          className="p-3.5 rounded-xl border border-sky-400 bg-sky-50/60 flex items-center justify-between gap-3 shadow-xs"
                        >
                          <div className="flex-1">
                            <label className="text-[10px] font-bold text-sky-800 block mb-1">
                              Yeni Proje İsmi
                            </label>
                            <input
                              type="text"
                              value={editingName}
                              onChange={(e) => setEditingName(e.target.value)}
                              autoFocus
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') handleSaveRename(p.id);
                                if (e.key === 'Escape') handleCancelRename();
                              }}
                              className="w-full bg-white border border-sky-400 rounded-lg px-3 py-1.5 text-xs text-slate-900 font-bold focus:outline-hidden focus:ring-2 focus:ring-sky-500"
                            />
                          </div>
                          <div className="flex items-center gap-1.5 shrink-0 pt-4">
                            <button
                              onClick={handleCancelRename}
                              className="p-1.5 text-slate-500 hover:bg-slate-200 rounded-lg transition cursor-pointer"
                              title="İptal"
                            >
                              <X className="w-4 h-4" />
                            </button>
                            <button
                              onClick={(e) => handleSaveRename(p.id, e)}
                              className="px-3 py-1.5 bg-sky-600 hover:bg-sky-500 text-white text-xs font-bold rounded-lg shadow-xs transition flex items-center gap-1 cursor-pointer"
                              title="Kaydet"
                            >
                              <Check className="w-3.5 h-3.5" />
                              <span>Kaydet</span>
                            </button>
                          </div>
                        </div>
                      );
                    }

                    return (
                      <div
                        key={p.id}
                        className="p-3.5 rounded-xl border border-slate-200 bg-white hover:border-indigo-300 transition-all flex items-center justify-between gap-3 shadow-xs"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <h4 className="text-xs font-bold text-slate-900 truncate" title={p.name}>
                              {p.name}
                            </h4>
                            <button
                              onClick={(e) => handleStartRename(p, e)}
                              className="p-1 text-slate-400 hover:text-sky-600 hover:bg-sky-50 rounded transition cursor-pointer"
                              title="Proje ismini düzenle"
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </button>
                            {p.isAccepted !== undefined ? (
                              <span
                                className={`text-[10px] font-semibold px-2 py-0.5 rounded-full flex items-center gap-1 ${
                                  p.isAccepted
                                    ? 'bg-emerald-100 text-emerald-800'
                                    : 'bg-rose-100 text-rose-800'
                                }`}
                              >
                                {p.isAccepted ? (
                                  <>
                                    <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                                    <span>Kabul Edildi</span>
                                  </>
                                ) : (
                                  <>
                                    <AlertTriangle className="w-3 h-3 text-rose-600" />
                                    <span>Tolerans Dışı</span>
                                  </>
                                )}
                              </span>
                            ) : (
                              <span className="text-[10px] font-semibold bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full">
                                Taslak
                              </span>
                            )}
                          </div>

                          <div className="flex items-center gap-3 text-[11px] text-slate-500 mt-1 flex-wrap">
                            <span className="flex items-center gap-1 text-slate-600">
                              <Clock className="w-3.5 h-3.5 text-sky-600" />
                              <span>Dengeleme: <strong>{p.calculatedAt || p.updatedAt}</strong></span>
                            </span>
                            <span>•</span>
                            <span className="font-mono">{stationCnt} Nokta</span>
                            <span>•</span>
                            <span className="font-mono">{baselineCnt} Baz</span>
                            {p.sigma0 !== undefined && (
                              <>
                                <span>•</span>
                                <span className="font-mono">σ₀: {p.sigma0.toFixed(4)}</span>
                              </>
                            )}
                          </div>
                        </div>

                        {/* Action Buttons */}
                        <div className="flex items-center gap-1.5 shrink-0">
                          <button
                            onClick={(e) => handleDownloadProjectZip(p, e)}
                            className="p-1.5 text-slate-400 hover:text-emerald-700 hover:bg-emerald-50 rounded-lg transition cursor-pointer"
                            title="Tam Proje Arşivi İndir (.zip: JSON + Ham RINEX + Rapor - HMAC Korumalı)"
                          >
                            <Archive className="w-4 h-4 text-emerald-600" />
                          </button>
                          <button
                            onClick={() => handleDownloadProjectJSON(p)}
                            className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition cursor-pointer"
                            title="Projeyi .json olarak indir"
                          >
                            <Download className="w-4 h-4" />
                          </button>
                          <button
                            onClick={(e) => handleStartRename(p, e)}
                            className="p-1.5 text-slate-400 hover:text-sky-600 hover:bg-sky-50 rounded-lg transition cursor-pointer"
                            title="Proje ismini düzenle"
                          >
                            <Pencil className="w-4 h-4" />
                          </button>
                          <button
                            onClick={(e) => handleStartDelete(p.id, e)}
                            className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition cursor-pointer"
                            title="Projeyi sil"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => {
                              onOpenProject(p);
                              setIsLoadModalOpen(false);
                            }}
                            className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold rounded-lg shadow-xs transition flex items-center gap-1 cursor-pointer"
                          >
                            <span>Projeyi Aç</span>
                          </button>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            {/* Modal Footer */}
            <div className="p-3.5 bg-slate-50 border-t border-slate-200 flex justify-end">
              <button
                onClick={() => setIsLoadModalOpen(false)}
                className="px-4 py-2 bg-slate-200 hover:bg-slate-300 text-slate-700 text-xs font-semibold rounded-lg transition cursor-pointer"
              >
                Kapat
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Real-Time Archive Export / Import Progress Modal */}
      {archiveProgress && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/75 backdrop-blur-xs p-4 animate-in fade-in">
          <div className="bg-white w-full max-w-md rounded-2xl shadow-2xl border border-slate-200 p-6 space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-emerald-100 text-emerald-700 flex items-center justify-center shrink-0">
                <Loader2 className="w-5 h-5 animate-spin" />
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="text-sm font-bold text-slate-900 truncate">
                  {archiveProgress.type === 'export' ? 'Tam Proje Arşivi Paketleniyor (.zip)' : 'Tam Proje Arşivi Doğrulanıyor (.zip)'}
                </h3>
                <p className="text-xs text-slate-500 font-mono">
                  {archiveProgress.stage} • %{archiveProgress.percent}
                </p>
              </div>
            </div>

            <div className="space-y-1.5">
              <div className="w-full bg-slate-100 h-2.5 rounded-full overflow-hidden border border-slate-200">
                <div
                  className="h-full bg-emerald-600 transition-all duration-300"
                  style={{ width: `${archiveProgress.percent}%` }}
                />
              </div>
              <div className="flex justify-between text-[11px] text-slate-600 font-medium">
                <span className="truncate pr-2">{archiveProgress.message}</span>
                <span className="shrink-0 font-mono font-bold text-emerald-700">%{archiveProgress.percent}</span>
              </div>
              {archiveProgress.currentFile && (
                <p className="text-[10px] text-slate-400 font-mono truncate" title={archiveProgress.currentFile}>
                  İşlenen: {archiveProgress.currentFile}
                </p>
              )}
            </div>

            <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-400">
              <span className="flex items-center gap-1 text-emerald-700 font-semibold">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
                <span>HMAC-SHA256 Güvenlik Korumalı</span>
              </span>
              <span className="font-mono text-[10px] text-slate-400">100% Yerel / Çevrimdışı</span>
            </div>
          </div>
        </div>
      )}

      {/* Cryptographic Tamper Alert Modal */}
      {tamperError && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-xs p-4 animate-in fade-in">
          <div className="bg-white w-full max-w-lg rounded-2xl shadow-2xl border-2 border-rose-500 p-6 space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-xl bg-rose-100 text-rose-700 flex items-center justify-center shrink-0">
                <ShieldAlert className="w-6 h-6 text-rose-600" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-rose-900">
                  {tamperError.title}
                </h3>
                <p className="text-xs text-rose-700 font-semibold">
                  Güvenlik ve Bütünlük Denetimi Başarısız
                </p>
              </div>
            </div>

            <div className="p-3.5 bg-rose-50 rounded-xl border border-rose-200 text-xs text-rose-900 space-y-2 whitespace-pre-line leading-relaxed font-medium">
              {tamperError.message}
            </div>

            <p className="text-[11px] text-slate-500 leading-relaxed">
              Bu arşiv paketindeki orijinal ham RINEX ölçüleri, baz vektörleri veya koordinat verileri harici olarak değiştirilmiş ya da tahrif edilmiştir. Jeodezik doğruluk ve BÖHYY standartları gereği tahrif edilmiş veriler yüklenemez.
            </p>

            <div className="flex justify-end pt-2">
              <button
                onClick={() => setTamperError(null)}
                className="px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold rounded-lg shadow-xs transition cursor-pointer"
              >
                Anladım, Kapat
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
