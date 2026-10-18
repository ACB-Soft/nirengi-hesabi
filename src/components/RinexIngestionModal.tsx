/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * RINEX Ingestion & Offline Inspection Modal (Faz 1)
 * High-performance browser-based parsing of 24h RINEX v2/v3/v4 files using streaming chunk reading
 * and client-side OPFS (Origin Private File System) offline persistence.
 */

import React, { useState, useEffect, useRef } from 'react';
import {
  Station,
  StationType,
  RinexParsedSummary,
} from '../types/gnss';
import {
  parseRinexFile,
  createStationFromSummary,
} from '../utils/rinexStreamParser';
import {
  isOpfsSupported,
  saveRinexFileToOpfs,
  listRinexFilesInOpfs,
  loadRinexFileFromOpfs,
  deleteRinexFileFromOpfs,
  clearOpfsRinexDirectory,
  StoredRinexFile,
} from '../utils/opfsStorage';
import {
  Radio,
  Upload,
  CheckCircle2,
  AlertTriangle,
  FileText,
  Trash2,
  HardDrive,
  Cpu,
  Layers,
  Sparkles,
  X,
  ExternalLink,
  Satellite,
  Compass,
  Database,
  RefreshCw,
  Eye,
  Plus,
} from 'lucide-react';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  dom: number;
  surveyEpoch: number;
  onAddStation: (station: Station) => void;
  onDetectedSurveyEpoch?: (epoch: number, dateStr?: string) => void;
  onNavigateToOccupationView?: (stationId: string) => void;
}

export const RinexIngestionModal: React.FC<Props> = ({
  isOpen,
  onClose,
  dom,
  surveyEpoch,
  onAddStation,
  onDetectedSurveyEpoch,
  onNavigateToOccupationView,
}) => {
  const [isDragging, setIsDragging] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [parsedSummaries, setParsedSummaries] = useState<RinexParsedSummary[]>([]);
  const [storedFiles, setStoredFiles] = useState<StoredRinexFile[]>([]);
  const [opfsAvailable, setOpfsAvailable] = useState(false);
  const [activeTab, setActiveTab] = useState<'upload' | 'storage'>('upload');
  const [notification, setNotification] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setOpfsAvailable(isOpfsSupported());
    refreshStoredFiles();
  }, [isOpen]);

  const refreshStoredFiles = async () => {
    try {
      const files = await listRinexFilesInOpfs();
      setStoredFiles(files);
    } catch (err) {
      console.warn('Could not list OPFS files:', err);
    }
  };

  const handleFiles = async (files: FileList | File[]) => {
    if (!files || files.length === 0) return;
    setIsProcessing(true);
    setNotification(null);

    const newSummaries: RinexParsedSummary[] = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      try {
        // Parse streaming header and sample body
        const summary = await parseRinexFile(file, dom);

        // Save to client-side OPFS offline storage in background
        if (opfsAvailable) {
          try {
            await saveRinexFileToOpfs(file);
          } catch (storageErr) {
            console.warn('Failed saving to OPFS:', storageErr);
          }
        }

        newSummaries.push(summary);
      } catch (err) {
        console.error(`Error parsing RINEX file ${file.name}:`, err);
      }
    }

    setParsedSummaries((prev) => [...prev, ...newSummaries]);
    setIsProcessing(false);
    refreshStoredFiles();

    if (newSummaries.length > 0) {
      setNotification(`${newSummaries.length} adet RINEX dosyası başarıyla ayrıştırıldı.`);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleFiles(e.dataTransfer.files);
    }
  };

  const handleAddAllToProject = () => {
    if (parsedSummaries.length === 0) return;

    let addedCount = 0;
    parsedSummaries.forEach((summary) => {
      const station = createStationFromSummary(summary, {
        dom,
        surveyEpoch,
        forcedType: summary.detectedPointType,
      });

      onAddStation(station);
      addedCount++;

      if (summary.metadata.surveyEpoch && onDetectedSurveyEpoch) {
        onDetectedSurveyEpoch(summary.metadata.surveyEpoch, summary.metadata.firstObsTime);
      }
    });

    setNotification(`${addedCount} adet istasyon ağ projenize eklendi!`);
    setTimeout(() => {
      onClose();
    }, 800);
  };

  const handleAddSingleToProject = (summary: RinexParsedSummary) => {
    const station = createStationFromSummary(summary, {
      dom,
      surveyEpoch,
      forcedType: summary.detectedPointType,
    });

    onAddStation(station);
    if (summary.metadata.surveyEpoch && onDetectedSurveyEpoch) {
      onDetectedSurveyEpoch(summary.metadata.surveyEpoch, summary.metadata.firstObsTime);
    }

    setNotification(`"${station.name}" istasyonu ağ projenize eklendi.`);
  };

  const handleToggleStationType = (index: number) => {
    setParsedSummaries((prev) => {
      const updated = [...prev];
      const current = updated[index];
      const newType: StationType = current.detectedPointType === 'CORS' ? 'GROUND' : 'CORS';
      updated[index] = { ...current, detectedPointType: newType };
      return updated;
    });
  };

  const handleRemoveSummary = (index: number) => {
    setParsedSummaries((prev) => prev.filter((_, i) => i !== index));
  };

  const handleLoadFromOpfs = async (stored: StoredRinexFile) => {
    setIsProcessing(true);
    try {
      const file = await loadRinexFileFromOpfs(stored.name);
      if (file) {
        await handleFiles([file]);
        setActiveTab('upload');
      }
    } catch (err) {
      console.error('Error loading file from OPFS:', err);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleDeleteFromOpfs = async (name: string) => {
    await deleteRinexFileFromOpfs(name);
    refreshStoredFiles();
  };

  const handleClearAllStorage = async () => {
    if (window.confirm('Tüm çevrimdışı RINEX dosyaları tarayıcınızdan silinsin mi?')) {
      await clearOpfsRinexDirectory();
      refreshStoredFiles();
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 backdrop-blur-xs p-3 sm:p-6 animate-in fade-in">
      <div className="bg-white rounded-3xl shadow-2xl border border-slate-200 w-full max-w-5xl max-h-[92vh] flex flex-col overflow-hidden">
        
        {/* Header */}
        <div className="px-6 py-5 border-b border-slate-100 flex items-center justify-between bg-gradient-to-r from-slate-900 via-slate-800 to-sky-950 text-white shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-sky-500/20 border border-sky-400/30 flex items-center justify-center text-sky-400">
              <Radio className="w-5 h-5 animate-pulse" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-lg font-bold text-white">Çevrimdışı RINEX Veri İçe Aktarma & Ayrıştırma</h3>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-sky-500/20 text-sky-300 border border-sky-400/30">
                  Faz 1 Motoru
                </span>
              </div>
              <p className="text-xs text-slate-300">
                24 saatlik RINEX .obs/.nav dosyalarını tarayıcıda akışkan okuma ile anında ayrıştırın ve OPFS diskinizde saklayın.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="hidden sm:flex items-center gap-1.5 px-3 py-1 rounded-lg bg-slate-800/80 border border-slate-700 text-[11px] text-slate-300">
              <HardDrive className="w-3.5 h-3.5 text-emerald-400" />
              <span>{opfsAvailable ? 'OPFS Çevrimdışı Aktif' : 'Tarayıcı Önbelleği'}</span>
            </div>
            <button
              onClick={onClose}
              className="w-8 h-8 rounded-full hover:bg-white/10 text-slate-400 hover:text-white flex items-center justify-center transition"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Sub Header / Tabs */}
        <div className="px-6 py-2.5 bg-slate-50 border-b border-slate-200 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setActiveTab('upload')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition flex items-center gap-1.5 ${
                activeTab === 'upload'
                  ? 'bg-sky-600 text-white shadow-xs'
                  : 'text-slate-600 hover:bg-slate-200/70'
              }`}
            >
              <Upload className="w-3.5 h-3.5" />
              <span>Dosya Yükle & Ayrıştır ({parsedSummaries.length})</span>
            </button>
            <button
              onClick={() => setActiveTab('storage')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition flex items-center gap-1.5 ${
                activeTab === 'storage'
                  ? 'bg-sky-600 text-white shadow-xs'
                  : 'text-slate-600 hover:bg-slate-200/70'
              }`}
            >
              <HardDrive className="w-3.5 h-3.5" />
              <span>OPFS Çevrimdışı Depo ({storedFiles.length})</span>
            </button>
          </div>

          {notification && (
            <div className="text-xs font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 px-3 py-1 rounded-lg flex items-center gap-1.5 animate-in fade-in">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
              <span>{notification}</span>
            </div>
          )}
        </div>

        {/* Body Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {activeTab === 'upload' && (
            <>
              {/* Drag & Drop Zone */}
              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  setIsDragging(true);
                }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
                className={`border-2 border-dashed rounded-2xl p-8 text-center cursor-pointer transition flex flex-col items-center justify-center gap-3 ${
                  isDragging
                    ? 'border-sky-500 bg-sky-50/80 ring-4 ring-sky-100'
                    : 'border-slate-300 hover:border-sky-400 bg-slate-50/50 hover:bg-sky-50/30'
                }`}
              >
                <input
                  type="file"
                  ref={fileInputRef}
                  multiple
                  accept=".obs,.nav,.rnx,.crx,.o,.g,.n,.24o,.25o,.26o,.27o,.28o,.29o,.30o"
                  onChange={(e) => {
                    if (e.target.files) handleFiles(e.target.files);
                    e.target.value = '';
                  }}
                  className="hidden"
                />

                <div className="w-14 h-14 rounded-2xl bg-sky-100 text-sky-600 flex items-center justify-center shadow-xs">
                  {isProcessing ? (
                    <RefreshCw className="w-7 h-7 animate-spin" />
                  ) : (
                    <Upload className="w-7 h-7" />
                  )}
                </div>

                <div>
                  <div className="text-base font-bold text-slate-800">
                    {isProcessing
                      ? 'RINEX Dosyaları Akışkan Okunuyor...'
                      : 'RINEX Dosyalarını Buraya Sürükleyin veya Seçin'}
                  </div>
                  <p className="text-xs text-slate-500 mt-1 max-w-md mx-auto">
                    Desteklenen formatlar: <span className="font-semibold text-slate-700">RINEX 2.xx, 3.xx, 4.xx</span> (.obs, .nav, .rnx, .crx, .o, .g, .n).
                    Büyük 24 saatlik dosyalar UI donmadan parça parça işlenir.
                  </p>
                </div>

                <div className="flex flex-wrap items-center justify-center gap-2 pt-1 text-[11px] text-slate-500">
                  <span className="px-2.5 py-1 rounded-full bg-white border border-slate-200">Çevrimdışı Güvenli</span>
                  <span className="px-2.5 py-1 rounded-full bg-white border border-slate-200">Sıfır Sunucu Yükü</span>
                  <span className="px-2.5 py-1 rounded-full bg-white border border-slate-200">NOAA Antcal Eşleşmesi</span>
                </div>
              </div>

              {/* Parsed Summaries List */}
              {parsedSummaries.length > 0 && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <h4 className="text-sm font-bold text-slate-800 flex items-center gap-2">
                      <Sparkles className="w-4 h-4 text-sky-600" />
                      <span>Ayrıştırılan İstasyonlar ve Gözlem Verileri ({parsedSummaries.length})</span>
                    </h4>

                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => setParsedSummaries([])}
                        className="px-3 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-100 text-xs font-semibold text-slate-600 transition"
                      >
                        Listeyi Temizle
                      </button>
                      <button
                        onClick={handleAddAllToProject}
                        className="px-4 py-1.5 rounded-xl bg-sky-600 hover:bg-sky-700 text-white text-xs font-bold shadow-xs transition flex items-center gap-1.5"
                      >
                        <Plus className="w-4 h-4" />
                        <span>Tümünü Projeye Ekle ({parsedSummaries.length})</span>
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-4">
                    {parsedSummaries.map((summary, idx) => {
                      const { metadata, geodeticApprox, detectedPointType } = summary;
                      const hasWarnings = metadata.warnings.length > 0;
                      const satCount = summary.occupation?.satellites.length || 0;

                      return (
                        <div
                          key={`${metadata.fileName}-${idx}`}
                          className="p-5 rounded-2xl bg-white border border-slate-200 shadow-xs hover:border-sky-300 transition space-y-4"
                        >
                          {/* Card Top Row */}
                          <div className="flex flex-wrap items-center justify-between gap-3">
                            <div className="flex items-center gap-3">
                              <div className={`w-11 h-11 rounded-xl flex items-center justify-center font-black text-sm tracking-wider ${
                                detectedPointType === 'CORS'
                                  ? 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                                  : 'bg-sky-100 text-sky-800 border border-sky-300'
                              }`}>
                                {metadata.markerName.substring(0, 4)}
                              </div>

                              <div>
                                <div className="flex items-center gap-2">
                                  <span className="text-base font-extrabold text-slate-900">
                                    {metadata.markerName}
                                  </span>
                                  <button
                                    onClick={() => handleToggleStationType(idx)}
                                    className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold border transition ${
                                      detectedPointType === 'CORS'
                                        ? 'bg-emerald-50 text-emerald-700 border-emerald-300 hover:bg-emerald-100'
                                        : 'bg-sky-50 text-sky-700 border-sky-300 hover:bg-sky-100'
                                    }`}
                                    title="Tıklayarak CORS veya Rover tipine dönüştürün"
                                  >
                                    {detectedPointType === 'CORS' ? 'TUSAGA Sabit (CORS)' : 'Dengelenecek Rover'}
                                  </button>
                                  <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-slate-100 text-slate-700">
                                    v{metadata.rinexVersion}
                                  </span>
                                </div>
                                <div className="text-xs text-slate-500 font-mono">
                                  {metadata.fileName} ({(metadata.fileSizeBytes / (1024 * 1024)).toFixed(2)} MB)
                                </div>
                              </div>
                            </div>

                            <div className="flex items-center gap-2">
                              {onNavigateToOccupationView && (
                                <button
                                  onClick={() => {
                                    handleAddSingleToProject(summary);
                                    onNavigateToOccupationView(metadata.markerName);
                                    onClose();
                                  }}
                                  className="px-3 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-100 text-xs font-semibold text-slate-700 transition flex items-center gap-1.5"
                                  title="Topcon Tools tarzı Uydu/Oturum zaman çizelgesini aç"
                                >
                                  <Eye className="w-3.5 h-3.5 text-sky-600" />
                                  <span>Oturum Görünümü</span>
                                </button>
                              )}

                              <button
                                onClick={() => handleAddSingleToProject(summary)}
                                className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold transition flex items-center gap-1.5 shadow-2xs"
                              >
                                <Plus className="w-3.5 h-3.5" />
                                <span>Projeye Ekle</span>
                              </button>

                              <button
                                onClick={() => handleRemoveSummary(idx)}
                                className="p-1.5 rounded-lg hover:bg-rose-50 text-slate-400 hover:text-rose-600 transition"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                          </div>

                          {/* Data Badges Grid */}
                          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                            <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-100">
                              <span className="text-[10px] text-slate-400 block font-semibold">ÖLÇÜ EPOĞU & ZAMAN</span>
                              <span className="font-bold text-slate-800">
                                {metadata.surveyEpoch ? `t = ${metadata.surveyEpoch.toFixed(2)}` : '-'}
                              </span>
                              <div className="text-[10px] text-slate-500 truncate" title={metadata.firstObsTime}>
                                {metadata.firstObsTime || 'Zaman okunamadı'}
                              </div>
                            </div>

                            <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-100">
                              <span className="text-[10px] text-slate-400 block font-semibold">ANTEN & YÜKSEKLİK</span>
                              <span className="font-bold text-slate-800 truncate block" title={metadata.antennaType}>
                                {metadata.antennaType || 'Belirtilmemiş'}
                              </span>
                              <div className="text-[10px] text-sky-700 font-semibold">
                                ΔH: {metadata.deltaH.toFixed(3)} m (ARP)
                              </div>
                            </div>

                            <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-100">
                              <span className="text-[10px] text-slate-400 block font-semibold">ALICI & FIRMWARE</span>
                              <span className="font-bold text-slate-800 truncate block" title={metadata.receiverType}>
                                {metadata.receiverType || 'GNSS Receiver'}
                              </span>
                              <div className="text-[10px] text-slate-500 truncate">
                                {metadata.receiverVersion || 'v1.0'}
                              </div>
                            </div>

                            <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-100">
                              <span className="text-[10px] text-slate-400 block font-semibold">UYDULAR & ARALIK</span>
                              <span className="font-bold text-slate-800 flex items-center gap-1">
                                <Satellite className="w-3.5 h-3.5 text-emerald-600" />
                                <span>{satCount} Uydu Takip Edildi</span>
                              </span>
                              <div className="text-[10px] text-slate-500">
                                Örnekleme: {metadata.intervalSec || 30} sn
                              </div>
                            </div>
                          </div>

                          {/* Coordinates Preview */}
                          <div className="p-3 rounded-xl bg-sky-50/50 border border-sky-100 flex flex-wrap items-center justify-between text-xs text-slate-700">
                            <div className="flex items-center gap-2">
                              <Compass className="w-4 h-4 text-sky-600" />
                              <span className="font-bold text-sky-950">TUREF Projeksiyon (DOM {dom}°):</span>
                            </div>
                            <div className="flex items-center gap-4 font-mono text-[11px]">
                              <span>Y (Sağa): <strong className="text-slate-900">{geodeticApprox.projY.toFixed(3)} m</strong></span>
                              <span>X (Yukarı): <strong className="text-slate-900">{geodeticApprox.projX.toFixed(3)} m</strong></span>
                              <span>h: <strong className="text-slate-900">{geodeticApprox.h.toFixed(3)} m</strong></span>
                            </div>
                          </div>

                          {/* Warnings */}
                          {hasWarnings && (
                            <div className="p-2.5 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-xs space-y-1">
                              {metadata.warnings.map((w, wIdx) => (
                                <div key={wIdx} className="flex items-center gap-1.5">
                                  <AlertTriangle className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                                  <span>{w}</span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </>
          )}

          {activeTab === 'storage' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="text-sm font-bold text-slate-800 flex items-center gap-2">
                    <HardDrive className="w-4 h-4 text-emerald-600" />
                    <span>OPFS Çevrimdışı RINEX Deposu</span>
                  </h4>
                  <p className="text-xs text-slate-500">
                    Kullanıcının tarayıcısına yerel olarak kaydedilmiş RINEX dosyaları (İnternetsiz arazide kullanılabilir).
                  </p>
                </div>

                {storedFiles.length > 0 && (
                  <button
                    onClick={handleClearAllStorage}
                    className="px-3 py-1.5 rounded-lg border border-rose-200 hover:bg-rose-50 text-xs font-semibold text-rose-600 transition flex items-center gap-1.5"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Tüm Depoyu Temizle</span>
                  </button>
                )}
              </div>

              {storedFiles.length === 0 ? (
                <div className="p-12 text-center border border-dashed border-slate-200 rounded-2xl space-y-2">
                  <Database className="w-8 h-8 text-slate-300 mx-auto" />
                  <div className="text-sm font-semibold text-slate-600">Henüz çevrimdışı depoda kayıtlı RINEX dosyası yok.</div>
                  <p className="text-xs text-slate-400">Yüklediğiniz dosyalar otomatik olarak buraya kaydedilir.</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {storedFiles.map((sf) => (
                    <div
                      key={sf.name}
                      className="p-4 rounded-xl bg-slate-50 border border-slate-200 flex items-center justify-between gap-3 shadow-2xs"
                    >
                      <div className="min-w-0">
                        <div className="text-xs font-bold text-slate-800 truncate" title={sf.name}>
                          {sf.name}
                        </div>
                        <div className="text-[10px] text-slate-500">
                          Boyut: {(sf.size / (1024 * 1024)).toFixed(2)} MB • {sf.isOpfs ? 'OPFS Yerel Disk' : 'Önbellek'}
                        </div>
                      </div>

                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          onClick={() => handleLoadFromOpfs(sf)}
                          className="px-2.5 py-1 rounded-lg bg-sky-600 hover:bg-sky-700 text-white text-[11px] font-bold transition flex items-center gap-1"
                        >
                          <RefreshCw className="w-3 h-3" />
                          <span>Yeniden Ayrıştır</span>
                        </button>
                        <button
                          onClick={() => handleDeleteFromOpfs(sf.name)}
                          className="p-1.5 rounded-lg hover:bg-rose-50 text-slate-400 hover:text-rose-600 transition"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 bg-slate-50 border-t border-slate-200 flex items-center justify-between shrink-0">
          <div className="text-xs text-slate-500">
            {parsedSummaries.length > 0
              ? `${parsedSummaries.length} dosya ayrıştırıldı`
              : 'Hazır. Dosya yükleyin veya sürükleyin.'}
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-xl border border-slate-200 hover:bg-slate-100 text-xs font-semibold text-slate-600 transition"
            >
              Kapat
            </button>
            {parsedSummaries.length > 0 && (
              <button
                onClick={handleAddAllToProject}
                className="px-5 py-2 rounded-xl bg-sky-600 hover:bg-sky-700 text-white text-xs font-bold shadow-xs transition flex items-center gap-1.5"
              >
                <Plus className="w-4 h-4" />
                <span>Seçilenleri Projeye Aktar</span>
              </button>
            )}
          </div>
        </div>

      </div>
    </div>
  );
};
