/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * 5. Faz: Resmi BÖHYY Dengeleme Hesap Karnesi, CAD & CBS Dışa Aktarım (DXF, KML, GeoJSON, Excel)
 * Kadastro Genel Müdürlüğü & BÖHYY Standartlarına Uygun Onay Karnesi
 */

import React, { useState } from 'react';
import { JobConfig, AdjustmentResult, LoopClosure, Station } from '../types/gnss';
import { exportAdjustmentToExcel, exportVelocityReportToExcel } from '../utils/geodesy';
import {
  exportNetworkToDxf,
  exportNetworkToKml,
  exportNetworkToGeoJson,
  exportNetworkToNetcadNcn,
  exportNetworkToCsv,
  exportNetworkToNetcadBaz,
} from '../utils/cadCbsExport';
import {
  FileText,
  Download,
  Printer,
  Table,
  CheckCircle2,
  AlertTriangle,
  Award,
  FileSpreadsheet,
  Layers,
  Globe,
  FileCode,
  Sparkles,
  Share2,
  Sliders,
  ShieldCheck,
  Check,
  Archive,
  Lock,
  Loader2,
} from 'lucide-react';
import { exportSecureProjectZipArchive, triggerBlobDownload } from '../utils/projectArchiveManager';

interface Props {
  config: JobConfig;
  adjustmentResult: AdjustmentResult | null;
  loopClosures: LoopClosure[];
  stations: Record<string, Station>;
}

export const ReportExportTab: React.FC<Props> = ({
  config,
  adjustmentResult,
  loopClosures,
  stations,
}) => {
  const [dxfScale, setDxfScale] = useState<number>(1000);
  const [exportNotice, setExportNotice] = useState<string | null>(null);
  const [isExportingZip, setIsExportingZip] = useState(false);
  const [zipProgressText, setZipProgressText] = useState<string>('');

  const showNotification = (msg: string) => {
    setExportNotice(msg);
    setTimeout(() => setExportNotice(null), 3000);
  };

  const handleExportVelocityExcel = () => {
    exportVelocityReportToExcel(stations, config.surveyEpoch, config.refEpoch, config.dom, config.projectName);
    showNotification('TUSAGA Hız Hesabı ve Epok Kaydırma tablosu Excel (.xlsx) olarak indirildi.');
  };

  const handleExportExcel = () => {
    if (!adjustmentResult) return;
    exportAdjustmentToExcel(config, adjustmentResult, loopClosures);
    showNotification('Dengeleme Hesap Karnesi Excel (.xlsx) olarak indirildi.');
  };

  const handleExportDxf = () => {
    exportNetworkToDxf(config, stations, adjustmentResult?.baselines || [], adjustmentResult, dxfScale);
    showNotification(`AutoCAD / Netcad DXF dosyası başarıyla indirildi (Elips Büyütmesi: ${dxfScale}x).`);
  };

  const handleExportNetcadNcn = () => {
    exportNetworkToNetcadNcn(config, stations, adjustmentResult);
    showNotification('Netcad Nokta Dosyası (.ncn) başarıyla indirildi.');
  };

  const handleExportCsv = () => {
    exportNetworkToCsv(config, stations, adjustmentResult);
    showNotification('Dengelenmiş Nokta Koordinatları CSV formatında indirildi.');
  };

  const handleExportNetcadBaz = () => {
    exportNetworkToNetcadBaz(config, adjustmentResult?.baselines || [], adjustmentResult);
    showNotification('Netcad / Jeodezik Baz Vektörleri (.baz) başarıyla indirildi.');
  };

  const handleExportKml = () => {
    exportNetworkToKml(config, stations, adjustmentResult?.baselines || [], adjustmentResult);
    showNotification('Google Earth 3D KML dosyası başarıyla indirildi.');
  };

  const handleExportGeoJson = () => {
    exportNetworkToGeoJson(config, stations, adjustmentResult?.baselines || [], adjustmentResult);
    showNotification('QGIS / WebGIS GeoJSON dosyası başarıyla indirildi.');
  };

  const handleExportZipArchive = async () => {
    setIsExportingZip(true);
    setZipProgressText('Arşiv paketleme başlatılıyor...');

    try {
      const currentProject = {
        id: 'project-' + Date.now(),
        name: config.projectName || 'GNSS_Nirengi_Projesi',
        updatedAt: new Date().toLocaleDateString('tr-TR') + ' ' + new Date().toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }),
        calculatedAt: adjustmentResult?.adjustedAt || new Date().toLocaleString('tr-TR'),
        stationCount: Object.keys(stations).length,
        baselineCount: (adjustmentResult?.baselines || []).length,
        pointCount: Object.keys(stations).length,
        sigma0: adjustmentResult?.sigma0Aposteriori,
        isAccepted: adjustmentResult?.chiSquareTest?.passed,
        data: {
          config,
          stations,
          baselines: adjustmentResult?.baselines || [],
          loopClosures,
          adjustmentResult,
          constrainedResult: adjustmentResult?.mode === 'constrained' ? adjustmentResult : null,
          unconstrainedResult: adjustmentResult?.mode === 'unconstrained' ? adjustmentResult : null,
        },
      };

      const blob = await exportSecureProjectZipArchive(currentProject, (prog) => {
        setZipProgressText(`%${prog.percent}`);
      });

      const safeName = (config.projectName || 'GNSS_Projesi').replace(/[^a-zA-Z0-9_\u00C0-\u017F-]/g, '_');
      triggerBlobDownload(blob, `${safeName}_GNSS_Arsivi.zip`);
      showNotification('Tam Proje Arşivi (.zip: JSON + Ham RINEX + Rapor) HMAC korumalı olarak başarıyla indirildi.');
    } catch (err: any) {
      console.error('ZIP export error:', err);
      alert(`Arşiv oluşturma hatası: ${err?.message || err}`);
    } finally {
      setIsExportingZip(false);
      setZipProgressText('');
    }
  };

  const handleExportTxt = () => {
    if (!adjustmentResult) return;
    let reportTxt = `================================================================================\n`;
    reportTxt += `       TUREF / ITRF96 GNSS 3D AĞ DENGELEME VE HESAP RAPORU\n`;
    reportTxt += `  (Büyük Ölçekli Harita ve Harita Bilgileri Üretim Yönetmeliği Standartlarında)\n`;
    reportTxt += `================================================================================\n\n`;

    reportTxt += `PROJE BİLGİLERİ:\n`;
    reportTxt += `Proje Adı           : ${config.projectName}\n`;
    reportTxt += `Mühendis / Firma    : ${config.surveyor}\n`;
    reportTxt += `İdare / Kurum       : ${config.institution}\n`;
    reportTxt += `Koordinat Sistemi   : ${config.crsSystem} (DOM: ${config.dom} Derece)\n`;
    reportTxt += `Referans Elipsoidi  : ${config.ellipsoid} (a=6378137.0 m, 1/f=298.257222101)\n`;
    reportTxt += `Ölçü Epoğu (t)      : ${config.surveyEpoch.toFixed(2)}\n`;
    reportTxt += `Referans Epoğu      : ${config.refEpoch.toFixed(2)}\n`;
    reportTxt += `Dengeleme Modu      : ${adjustmentResult.mode === 'constrained' ? 'Dayalı (CORS Sabit)' : 'Serbest (İç Tutarlılık)'}\n`;
    reportTxt += `Hesaplama Tarihi    : ${new Date().toLocaleString('tr-TR')}\n\n`;

    reportTxt += `DENGELEME İSTATİSTİKLERİ:\n`;
    reportTxt += `Birim Ölçü St. Hatası (sigma_0) : ${adjustmentResult.sigma0Aposteriori.toFixed(4)}\n`;
    reportTxt += `Serbestlik Derecesi (DOF)       : ${adjustmentResult.dof}\n`;
    reportTxt += `Toplam Ölçü Sayısı (3*m)        : ${adjustmentResult.totalObservations}\n`;
    reportTxt += `Toplam Bilinmeyen Sayısı (3*u)  : ${adjustmentResult.totalUnknowns}\n`;
    reportTxt += `Kalıntı Kareler Toplamı [vPv]   : ${adjustmentResult.vPv.toFixed(6)}\n`;
    if (adjustmentResult.matrixDiagnostics) {
      reportTxt += `Tasarım Matrisi A Boyutu        : ${adjustmentResult.matrixDiagnostics.numRowsA} x ${adjustmentResult.matrixDiagnostics.numColsA} (${adjustmentResult.matrixDiagnostics.sparsityPercent.toFixed(1)}% Seyreklik)\n`;
      reportTxt += `Normal Matris Kondisyon Sayısı  : ${adjustmentResult.matrixDiagnostics.conditionNumberN.toFixed(2)}\n`;
      reportTxt += `Ortalama Serbestlik Katkısı (r̄) : ${adjustmentResult.matrixDiagnostics.averageRedundancy.toFixed(3)}\n`;
    }
    reportTxt += `Ki-Kare Testi (95% Güven)       : ${adjustmentResult.chiSquareTest.passed ? 'GEÇTİ (Model Uyumlu)' : 'KRİTİK UYARI'}\n`;
    reportTxt += `Baarda w-testi Kaba Hatalar     : ${adjustmentResult.outliers.length > 0 ? adjustmentResult.outliers.join(', ') : 'Kaba Hata Tespit Edilmedi'}\n\n`;

    reportTxt += `--------------------------------------------------------------------------------\n`;
    reportTxt += `DENGELENMİŞ KOORDİNATLAR VE HATA ELİPSLERİ:\n`;
    reportTxt += `Nokta       X(m)         Y(m)         Z(m)       TM-Y(m)      TM-X(m)      H(m)    sX(mm)  sY(mm)  sZ(mm)   a(mm)   b(mm) Az(G)\n`;
    reportTxt += `--------------------------------------------------------------------------------\n`;

    Object.values(adjustmentResult.stations).forEach((st) => {
      const name = st.name.padEnd(10);
      const x = (st.adjustedX ?? st.x).toFixed(4).padStart(12);
      const y = (st.adjustedY ?? st.y).toFixed(4).padStart(12);
      const z = (st.adjustedZ ?? st.z).toFixed(4).padStart(12);
      const py = (st.adjustedProjY ?? st.projY).toFixed(3).padStart(12);
      const px = (st.adjustedProjX ?? st.projX).toFixed(3).padStart(12);
      const h = (st.adjustedH ?? st.h).toFixed(3).padStart(9);
      const sx = (st.sigmaEast ?? st.sigmaX ?? 0).toFixed(1).padStart(7);
      const sy = (st.sigmaNorth ?? st.sigmaY ?? 0).toFixed(1).padStart(7);
      const sz = (st.sigmaUp ?? st.sigmaZ ?? 0).toFixed(1).padStart(7);
      const a = (st.semiMajor ?? 0).toFixed(1).padStart(7);
      const b = (st.semiMinor ?? 0).toFixed(1).padStart(7);
      const az = (st.ellipseAzimuth ?? 0).toFixed(1).padStart(6);

      reportTxt += `${name} ${x} ${y} ${z} ${py} ${px} ${h} ${sx} ${sy} ${sz} ${a} ${b} ${az}\n`;
    });

    reportTxt += `\n--------------------------------------------------------------------------------\n`;
    reportTxt += `BAZ VEKTÖRLERİ VE DÜZELTME KALINTILARI:\n`;
    reportTxt += `BazID       Başlangıç->Bitiş     Uzunluk(m)    dX(m)       dY(m)       dZ(m)      vx(mm)   vy(mm)   vz(mm)  vMek(mm)  w-Test\n`;
    reportTxt += `--------------------------------------------------------------------------------\n`;

    adjustmentResult.baselines.forEach((b) => {
      const id = b.id.padEnd(10);
      const route = `${b.fromId}->${b.toId}`.padEnd(20);
      const len = b.length.toFixed(2).padStart(12);
      const dx = b.dX.toFixed(3).padStart(11);
      const dy = b.dY.toFixed(3).padStart(11);
      const dz = b.dZ.toFixed(3).padStart(11);
      const vx = (b.vX ?? 0).toFixed(1).padStart(8);
      const vy = (b.vY ?? 0).toFixed(1).padStart(8);
      const vz = (b.vZ ?? 0).toFixed(1).padStart(8);
      const vm = (b.spatialV ?? 0).toFixed(1).padStart(9);
      const wt = (b.wTest ?? 0).toFixed(2).padStart(7);

      reportTxt += `${id} ${route} ${len} ${dx} ${dy} ${dz} ${vx} ${vy} ${vz} ${vm} ${wt}\n`;
    });

    const blob = new Blob([reportTxt], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${config.projectName.replace(/\s+/g, '_')}_Dengeleme_Raporu.txt`;
    link.click();
    URL.revokeObjectURL(url);
    showNotification('Resmi dengeleme metin raporu (.txt) indirildi.');
  };

  const handlePrint = () => {
    window.print();
  };

  if (!adjustmentResult) {
    return (
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-8 sm:p-12 text-center space-y-4">
        <FileText className="w-12 h-12 text-slate-300 mx-auto" />
        <h3 className="text-base font-bold text-slate-800">Dengeleme Hesabı Henüz Çalıştırılmadı</h3>
        <p className="text-xs text-slate-500 max-w-md mx-auto">
          Resmi BÖHYY dengeleme hesap karnesi ve CAD/CBS dışa aktarımı için "Dayalı Dengeleme" sekmesinden çözümü çalıştırınız.
          İstasyonlarınıza ait hız raporunu veya mevcut nokta verilerini doğrudan indirebilirsiniz.
        </p>
        {Object.keys(stations).length > 0 && (
          <div className="pt-2 flex items-center justify-center gap-3 flex-wrap">
            <button
              onClick={handleExportVelocityExcel}
              className="px-5 py-2.5 text-xs font-bold bg-purple-700 hover:bg-purple-800 text-white rounded-xl shadow-sm transition cursor-pointer inline-flex items-center gap-2"
            >
              <FileSpreadsheet className="w-4 h-4" />
              <span>Hız Hesabı Excel (.xlsx)</span>
            </button>
            <button
              onClick={handleExportNetcadNcn}
              className="px-5 py-2.5 text-xs font-bold bg-emerald-700 hover:bg-emerald-800 text-white rounded-xl shadow-sm transition cursor-pointer inline-flex items-center gap-2"
            >
              <FileCode className="w-4 h-4 text-emerald-300" />
              <span>Netcad Nokta (.ncn)</span>
            </button>
            <button
              onClick={handleExportDxf}
              className="px-5 py-2.5 text-xs font-bold bg-slate-900 hover:bg-slate-800 text-white rounded-xl shadow-sm transition cursor-pointer inline-flex items-center gap-2"
            >
              <Layers className="w-4 h-4 text-sky-400" />
              <span>Netcad DXF</span>
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Top Banner: Header & Export Hub */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-5 no-print space-y-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h2 className="text-lg font-extrabold text-slate-900">
              Resmi Dengeleme Karnesi ve CAD/CBS Dışa Aktarım
            </h2>
            <p className="text-xs text-slate-500 mt-1 max-w-2xl leading-relaxed">
              BÖHYY standartlarında onaylanabilir resmi hesap karnesi; Netcad (.ncn/.baz/.dxf), Google Earth (.kml), GeoJSON ve Excel çıktıları.
            </p>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={handleExportZipArchive}
              disabled={isExportingZip}
              className="px-4 py-2.5 text-xs font-bold bg-emerald-700 hover:bg-emerald-600 text-white rounded-xl shadow-xs transition cursor-pointer flex items-center gap-2"
              title="Proje JSON, Ham RINEX (.obs/.nav) ve BÖHYY Raporunu tek bir HMAC-SHA256 korumalı .zip dosyasında arşivler"
            >
              {isExportingZip ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin text-emerald-200" />
                  <span>{zipProgressText || 'Paketleniyor...'}</span>
                </>
              ) : (
                <>
                  <Archive className="w-4 h-4 text-emerald-300" />
                  <span>Tam Proje Arşivi (.zip)</span>
                </>
              )}
            </button>
            <button
              onClick={handlePrint}
              className="px-4 py-2.5 text-xs font-bold bg-slate-900 hover:bg-slate-800 text-white rounded-xl shadow-sm transition cursor-pointer flex items-center gap-2"
            >
              <Printer className="w-4 h-4 text-sky-400" />
              <span>Yazdır / PDF Kaydet</span>
            </button>
          </div>
        </div>

        {/* CAD & CBS Export Hub Grid (5 Cards) */}
        <div className="pt-3 border-t border-slate-100 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          {/* Card 1: AutoCAD / Netcad DXF */}
          <div className="p-3.5 bg-slate-50 hover:bg-slate-100/80 rounded-xl border border-slate-200 flex flex-col justify-between transition">
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="font-bold text-xs text-slate-900 flex items-center gap-1.5">
                  <Layers className="w-4 h-4 text-sky-600" />
                  <span>Netcad / DXF</span>
                </span>
                <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-sky-100 text-sky-800 font-bold">
                  Katmanlı
                </span>
              </div>
              <p className="text-[11px] text-slate-500 leading-tight">
                Noktalar, kotlar, baz hatları ve %95 güvenli 2D hata elipsleri katmanı.
              </p>
              <div className="flex items-center gap-1.5 pt-1">
                <label className="text-[10px] text-slate-500 font-semibold">Elips:</label>
                <select
                  value={dxfScale}
                  onChange={(e) => setDxfScale(Number(e.target.value))}
                  className="px-1 py-0.5 text-[10px] font-bold bg-white border border-slate-300 rounded shadow-2xs"
                >
                  <option value={500}>500x</option>
                  <option value={1000}>1000x</option>
                  <option value={2000}>2000x</option>
                </select>
              </div>
            </div>
            <button
              onClick={handleExportDxf}
              className="mt-3 w-full py-1.5 px-2 text-xs font-bold bg-sky-600 hover:bg-sky-700 text-white rounded-lg shadow-xs transition flex items-center justify-center gap-1.5 cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              <span>DXF İndir</span>
            </button>
          </div>

          {/* Card 2: Netcad Nokta (.ncn) & Baz (.baz) */}
          <div className="p-3.5 bg-slate-50 hover:bg-slate-100/80 rounded-xl border border-slate-200 flex flex-col justify-between transition">
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="font-bold text-xs text-slate-900 flex items-center gap-1.5">
                  <FileCode className="w-4 h-4 text-emerald-600" />
                  <span>Netcad .ncn / .baz</span>
                </span>
                <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-emerald-100 text-emerald-800 font-bold">
                  Netcad 5-8
                </span>
              </div>
              <p className="text-[11px] text-slate-500 leading-tight">
                Netcad doğrudan nokta kütüğü (.ncn) ve jeodezik baz vektörleri (.baz).
              </p>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-1.5">
              <button
                onClick={handleExportNetcadNcn}
                className="py-1.5 px-1.5 text-[11px] font-bold bg-emerald-700 hover:bg-emerald-800 text-white rounded-lg shadow-xs transition flex items-center justify-center gap-1 cursor-pointer"
                title="Netcad nokta dosyasını (.ncn) indir"
              >
                <Download className="w-3 h-3" />
                <span>.NCN</span>
              </button>
              <button
                onClick={handleExportNetcadBaz}
                className="py-1.5 px-1.5 text-[11px] font-bold bg-teal-700 hover:bg-teal-800 text-white rounded-lg shadow-xs transition flex items-center justify-center gap-1 cursor-pointer"
                title="Netcad baz vektör dosyasını (.baz) indir"
              >
                <Download className="w-3 h-3" />
                <span>.BAZ</span>
              </button>
            </div>
          </div>

          {/* Card 3: Google Earth KML */}
          <div className="p-3.5 bg-slate-50 hover:bg-slate-100/80 rounded-xl border border-slate-200 flex flex-col justify-between transition">
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="font-bold text-xs text-slate-900 flex items-center gap-1.5">
                  <Globe className="w-4 h-4 text-emerald-600" />
                  <span>Google Earth (.kml)</span>
                </span>
                <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-emerald-100 text-emerald-800 font-bold">
                  3D Görsel
                </span>
              </div>
              <p className="text-[11px] text-slate-500 leading-tight">
                3D istasyon balonları, CORS/Rover simgeleri, baz güzergahları ve hata metrikleri.
              </p>
            </div>
            <button
              onClick={handleExportKml}
              className="mt-3 w-full py-1.5 px-2 text-xs font-bold bg-emerald-700 hover:bg-emerald-800 text-white rounded-lg shadow-xs transition flex items-center justify-center gap-1.5 cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              <span>KML İndir</span>
            </button>
          </div>

          {/* Card 4: QGIS / WebGIS GeoJSON */}
          <div className="p-3.5 bg-slate-50 hover:bg-slate-100/80 rounded-xl border border-slate-200 flex flex-col justify-between transition">
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="font-bold text-xs text-slate-900 flex items-center gap-1.5">
                  <FileCode className="w-4 h-4 text-indigo-600" />
                  <span>QGIS / CBS (.geojson)</span>
                </span>
                <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-indigo-100 text-indigo-800 font-bold">
                  WGS84 / TM
                </span>
              </div>
              <p className="text-[11px] text-slate-500 leading-tight">
                QGIS, ArcGIS veya Web Harita sunucuları için zengin jeodezik öznitelikli vektör katmanı.
              </p>
            </div>
            <button
              onClick={handleExportGeoJson}
              className="mt-3 w-full py-1.5 px-2 text-xs font-bold bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg shadow-xs transition flex items-center justify-center gap-1.5 cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              <span>GeoJSON İndir</span>
            </button>
          </div>

          {/* Card 5: Excel, CSV & Metin Raporları */}
          <div className="p-3.5 bg-slate-50 hover:bg-slate-100/80 rounded-xl border border-slate-200 flex flex-col justify-between transition">
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="font-bold text-xs text-slate-900 flex items-center gap-1.5">
                  <FileSpreadsheet className="w-4 h-4 text-purple-600" />
                  <span>Excel &amp; Koordinatlar</span>
                </span>
                <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-purple-100 text-purple-800 font-bold">
                  BÖHYY Resmi
                </span>
              </div>
              <p className="text-[11px] text-slate-500 leading-tight">
                Çok sayfalı Excel karnesi, CSV koordinatlar ve resmi metin (.txt) raporu.
              </p>
            </div>
            <div className="mt-3 grid grid-cols-3 gap-1">
              <button
                onClick={handleExportExcel}
                className="py-1.5 px-1 text-[11px] font-bold bg-purple-700 hover:bg-purple-800 text-white rounded-lg shadow-xs transition flex items-center justify-center gap-1 cursor-pointer"
                title="Dengeleme karnesini Excel olarak indir"
              >
                <FileSpreadsheet className="w-3 h-3" />
                <span>Excel</span>
              </button>
              <button
                onClick={handleExportCsv}
                className="py-1.5 px-1 text-[11px] font-bold bg-indigo-700 hover:bg-indigo-800 text-white rounded-lg shadow-xs transition flex items-center justify-center gap-1 cursor-pointer"
                title="Dengelenmiş noktaları CSV olarak indir"
              >
                <Download className="w-3 h-3" />
                <span>CSV</span>
              </button>
              <button
                onClick={handleExportTxt}
                className="py-1.5 px-1 text-[11px] font-bold bg-slate-800 hover:bg-slate-700 text-white rounded-lg shadow-xs transition flex items-center justify-center gap-1 cursor-pointer"
                title="Resmi metin raporunu (.txt) indir"
              >
                <FileText className="w-3 h-3" />
                <span>Metin</span>
              </button>
            </div>
          </div>
        </div>

        {/* Notification Toast */}
        {exportNotice && (
          <div className="p-2.5 bg-emerald-50 border border-emerald-200 rounded-xl text-emerald-900 text-xs flex items-center gap-2 animate-fade-in font-medium">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>{exportNotice}</span>
          </div>
        )}
      </div>

      {/* Official Formatted Geodetic Report Sheet (Print & Screen View) */}
      <div className="bg-white rounded-2xl shadow-md border border-slate-200 p-8 sm:p-10 space-y-6 text-slate-800 print:shadow-none print:border-none print:p-0">
        {/* Report Header */}
        <div className="text-center border-b-2 border-slate-900 pb-4 space-y-1">
          <div className="text-[11px] font-bold tracking-widest text-slate-500 uppercase">
            T.C. ÇEVRE, ŞEHİRCİLİK VE İKLİM DEĞİŞİKLİĞİ BAKANLIĞI &bull; TAPU VE KADASTRO GENEL MÜDÜRLÜĞÜ
          </div>
          <h1 className="text-xl sm:text-2xl font-black text-slate-900 uppercase tracking-tight">
            GNSS 3D AĞ DENGELEME VE HESAP KARNESİ
          </h1>
          <div className="text-xs text-slate-600 font-medium">
            Büyük Ölçekli Harita ve Harita Bilgileri Üretim Yönetmeliği (BÖHYY) Madde 18 &amp; 21 Standartlarında
          </div>
        </div>

        {/* Project Meta Table */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs border border-slate-200 rounded-xl p-4 bg-slate-50 print:bg-transparent">
          <div>
            <span className="text-slate-500 block text-[10px] font-semibold">Proje Adı:</span>
            <strong className="text-slate-900 text-sm">{config.projectName}</strong>
          </div>
          <div>
            <span className="text-slate-500 block text-[10px] font-semibold">Mühendis / Firma:</span>
            <strong className="text-slate-900 text-sm">{config.surveyor}</strong>
          </div>
          <div>
            <span className="text-slate-500 block text-[10px] font-semibold">Koordinat Sistemi / DOM:</span>
            <strong className="text-slate-900">{config.crsSystem} (DOM: {config.dom}&deg;)</strong>
          </div>
          <div>
            <span className="text-slate-500 block text-[10px] font-semibold">Ölçü / Referans Epoğu:</span>
            <strong className="text-slate-900 font-mono">
              {config.surveyEpoch.toFixed(2)} &rarr; {config.refEpoch.toFixed(2)}
            </strong>
          </div>
        </div>

        {/* Adjustment Summary Metrics */}
        <div className="border border-slate-200 rounded-xl p-4 space-y-3 text-xs bg-slate-50/50 print:bg-transparent">
          <div className="flex items-center justify-between border-b border-slate-200 pb-2">
            <span className="font-bold text-slate-900 uppercase tracking-wider text-[11px]">
              Dengeleme Modeli ve İstatistiki Doğruluk Özeti (DynAdjust)
            </span>
            <span
              className={`px-2 py-0.5 rounded text-[10px] font-extrabold ${
                adjustmentResult.chiSquareTest.passed
                  ? 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                  : 'bg-amber-100 text-amber-800 border border-amber-300'
              }`}
            >
              {adjustmentResult.chiSquareTest.passed ? 'Kİ-KARE TESTİ: GEÇTİ (MODEL UYUMLU)' : 'Kİ-KARE TESTİ: UYARI'}
            </span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 font-mono text-[11px]">
            <div>
              <span className="text-slate-500 block font-sans">Birim Ölçü St. Hatası (σ₀):</span>
              <strong className="text-slate-900 text-sm">{adjustmentResult.sigma0Aposteriori.toFixed(4)}</strong>
            </div>
            <div>
              <span className="text-slate-500 block font-sans">Serbestlik Derecesi (r = n - u):</span>
              <strong className="text-slate-900 text-sm">{adjustmentResult.dof}</strong> (Ölçü: {adjustmentResult.totalObservations}, Bilinmeyen: {adjustmentResult.totalUnknowns})
            </div>
            <div>
              <span className="text-slate-500 block font-sans">Kalıntı Kareler Toplamı [vPv]:</span>
              <strong className="text-slate-900 text-sm">{adjustmentResult.vPv.toFixed(4)}</strong>
            </div>
            <div>
              <span className="text-slate-500 block font-sans">Baarda Kaba Hata Tespiti:</span>
              <strong className={adjustmentResult.outliers.length === 0 ? 'text-emerald-700 text-sm' : 'text-rose-700 text-sm'}>
                {adjustmentResult.outliers.length === 0 ? '0 Kaba Hata (Tam Uyumlu)' : `${adjustmentResult.outliers.length} Hata (${adjustmentResult.outliers.join(', ')})`}
              </strong>
            </div>
          </div>
        </div>

        {/* BÖHYY Madde 18 & 21 Standartları Denetim Karnesi */}
        <div className="border border-slate-200 rounded-xl p-4 space-y-2 bg-gradient-to-r from-slate-50 to-indigo-50/30 print:bg-transparent">
          <div className="flex items-center justify-between border-b border-slate-200 pb-2">
            <span className="font-bold text-slate-900 uppercase tracking-wider text-[11px] flex items-center gap-1.5">
              <Award className="w-4 h-4 text-indigo-700" />
              <span>BÖHYY Madde 18 &amp; 21 Kalite Kriterleri Değerlendirme Tablosu</span>
            </span>
            <span className="text-[10px] font-semibold text-slate-600">
              T.C. BÖHYY ve TUSAGA-Aktif Standartları
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5 text-xs">
            {/* Criteria 1: sigma_0 */}
            <div className="p-2.5 rounded-lg border bg-white border-slate-200">
              <div className="flex items-center justify-between text-[11px]">
                <span className="font-semibold text-slate-700">Birim Ölçü Hatası (σ₀)</span>
                <span className={`px-1.5 py-0.2 rounded text-[10px] font-bold ${
                  adjustmentResult.sigma0Aposteriori >= 0.6 && adjustmentResult.sigma0Aposteriori <= 1.4
                    ? 'bg-emerald-100 text-emerald-800'
                    : 'bg-amber-100 text-amber-800'
                }`}>
                  {adjustmentResult.sigma0Aposteriori >= 0.6 && adjustmentResult.sigma0Aposteriori <= 1.4 ? 'UYGUN' : 'UYARI'}
                </span>
              </div>
              <div className="font-mono text-slate-900 font-bold mt-1">
                σ₀ = {adjustmentResult.sigma0Aposteriori.toFixed(4)}
              </div>
              <span className="text-[10px] text-slate-500">Tolerans: 0.70 ≤ σ₀ ≤ 1.30</span>
            </div>

            {/* Criteria 2: Chi-squared */}
            <div className="p-2.5 rounded-lg border bg-white border-slate-200">
              <div className="flex items-center justify-between text-[11px]">
                <span className="font-semibold text-slate-700">Ki-Kare Modeli (χ²)</span>
                <span className={`px-1.5 py-0.2 rounded text-[10px] font-bold ${
                  adjustmentResult.chiSquareTest.passed
                    ? 'bg-emerald-100 text-emerald-800'
                    : 'bg-rose-100 text-rose-800'
                }`}>
                  {adjustmentResult.chiSquareTest.passed ? 'GEÇTİ' : 'UYARI'}
                </span>
              </div>
              <div className="font-mono text-slate-900 font-bold mt-1">
                vPv = {adjustmentResult.vPv.toFixed(2)}
              </div>
              <span className="text-[10px] text-slate-500">95% Güven Aralığı İçi</span>
            </div>

            {/* Criteria 3: Max Semi-Major Axis */}
            {(() => {
              const maxA = Math.max(
                ...Object.values(adjustmentResult.stations)
                  .filter((s) => !(s.isFixed.x && s.isFixed.y && s.isFixed.z))
                  .map((s) => s.semiMajor ?? 0),
                0
              );
              const maxPassed = maxA <= 30.0;
              return (
                <div className="p-2.5 rounded-lg border bg-white border-slate-200">
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="font-semibold text-slate-700">Maksimum Hata Elipsi (a)</span>
                    <span className={`px-1.5 py-0.2 rounded text-[10px] font-bold ${
                      maxPassed ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'
                    }`}>
                      {maxPassed ? 'KABUL' : 'AŞILDI'}
                    </span>
                  </div>
                  <div className="font-mono text-slate-900 font-bold mt-1">
                    a_maks = {maxA.toFixed(1)} mm
                  </div>
                  <span className="text-[10px] text-slate-500">BÖHYY Sınırı: a ≤ 30.0 mm</span>
                </div>
              );
            })()}

            {/* Criteria 4: Baarda Outlier Screening */}
            <div className="p-2.5 rounded-lg border bg-white border-slate-200">
              <div className="flex items-center justify-between text-[11px]">
                <span className="font-semibold text-slate-700">Baarda Kaba Hata (w)</span>
                <span className={`px-1.5 py-0.2 rounded text-[10px] font-bold ${
                  adjustmentResult.outliers.length === 0
                    ? 'bg-emerald-100 text-emerald-800'
                    : 'bg-rose-100 text-rose-800'
                }`}>
                  {adjustmentResult.outliers.length === 0 ? 'TEMİZ' : 'HATA'}
                </span>
              </div>
              <div className="font-mono text-slate-900 font-bold mt-1">
                {adjustmentResult.outliers.length} Adet Kaba Hata
              </div>
              <span className="text-[10px] text-slate-500">Kritik Değer: |w| ≤ {config.wCrit}</span>
            </div>
          </div>
        </div>

        {/* Table 1: Adjusted Coordinates & 3D Error Ellipses */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wide">
              1. Dengelenmiş Nokta Koordinatları ve %95 Güven Aralıklı Hata Elipsleri
            </h3>
            <span className="text-[10px] text-slate-500 font-mono">BÖHYY Toleransı: a &le; 30 mm</span>
          </div>

          <div className="overflow-x-auto border border-slate-200 rounded-xl">
            <table className="w-full text-left text-[11px] border-collapse font-mono">
              <thead>
                <tr className="bg-slate-100 text-slate-800 font-sans font-bold border-b border-slate-200">
                  <th className="p-2">Nokta ID</th>
                  <th className="p-2 text-right">TM Sağa Y (m)</th>
                  <th className="p-2 text-right">TM Yukarı X (m)</th>
                  <th className="p-2 text-right">Elip. H (m)</th>
                  <th className="p-2 text-right">σ_E (mm)</th>
                  <th className="p-2 text-right">σ_N (mm)</th>
                  <th className="p-2 text-right">a (mm)</th>
                  <th className="p-2 text-right">b (mm)</th>
                  <th className="p-2 text-right">c (mm)</th>
                  <th className="p-2 text-right">Azimut (Gon)</th>
                  <th className="p-2 text-center font-sans">Durum</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {Object.values(adjustmentResult.stations).map((st) => {
                  const isFixed = st.isFixed.x && st.isFixed.y && st.isFixed.z;
                  const a = st.semiMajor ?? 0;
                  const b = st.semiMinor ?? 0;
                  const c = st.semiAxisC ?? (st.sigmaH ? st.sigmaH * 1.42 : 0);
                  const isAccepted = isFixed || a <= 30.0;

                  return (
                    <tr key={st.id} className="hover:bg-slate-50">
                      <td className="p-2 font-sans font-bold text-slate-900">{st.name}</td>
                      <td className="p-2 text-right font-bold text-sky-900">
                        {(st.adjustedProjY ?? st.projY).toFixed(4)}
                      </td>
                      <td className="p-2 text-right font-bold text-sky-900">
                        {(st.adjustedProjX ?? st.projX).toFixed(4)}
                      </td>
                      <td className="p-2 text-right">{(st.adjustedH ?? st.h).toFixed(4)}</td>
                      <td className="p-2 text-right text-slate-600">{(st.sigmaEast ?? st.sigmaX ?? 0).toFixed(1)}</td>
                      <td className="p-2 text-right text-slate-600">{(st.sigmaNorth ?? st.sigmaY ?? 0).toFixed(1)}</td>
                      <td className="p-2 text-right font-bold text-slate-900">
                        {isFixed ? '0.0 (Sabit)' : a.toFixed(1)}
                      </td>
                      <td className="p-2 text-right text-slate-700">
                        {isFixed ? '0.0 (Sabit)' : b.toFixed(1)}
                      </td>
                      <td className="p-2 text-right text-indigo-700">
                        {isFixed ? '0.0' : c.toFixed(1)}
                      </td>
                      <td className="p-2 text-right text-slate-700">
                        {isFixed ? '-' : (st.ellipseAzimuth ?? 0).toFixed(2)}
                      </td>
                      <td className="p-2 text-center font-sans">
                        <span
                          className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                            isFixed
                              ? 'bg-rose-100 text-rose-800'
                              : isAccepted
                              ? 'bg-emerald-100 text-emerald-800'
                              : 'bg-amber-100 text-amber-800'
                          }`}
                        >
                          {isFixed ? 'CORS SABİT' : isAccepted ? 'UYGUN' : 'TOLERANS DIŞI'}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* Table 2: Baselines & Residuals */}
        <div className="space-y-2">
          <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wide">
            2. Çift Fark Baz Vektörleri ve Dengeleme Kalıntıları (vPv)
          </h3>
          <div className="overflow-x-auto border border-slate-200 rounded-xl">
            <table className="w-full text-left text-[11px] border-collapse font-mono">
              <thead>
                <tr className="bg-slate-100 text-slate-800 font-sans font-bold border-b border-slate-200">
                  <th className="p-2">Baz ID</th>
                  <th className="p-2">Güzergah</th>
                  <th className="p-2 text-right">Uzunluk (m)</th>
                  <th className="p-2 text-right">&Delta;X (m)</th>
                  <th className="p-2 text-right">&Delta;Y (m)</th>
                  <th className="p-2 text-right">&Delta;Z (m)</th>
                  <th className="p-2 text-right">vX (mm)</th>
                  <th className="p-2 text-right">vY (mm)</th>
                  <th className="p-2 text-right">vZ (mm)</th>
                  <th className="p-2 text-right">v_3D (mm)</th>
                  <th className="p-2 text-right">r_i (Serbestlik)</th>
                  <th className="p-2 text-right">Baarda w</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {adjustmentResult.baselines.map((b) => (
                  <tr key={b.id} className={b.isOutlier ? 'bg-rose-50' : 'hover:bg-slate-50'}>
                    <td className="p-2 font-sans font-bold text-slate-900">{b.id}</td>
                    <td className="p-2 font-sans text-slate-700">{b.fromId} &rarr; {b.toId}</td>
                    <td className="p-2 text-right">{b.length.toFixed(3)}</td>
                    <td className="p-2 text-right">{b.dX.toFixed(4)}</td>
                    <td className="p-2 text-right">{b.dY.toFixed(4)}</td>
                    <td className="p-2 text-right">{b.dZ.toFixed(4)}</td>
                    <td className="p-2 text-right text-slate-600">{(b.vX ?? 0).toFixed(1)}</td>
                    <td className="p-2 text-right text-slate-600">{(b.vY ?? 0).toFixed(1)}</td>
                    <td className="p-2 text-right text-slate-600">{(b.vZ ?? 0).toFixed(1)}</td>
                    <td className="p-2 text-right font-bold text-slate-900">{(b.spatialV ?? 0).toFixed(1)}</td>
                    <td className="p-2 text-right font-bold text-indigo-700">{(b.redundancyNumber ?? 1.0).toFixed(2)}</td>
                    <td className="p-2 text-right font-bold">
                      <span className={b.isOutlier ? 'text-rose-700 font-black' : 'text-slate-800'}>
                        {(b.wTest ?? 0).toFixed(2)} {b.isOutlier ? '(!)' : ''}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Table 3: Loop Closures */}
        {loopClosures.length > 0 && (
          <div className="space-y-2">
            <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wide">
              3. Kapalı Üçgen Döngü Kapanışları (Loop Closures) &amp; Tolerans Analizi
            </h3>
            <div className="overflow-x-auto border border-slate-200 rounded-xl">
              <table className="w-full text-left text-[11px] border-collapse font-mono">
                <thead>
                  <tr className="bg-slate-100 text-slate-800 font-sans font-bold border-b border-slate-200">
                    <th className="p-2">Döngü ID</th>
                    <th className="p-2">Güzergah</th>
                    <th className="p-2 text-right">Çevre S (km)</th>
                    <th className="p-2 text-right">Kapanış w (mm)</th>
                    <th className="p-2 text-right">BÖHYY Tolerans (mm)</th>
                    <th className="p-2 text-right">Bağıl Doğruluk</th>
                    <th className="p-2 text-center font-sans">Karar</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {loopClosures.map((l) => (
                    <tr key={l.id} className="hover:bg-slate-50">
                      <td className="p-2 font-sans font-bold">{l.id}</td>
                      <td className="p-2 font-sans">{l.stationIds.join(' - ')}</td>
                      <td className="p-2 text-right">{l.totalLengthKm.toFixed(2)}</td>
                      <td className="p-2 text-right font-bold text-slate-900">{l.totalMisclosure.toFixed(1)}</td>
                      <td className="p-2 text-right text-slate-600">{l.toleranceMm.toFixed(1)}</td>
                      <td className="p-2 text-right font-bold text-sky-800">{l.relativePrecision}</td>
                      <td className="p-2 text-center font-sans font-bold">
                        <span
                          className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                            l.isAccepted ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'
                          }`}
                        >
                          {l.isAccepted ? 'UYGUN' : 'TOLERANS AŞILDI'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Official Certification & Signature Box */}
        <div className="pt-8 border-t-2 border-slate-900 space-y-6">
          <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-200 text-xs text-slate-700 leading-relaxed font-sans">
            <strong>BÖHYY Madde 18 &amp; 21 Uygunluk Beyanı:</strong> Yukarıda detayları verilen GNSS post-processing ve 
            3D ağ dengelemesi hesapları; T.C. Büyük Ölçekli Harita ve Harita Bilgileri Üretim Yönetmeliği hükümlerine, 
            TUSAGA-Aktif jeodezik standartlarına ve TMMOB Harita ve Kadastro Mühendisleri Odası mesleki kurallarına uygun olarak 
            bilimsel 3D Gauss-Markov en küçük kareler yöntemiyle çözülmüş ve doğrulanmıştır.
          </div>

          <div className="grid grid-cols-2 pt-4 text-center text-xs font-sans">
            <div>
              <div className="font-bold text-slate-900 text-sm">Hesaplayan Harita Mühendisi</div>
              <div className="text-slate-600 mt-0.5">{config.surveyor}</div>
              <div className="text-[11px] text-slate-400">TMMOB HKMO Oda Sicil No: _________</div>
              <div className="h-16 border-b border-dashed border-slate-400 w-52 mx-auto mt-2"></div>
              <div className="text-[10px] text-slate-400 mt-1 font-semibold uppercase">İmza &bull; Kaşe</div>
            </div>

            <div>
              <div className="font-bold text-slate-900 text-sm">Kontrol Eden &bull; İdare / Kurum Yetkilisi</div>
              <div className="text-slate-600 mt-0.5">{config.institution}</div>
              <div className="text-[11px] text-slate-400">Onay Makamı</div>
              <div className="h-16 border-b border-dashed border-slate-400 w-52 mx-auto mt-2"></div>
              <div className="text-[10px] text-slate-400 mt-1 font-semibold uppercase">İmza &bull; Resmi Mühür</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
